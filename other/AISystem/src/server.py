import argparse
import shutil
import tempfile
import asyncio
import os
import traceback
import json
from fastapi import FastAPI, HTTPException
from fastapi.responses import (
    StreamingResponse,
    HTMLResponse,
    JSONResponse,
)
from fastapi.concurrency import run_in_threadpool
import gdown
from pydantic import BaseModel, Field
from typing import List, Optional, Any, Type, Dict
import httpx
import markdown
import time
import threading

script_dir = os.path.dirname(os.path.abspath(__file__))
har_and_cookies_dir = os.path.join(script_dir, "har_and_cookies")

try:
    from Module.g4f.client import Client, AsyncClient
    from Module.g4f.Provider import ProviderUtils, BaseProvider
    from Module.g4f import Model
    import Module.g4f.debug
    from Module.g4f.cookies import set_cookies_dir, read_cookie_files
    from Module.g4f.errors import ProviderNotFoundError, ModelNotFoundError

    Module.g4f.debug.logging = True
    set_cookies_dir(har_and_cookies_dir)

    print(f"g4fモジュールをロードしました。Cookieディレクトリ: {har_and_cookies_dir}")

except ImportError as e:
    print(f"g4fモジュールのインポートエラー: {e}")
    print(
        "'Module/g4f' ディレクトリが main.py と正しく相対配置されているか確認してください。"
    )
    exit(1)
except Exception as e:
    print(f"g4fの初期化準備中にエラーが発生しました: {e}")
    traceback.print_exc()
    exit(1)

app = FastAPI(
    title="g4f バックエンド API (Chat & Image Generation)",
    description="Provider/Modelを指定してg4f AIモデルと対話、または画像を生成するAPIサーバー(チャットはストリーミング対応)",
    version="1.4.2",
)

