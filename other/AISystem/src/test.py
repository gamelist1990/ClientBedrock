from typing import Optional
import requests
import json
import random # Add random for selecting test items

# BASE_URL = "https://neuralai-jbwc.onrender.com"
BASE_URL = "http://localhost:9002" # ローカルテスト用に変更 (必要に応じて調整してください)


def test_get_identifiers(identifier_type: str = "provider", filter_str: Optional[str] = None, expect_error: bool = False):
    """
    /models エンドポイントをテストする (type と filter に対応)
    Args:
        identifier_type (str): "provider" または "model"
        filter_str (Optional[str]): フィルタリング文字列
        expect_error (bool): 400エラーを期待するかどうか
    """
    print(f"\n--- テスト開始: /models (type='{identifier_type}', filter='{filter_str}', expect_error={expect_error}) ---")
    url = f"{BASE_URL}/models"
    payload = {"type": identifier_type}
    if filter_str:
        payload["filter"] = filter_str

    try:
        response = requests.post(url, json=payload)
        print(f"ステータスコード: {response.status_code}")

        if expect_error:
            if response.status_code == 400:
                print("期待通り 400 Bad Request が返されました。")
                try:
                    print(f"エラー詳細: {response.json()}")
                except json.JSONDecodeError:
                    print(f"エラー詳細 (テキスト): {response.text}")
                print(f"--- /models 不正typeテスト 成功 ---")
                return None # エラー時はNoneを返す
            else:
                print(
                    f"!!! /models 不正typeテスト 失敗: 期待した 400 ではなく {response.status_code} が返されました。"
                )
                try:
                    print(f"レスポンス: {response.json()}")
                except json.JSONDecodeError:
                    print(f"レスポンス (テキスト): {response.text}")
                return None # エラー時はNoneを返す
        else:
            response.raise_for_status() # 400以外のHTTPエラーもチェック
            identifiers = response.json()
            print(f"利用可能な {identifier_type} (フィルター: '{filter_str}'): {identifiers}")
            if isinstance(identifiers, list):
                print(f"レスポンスはリスト形式です ({len(identifiers)} 件)。")
            else:
                print("警告: レスポンスがリスト形式ではありません。")
            print(f"--- /models (type='{identifier_type}', filter='{filter_str}') テスト成功 ---")
            return identifiers

    except requests.exceptions.RequestException as e:
        print(f"!!! /models テスト失敗 (type='{identifier_type}', filter='{filter_str}', リクエストエラー): {e}")
        return None
    except Exception as e:
        print(f"!!! /models テスト失敗 (type='{identifier_type}', filter='{filter_str}', 予期せぬエラー): {e}")
        return None


def test_chat(provider_name: Optional[str], model_name: str, message: str):
    """/chat エンドポイントをテストする (provider_name は Optional に)"""
    provider_display = provider_name if provider_name else "Default"
    print(
        f"\n--- テスト開始: /chat (Provider: {provider_display}, Model: {model_name}) ---"
    )
    url = f"{BASE_URL}/chat"
    payload = {"model": model_name, "message": message}
    # provider_name が None でない場合のみペイロードに追加
    if provider_name:
        payload["provider_name"] = provider_name

    try:
        response = requests.post(url, json=payload)
        print(f"ステータスコード: {response.status_code}")
        response.raise_for_status()
        result = response.json()
        ai_response = result.get("response")
        print(f"AIからの応答: {ai_response[:200] if ai_response else 'N/A'}...") # 長すぎる応答を省略
        if "response" in result and ai_response is not None:
            print(
                f"--- /chat テスト成功 (Provider: {provider_display}, Model: {model_name}) ---"
            )
            return ai_response
        else:
            print(
                f"!!! /chat テスト失敗: レスポンスに 'response' キーがないか、nullです。"
            )
            print(f"受信したJSON: {result}")
            return None
    except requests.exceptions.RequestException as e:
        print(
            f"!!! /chat テスト失敗 (Provider: {provider_display}, Model: {model_name}, リクエストエラー): {e}"
        )
        # エラーレスポンスの内容を表示しようと試みる
        try:
            print(f"エラーレスポンス: {response.json()}")
        except:
             print(f"エラーレスポンス (テキスト): {response.text}")
        return None
    except Exception as e:
        print(
            f"!!! /chat テスト失敗 (Provider: {provider_display}, Model: {model_name}, 予期せぬエラー): {e}"
        )
        return None


