# API リファレンス (v1.2.2)

このドキュメントは、`g4f` ライブラリを利用して様々な AI プロバイダーと対話するためのバックエンド API サーバー (バージョン 1.2.2) の仕様を記述します。

**ベース URL:** `http://<サーバーアドレス>:<ポート>` (デフォルト: `http://127.0.0.1:9002`)

## 1. 利用可能な識別子リストの取得

利用可能な AI プロバイダーまたはモデルの識別子リストを取得します。

**エンドポイント:** `/models`

**メソッド:** `POST`

### リクエストボディ (JSON):

```json
{
  "type": "string (optional, default: 'provider')",
  "filter": "string (optional)"
}
```

- `type`: 取得する識別子の種類を指定します。
  - `"provider"` (デフォルト): 利用可能なプロバイダー名のリストを返します。
  - `"model"`: 利用可能なモデル名のリストを返します。
- `filter`: 指定した場合、識別子リストを部分一致 (大文字小文字を区別しない) でフィルタリングします。

### 成功レスポンス (200 OK):

- Content-Type: `application/json`
- ボディ: `type` で指定された種類の識別子の文字列リスト。

```json
// type="provider" の場合
["Grok", "Llama", "Mixtral", "Gemini", ...]

// type="model" の場合
["grok-3", "llama-3-70b", "gemini-1.5-flash", ...]
```

### エラーレスポンス:

- **400 Bad Request:**

  ```json
  {
    "detail": "無効な type '<指定されたtype>' です。有効な type は 'provider' または 'model' です。"
  }
  ```

- **500 Internal Server Error:**

  ```json
  {
    "detail": "g4fから<type>リストを取得できませんでした: <元のエラー詳細>"
  }
  ```

- **503 Service Unavailable:**
  ```json
  {
    "detail": "g4fから<type>リストを取得できませんでした。"
  }
  ```

### cURL 例:

```bash
# プロバイダーリスト取得 (デフォルト)
curl -X POST http://127.0.0.1:9002/models -H "Content-Type: application/json" -d '{}'

# モデルリスト取得
curl -X POST http://127.0.0.1:9002/models -H "Content-Type: application/json" -d '{"type": "model"}'

# "gpt" を含むプロバイダーリスト取得
curl -X POST http://127.0.0.1:9002/models -H "Content-Type: application/json" -d '{"type": "provider", "filter": "gpt"}'

# "llama" を含むモデルリスト取得
curl -X POST http://127.0.0.1:9002/models -H "Content-Type: application/json" -d '{"type": "model", "filter": "llama"}'
```

## 2. AI とのチャット

指定したプロバイダーとモデルを使用して AI と対話します。通常の JSON レスポンスと、Server-Sent Events (SSE) によるストリーミングレスポンスをサポートします。

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

- `provider_name`: 使用する AI プロバイダーの識別子 (例: "Grok")。`/models` エンドポイントで取得した名前を指定します。
- `model`: 使用するモデル名 (例: "grok-3" や "" など、プロバイダーがサポートするモデル識別子)。空文字列 "" を指定すると、プロバイダーのデフォルトモデルが使用される場合があります。
- `message`: AI に送信するユーザーメッセージ。
- `auth_key`: 認証キー（現在のバージョンでは使用されていません）。
- `stream`: `true` に設定するとレスポンスがストリーミング (SSE) 形式になります。`false` または未指定の場合は、完了後に全レスポンスが JSON で返されます。

**成功レスポンス (200 OK, stream=false):**

Content-Type: application/json
ボディ: AI からの完全な応答を含む JSON オブジェクト。
json
{
"response": "AI からの応答テキストです。"
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

  (注意: ストリーミング時は HTTP ステータスコードは 200 のままで、`event: error` の SSE メッセージが送信されます)

- **500 Internal Server Error (非ストリーミング時):**

  - Content-Type: `application/json`
  - ボディ: AI プロバイダーから有効な応答が得られなかった場合、または予期せぬサーバーエラーが発生した場合。

  ```json
  {
    "detail": "AIプロバイダーから有効な応答を取得できませんでした。"
  }
  ```

- **503 Service Unavailable (非ストリーミング時):**

  - Content-Type: `application/json`
  - ボディ: AI プロバイダーサービス自体が利用不可、または通信中にエラーが発生した場合。

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

  (`--no-buffer` オプションは、curl がレスポンスをバッファリングせず、受信次第表示するために推奨されます)

## 3. JavaScript での利用例

### 非ストリーミング

```javascript
async function chatWithAI(providerName, model, message) {
  const response = await fetch("http://127.0.0.1:9002/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider_name: providerName,
      model: model,
      message: message,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || "An error occurred");
  }

  const data = await response.json();
  return data.response;
}

// 使用例
chatWithAI("Grok", "grok-3", "こんにちは")
  .then(console.log)
  .catch(console.error);
```
