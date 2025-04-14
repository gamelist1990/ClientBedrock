import fetch, { Response } from 'node-fetch';
import { TextDecoder } from 'util';

const DEFAULT_BACKEND_URL = "http://127.0.0.1:9002";

// --- インターフェース定義 ---
interface StreamChunk {
    delta?: string;
    end_of_stream?: boolean;
    error?: any;
}

type OnChunkCallback = (chunk: StreamChunk) => void;

interface AIResponseJson { response: string; }
interface ErrorResponseJson {
    detail?: string;
}

// --- LocalAI クラス ---
class LocalAI {
    private backendUrl: string;
    private providerName: string; // "None" または有効なプロバイダー名
    private modelName: string;

    /**
     * LocalAI クラスのインスタンスを生成します。
     * @param providerName 使用するプロバイダー名。"None" を指定するとプロバイダー指定なしでリクエストします。
     * @param modelName 使用するモデル名。
     * @param backendUrl (オプション) バックエンドAPIのURL。デフォルトは "http://127.0.0.1:9002"。
     */
    constructor(providerName: string | null | undefined, modelName: string, backendUrl: string = DEFAULT_BACKEND_URL) {
        // providerName が null や undefined の場合は "None" として扱う
        this.providerName = (providerName === null || providerName === undefined) ? "None" : providerName;

        // providerName が空文字の場合の警告
        if (this.providerName === '') {
             console.warn(`Provider名が空文字です。Provider指定なしとして扱われます。意図しない場合は有効なProvider名または "None" を指定してください。`);
             this.providerName = "None"; // 空文字も "None" 扱いにする
        }
        // modelName が空の場合の警告
        if (!modelName) {
            // モデル名は必須なのでエラーにするか、警告に留めるか検討。現状は警告。
            console.warn(`モデル名が指定されていません。空でない文字列を指定することを強く推奨します。`);
            // throw new Error("モデル名は必須です。"); // 必要ならエラーにする
        }
        this.modelName = modelName;
        this.backendUrl = backendUrl;

        console.log(`LocalAI initialized: Provider='${this.providerName}', Model='${this.modelName}', Backend='${this.backendUrl}'`);
    }

    /**
     * AIバックエンドとチャットを行います。ストリーミング対応。
     * @param prompt ユーザーからの入力プロンプト。
     * @param onChunk (オプション) ストリーミング時にチャンクデータを受け取るコールバック関数。
     * @returns ストリーミング時は全応答テキスト、非ストリーミング時は応答テキスト、エラー時は null。
     * @throws ネットワークエラーやバックエンドエラーが発生した場合。
     */
    public async chat(prompt: string, onChunk?: OnChunkCallback): Promise<string | null> {
        if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
            throw new Error("有効なプロンプトを入力してください。");
        }

        const isStreaming = onChunk !== undefined;
        const requestUrl = `${this.backendUrl}/chat`;

        const payload: {
            provider_name?: string; // "None" の場合は含めない
            model: string;
            message: string;
            stream: boolean;
        } = {
            model: this.modelName,
            message: prompt.trim(), // 前後の空白を除去
            stream: isStreaming
        };

        // providerName が "None" でない場合のみペイロードに追加
        if (this.providerName !== "None") {
            payload.provider_name = this.providerName;
        }

        console.log(`リクエスト送信中: ${requestUrl} - Payload: ${JSON.stringify(payload)}`);

