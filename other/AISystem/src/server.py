import asyncio
import os
import traceback
import json
from fastapi import FastAPI, HTTPException, Request

# Import PlainTextResponse, HTMLResponse, and httpx
from fastapi.responses import StreamingResponse, PlainTextResponse, HTMLResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import List, Optional, Any, Type
import httpx  # Add httpx for making HTTP requests
import markdown  # Add markdown for converting Markdown to HTML

script_dir = os.path.dirname(os.path.abspath(__file__))
try:
    from Module.g4f.client import Client
    from Module.g4f.Provider import ProviderUtils, BaseProvider
    # Import Model from g4f
    from Module.g4f import Model
    import Module.g4f.debug
    from Module.g4f.cookies import set_cookies_dir, read_cookie_files
    from Module.g4f.errors import ProviderNotFoundError

    Module.g4f.debug.logging = True
    cookies_dir = os.path.join(script_dir, "har_and_cookies")
    set_cookies_dir(cookies_dir)
    read_cookie_files(cookies_dir)

    print(f"g4fが初期化されました。Cookieディレクトリ: {cookies_dir}")

except ImportError as e:
    print(f"g4fモジュールのインポートエラー: {e}")
    print(
        "'Module/g4f' ディレクトリが main.py と正しく相対配置されているか確認してください。"
    )
    exit(1)
except Exception as e:
    print(f"g4fの初期化中にエラーが発生しました: {e}")
    traceback.print_exc()
    exit(1)

app = FastAPI(
    title="g4f バックエンド API (Provider/Model分離版, Streaming対応)",
    description="Provider名とModel名を指定してg4f AIモデルと対話するAPIサーバー(ストリーミング対応)",
    version="1.2.2", # バージョンを更新 (機能追加のため)
)

# --- Define the URL for the README ---
# 例: Markdownの場合
# README_URL = "https://raw.githubusercontent.com/gamelist1990/ClientBedrock/refs/heads/main/other/AISystem/README.md"
# 例: HTMLの場合 (テスト用に別のURLを指定する場合)
README_URL = "https://raw.githubusercontent.com/gamelist1990/ClientBedrock/refs/heads/main/other/AISystem/index.html"


# --- Modified route for the root path ---
@app.get("/", response_class=HTMLResponse)
async def get_readme():
    """
    ルートパス(/)にアクセスした際に指定されたURLからコンテンツを取得します。
    URLが.htmlで終わる場合はそのままHTMLとして、それ以外はMarkdownとして解釈しHTML表示します。
    """
    try:
        async with httpx.AsyncClient() as client:
            print(f"Fetching content from: {README_URL}")
            response = await client.get(README_URL)
            response.raise_for_status() # HTTPエラーがあれば例外を発生させる
            content = response.text
            print("Content fetched successfully.")

            # URLの末尾をチェックして処理を分岐
            if README_URL.lower().endswith(".html"):
                print("URL ends with .html, returning content as HTML.")
                # HTMLファイルの場合はそのまま返す
                return HTMLResponse(content=content)
            else:
                print("URL does not end with .html, treating as Markdown.")
                # それ以外の場合はMarkdownとしてHTMLに変換
                html_content = markdown.markdown(content)
                return HTMLResponse(content=html_content)

    except httpx.RequestError as exc:
        error_message = f"Error while requesting content from {exc.request.url!r}: {exc}"
        print(error_message)
        raise HTTPException(
            status_code=503, # Service Unavailable
            detail=f"Could not fetch content from source (Request Error): {README_URL}",
        )
    except httpx.HTTPStatusError as exc:
        error_message = f"Error response {exc.response.status_code} while requesting content from {exc.request.url!r}."
        print(error_message)
        raise HTTPException(
            status_code=502, # Bad Gateway (or use exc.response.status_code if appropriate)
            detail=f"Could not fetch content from source (Status: {exc.response.status_code}): {README_URL}",
        )
    except Exception as e:
        error_message = f"An unexpected error occurred while fetching content: {e}"
        print(error_message)
        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail=f"Internal server error while fetching content from {README_URL}."
        )


# --- Modified Pydantic Models ---
class ChatRequest(BaseModel):
    provider_name: Optional[str] = None
    model: str
    message: str
    auth_key: Optional[str] = None
    stream: Optional[bool] = False