def download_and_sync_gdrive_folder(folder_url: str, output_dir: str) -> bool:
    """
    Google Drive のフォルダ URL からファイルをダウンロードし、指定ディレクトリに同期（上書き）します。

    Args:
        folder_url: Google Drive のフォルダ共有 URL。
        output_dir: ファイルを同期する先のディレクトリパス。

    Returns:
        ダウンロードと同期が成功した場合は True、失敗した場合は False。
    """
    print("-" * 30)
    print(f"Google Drive からデータダウンロード/同期開始: {folder_url}")
    print(f"同期先ディレクトリ: {output_dir}")

    os.makedirs(output_dir, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        download_path = tmpdir
        try:
            print(f"一時ディレクトリにダウンロード中: {download_path}")
            gdown.download_folder(
                url=folder_url, output=download_path, quiet=False, use_cookies=False
            )
            print("gdown によるダウンロード処理完了。")

            downloaded_items = os.listdir(download_path)
            if not downloaded_items:
                print(
                    "警告: Google Drive からダウンロードされましたが、一時ディレクトリが空です。Drive上のフォルダが空の可能性があります。"
                )
                print("同期完了 (アイテムなし)。")
                print("-" * 30)
                return True

            print(
                f"ダウンロードされたアイテム ({len(downloaded_items)}個): {downloaded_items}"
            )

            print(f"ファイルを {output_dir} に同期中（上書き）...")

            sync_count = 0
            error_count = 0
            for item_name in downloaded_items:
                source_path = os.path.join(download_path, item_name)
                dest_path = os.path.join(output_dir, item_name)

                try:
                    if os.path.lexists(dest_path):
                        if os.path.isdir(dest_path) and not os.path.islink(dest_path):
                            print(f"  既存ディレクトリを削除: {dest_path}")
                            shutil.rmtree(dest_path)
                        else:
                            print(f"  既存ファイル/リンクを削除: {dest_path}")
                            os.remove(dest_path)

                    print(f"  移動: {source_path} -> {dest_path}")
                    shutil.move(source_path, dest_path)
                    sync_count += 1

                except Exception as e:
                    error_count += 1
                    print(f"警告: アイテム '{item_name}' の同期中にエラー: {e}")

            if error_count > 0:
                print(
                    f"警告: {error_count} 個のアイテムの同期中にエラーが発生しました。"
                )

            if sync_count > 0:
                print(
                    f"{sync_count} 個のアイテムを {output_dir} に正常に同期しました。"
                )
            elif error_count == 0:
                print("同期されたアイテムはありませんでした。")

            print("同期完了。")
            print("-" * 30)
            return True

        except Exception as e:
            print(
                f"Google Drive からのダウンロード/同期中に致命的なエラーが発生しました: {e}"
            )
            traceback.print_exc()
            print("-" * 30)
            return False

README_URL = "https://raw.githubusercontent.com/gamelist1990/ClientBedrock/refs/heads/main/other/AISystem/index.html"

@app.get("/", response_class=HTMLResponse)
async def get_readme():
    """
    ルートパス(/)にアクセスした際に指定されたURLからコンテンツを取得します。
    URLが.htmlで終わる場合はそのままHTMLとして、それ以外はMarkdownとして解釈しHTML表示します。
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(README_URL, follow_redirects=True)
            response.raise_for_status()
            content = response.text
            return HTMLResponse(
                content=(
                    markdown.markdown(content)
                    if not README_URL.lower().endswith(".html")
                    else content
                )
            )
    except httpx.RequestError as exc:
        print(f"Request error fetching README: {exc}")
        raise HTTPException(
            status_code=503,
            detail=f"Could not fetch content from source (Request Error): {README_URL}",
        )
    except httpx.HTTPStatusError as exc:
        print(f"Status error fetching README: {exc}")
        raise HTTPException(
            status_code=502,
            detail=f"Could not fetch content from source (Status: {exc.response.status_code}): {README_URL}",
        )
    except Exception as e:
        print(f"Unexpected error fetching README: {e}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error while fetching content from {README_URL}.",
        )

IMAGE_REQUEST_LIMIT = 10
IMAGE_REQUEST_WINDOW_SECONDS = 60
image_request_timestamps: List[float] = []
image_request_lock = threading.Lock()

class ChatRequest(BaseModel):
    provider_name: Optional[str] = None
    model: str
    message: str
    api_key: Optional[str] = Field(
        None, description="Optional API key for specific providers/models."
    )
    auth_key: Optional[str] = None
    stream: Optional[bool] = False
    type: Optional[str] = Field(
        "chat", description="Type of request: 'chat', 'image@url', 'image@b64'"
    )

class ModelListRequest(BaseModel):
    filter: Optional[str] = None
    type: Optional[str] = "provider"

async def run_g4f_image_task(
    func,
    model_name: str,
    prompt: str,
    g4f_response_format: str,
    api_key: Optional[str] = None,
):
    """ブロッキングする可能性のある画像生成関数を別スレッドで実行します。"""
    try:
        return await run_in_threadpool(
            func, model_name, prompt, g4f_response_format, api_key
        )
    except Exception as e:
        print(
            f"g4f画像生成操作中にエラーが発生しました (Model: {model_name}, Format: {g4f_response_format}): {e}"
        )
        detail_message = f"画像生成サービスでエラーが発生しました: {str(e)}"
        status_code = 503
        if isinstance(e, ModelNotFoundError) or (
            hasattr(e, "__cause__") and isinstance(e.__cause__, ModelNotFoundError)
        ):
            cause = e.__cause__ if hasattr(e, "__cause__") else e
            detail_message = f"画像生成モデル '{model_name}' が見つからないか、サポートされていません: {str(cause)}"
            status_code = 404
        elif "Could not find the Flask application" in str(e):
            detail_message = f"画像プロバイダーの内部コンポーネント(Flask)が見つかりませんでした。G4Fの依存関係を確認してください。"
            status_code = 500
        elif isinstance(e, ValueError) and "有効な画像データ" in str(e):
            detail_message = str(e)
            status_code = 502
        raise HTTPException(status_code=status_code, detail=detail_message)

def generate_image_sync(
    model_name: str,
    prompt: str,
    g4f_response_format: str,
    api_key: Optional[str] = None,
):
    """Synchronous wrapper to run async image generation."""

    async def _generate():
        client = AsyncClient(api_key=api_key)
        try:
            print(
                f"画像生成を開始 (Model: {model_name}, Format: {g4f_response_format})"
            )
            response = await client.images.generate(
                model=model_name, prompt=prompt, response_format=g4f_response_format
            )
            print(f"画像生成完了 (Model: {model_name})")
            if response and response.data:
                image_data = response.data[0]
                if g4f_response_format == "url" and image_data.url:
                    return {"type": "url", "data": image_data.url}
                elif g4f_response_format == "b64_json" and image_data.b64_json:
                    return {"type": "b64", "data": image_data.b64_json}
                else:
                    print(
                        f"警告: G4F 画像生成から予期しない応答形式。Response: {response}"
                    )
                    raise ValueError("G4Fから有効な画像データを取得できませんでした。")
            else:
                print(f"警告: G4F 画像生成から空の応答。Response: {response}")
                raise ValueError("G4Fから画像データを取得できませんでした。")
        except ModelNotFoundError as e:
            print(f"画像生成モデル '{model_name}' が見つかりません: {e}")
            raise ModelNotFoundError(
                f"モデル '{model_name}' が見つかりません: {e}"
            ) from e
        except Exception as e:
            print(f"client.images.generate 中にエラー発生 (Model: {model_name}): {e}")
            raise e

    try:
        loop = asyncio.get_running_loop()
        return loop.run_until_complete(_generate())
    except RuntimeError as e:
        print(
            f"Asyncio runtime error in image generation thread (fallback to asyncio.run): {e}"
        )
        try:
            return asyncio.run(_generate())
        except RuntimeError as e2:
            print(f"Fallback asyncio.run also failed: {e2}")
            raise RuntimeError(
                "Failed to run async image generation in sync wrapper."
            ) from e2

async def stream_response_generator(
    prov_class: Optional[Type[BaseProvider]],
    model_name: str,
    message_content: str,
    api_key: Optional[str] = None,
):
    """g4fからのストリーミング応答をSSE形式で生成する非同期ジェネレータ。"""
    client = Client(provider=prov_class if prov_class else None, api_key=api_key)
    try:
        stream = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": message_content}],
            stream=True,
        )
        async for (
            chunk
        ) in stream:
            if chunk.choices and chunk.choices[0].delta:
                content = chunk.choices[0].delta.content
                if content:
                    payload = json.dumps({"delta": content}, ensure_ascii=False)
                    yield f"data: {payload}\n\n"
                    await asyncio.sleep(0)

        final_payload = json.dumps({"end_of_stream": True}, ensure_ascii=False)
        yield f"data: {final_payload}\n\n"

    except Exception as e:
        print(
            f"ストリーミングエラー (Provider: {prov_class.__name__ if prov_class else 'Default'}, Model: {model_name}): {e}"
        )
        error_detail = f"ストリーミング中にエラーが発生しました: {str(e)}"
        status_code = 503
        if isinstance(e, ProviderNotFoundError):
            error_detail = f"プロバイダー '{prov_class.__name__ if prov_class else 'Default'}' がモデル '{model_name}' をサポートしていないか、見つかりません: {str(e)}"
            status_code = 404
        elif isinstance(e, ModelNotFoundError):
            error_detail = f"モデル '{model_name}' が見つかりません: {str(e)}"
            status_code = 404
        error_payload = json.dumps(
            {
                "error": error_detail,
                "status_code": status_code,
                "provider": prov_class.__name__ if prov_class else "Default",
                "model": model_name,
            },
            ensure_ascii=False,
        )
        yield f"event: error\ndata: {error_payload}\n\n"

@app.post("/models", response_model=List[str])
async def get_available_identifiers(request_body: ModelListRequest):
    """
    利用可能な識別子のリストを返します。
    type パラメータに応じて、'provider' または 'model' のリストを返します。
    デフォルトは 'provider' です。filter パラメータで結果をフィルタリングできます。
    """
    try:
        identifier_type = request_body.type
        available: List[str] = []
        if identifier_type == "provider":
            available = list(ProviderUtils.convert.keys())
            print("プロバイダーリストを取得しました。")
        elif identifier_type == "model":
            available = Model.__all__()
            print("モデルリストを取得しました。")
        else:
            raise HTTPException(
                status_code=400,
                detail=f"無効な type '{identifier_type}' です。有効な type は 'provider' または 'model' です。",
            )
        if request_body.filter:
            print(f"フィルター '{request_body.filter}' を適用します...")
            original_count = len(available)
            available = [
                item
                for item in available
                if request_body.filter.lower() in item.lower()
            ]
            print(f"フィルター適用後: {original_count}件 -> {len(available)}件")
        return available
    except HTTPException:
        raise
    except Exception as e:
        error_type = request_body.type if request_body else "unknown"
        print(f"{error_type}リストの取得中に予期せぬエラーが発生しました: {e}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail=f"g4fから{error_type}リストを取得できませんでした。"
        )

@app.post("/chat", response_model=Optional[Dict[str, Any]])
async def process_request(request_data: ChatRequest):
    """
    AIと対話、または画像を生成します。
    - type='chat': AIと対話します。stream=Trueの場合、SSEでストリーミング応答を返します。
    - type='image@url': 指定されたプロンプトで画像を生成し、URLを返します。(レートリミット対象: 10 RPM)
    - type='image@b64': 指定されたプロンプトで画像を生成し、Base64エンコードされたデータを返します。(レートリミット対象: 10 RPM)
    `stream` パラメータは画像生成リクエストでは無視されます。
    `api_key` パラメータは特定のプロバイダー/モデルで必要になる場合があります。
    """
    request_type = request_data.type or "chat"
    print(
        f"リクエスト受信 (Type: {request_type}, Provider: {request_data.provider_name}, Model: {request_data.model}, Stream: {request_data.stream}, Has API Key: {'Yes' if request_data.api_key else 'No'})"
    )

    if request_type.startswith("image@"):
        with image_request_lock:
            current_time = time.monotonic()
            image_request_timestamps[:] = [
                ts
                for ts in image_request_timestamps
                if current_time - ts < IMAGE_REQUEST_WINDOW_SECONDS
            ]
            if len(image_request_timestamps) >= IMAGE_REQUEST_LIMIT:
                print(
                    f"画像生成のレートリミット超過 (現在 {len(image_request_timestamps)}/{IMAGE_REQUEST_LIMIT} requests in {IMAGE_REQUEST_WINDOW_SECONDS}s)"
                )
                retry_after = (
                    str(
                        int(
                            IMAGE_REQUEST_WINDOW_SECONDS
                            - (current_time - image_request_timestamps[0])
                        )
                    )
                    if image_request_timestamps
                    else str(IMAGE_REQUEST_WINDOW_SECONDS)
                )
                raise HTTPException(
                    status_code=429,
                    detail=f"画像生成リクエストが多すぎます。{IMAGE_REQUEST_WINDOW_SECONDS}秒あたり{IMAGE_REQUEST_LIMIT}回のリクエストに制限されています。しばらくしてから再試行してください。",
                    headers={"Retry-After": retry_after},
                )
            image_request_timestamps.append(current_time)
            print(
                f"画像生成リクエストを許可 (現在 {len(image_request_timestamps)}/{IMAGE_REQUEST_LIMIT} requests in {IMAGE_REQUEST_WINDOW_SECONDS}s)"
            )

        if request_data.stream:
            print(
                "警告: 画像生成リクエストで stream=True が指定されましたが、無視されます。"
            )

        response_format_part = request_type.split("@")[-1]
        if response_format_part == "url":
            g4f_response_format = "url"
        elif response_format_part == "b64":
            g4f_response_format = "b64_json"
        else:
            raise HTTPException(
                status_code=400,
                detail=f"無効な画像タイプ '{request_type}' です。'image@url' または 'image@b64' を使用してください。",
            )

        print(
            f"画像生成タスクを実行します (Model: {request_data.model}, Format: {g4f_response_format})..."
        )
        result = await run_g4f_image_task(
            generate_image_sync,
            request_data.model,
            request_data.message,
            g4f_response_format,
            request_data.api_key,
        )

        if result and "type" in result and "data" in result:
            if result["type"] == "url":
                print(f"画像URLを返します: {result['data'][:100]}...")
                return JSONResponse(content={"image_url": result["data"]})
            elif result["type"] == "b64":
                print(
                    f"画像Base64データを返します (最初の100文字): {result['data'][:100]}..."
                )
                return JSONResponse(content={"image_b64": result["data"]})
            else:
                print(
                    f"エラー: generate_image_syncから予期しない結果タイプ: {result.get('type')}"
                )
                raise HTTPException(
                    status_code=500,
                    detail="画像生成から内部的に無効な結果タイプが返されました。",
                )
        else:
            print(
                f"エラー: run_g4f_image_task がエラーを raise せずに無効な結果を返しました: {result}"
            )
            raise HTTPException(
                status_code=500,
                detail="画像生成タスクから予期しない結果が返されました。",
            )

    elif request_type == "chat":
        provider_class = None
        if request_data.provider_name:
            provider_class = ProviderUtils.convert.get(request_data.provider_name)
            if not provider_class:
                available_providers = list(ProviderUtils.convert.keys())
                raise HTTPException(
                    status_code=400,
                    detail=f"指定されたProvider名 '{request_data.provider_name}' は無効です。利用可能なProvider: {available_providers}",
                )

        if request_data.stream:
            print("チャットストリーミング応答を開始します...")
            return StreamingResponse(
                stream_response_generator(
                    provider_class,
                    request_data.model,
                    request_data.message,
                    request_data.api_key,
                ),
                media_type="text/event-stream",
            )
        else:
            print("非ストリーミングチャット応答を生成します...")

            def create_completion_sync(
                prov_class: Optional[Type[BaseProvider]],
                model_name: str,
                message_content: str,
                api_key: Optional[str] = None,
            ):
                client = Client(
                    provider=prov_class if prov_class else None, api_key=api_key
                )
                try:
                    response = client.chat.completions.create(
                        model=model_name,
                        messages=[{"role": "user", "content": message_content}],
                        stream=False,
                    )
                    if (
                        response
                        and response.choices
                        and response.choices[0].message
                        and response.choices[0].message.content is not None
                    ):
                        return response.choices[0].message.content
                    else:
                        print(
                            f"警告: Provider '{prov_class.__name__ if prov_class else 'Default'}' から予期しない応答形式 (非ストリーミング)。Response: {response}"
                        )
                        raise ValueError(
                            "AIプロバイダーから有効な応答コンテンツを取得できませんでした。"
                        )
                except (ProviderNotFoundError, ModelNotFoundError) as e:
                    print(
                        f"Provider/Model Error in sync chat (Provider: {prov_class.__name__ if prov_class else 'Default'}, Model: {model_name}): {e}"
                    )
                    raise e from e
                except Exception as e:
                    print(
                        f"Error during client.chat.completions.create (Non-streaming, Provider: {prov_class.__name__ if prov_class else 'Default'}, Model: {model_name}): {e}"
                    )
                    raise e

            try:
                ai_response = await run_in_threadpool(
                    create_completion_sync,
                    provider_class,
                    request_data.model,
                    request_data.message,
                    request_data.api_key,
                )
            except Exception as e:
                print(
                    f"g4fチャット操作中にエラーが発生しました (非ストリーミング, Provider: {provider_class.__name__ if provider_class else 'Default'}, Model: {request_data.model}): {e}"
                )
                detail_message = (
                    f"AIプロバイダーサービスでエラーが発生しました: {str(e)}"
                )
                status_code = 503
                cause = (
                    e.__cause__ if hasattr(e, "__cause__") else e
                )
                if isinstance(cause, ProviderNotFoundError):
                    detail_message = f"プロバイダー '{provider_class.__name__ if provider_class else 'Default'}' がモデル '{request_data.model}' をサポートしていないか、見つかりません: {str(cause)}"
                    status_code = 404
                elif isinstance(cause, ModelNotFoundError):
                    detail_message = (
                        f"モデル '{request_data.model}' が見つかりません: {str(cause)}"
                    )
                    status_code = 404
                elif isinstance(
                    e, ValueError
                ) and "有効な応答コンテンツを取得できませんでした" in str(e):
                    detail_message = str(e)
                    status_code = 502
                elif "authentication failed" in str(e).lower():
                    detail_message = f"AIプロバイダーでの認証に失敗しました: {str(e)}"
                    status_code = 401
                elif (
                    "connection error" in str(e).lower() or "timeout" in str(e).lower()
                ):
                    detail_message = f"AIプロバイダーへの接続に失敗しました: {str(e)}"
                    status_code = 504

                raise HTTPException(status_code=status_code, detail=detail_message)

            print(
                f"応答を送信中 (非ストリーミング): {ai_response[:100] if ai_response else 'N/A'}..."
            )
            return JSONResponse(content={"response": ai_response})
    else:
        raise HTTPException(
            status_code=400,
            detail=f"無効なリクエストタイプ '{request_type}' です。'chat'、'image@url'、または 'image@b64' を使用してください。",
        )

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="g4f FastAPI Server with Google Drive data sync."
    )
    parser.add_argument(
        "--data",
        type=str,
        help="Google Drive folder URL to download data from. Overwrites existing files in har_and_cookies.",
        default=None,
    )
    parser.add_argument(
        "--host",
        type=str,
        default="0.0.0.0",
        help="Host for the Uvicorn server.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=9002,
        help="Port for the Uvicorn server.",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reloading for development.",
    )
    args = parser.parse_args()

    is_reloader_process = os.environ.get("UVICORN_RELOADER_PARENT_PID") is not None
    if args.data and not is_reloader_process:
        print("起動時 Google Drive データ同期を開始します...")
        download_successful = download_and_sync_gdrive_folder(
            args.data, har_and_cookies_dir
        )
        if download_successful:
            print("Google Drive データ同期が完了しました。")
        else:
            print(
                "警告: Google Drive データ同期に失敗または一部エラーがありました。既存のデータで続行します。"
            )
    elif not args.data and not is_reloader_process:
        print(
            "起動時 Google Drive データ同期はスキップされました (--data 引数がありません)。"
        )
    elif is_reloader_process:
        print("リローダープロセス: Google Drive データ同期はスキップします。")

    try:
        print(f"Cookie/HAR ファイルを読み込み中: {har_and_cookies_dir}")
        if os.path.isdir(har_and_cookies_dir):
            read_cookie_files(har_and_cookies_dir)
            print("Cookie/HAR ファイルの読み込み試行完了。")
        else:
            print(
                f"Cookie/HAR ディレクトリが見つかりません: {har_and_cookies_dir} スキップします。"
            )
    except Exception as e:
        print(f"Cookie/HAR ファイルの読み込み中にエラーが発生しました: {e}")
        traceback.print_exc()

    import uvicorn

    reloader_env = os.environ.get("UVICORN_RELOADER")
    if not args.reload and (not reloader_env or reloader_env.lower() != "true"):
        print(f"Uvicornサーバーを起動中 (Host: {args.host}, Port: {args.port})...")
        print(
            f"画像生成レートリミット: {IMAGE_REQUEST_LIMIT} requests / {IMAGE_REQUEST_WINDOW_SECONDS} seconds"
        )
        print(f"APIドキュメント: http://{args.host}:{args.port}/docs")
        print(f"README: http://{args.host}:{args.port}/")

    module_name = os.path.splitext(os.path.basename(__file__))[0]
    uvicorn.run(
        f"{module_name}:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )

    if not is_reloader_process:
        print("Uvicornサーバーを終了します。")
        exit(0)