        try {
            const response: Response = await fetch(requestUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': isStreaming ? 'text/event-stream' : 'application/json'
                },
                body: JSON.stringify(payload)
            });

            // --- エラーハンドリング ---
            if (!response.ok) {
                let errorDetail = `HTTPステータス: ${response.status} ${response.statusText}`;
                try {
                    // エラーレスポンスがJSON形式の場合、詳細を取得試行
                    const errorJson = await response.json() as ErrorResponseJson;
                    if (errorJson?.detail) {
                        errorDetail = `バックエンドエラー (${response.status}): ${errorJson.detail}`;
                    }
                } catch (jsonError) {
                    // JSONでなければテキストとして取得試行
                    try {
                        const errorText = await response.text();
                        if (errorText) {
                            errorDetail = `バックエンドエラー (${response.status}): ${errorText}`;
                        }
                    } catch (textError) {
                        console.error("エラーレスポンスのテキスト読み取りにも失敗:", textError);
                    }
                }
                console.error(`バックエンドへのリクエストが失敗しました。 ${errorDetail}`);
                // エラーを投げて呼び出し元で処理させる
                throw new Error(`AIバックエンドとの通信に失敗しました。(${errorDetail})`);
            }

            // --- ストリーミング処理 ---
            if (isStreaming && response.body && onChunk) {
                return this._handleStreamingResponse(response, onChunk);
            }

            // --- 非ストリーミング処理 ---
            const responseData = await response.json() as AIResponseJson;
            if (responseData?.response && typeof responseData.response === 'string') {
                return responseData.response;
            } else {
                console.warn("バックエンドからの応答形式が無効でした(非ストリーミング)。", responseData);
                throw new Error("AIバックエンドからの応答形式が無効でした。");
            }

        } catch (error: any) {
            // fetch 自体のエラー (ネットワークエラーなど) や、上記で throw されたエラーを捕捉
            console.error("AIバックエンドへのリクエスト中にエラーが発生しました:", error);
            // エラーの原因情報があれば含める
            const causeMessage = error.cause ? ` (Cause: ${error.cause.code || error.cause.message || error.cause})` : '';
            // エラーを再throwして呼び出し元に伝える
            throw new Error(`AIバックエンドリクエスト失敗: ${error.message}${causeMessage}`);
        }
    }

    /**
     * ストリーミング応答を処理する内部ヘルパーメソッド。
     * @param response フェッチ応答オブジェクト。
     * @param onChunk チャンクデータを受け取るコールバック関数。
     * @returns 結合された全応答テキスト。
     * @throws ストリーム読み取りエラーが発生した場合。
     */
    private async _handleStreamingResponse(response: Response, onChunk: OnChunkCallback): Promise<string> {
        if (!response.body) {
            throw new Error("Streaming response body is missing.");
        }
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let fullResponseText = '';

        try {
            // ReadableStream を非同期イテレータとして処理
            for await (const chunk of response.body) {
                // chunk が Buffer か Uint8Array かで処理を分ける必要はない場合が多いが、念のため Buffer.from で統一
                if (chunk instanceof Buffer || chunk instanceof Uint8Array) {
                    buffer += decoder.decode(chunk, { stream: true });
                } else {
                    throw new Error('Received chunk is neither Buffer nor Uint8Array');
                }
                let parts = buffer.split('\n\n'); // SSE のメッセージ区切り
                buffer = parts.pop() || ''; // 最後の不完全なメッセージをバッファに残す

                for (const part of parts) {
                    if (part.trim() === '') continue;

                    let eventType = 'message'; // デフォルトイベントタイプ
                    let data = '';
                    const lines = part.split('\n');

                    // SSE の各行を解析
                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            eventType = line.substring('event: '.length).trim();
                        } else if (line.startsWith('data: ')) {
                            // data: 行が複数ある場合を考慮して連結
                            data += line.substring('data: '.length);
                        }
                        // id: や retry: など他のSSEフィールドはここでは無視
                    }

                    if (data) {
                        try {
                            const chunkData: StreamChunk = JSON.parse(data);

                            // エラーイベントの処理
                            if (eventType === 'error') {
                                console.error("ストリーミングエラー受信:", chunkData);
                                // エラー情報をコールバックで通知
                                onChunk({ error: chunkData.error || chunkData });
                                // エラー発生時はループを継続するか、ここで throw するか検討。
                                // ここでは継続し、最終的に不完全な応答が返る可能性がある。
                                // throw new Error(`Streaming error received: ${JSON.stringify(chunkData.error || chunkData)}`);
                            } else {
                                // 通常のデータチャンク処理
                                if (chunkData.delta) {
                                    fullResponseText += chunkData.delta;
                                }
                                // コールバックでチャンクデータを通知
                                onChunk(chunkData);
                                // ストリーム終了イベントのログ出力
                                if (chunkData.end_of_stream) {
                                    console.log("ストリーム終了イベント受信。");
                                    // 終了イベントを受け取ったらループを抜けても良いかもしれないが、
                                    // 念のため後続のチャンクがないか確認するためループは継続する。
                                }
                            }
                        } catch (e) {
                            console.error("受信データのJSONパース失敗:", data, e);
                            // パース失敗もエラーとしてコールバック通知
                            onChunk({ error: { message: "Failed to parse chunk data", receivedData: data } });
                        }
                    }
                }
            }
            // ストリームが正常に終了した場合、バッファの最終デコード
            buffer += decoder.decode(undefined, { stream: false });
            if (buffer.trim()) {
                console.warn("ストリーム終了後、未処理のバッファが残っています:", buffer);
                // 必要であれば、この残ったバッファも処理するロジックを追加
            }

            console.log("ストリーム読み取り完了。");
            return fullResponseText; // 結合したテキストを返す

        } catch (streamError: any) {
            console.error("ストリーム読み取り中にエラー:", streamError);
            // ストリーム読み取りエラーもコールバック通知
            onChunk({ error: { message: "Stream reading error", cause: streamError?.message || streamError } });
            // エラーを再throw
            throw new Error(`ストリーム読み取りエラー: ${streamError.message}`);
        }
    }

    /**
     * 利用可能なプロバイダー名のリストを取得します。
     * @returns プロバイダー名の配列。取得失敗時は空配列。
     */
    public async getAvailableProviders(): Promise<string[]> {
        return this._fetchIdentifierList("provider");
    }

    /**
     * 利用可能なモデル名のリストを取得します。
     * @returns モデル名の配列。取得失敗時は空配列。
     */
    public async getAvailableModels(): Promise<string[]> {
        return this._fetchIdentifierList("model");
    }

    /**
     * バックエンドから識別子（プロバイダーまたはモデル）のリストを取得する内部ヘルパーメソッド。
     * @param identifierType 取得する識別子のタイプ ('provider' または 'model')。
     * @returns 識別子の文字列配列。取得失敗時は空配列。
     */
    private async _fetchIdentifierList(identifierType: 'provider' | 'model'): Promise<string[]> {
        const requestUrl = `${this.backendUrl}/models`;
        console.log(`利用可能な ${identifierType} リストを取得中: ${requestUrl}`);
        try {
            const response: Response = await fetch(requestUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                // リクエストボディに type を含める
                body: JSON.stringify({ type: identifierType })
            });

            if (!response.ok) {
                let errorDetail = `HTTPステータス: ${response.status} ${response.statusText}`;
                try {
                    const errorJson = await response.json() as ErrorResponseJson;
                    if (errorJson?.detail) {
                        errorDetail = `${identifierType}リスト取得エラー (${response.status}): ${errorJson.detail}`;
                    }
                } catch (e) { /* ignore json parse error */ }
                console.error(`${identifierType}リストの取得に失敗しました。 ${errorDetail}`);
                return []; // エラー時は空配列を返す
            }

            // バックエンドは直接 string[] を返すことを期待
            const identifiers = await response.json();

            // レスポンスが期待通り string の配列か検証
            if (Array.isArray(identifiers) && identifiers.every((item) => typeof item === 'string')) {
                console.log(`取得成功: ${identifierType} リスト (${identifiers.length}件)`);
                return identifiers as string[];
            } else {
                console.warn(`バックエンドから取得した ${identifierType} リストの形式が無効でした。`, identifiers);
                return []; // 不正な形式の場合も空配列を返す
            }
        } catch (error: any) {
            console.error(`${identifierType}リストの取得中にネットワークエラー等が発生しました:`, error);
            return []; // ネットワークエラー等でも空配列を返す
        }
    }
}

export { LocalAI, OnChunkCallback, StreamChunk };
