import requests
import json

BASE_URL = "http://127.0.0.1:9002"

def test_get_models():
    """/models エンドポイントをテストする"""
    print("--- テスト開始: /models エンドポイント ---")
    url = f"{BASE_URL}/models"
    try:
        response = requests.post(url, json={})
        print(f"ステータスコード: {response.status_code}")
        response.raise_for_status()
        models = response.json()
        print(f"利用可能なProvider: {models}")
        if isinstance(models, list):
            print("レスポンスはリスト形式です。")
        else:
            print("警告: レスポンスがリスト形式ではありません。")
        print("--- /models テスト成功 ---")
        return models
    except requests.exceptions.RequestException as e:
        print(f"!!! /models テスト失敗 (リクエストエラー): {e}")

        return None
    except Exception as e:
        print(f"!!! /models テスト失敗 (予期せぬエラー): {e}")
        return None

def test_chat(provider_name: str, model_name: str, message: str):
    """/chat エンドポイントをテストする"""
    print(f"\n--- テスト開始: /chat (Provider: {provider_name}, Model: {model_name}) ---")
    url = f"{BASE_URL}/chat"
    payload = {
        "provider_name": provider_name,
        "model": model_name,
        "message": message
    }
    try:
        response = requests.post(url, json=payload)
        print(f"ステータスコード: {response.status_code}")
        response.raise_for_status()
        result = response.json()
        ai_response = result.get('response')
        print(f"AIからの応答: {ai_response}")
        if 'response' in result and ai_response is not None:
             print(f"--- /chat テスト成功 (Provider: {provider_name}, Model: {model_name}) ---")
             return ai_response
        else:
             print(f"!!! /chat テスト失敗: レスポンスに 'response' キーがないか、nullです。")
             print(f"受信したJSON: {result}")
             return None
    except requests.exceptions.RequestException as e:
        print(f"!!! /chat テスト失敗 (Provider: {provider_name}, Model: {model_name}, リクエストエラー): {e}")

        return None
    except Exception as e:
        print(f"!!! /chat テスト失敗 (Provider: {provider_name}, Model: {model_name}, 予期せぬエラー): {e}")
        return None

def test_chat_invalid_provider():
    """/chat エンドポイントで存在しないProvider名をテストする (400エラーを期待)"""
    print("\n--- テスト開始: /chat エンドポイント (不正なProvider名) ---")
    url = f"{BASE_URL}/chat"
    invalid_provider_name = "存在しないはずのプロバイダー名_XYZ"
    payload = {
        "provider_name": invalid_provider_name,
        "model": "any-model",
        "message": "このリクエストは失敗するはず"
    }
    try:
        response = requests.post(url, json=payload)
        print(f"ステータスコード: {response.status_code}")

        if response.status_code == 400:
            print("期待通り 400 Bad Request が返されました。")
            try:
                print(f"エラー詳細: {response.json()}")
            except json.JSONDecodeError:
                print(f"エラー詳細 (テキスト): {response.text}")
            print("--- /chat 不正Provider名テスト 成功 ---")
        else:
            print(f"!!! /chat 不正Provider名テスト 失敗: 期待した 400 ではなく {response.status_code} が返されました。")
            try:
                print(f"レスポンス: {response.json()}")
            except json.JSONDecodeError:
                 print(f"レスポンス (テキスト): {response.text}")

    except requests.exceptions.RequestException as e:
        print(f"!!! /chat 不正Provider名テスト 失敗 (リクエストエラー): {e}")
    except Exception as e:
        print(f"!!! /chat 不正Provider名テスト 失敗 (予期せぬエラー): {e}")


if __name__ == "__main__":
    print("APIサーバーのテストを開始します...")

    available_providers = test_get_models()

    if available_providers:
        provider_to_test = "Grok"
        model_to_test = "grok-3-thinking"


        if provider_to_test not in available_providers:
             print(f"警告: 指定されたProvider '{provider_to_test}' は /models のリストに含まれていません。リストの最初のProvider '{available_providers[0]}' で試します。")
             if available_providers:
                 provider_to_test = available_providers[0]

                 model_to_test = ""

        print(f"\n取得したProviderリストから '{provider_to_test}' (Model: '{model_to_test}') を使用してチャットテストを行います。")
        test_chat(provider_to_test, model_to_test, "日本の首都はどこですか？")
        test_chat(provider_to_test, model_to_test, "簡単な挨拶をしてください。")
    else:
        print("\nProviderリストが取得できなかったため、デフォルト Provider 'Grok' (Model: '') でチャットテストを試みます。")
        test_chat("Grok", "", "Hello!")

    test_chat_invalid_provider()

    print("\nAPIサーバーのテストが終了しました。")