def test_chat_invalid_provider():
    """/chat エンドポイントで存在しないProvider名をテストする (400エラーを期待)"""
    print("\n--- テスト開始: /chat エンドポイント (不正なProvider名) ---")
    url = f"{BASE_URL}/chat"
    invalid_provider_name = "存在しないはずのプロバイダー名_XYZ123"
    payload = {
        "provider_name": invalid_provider_name,
        "model": "any-model", # モデル名は何でもよい
        "message": "このリクエストは失敗するはず",
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
            print(
                f"!!! /chat 不正Provider名テスト 失敗: 期待した 400 ではなく {response.status_code} が返されました。"
            )
            try:
                print(f"レスポンス: {response.json()}")
            except json.JSONDecodeError:
                print(f"レスポンス (テキスト): {response.text}")

    except requests.exceptions.RequestException as e:
        print(f"!!! /chat 不正Provider名テスト 失敗 (リクエストエラー): {e}")
    except Exception as e:
        print(f"!!! /chat 不正Provider名テスト 失敗 (予期せぬエラー): {e}")


# test_chat_no_provider は test_chat(provider_name=None, ...) でカバーされるため削除


if __name__ == "__main__":
    print("APIサーバーのテストを開始します...")

    # --- /models エンドポイントのテスト ---
    available_providers = test_get_identifiers(identifier_type="provider")
    available_models = test_get_identifiers(identifier_type="model")
    filtered_providers = test_get_identifiers(identifier_type="provider", filter_str="gpt")
    filtered_models = test_get_identifiers(identifier_type="model", filter_str="llama")
    test_get_identifiers(identifier_type="invalid_type", expect_error=True) # 不正なtypeのテスト

    # --- /chat エンドポイントのテスト ---
    provider_to_test = None
    model_to_test = "gpt-4o-mini" # デフォルトで使用するモデル (Provider指定なしの場合)

    # 利用可能なプロバイダーがあれば、ランダムに選択してテスト
    if available_providers:
        # 特定のプロバイダーを優先的に試す (例: Gemini)
        preferred_provider = "Gemini"
        preferred_model = "gemini-1.5-flash" # Geminiで使うモデル

        if preferred_provider in available_providers:
            provider_to_test = preferred_provider
            model_to_test = preferred_model
            print(f"\n優先プロバイダー '{provider_to_test}' (Model: '{model_to_test}') でテストします。")
        else:
            # 優先プロバイダーがなければランダムに選択
            provider_to_test = random.choice(available_providers)
            # 選択したプロバイダーで使えそうなモデルを適当に設定 (gpt-4o-miniなど汎用的なもの)
            # 注意: 選択されたプロバイダーが実際にそのモデルをサポートしているかは不明
            model_to_test = "gpt-4o-mini"
            print(f"\n利用可能なプロバイダーからランダムに '{provider_to_test}' (Model: '{model_to_test}') を選択してテストします。")

        test_chat(provider_to_test, model_to_test, "日本の首都はどこですか？")
        test_chat(provider_to_test, model_to_test, "簡単な挨拶をしてください。")

    else:
        print("\n利用可能なプロバイダーリストが取得できませんでした。")

    # Provider指定なしのテスト (デフォルトモデルを使用)
    print(f"\nProvider指定なし (Model: 'gpt-4o-mini') でテストします。")
    test_chat(None, "gpt-4o-mini", "Providerを指定せずにリクエストします。どのモデルが使われますか？")

    # 不正なProvider名のテスト
    test_chat_invalid_provider()

    print("\nAPIサーバーのテストが終了しました。")