class ModelListRequest(BaseModel):
    filter: Optional[str] = None
    # Add 'type' field, default to 'provider'
    type: Optional[str] = "provider"


# --- Existing Helper Functions ---
async def run_g4f_task(
    func,
    provider_class: Optional[Type[BaseProvider]],
    model_name: str,
    message_content: str,
):
    """ブロッキングする可能性のある関数を別スレッドで実行します (非ストリーミング用)。"""
    try:
        return await run_in_threadpool(
            func, provider_class, model_name, message_content
        )
    except Exception as e:
        print(
            f"g4f操作中にエラーが発生しました (非ストリーミング, Provider: {provider_class.__name__ if provider_class else 'None'}, Model: {model_name}): {e}"
        )
        traceback.print_exc()
        # Keep existing error handling for g4f tasks
        if isinstance(e, ProviderNotFoundError):
            # Re-raise specific ProviderNotFoundError if caught directly by run_in_threadpool wrapper
            raise HTTPException(
                status_code=404,
                detail=f"プロバイダー内部でモデルが見つからないか、サポートされていません: {str(e)}",
            )
        # Check if the exception has an attribute indicating it's a ProviderNotFoundError raised within create_completion_sync
        elif hasattr(e, "__cause__") and isinstance(e.__cause__, ProviderNotFoundError):
            raise HTTPException(
                status_code=404,
                detail=f"プロバイダー内部でモデルが見つからないか、サポートされていません: {str(e.__cause__)}",
            )
        else:
            raise HTTPException(
                status_code=503,
                detail=f"AIプロバイダーサービスが利用不可か、エラーが発生しました: {str(e)}",
            )


async def stream_response_generator(
    prov_class: Optional[Type[BaseProvider]], model_name: str, message_content: str
):
    """g4fからのストリーミング応答をSSE形式で生成する非同期ジェネレータ。"""
    client = Client(provider=prov_class if prov_class else None)
    try:
        stream = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": message_content}],
            stream=True,
        )

        async for chunk in stream:  # Use async for with httpx stream
            content = chunk.choices[0].delta.content
            if content:
                payload = json.dumps({"delta": content}, ensure_ascii=False)
                yield f"data: {payload}\n\n"
                await asyncio.sleep(0.01)  # Keep small sleep for yielding control

        final_payload = json.dumps({"end_of_stream": True}, ensure_ascii=False)
        yield f"data: {final_payload}\n\n"

    except Exception as e:
        print(
            f"ストリーミングエラー (Provider: {prov_class.__name__ if prov_class else 'None'}, Model: {model_name}): {e}"
        )
        traceback.print_exc()
        error_payload = json.dumps(
            {
                "error": str(e),
                "provider": prov_class.__name__ if prov_class else "None",
                "model": model_name,
            },
            ensure_ascii=False,
        )
        yield f"event: error\ndata: {error_payload}\n\n"


# --- Modified API Endpoints ---
@app.post("/models", response_model=List[str])
async def get_available_identifiers(request_body: ModelListRequest):
    """
    利用可能な識別子のリストを返します。
    リクエストボディの type パラメータに応じて、プロバイダー ('provider') またはモデル ('model') のリストを返します。
    デフォルトは 'provider' です。filter パラメータで結果をフィルタリングできます。
    """
    try:
        identifier_type = request_body.type
        available: List[str] = [] # Initialize available list

        if identifier_type == "provider":
            available = list(ProviderUtils.convert.keys())
            print("プロバイダーリストを取得しました。")
        elif identifier_type == "model":
            # Use the imported Model class and call its __all__ method
            available = Model.__all__()
            print("モデルリストを取得しました。")
        else:
            # Invalid type
            raise HTTPException(
                status_code=400, # Bad Request for invalid type
                detail=f"無効な type '{identifier_type}' です。有効な type は 'provider' または 'model' です。"
            )

        # Apply filter if provided
        if request_body.filter:
            print(f"フィルター '{request_body.filter}' を適用します...")
            # Simple case-insensitive substring filter
            original_count = len(available)
            available = [
                item for item in available if request_body.filter.lower() in item.lower()
            ]
            print(f"フィルター適用後: {original_count}件 -> {len(available)}件")

        return available

    except HTTPException:
         # Re-raise HTTPException directly to preserve status code and detail
         raise
    except Exception as e:
        # Use requested type in error message, default to 'unknown' if request_body is None
        error_type = request_body.type if request_body else 'unknown'
        print(f"{error_type}リストの取得中に予期せぬエラーが発生しました: {e}")
        traceback.print_exc() # Add traceback for better debugging
        raise HTTPException(
            status_code=500, detail=f"g4fから{error_type}リストを取得できませんでした。"
        )


