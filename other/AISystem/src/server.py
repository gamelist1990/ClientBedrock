import asyncio
import os
import traceback
import json
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import List, Optional, Any, Type

script_dir = os.path.dirname(os.path.abspath(__file__))
try:
    from Module.g4f.client import Client
    from Module.g4f.Provider import ProviderUtils, BaseProvider
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
    version="1.2.0",
)


class ChatRequest(BaseModel):
    provider_name: str
    model: str
    message: str
    auth_key: Optional[str] = None
    stream: Optional[bool] = False


class ModelListRequest(BaseModel):
    filter: Optional[str] = None


async def run_g4f_task(
    func, provider_class: Type[BaseProvider], model_name: str, message_content: str
):
    """ブロッキングする可能性のある関数を別スレッドで実行します (非ストリーミング用)。"""
    try:
        return await run_in_threadpool(
            func, provider_class, model_name, message_content
        )
    except Exception as e:
        print(
            f"g4f操作中にエラーが発生しました (非ストリーミング, Provider: {provider_class.__name__}, Model: {model_name}): {e}"
        )
        traceback.print_exc()
        if isinstance(e, ProviderNotFoundError):
            raise HTTPException(
                status_code=404,
                detail=f"プロバイダー内部でモデルが見つからないか、サポートされていません: {str(e)}",
            )
        raise HTTPException(
            status_code=503,
            detail=f"AIプロバイダーサービスが利用不可か、エラーが発生しました: {str(e)}",
        )


async def stream_response_generator(
    prov_class: Type[BaseProvider], model_name: str, message_content: str
):
    """g4fからのストリーミング応答をSSE形式で生成する非同期ジェネレータ。"""
    client = Client(provider=prov_class)
    try:
        stream = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": message_content}],
            stream=True,
        )

        for chunk in stream:
            content = chunk.choices[0].delta.content
            if content:
                payload = json.dumps({"delta": content}, ensure_ascii=False)
                yield f"data: {payload}\n\n"
                await asyncio.sleep(0.01)

        final_payload = json.dumps({"end_of_stream": True}, ensure_ascii=False)
        yield f"data: {final_payload}\n\n"

    except Exception as e:
        print(
            f"ストリーミングエラー (Provider: {prov_class.__name__}, Model: {model_name}): {e}"
        )
        traceback.print_exc()
        error_payload = json.dumps(
            {"error": str(e), "provider": prov_class.__name__, "model": model_name},
            ensure_ascii=False,
        )
        yield f"event: error\ndata: {error_payload}\n\n"


@app.post("/models", response_model=List[str])
async def get_available_models(request_body: ModelListRequest):
    """利用可能なプロバイダー識別子のリストを返します。"""
    try:
        available = list(ProviderUtils.convert.keys())
        return available
    except Exception as e:
        print(f"モデルリスト(プロバイダーリスト)の取得中にエラーが発生しました: {e}")
        raise HTTPException(
            status_code=500, detail="g4fからプロバイダーリストを取得できませんでした。"
        )


@app.post("/chat")
async def chat_with_ai(request_data: ChatRequest):
    """
    AIと対話します。stream=Trueの場合、SSEでストリーミング応答を返します。
    """
    print(
        f"チャットリクエスト受信 (Provider: {request_data.provider_name}, Model: {request_data.model}, Stream: {request_data.stream})"
    )

    provider_class = ProviderUtils.convert.get(request_data.provider_name)
    if not provider_class:
        available_providers = list(ProviderUtils.convert.keys())
        raise HTTPException(
            status_code=400,
            detail=f"指定されたProvider名 '{request_data.provider_name}' は無効です。利用可能なProvider: {available_providers}",
        )

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
            prov_class: Type[BaseProvider], model_name: str, message_content: str
        ):
            client = Client(provider=prov_class)
            try:
                response = client.chat.completions.create(
                    model=model_name,
                    messages=[{"role": "user", "content": message_content}],
                    stream=False,
                )
                if response.choices and response.choices[0].message:
                    return response.choices[0].message.content
                else:
                    print(
                        f"警告: Provider '{prov_class.__name__}' から予期しない応答形式 (非ストリーミング)。"
                    )
                    return None
            except ProviderNotFoundError as e:
                print(
                    f"Provider '{prov_class.__name__}' 内でエラー (非ストリーミング): {e}"
                )
                traceback.print_exc()
                raise ProviderNotFoundError(
                    f"Provider '{prov_class.__name__}' 内でモデル '{model_name}' が見つからないか、エラーが発生しました: {e}"
                )
            except Exception as e:
                print(
                    f"client.chat.completions.create中にエラー発生 (非ストリーミング, Provider: {prov_class.__name__}, Model: {model_name}): {e}"
                )
                traceback.print_exc()
                raise e

        ai_response = await run_g4f_task(
            create_completion_sync,
            provider_class,
            request_data.model,
            request_data.message,
        )

        if ai_response is None:
            raise HTTPException(
                status_code=500,
                detail="AIプロバイダーから有効な応答を取得できませんでした。",
            )

        print(f"応答を送信中 (非ストリーミング): {ai_response[:100]}...")
        return {"response": ai_response}


if __name__ == "__main__":
    import uvicorn

    print("Uvicornサーバーを起動中...")
    uvicorn.run("server:app", host="0.0.0.0", port=9002, reload=True)
