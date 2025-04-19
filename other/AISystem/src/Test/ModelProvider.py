import requests
import json
from typing import List, Optional

# --- Configuration ---
# FastAPIサーバーが実行されているアドレスとポート
BASE_URL = "https://neuralai-jbwc.onrender.com"
MODELS_ENDPOINT = f"{BASE_URL}/models"


# --- Function to Get Identifiers ---
def get_identifiers(identifier_type: str) -> Optional[List[str]]:
    """
    指定されたタイプの識別子リストをサーバーから取得します。

    Args:
        identifier_type: 取得する識別子のタイプ ("provider" または "model")。

    Returns:
        識別子のリスト、またはエラー時に None。
    """
    print(f"\n--- Getting {identifier_type} list ---")
    payload = {"type": identifier_type}

    try:
        response = requests.post(MODELS_ENDPOINT, json=payload, timeout=30)
        print(f"Status Code: {response.status_code}")
        response.raise_for_status()  # HTTPエラーがあれば例外を発生させる

        identifiers = response.json()
        if isinstance(identifiers, list):
            print(f"Successfully retrieved {len(identifiers)} {identifier_type}(s).")
            return identifiers
        else:
            print(f"Error: Expected a list but received type {type(identifiers)}")
            print("Received data:", identifiers)
            return None

    except requests.exceptions.Timeout:
        print(f"Error: Request timed out while fetching {identifier_type} list.")
        return None
    except requests.exceptions.RequestException as e:
        print(f"Error: Request failed while fetching {identifier_type} list: {e}")
        # エラーレスポンスの内容を表示しようと試みる
        if hasattr(e, "response") and e.response is not None:
            try:
                print("Server Error Response:", e.response.json())
            except json.JSONDecodeError:
                print("Server Error Response (non-JSON):", e.response.text)
        return None
    except json.JSONDecodeError:
        print(
            f"Error: Failed to decode JSON response from server for {identifier_type} list."
        )
        print("Received text:", response.text)
        return None
    except Exception as e:
        print(
            f"An unexpected error occurred while fetching {identifier_type} list: {e}"
        )
        return None


# --- Main Execution ---
if __name__ == "__main__":
    print(f"Attempting to fetch providers and models from {BASE_URL}...")

    # プロバイダーリストを取得
    providers = get_identifiers("provider")
    if providers:
        print("\nAvailable Providers:")
        # リストが長い場合、一部のみ表示する例
        if len(providers) > 20:
            print(providers[:10], f"... (and {len(providers)-10} more)")
        else:
            print(providers)
    else:
        print("\nFailed to retrieve provider list.")

    # モデルリストを取得
    models = get_identifiers("model")
    if models:
        print("\nAvailable Models:")
        # リストが長い場合、一部のみ表示する例
        if len(models) > 50:
            print(models[:25], f"... (and {len(models)-25} more)")
        else:
            print(models)
    else:
        print("\nFailed to retrieve model list.")

    print("\n--- Finished ---")