@app.post("/chat")
async def chat_with_ai(request_data: ChatRequest):
    """
    AIと対話します。stream=Trueの場合、SSEでストリーミング応答を返します。
    """
    print(
        f"チャットリクエスト受信 (Provider: {request_data.provider_name}, Model: {request_data.model}, Stream: {request_data.stream})"
    )

    provider_class = None
    if request_data.provider_name:
        provider_class = ProviderUtils.convert.get(request_data.provider_name)
        if not provider_class:
            available_providers = list(ProviderUtils.convert.keys())
            raise HTTPException(
                status_code=400,  # Use 400 Bad Request for invalid provider name
                detail=f"指定されたProvider名 '{request_data.provider_name}' は無効です。利用可能なProvider: {available_providers}",
            )
    # If provider_name is None, Client(provider=None) will use the default or handle it internally.

    if request_data.stream:
        print("ストリーミング応答を開始します...")
        return StreamingResponse(
            stream_response_generator(
                provider_class, request_data.model, request_data.message
            ),
            media_type="text/event-stream",
        )

    else:
        print("非ストリーミング応答を生成します...")

        def create_completion_sync(
            prov_class: Optional[Type[BaseProvider]],
            model_name: str,
            message_content: str,
        ):
            # This function runs in a separate thread via run_in_threadpool
            client = Client(provider=prov_class if prov_class else None)
            try:
                response = client.chat.completions.create(
                    model=model_name,
                    messages=[{"role": "user", "content": message_content}],
                    stream=False,
                )
                # Check response structure carefully
                if (
                    response
                    and response.choices
                    and response.choices[0].message
                    and response.choices[0].message.content is not None
                ):
                    return response.choices[0].message.content
                else:
                    # Log the actual response for debugging if it's unexpected
                    print(
                        f"警告: Provider '{prov_class.__name__ if prov_class else 'Default'}' から予期しない応答形式 (非ストリーミング)。Response: {response}"
                    )
                    # Raise an exception instead of returning None to be caught by run_g4f_task
                    raise ValueError(
                        "AIプロバイダーから有効な応答コンテンツを取得できませんでした。"
                    )

            except ProviderNotFoundError as e:
                # Re-raise ProviderNotFoundError to be caught by run_g4f_task's specific handling
                print(
                    f"Provider '{prov_class.__name__ if prov_class else 'Default'}' 内でエラー (非ストリーミング): {e}"
                )
                # No need to print traceback here, run_g4f_task will do it.
                raise ProviderNotFoundError(
                    f"Provider '{prov_class.__name__ if prov_class else 'Default'}' 内でモデル '{model_name}' が見つからないか、エラーが発生しました: {e}"
                ) from e  # Preserve original exception context
            except Exception as e:
                print(
                    f"client.chat.completions.create中にエラー発生 (非ストリーミング, Provider: {prov_class.__name__ if prov_class else 'Default'}, Model: {model_name}): {e}"
                )
                # No need to print traceback here, run_g4f_task will do it.
                # Re-raise the original exception to be caught by run_g4f_task
                raise e

        # run_g4f_task will handle exceptions from create_completion_sync
        ai_response = await run_g4f_task(
            create_completion_sync,
            provider_class,
            request_data.model,
            request_data.message,
        )

        # ai_response should not be None if create_completion_sync raises exceptions properly
        # The HTTPException logic is now primarily within run_g4f_task
        print(
            f"応答を送信中 (非ストリーミング): {ai_response[:100] if ai_response else 'N/A'}..."
        )
        return {"response": ai_response}


# --- Main execution block ---
if __name__ == "__main__":
    import uvicorn

    print("Uvicornサーバーを起動中...")
    # Consider removing reload=True for production environments
    uvicorn.run("server:app", host="0.0.0.0", port=9002, reload=True)
