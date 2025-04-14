import fetch, { Response } from 'node-fetch';
import { TextDecoder } from 'util';

const DEFAULT_BACKEND_URL = "http://127.0.0.1:9002";

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

/**
 * 利用可能なプロバイダーのリストを返すJSON形式
 */
interface AvailableProvidersJson {
    models: string[];
}

class LocalAI {
    private backendUrl: string;
    private providerName: string;
    private modelName: string;

    constructor(providerName: string, modelName: string, backendUrl: string = DEFAULT_BACKEND_URL) {
        if (providerName === null || providerName === undefined) {
            throw new Error("Provider名が指定されていません。");
        }

        if (providerName === '' || (providerName !== '' && providerName !== "None")) {
             console.warn(`Provider名が空です。意図しない場合は "None" または有効なProvider名を指定してください。`);
        }
        if (!modelName) {
            console.warn(`モデル名が指定されていません。Provider "${providerName}" によっては必要ない場合もありますが、空でない文字列を推奨します。`);
        }
        this.providerName = providerName;
        this.modelName = modelName;
        this.backendUrl = backendUrl;
    }


    public async chat(prompt: string, onChunk?: OnChunkCallback): Promise<string | null> {
        if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
            throw new Error("有効なプロンプトを入力してください。");
        }

        const isStreaming = onChunk !== undefined;
        const requestUrl = `${this.backendUrl}/chat`;

        const payload: {
            provider_name?: string; // オプショナルにする
            model: string;
            message: string;
            stream: boolean;
        } = {
            model: this.modelName,
            message: prompt,
            stream: isStreaming
        };

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

            if (!response.ok) {
                let errorDetail = `HTTPステータス: ${response.status} ${response.statusText}`;
                try {
                    const errorJson = await response.json() as ErrorResponseJson;
                    if (errorJson?.detail) {
                        errorDetail = `バックエンドエラー (${response.status}): ${errorJson.detail}`;
                    }
                } catch (jsonError) {
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

            if (isStreaming && response.body && onChunk) {
                const decoder = new TextDecoder('utf-8');
                let buffer = '';
                let fullResponseText = '';

                try {
                    for await (const chunk of response.body) {
                        buffer += decoder.decode(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), { stream: true });
                        let parts = buffer.split('\n\n');
                        buffer = parts.pop() || '';

                        for (const part of parts) {
                            if (part.trim() === '') continue;

                            let eventType = 'message';
                            let data = '';
                            const lines = part.split('\n');

                            for (const line of lines) {
                                if (line.startsWith('event: ')) {
                                    eventType = line.substring('event: '.length).trim();
                                } else if (line.startsWith('data: ')) {
                                    data += line.substring('data: '.length);
                                }
                            }

                            if (data) {
                                try {
                                    const chunkData: StreamChunk = JSON.parse(data);

                                    if (eventType === 'error') {
                                        console.error("ストリーミングエラー受信:", chunkData);
                                        onChunk({ error: chunkData.error || chunkData });
                                    } else {
                                        if (chunkData.delta) {
                                            fullResponseText += chunkData.delta;
                                        }
                                        onChunk(chunkData);
                                        if (chunkData.end_of_stream) {
                                            console.log("ストリーム終了イベント受信。");
                                        }
                                    }
                                } catch (e) {
                                    console.error("受信データのJSONパース失敗:", data, e);
                                    onChunk({ error: { message: "Failed to parse chunk data", receivedData: data } });
                                }
                            }
                        }
                    }
                    console.log("ストリーム読み取り完了。");

                } catch (streamError: any) {
                    console.error("ストリーム読み取り中にエラー:", streamError);
                    onChunk({ error: { message: "Stream reading error", cause: streamError?.message || streamError } });
                    throw new Error(`ストリーム読み取りエラー: ${streamError.message}`);
                }
                return fullResponseText;
            }

                const responseData = await response.json() as AIResponseJson;
                if (responseData?.response && typeof responseData.response === 'string') {
                    return responseData.response;
                } else {
                    console.warn("バックエンドからの応答形式が無効でした(非ストリーミング)。", responseData);
                    throw new Error("AIバックエンドからの応答形式が無効でした。");
                }



            
        } catch (error: any) {
            console.error("AIバックエンドへのリクエスト中にネットワークエラー等が発生しました:", error);
            const causeMessage = error.cause ? ` (Cause: ${error.cause.code || error.cause.message || error.cause})` : '';
            throw new Error(`AIバックエンドリクエスト失敗: ${error.message}${causeMessage}`);
        }
    }


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
                body: JSON.stringify({}) // 空のボディを送信
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
            const providers = await response.json() as AvailableProvidersJson;
            if (providers && Array.isArray(providers.models) && providers.models.every((item) => typeof item === 'string')) {
                return providers.models
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

export { LocalAI, OnChunkCallback, StreamChunk };
