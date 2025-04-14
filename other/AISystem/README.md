# APIリファレンス

このドキュメントは、`g4f` ライブラリを利用して様々なAIプロバイダーと対話するためのバックエンドAPIサーバーの仕様を記述します。

ベースURL: http://<サーバーアドレス>:<ポート> (デフォルト: http://127.0.0.1:9002)

## 1. 利用可能なプロバイダーリストの取得

1. 利用可能なプロバイダーリストの取得
   利用可能なAIプロバイダーの識別子リストを取得します。

エンドポイント: /models
メソッド: POST
リクエストボディ (JSON):
json
{
  "filter": "string (optional, 現在未使用)"
  }

   - `filter`: 現在のバージョンではこのフィールドは使用されていません。空のJSON `{}` を送信してください。

   **成功レスポンス (200 OK):**

   - Content-Type: `application/json`
   - ボディ: 利用可能なプロバイダー名の文字列リスト。

   ```json
   [
     "Grok",
     "Llama",
     "Mixtral",
     "..."
   ]
   ```

   **エラーレスポンス (500 Internal Server Error):**

   - Content-Type: `application/json`
   - ボディ: プロバイダーリストの取得に失敗した場合。

   ```json
   {
     "detail": "g4fからプロバイダーリストを取得できませんでした。"
   }
   ```

   **cURL 例:**

   ```bash
   curl -X POST http://127.0.0.1:9002/models -H "Content-Type: application/json" -d '{}'
   ```

## 2. AIとのチャット

指定したプロバイダーとモデルを使用してAIと対話します。通常のJSONレスポンスと、Server-Sent Events (SSE) によるストリーミングレスポンスをサポートします。

エンドポイント: /chat

メソッド: POST

リクエストボディ (JSON):
```json
   {
     "provider_name": "string (必須)",
     "model": "string (必須)",
     "message": "string (必須)",
     "auth_key": "string (optional, 現在未使用)",
     "stream": "boolean (optional, default: false)"
   }
   ```

   - `provider_name`: 使用するAIプロバイダーの識別子 (例: "Grok")。`/models` エンドポイントで取得した名前を指定します。
   - `model`: 使用するモデル名 (例: "grok-3" や "" など、プロバイダーがサポートするモデル識別子)。空文字列 "" を指定すると、プロバイダーのデフォルトモデルが使用される場合があります。
   - `message`: AIに送信するユーザーメッセージ。
   - `auth_key`: 認証キー（現在のバージョンでは使用されていません）。
   - `stream`: `true` に設定するとレスポンスがストリーミング (SSE) 形式になります。`false` または未指定の場合は、完了後に全レスポンスがJSONで返されます。

   **成功レスポンス (200 OK, stream=false):**

Content-Type: application/json
ボディ: AIからの完全な応答を含むJSONオブジェクト。
json
{
  "response": "AIからの応答テキストです。"
}

   **成功レスポンス (200 OK, stream=true):**

Content-Type: text/event-stream
ボディ: Server-Sent Events のストリーム。

   - メッセージチャンク:

     ```plaintext
     data: {"delta": "応答の一部"}

     data: {"delta": "次の応答部分"}

     ...
     ```

   - ストリーム終了:

     ```plaintext
     data: {"end_of_stream": true}
     ```

   - ストリーミング中のエラー:

     ```plaintext
     event: error
     data: {"error": "エラーメッセージ", "provider": "プロバイダー名", "model": "モデル名"}
     ```

   **エラーレスポンス:**

   - **400 Bad Request:**

     - Content-Type: `application/json`
     - ボディ: 指定された `provider_name` が無効な場合。

     ```json
     {
       "detail": "指定されたProvider名 '無効な名前' は無効です。利用可能なProvider: ['Grok', 'Llama', ...]"
     }
     ```

   - **404 Not Found (非ストリーミング時):**

     - Content-Type: `application/json`
     - ボディ: プロバイダーは存在するが、指定された `model` がプロバイダー内部で見つからないかサポートされていない場合 (`g4f`ライブラリの `ProviderNotFoundError` に起因)。

     ```json
     {
       "detail": "プロバイダー内部でモデルが見つからないか、サポートされていません: <元のエラー詳細>"
     }
     ```

     (注意: ストリーミング時はHTTPステータスコードは200のままで、`event: error` のSSEメッセージが送信されます)

   - **500 Internal Server Error (非ストリーミング時):**

     - Content-Type: `application/json`
     - ボディ: AIプロバイダーから有効な応答が得られなかった場合、または予期せぬサーバーエラーが発生した場合。

     ```json
     {
       "detail": "AIプロバイダーから有効な応答を取得できませんでした。"
     }
     ```

   - **503 Service Unavailable (非ストリーミング時):**

     - Content-Type: `application/json`
     - ボディ: AIプロバイダーサービス自体が利用不可、または通信中にエラーが発生した場合。

     ```json
     {
       "detail": "AIプロバイダーサービスが利用不可か、エラーが発生しました: <元のエラー詳細>"
     }
     ```

   **cURL 例:**

   - **非ストリーミング:**

     ```bash
     curl -X POST http://127.0.0.1:9002/chat \
     -H "Content-Type: application/json" \
     -d '{
           "provider_name": "Grok",
           "model": "grok-3",
           "message": "日本の首都はどこですか？",
           "stream": false
         }'
     ```

   - **ストリーミング:**

     ```bash
     curl -X POST http://127.0.0.1:9002/chat \
     -H "Content-Type: application/json" \
     -H "Accept: text/event-stream" \
     -d '{
           "provider_name": "Grok",
           "model": "grok-3",
           "message": "自己紹介をしてください。",
           "stream": true
         }' --no-buffer
     ```

     (`--no-buffer` オプションは、curlがレスポンスをバッファリングせず、受信次第表示するために推奨されます)
