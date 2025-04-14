import fetch, { Response } from 'node-fetch'; // Response 型もインポート
import { TextDecoder } from 'util'; // Node.js標準のTextDecoderを使用

// --- 定数 ---
const DEFAULT_BACKEND_URL = "http://127.0.0.1:9002";

// --- 型定義 ---
/**
 * ストリーミングで受信するチャンクデータの型
 */
interface StreamChunk {
    delta?: string;          // テキストの差分
    end_of_stream?: boolean; // ストリーム終了フラグ
    error?: any;             // エラー情報
}

/**
 * chatメソッドのonChunkコールバック関数の型
 */
type OnChunkCallback = (chunk: StreamChunk) => void;

/**
 * AI応答のJSON形式 (非ストリーミング時)
 */
interface AIResponseJson {
    response: string;
}

/**
 * エラー応答のJSON形式
 */
interface ErrorResponseJson {
    detail?: string;
}


/**
 * ローカルのFastAPIバックエンド(g4f)と通信してAI応答を取得するクラス
 */
class LocalAI {
    private backendUrl: string;
    private providerName: string;
    private modelName: string;

    /**
     * LocalAIクラスのインスタンスを生成します。
     * @param providerName 使用するg4fのProvider名 (例: "Grok")
     * @param modelName Provider内で使用するモデル名 (例: "mixtral-8x7b", "grok-3-thinking")
     * @param backendUrl (オプション) FastAPIバックエンドサーバーのURL。デフォルトは "http://127.0.0.1:9002"。
     */
    constructor(providerName: string, modelName: string, backendUrl: string = DEFAULT_BACKEND_URL) {
        if (!providerName) {
            throw new Error("Provider名が指定されていません。");
        }
        if (!modelName) {
            console.warn(`モデル名が指定されていません。Provider "${providerName}" によっては必要ない場合もありますが、空でない文字列を推奨します。`);
        }
        this.providerName = providerName;
        this.modelName = modelName;
        this.backendUrl = backendUrl;
    }

    /**
     * 指定されたプロンプトを使用してローカルAIバックエンドにリクエストを送信し、応答を取得します。
     * ストリーミングを有効にするには、onChunkコールバックを提供します。
     * @param prompt AIへのユーザー入力テキスト
     * @param onChunk (オプション) ストリーミング中にチャンクデータを受け取るコールバック関数
     * @returns 非ストリーミング時はAI応答テキスト。ストリーミング時は全応答テキスト (エラー時はnull)。
     * @throws 通信エラーやバックエンドエラーが発生した場合
     */
    public async chat(prompt: string, onChunk?: OnChunkCallback): Promise<string | null> {
        if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
            throw new Error("有効なプロンプトを入力してください。"); // エラーをスローするように変更
        }

        const isStreaming = onChunk !== undefined;
        const requestUrl = `${this.backendUrl}/chat`;
        const payload = {
            provider_name: this.providerName,
            model: this.modelName,
            message: prompt,
            stream: isStreaming // onChunkの有無でストリーミングを判断
        };

        console.log(`リクエスト送信中: ${requestUrl} - Provider: ${this.providerName}, Model: ${this.modelName}, Stream: ${isStreaming}`);

