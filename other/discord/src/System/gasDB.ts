import JsonDB from "../database"; // パスは環境に合わせて確認してください

// --- 共通のレスポンス型 ---
interface ApiResponse<T = any> {
    success: boolean;
    status: number; // HTTPステータスコード相当
    data: T | { message: string;[key: string]: any }; // 成功時はデータ、失敗時はメッセージ等
}

// 設定データの型
interface GasConfig {
    api_key: string;
    url: string;
}

/**
 * Google Apps Script Web App (JSON DB API) と通信するためのクライアントクラス。
 * インスタンスの生成には非同期の `GasDbApiClient.create()` を使用してください。
 */
export class GasDbApiClient {
    private readonly gasWebAppUrl: string;
    private readonly apiKey: string;
    private readonly authParamName: string; // GAS側で定義した認証用パラメータ名

    /**
     * GasDbApiClient のインスタンスを非同期で初期化して作成します。
     * 設定ファイル (gasDB/gas/config.json) から APIキーとURLを読み込みます。
     * @param authParamName (オプション) APIキーを渡すためのURLパラメータ名。デフォルトは 'apikey'。
     * @returns 初期化された GasDbApiClient のインスタンス。
     * @throws 初期化に失敗した場合 (設定の読み込み失敗、設定内容の不備など)。
     */
    public static async create(authParamName: string = 'apikey'): Promise<GasDbApiClient> {
        console.log("[GasDbApiClient] Attempting to create and initialize instance...");
        try {
            const config = await GasDbApiClient.loadConfig();
            // 設定がロードできたか、必須項目が含まれているかチェック
            if (!config || typeof config.api_key !== 'string' || !config.api_key || typeof config.url !== 'string' || !config.url) {
                console.error("[GasDbApiClient] Initialization failed: Invalid or incomplete configuration loaded.", config);
                throw new Error("Failed to initialize GasDbApiClient: Invalid or incomplete configuration loaded. Check gasDB/gas/config.json.");
            }
            console.log("[GasDbApiClient] Configuration loaded successfully.");
            return new GasDbApiClient(config.url, config.api_key, authParamName);
        } catch (error) {
            console.error("[GasDbApiClient] Initialization failed:", error);
            // エラーをそのまま or カスタムエラーとして再throw
            throw new Error(`GasDbApiClient initialization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 設定をデータベースから読み込む内部ヘルパー関数。
     * 設定が存在しない場合は、空のデフォルト設定を作成して保存し、警告を表示します。
     * @returns 読み込んだ設定データ。
     * @throws JsonDB の初期化やデータ取得/設定に失敗した場合。
     */
    private static async loadConfig(): Promise<GasConfig | null> {
        const dbName = "gasDB";
        const objectKey = "gas";
        const configKey = "config";

        try {
            const configDb = new JsonDB(dbName);
            // JsonDB のコンストラクタが失敗するケースは考えにくいが念のため
            if (!configDb) {
                throw new Error(`Failed to instantiate JsonDB for '${dbName}'.`);
            }

            let configData = await configDb.get<GasConfig>(objectKey, configKey);

            if (!configData) {
                console.warn(`[GasDbApiClient] Config '${configKey}' not found in '${dbName}/${objectKey}'. Initializing with default empty values.`);
                const defaultData: GasConfig = { api_key: "", url: "" };
                try {
                    await configDb.set(objectKey, configKey, defaultData);
                    console.log(`[GasDbApiClient] Default empty config saved to '${dbName}/${objectKey}/${configKey}'. Please update it with valid values.`);
                    // デフォルト値を返す（createメソッド側でこれが有効かチェックされる）
                    configData = defaultData;
                } catch (setError) {
                    console.error(`[GasDbApiClient] Failed to save default config to '${dbName}/${objectKey}/${configKey}':`, setError);
                    throw new Error(`Failed to initialize default configuration: ${setError instanceof Error ? setError.message : String(setError)}`);
                }
            }

            // 念のため、読み込んだデータ（または作成したデフォルトデータ）の型をチェック
            if (typeof configData.api_key !== 'string' || typeof configData.url !== 'string') {
                console.error("[GasDbApiClient] Loaded configuration data structure is invalid:", configData);
                // 有効な構造でない場合は null を返すかエラーを投げる
                // ここではエラーを投げる方が create メソッドでの処理が明確になる
                throw new Error("Loaded configuration data structure is invalid (missing api_key or url string).");
            }

            return configData;

        } catch (error) {
            console.error(`[GasDbApiClient] Error during configuration loading from '${dbName}/${objectKey}/${configKey}':`, error);
            // エラーを再throwして、createメソッドで捕捉できるようにする
            throw error; // 元のエラーを維持
        }
    }

    /**
     * GasDbApiClient の新しいインスタンスを作成します。
     * このコンストラクタは private です。代わりに `GasDbApiClient.create()` を使用してください。
     * @param gasWebAppUrl GAS Web App のデプロイメントURL。
     * @param apiKey GAS Web Appへのアクセスに使用するAPIキー。
     * @param authParamName APIキーを渡すためのURLパラメータ名。
     */
    private constructor(gasWebAppUrl: string, apiKey: string, authParamName: string) {
        // create メソッドで null/空文字 チェック済みだが、念のためここでも確認
        if (!gasWebAppUrl) {
            throw new Error("GasDbApiClient requires a valid gasWebAppUrl.");
        }
        // APIキーは空でも許容するかもしれないが、通常は必須
        if (!apiKey) {
            console.warn("[GasDbApiClient] API Key is empty. API calls might be rejected by the server.");
            // throw new Error("GasDbApiClient requires a valid apiKey."); // 必要ならエラーにする
        }
        if (!authParamName) {
            throw new Error("GasDbApiClient requires a valid authParamName.");
        }

        this.gasWebAppUrl = gasWebAppUrl;
        this.apiKey = apiKey;
        this.authParamName = authParamName;
        console.log("[GasDbApiClient] Instance created successfully.");
    }

    /**
     * GETリクエストを送信するための内部ヘルパー関数。
     * @param action APIのアクション ('get' または 'getAll')。
     * @param params URLに追加するクエリパラメータ (key, object など)。
     */
    private async _fetchGet<T = any>(action: 'get' | 'getAll', params: Record<string, string>): Promise<ApiResponse<T>> {
        if (!this.gasWebAppUrl) {
            return { success: false, status: 400, data: { message: "Client not properly initialized: gasWebAppUrl is missing." } };
        }
        if (!this.apiKey) {
            console.warn("[GasDbApiClient._fetchGet] API Key is missing. Request might fail.");
            // return { success: false, status: 401, data: { message: "Client not properly initialized: apiKey is missing." } }; // 必要ならリクエスト前にエラー
        }

        const url = new URL(this.gasWebAppUrl);
        url.searchParams.set('action', action);
        url.searchParams.set(this.authParamName, this.apiKey); // APIキーをパラメータに追加
        for (const key in params) {
            // hasOwnProperty は Record<string, string> では不要だが念のため
            if (Object.prototype.hasOwnProperty.call(params, key)) {
                url.searchParams.set(key, params[key]);
            }
        }

        const requestUrl = url.toString();
        console.log(`[GasDbApiClient] Sending GET request to: ${requestUrl.split('?')[0]}?action=${action}&...`); // URL全体、特にAPIキーをログに出さないように配慮

        try {
            const response = await fetch(requestUrl, { method: 'GET' });
            const responseData = await response.json(); // GASからの応答はJSON形式と期待
            console.log("[GasDbApiClient] Received response (status:", response.status, "):", responseData);

            // GAS側で設定した success, status が含まれているか簡易チェック
            if (typeof responseData?.success !== 'boolean' || typeof responseData?.status !== 'number') {
                console.warn("[GasDbApiClient] Received unexpected response format:", responseData);
                // できるだけ元の情報を保持してエラーとして返す
                return { success: false, status: response.status, data: { message: "Received unexpected format from server", originalData: responseData } };
            }
            // GAS側から返された status と success を採用
            return responseData as ApiResponse<T>;
        } catch (error: any) {
            console.error("[GasDbApiClient] Error during GET request:", error);
            // ネットワークエラーなど fetch 自体の失敗
            return { success: false, status: 500, data: { message: `Client-side fetch error (GET): ${error.message || String(error)}` } };
        }
    }

    /**
     * POSTリクエストを送信するための内部ヘルパー関数。
     * @param payload リクエストボディとして送信するデータ (action, key, value, object, data などを含む)。
     */
    private async _fetchPost<T = any>(payload: Record<string, any>): Promise<ApiResponse<T>> {
        if (!this.gasWebAppUrl) {
            return { success: false, status: 400, data: { message: "Client not properly initialized: gasWebAppUrl is missing." } };
        }
        if (!this.apiKey) {
            console.warn("[GasDbApiClient._fetchPost] API Key is missing. Request might fail.");
            // return { success: false, status: 401, data: { message: "Client not properly initialized: apiKey is missing." } }; // 必要ならリクエスト前にエラー
        }

        const url = new URL(this.gasWebAppUrl);
        // POSTリクエストでもAPIキーはURLパラメータで渡す (GAS doPost の e.parameter で受け取る想定)
        url.searchParams.set(this.authParamName, this.apiKey);

        const requestUrl = url.toString();
        console.log(`[GasDbApiClient] Sending POST request to: ${requestUrl.split('?')[0]}?...`); // URL全体、特にAPIキーをログに出さないように配慮
        console.log(`[GasDbApiClient] Payload: ${JSON.stringify(payload)}`);

        try {
            const response = await fetch(requestUrl, {
                method: 'POST',
                // GAS の doPost で `JSON.parse(e.postData.contents)` を行う想定
                headers: {
                    // 一般的な API では 'application/json' を使うが、
                    // GAS の e.postData.contents でプレーンテキストとして受け取る場合は 'text/plain'
                    'Content-Type': 'text/plain;charset=utf-8',
                    // 必要に応じて他のヘッダーを追加 (例: 'Accept': 'application/json')
                },
                body: JSON.stringify(payload) // ペイロードをJSON文字列にして送信
                // mode: 'no-cors' は通常不要。GAS側で適切にCORSヘッダーを設定する
            });
            const responseData = await response.json();
            console.log("[GasDbApiClient] Received response (status:", response.status, "):", responseData);

            if (typeof responseData?.success !== 'boolean' || typeof responseData?.status !== 'number') {
                console.warn("[GasDbApiClient] Received unexpected response format:", responseData);
                return { success: false, status: response.status, data: { message: "Received unexpected format from server", originalData: responseData } };
            }
            return responseData as ApiResponse<T>;
        } catch (error: any) {
            console.error("[GasDbApiClient] Error during POST request:", error);
            return { success: false, status: 500, data: { message: `Client-side fetch error (POST): ${error.message || String(error)}` } };
        }
    }

    // --- Public API Methods ---

    /**
     * 指定されたキーに対応する値を取得します。
     * @param key 取得するデータのキー。
     * @param objectName (オプション) 対象のオブジェクト名。省略時はデフォルトオブジェクト。
     * @template T 期待されるデータの型。
     * @returns APIからのレスポンス。成功時は data プロパティに T 型の値が含まれます。
     */
    public async get<T = any>(key: string, objectName?: string): Promise<ApiResponse<T>> {
        if (!key || typeof key !== 'string' || key.trim() === '') {
            console.error("[GasDbApiClient.get] Error: Key must be a non-empty string.");
            return { success: false, status: 400, data: { message: "Client validation: Key must be a non-empty string." } };
        }
        const params: Record<string, string> = { key: key.trim() };
        if (objectName && typeof objectName === 'string' && objectName.trim() !== '') {
            params.object = objectName.trim();
        }
        return this._fetchGet<T>('get', params);
    }

    /**
     * 指定されたオブジェクトのすべてのデータを取得します。
     * @param objectName (オプション) 対象のオブジェクト名。省略時はデフォルトオブジェクト。
     * @template T 期待されるデータの型 (通常は Record<string, any>)。
     * @returns APIからのレスポンス。成功時は data プロパティに T 型の値が含まれます。
     */
    public async getAll<T = Record<string, any>>(objectName?: string): Promise<ApiResponse<T>> {
        const params: Record<string, string> = {};
        if (objectName && typeof objectName === 'string' && objectName.trim() !== '') {
            params.object = objectName.trim();
        }
        return this._fetchGet<T>('getAll', params);
    }

    /**
     * 指定されたキーと値でデータを設定または更新します。
     * @param key 設定するデータのキー。
     * @param value 設定する値 (JSONシリアライズ可能なもの)。
     * @param objectName (オプション) 対象のオブジェクト名。省略時はデフォルトオブジェクト。
     * @template T 期待されるレスポンスデータの型 (通常は { message: string })。
     * @returns APIからのレスポンス。
     */
    public async set<T = { message: string }>(key: string, value: any, objectName?: string): Promise<ApiResponse<T>> {
        if (!key || typeof key !== 'string' || key.trim() === '') {
            console.error("[GasDbApiClient.set] Error: Key must be a non-empty string.");
            return { success: false, status: 400, data: { message: "Client validation: Key must be a non-empty string." } };
        }
        // value が undefined の場合、JSON.stringify で無視される可能性があるため注意
        if (value === undefined) {
            // null に変換するか、GAS側で undefined を扱えるか確認が必要
            console.warn("[GasDbApiClient.set] Warning: Value is undefined. Sending as is, but might be treated as null or missing by the server.");
            // value = null; // 必要に応じて変換
        }
        const payload: Record<string, any> = { action: 'set', key: key.trim(), value };
        if (objectName && typeof objectName === 'string' && objectName.trim() !== '') {
            payload.object = objectName.trim();
        }
        return this._fetchPost<T>(payload);
    }

    /**
     * 指定されたキーのデータを削除します。
     * @param key 削除するデータのキー。
     * @param objectName (オプション) 対象のオブジェクト名。省略時はデフォルトオブジェクト。
     * @template T 期待されるレスポンスデータの型 (通常は { message: string })。
     * @returns APIからのレスポンス。
     */
    public async delete<T = { message: string }>(key: string, objectName?: string): Promise<ApiResponse<T>> {
        if (!key || typeof key !== 'string' || key.trim() === '') {
            console.error("[GasDbApiClient.delete] Error: Key must be a non-empty string.");
            return { success: false, status: 400, data: { message: "Client validation: Key must be a non-empty string." } };
        }
        const payload: Record<string, any> = { action: 'delete', key: key.trim() };
        if (objectName && typeof objectName === 'string' && objectName.trim() !== '') {
            payload.object = objectName.trim();
        }
        return this._fetchPost<T>(payload);
    }

    /**
     * 指定されたオブジェクトのデータをすべて上書きします。
     * @param data 書き込むデータ (Record<string, any> 型のオブジェクト)。
     * @param objectName (オプション) 対象のオブジェクト名。省略時はデフォルトオブジェクト。
     * @template T 期待されるレスポンスデータの型 (通常は { message: string })。
     * @returns APIからのレスポンス。
     */
    public async writeAll<T = { message: string }>(data: Record<string, any>, objectName?: string): Promise<ApiResponse<T>> {
        // typeof null === 'object' なので null も除外
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
            console.error("[GasDbApiClient.writeAll] Error: Data must be a plain object (Record<string, any>).");
            return { success: false, status: 400, data: { message: "Client validation: Data must be a plain object." } };
        }
        const payload: Record<string, any> = { action: 'writeAll', data };
        if (objectName && typeof objectName === 'string' && objectName.trim() !== '') {
            payload.object = objectName.trim();
        }
        return this._fetchPost<T>(payload);
    }
}
