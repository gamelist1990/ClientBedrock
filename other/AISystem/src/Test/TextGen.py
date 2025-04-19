import requests
import json

BASE_URL = "http://localhost:9002"
CHAT_ENDPOINT = f"{BASE_URL}/chat"

TEST_PROVIDER_NAME: str = "HuggingChat"
TEST_MODEL_NAME: str = "command-r"
TEST_MESSAGE: str = "こんにちは"
TEST_STREAM: bool = False


def test_chat(
    provider_name: str | None, model_name: str, message: str, stream: bool = False
):
    """Sends a chat request to the server and prints the response."""
    provider_display = provider_name if provider_name else "Default"
    print(f"\n--- Testing Chat ---")
    print(f"Provider: {provider_display}")
    print(f"Model: {model_name}")
    print(f"Message: '{message}'")
    print(f"Stream: {stream}")
    print("-" * 20)

    payload = {
        "provider_name": provider_name,
        "model": model_name,
        "message": message,
        "stream": stream,
        "type": "chat",
    }
    if payload["provider_name"] is None:
        del payload["provider_name"]

    try:
        with requests.post(
            CHAT_ENDPOINT, json=payload, stream=stream, timeout=10
        ) as response:
            print(f"Status Code: {response.status_code}")
            response.raise_for_status()

            if stream:
                print("Streaming Response:")
                for line in response.iter_lines():
                    if line:
                        decoded_line = line.decode("utf-8")
                        if decoded_line.startswith("data:"):
                            try:
                                data_json = decoded_line[len("data: ") :]
                                data = json.loads(data_json)
                                if "delta" in data:
                                    print(data["delta"], end="", flush=True)
                                elif "end_of_stream" in data and data["end_of_stream"]:
                                    print("\n--- End of Stream ---")
                                    break
                                elif "error" in data:
                                    print(f"\n--- Stream Error ---")
                                    print(f"  Error: {data.get('error')}")
                                    print(f"  Status Code: {data.get('status_code')}")
                                    print(f"  Provider: {data.get('provider')}")
                                    print(f"  Model: {data.get('model')}")
                                    break
                            except json.JSONDecodeError:
                                print(
                                    f"\n[Warning] Could not decode JSON from stream line: {data_json}"
                                )
                        elif decoded_line.startswith("event: error"):
                            pass
                        else:
                            print(f"\n[Info] Received non-data line: {decoded_line}")
                print("\n--- Full Streamed Response Received ---")

            else:
                result = response.json()
                ai_response = result.get("response")
                print("\nNon-Streaming Response:")
                if ai_response is not None:
                    print(ai_response)
                else:
                    print("Error: 'response' key not found or is null in the result.")
                    print("Received JSON:", result)

    except requests.exceptions.RequestException as e:
        print(f"\n!!! Request Error: {e}")
        if hasattr(e, "response") and e.response is not None:
            try:
                print("Server Error Response:", e.response.json())
            except json.JSONDecodeError:
                print("Server Error Response (non-JSON):", e.response.text)
    except Exception as e:
        print(f"\n!!! An unexpected error occurred: {e}")
        import traceback

        traceback.print_exc()

    print("-" * 20)
    print("--- Test Complete ---")


if __name__ == "__main__":
    test_chat(
        provider_name=TEST_PROVIDER_NAME,
        model_name=TEST_MODEL_NAME,
        message=TEST_MESSAGE,
        stream=TEST_STREAM,
    )