        try {
            const response: Response = await fetch(requestUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': isStreaming ? 'text/event-stream' : 'application/json' // Acceptヘッダーを切り替え
                },
                body: JSON.stringify(payload)
            });

            // --- エラーレスポンスの処理 ---
            if (!response.ok) {
                let errorDetail = `HTTPステータス: ${response.status} ${response.statusText}`;
                try {
                    // エラー応答がJSON形式の場合、detailを取得試行
                    const errorJson = await response.json() as ErrorResponseJson;
                    if (errorJson?.detail) {
                        errorDetail = `バックエンドエラー (${response.status}): ${errorJson.detail}`;
                    }
                } catch (jsonError) {
                    // JSONパース失敗時はテキストとして取得試行
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
                throw new Error(`AIバックエンドとの通信に失敗しました。(${errorDetail})`);
            }

            // --- ストリーミング応答の処理 ---
            if (isStreaming && response.body && onChunk) {
                const decoder = new TextDecoder('utf-8');
                let buffer = '';
                let fullResponseText = '';

                try {
                    // node-fetch の response.body は Node.js の Readable ストリーム (非同期イテラブル)
                    for await (const chunk of response.body) {
                        // chunk は Buffer 型のはず
                        buffer += decoder.decode(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), { stream: true });

                        // SSEメッセージは \n\n で区切られる
                        let parts = buffer.split('\n\n');

                        // 最後の要素は不完全なメッセージの可能性があるため、バッファに残す
                        buffer = parts.pop() || '';

                        for (const part of parts) {
                            if (part.trim() === '') continue; // 空行は無視

                            let eventType = 'message'; // デフォルトイベント
                            let data = '';
                            const lines = part.split('\n');

                            for (const line of lines) {
                                if (line.startsWith('event: ')) {
                                    eventType = line.substring('event: '.length).trim();
                                } else if (line.startsWith('data: ')) {
                                    // 複数行のdataフィールドに対応するため、最初のdata:以降を連結
                                    data += line.substring('data: '.length);
                                }
                                // 'id:' や 'retry:' など他のSSEフィールドは今回は無視
                            }

                            if (data) {
                                try {
                                    const chunkData: StreamChunk = JSON.parse(data);

                                    if (eventType === 'error') {
                                        console.error("ストリーミングエラー受信:", chunkData);
                                        onChunk({ error: chunkData.error || chunkData }); // errorフィールドがあればそれを、なければ全体を渡す
                                    } else {
                                        // 通常のデータ ('message' イベントまたはイベント指定なし)
                                        if (chunkData.delta) {
                                            fullResponseText += chunkData.delta;
                                        }
                                        onChunk(chunkData); // コールバックを呼び出し

                                        if (chunkData.end_of_stream) {
                                            console.log("ストリーム終了イベント受信。");
                                            // ここでループを抜ける必要はない (readerが完了するのを待つ)
                                        }
                                    }
                                } catch (e) {
                                    console.error("受信データのJSONパース失敗:", data, e);
                                    onChunk({ error: { message: "Failed to parse chunk data", receivedData: data } });
                                }
                            }
                        }
                    }
                    // ループ終了後 (ストリームが閉じた後)
                    console.log("ストリーム読み取り完了。");
                    // 必要であれば最後に onChunk({ end_of_stream: true }) を再度呼ぶこともできるが、
                    // サーバーが送る end_of_stream イベントに依存するのが普通

                } catch (streamError: any) {
                    console.error("ストリーム読み取り中にエラー:", streamError);
                    // ストリーム読み取りエラーをコールバックで通知
                    onChunk({ error: { message: "Stream reading error", cause: streamError?.message || streamError } });
                    throw new Error(`ストリーム読み取りエラー: ${streamError.message}`); // エラーを再スロー
                }
                return fullResponseText; // 成功時は全文を返す (コールバックで処理済みでも返す)
            }

            // --- 非ストリーミング応答の処理 ---
            else if (!isStreaming) {
                const responseData = await response.json() as AIResponseJson;
                if (responseData?.response && typeof responseData.response === 'string') {
                    return responseData.response;
                } else {
                    console.warn("バックエンドからの応答形式が無効でした(非ストリーミング)。", responseData);
                    throw new Error("AIバックエンドからの応答形式が無効でした。");
                }
            }
            // isStreaming=trueだがresponse.bodyがない、またはonChunkがない場合(通常は起こらないはず)
            else {
                console.error("ストリーミング処理の前提条件が満たされていません。");
                throw new Error("ストリーミング処理を開始できませんでした。");
            }

        } catch (error: any) {
            // fetch 자체의 에러 (네트워크 등)
            console.error("AIバックエンドへのリクエスト中にネットワークエラー等が発生しました:", error);
            // エラーオブジェクトに cause が含まれていれば詳細情報として利用
            const causeMessage = error.cause ? ` (Cause: ${error.cause.code || error.cause.message || error.cause})` : '';
            throw new Error(`AIバックエンドリクエスト失敗: ${error.message}${causeMessage}`);
        }
    }

    /**
    * 利用可能なProviderのリストをバックエンドから取得します。
    * (このメソッドは変更なし)
    */
    public async getAvailableProviders(): Promise<string[]> {
        const requestUrl = `${this.backendUrl}/models`;
        console.log(`利用可能なProviderリストを取得中: ${requestUrl}`);
        try {
            const response: Response = await fetch(requestUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({})
            });
            if (!response.ok) {
                let errorDetail = `HTTPステータス: ${response.status} ${response.statusText}`;
                try {
                    const errorJson = await response.json() as ErrorResponseJson;
                    if (errorJson?.detail) { errorDetail = `Providerリスト取得エラー (${response.status}): ${errorJson.detail}`; }
                } catch (e) { /* ignore */ }
                console.error(`Providerリストの取得に失敗しました。 ${errorDetail}`);
                return [];
            }
            const providers = await response.json();
            if (Array.isArray(providers) && providers.every(item => typeof item === 'string')) {
                return providers;
            } else {
                console.warn("バックエンドから取得したProviderリストの形式が無効でした。", providers);
                return [];
            }
        } catch (error: any) {
            console.error("Providerリストの取得中にネットワークエラー等が発生しました:", error);
            return [];
        }
    }
}

// LocalAIクラスをエクスポート
export { LocalAI, OnChunkCallback, StreamChunk }; // 型もエクスポート