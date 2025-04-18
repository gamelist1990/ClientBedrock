import requests
import json

BASE_URL = "http://localhost:9002"
CHAT_ENDPOINT = f"{BASE_URL}/chat"

MODEL_NAME = "flux"  
PROMPT_JP = "猫"  

def test_image_generation(req_type: str):
    print(f"\n--- 画像生成テスト ({req_type}) 開始 ---")
    print(f"モデル: {MODEL_NAME}")
    print(f"プロンプト: {PROMPT_JP}")
    print(f"リクエストタイプ: {req_type}")

    payload = {
        "model": MODEL_NAME,
        "message": PROMPT_JP,  
        "type": req_type,
    }

    try:
        response = requests.post(CHAT_ENDPOINT, json=payload, timeout=300)
        response.raise_for_status()  

        result_data = response.json()
        print(f"レスポンス ({response.status_code}):")

        if req_type == "image@url":
            if "image_url" in result_data:
                print(f"成功！ 生成された画像のURL:\n{result_data['image_url']}")
            else:
                print("エラー: レスポンスに 'image_url' が含まれていません。")
                print(result_data)
        elif req_type == "image@b64":
            if "image_b64" in result_data:
                print(
                    f"成功！ 生成された画像のBase64データ (最初の100文字):\n{result_data['image_b64'][:100]}..."
                )
            else:
                print("エラー: レスポンスに 'image_b64' が含まれていません。")
                print(result_data)

    except requests.exceptions.Timeout:
        print(f"エラー: リクエストがタイムアウトしました ({CHAT_ENDPOINT})。")
    except requests.exceptions.RequestException as e:
        print(f"エラー: リクエスト中にエラーが発生しました: {e}")
        if hasattr(e, "response") and e.response is not None:
            try:
                error_detail = e.response.json()
                print("サーバーからのエラー詳細:")
                print(json.dumps(error_detail, indent=2, ensure_ascii=False))
            except json.JSONDecodeError:
                print("サーバーからのエラー(テキスト):")
                print(e.response.text)
    except Exception as e:
        print(f"予期せぬエラーが発生しました: {e}")

    print(f"--- 画像生成テスト ({req_type}) 終了 ---")


if __name__ == "__main__":
    test_image_generation("image@url")
    print("\n" + "=" * 30 + "\n")  
    test_image_generation("image@b64")