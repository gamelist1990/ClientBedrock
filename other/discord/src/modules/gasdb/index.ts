import { EmbedBuilder, Message, GuildTextBasedChannel, AttachmentBuilder } from "discord.js";
import { PREFIX, registerCommand } from "../..";
import { Command } from "../../types/command";
import { Buffer } from 'buffer';

const GAS_DB_API_URL = "https://script.google.com/macros/s/AKfycbxy3V5phmHnmc5yV4X5dIktey8jKBhQ5-BhfJYetNT5U44-BSlaljGHJDLgKxTD-6wtsw/exec";
const GAS_DB_API_KEY = "jLzM1cxhpLSQngyW1aSK51HcF6N16GDf";
const AUTH_PARAM_NAME = 'apikey';

async function callGasDbApi(
    action: 'get' | 'getAll' | 'set' | 'delete',
    key?: string,
    value?: any
): Promise<any> {
    if (!GAS_DB_API_KEY) {
        console.error("❌ FATAL: GAS_DB_API_KEY is not set!");
        throw new Error("データベースAPIキーが設定されていません。ボットの管理者に連絡してください。");
    }

    let url = GAS_DB_API_URL;
    const apiKeyParam = `${AUTH_PARAM_NAME}=${encodeURIComponent(GAS_DB_API_KEY)}`;

    const options: RequestInit = {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
    };

    if (action === 'get' && key) {
        url += `?action=get&key=${encodeURIComponent(key)}&${apiKeyParam}`;
    } else if (action === 'getAll') {
        url += `?action=getAll&${apiKeyParam}`;
    } else if (action === 'set' && key && value !== undefined) {
        options.method = 'POST';
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify({ action: 'set', key: key, value: value });
        url += `?${apiKeyParam}`;
    } else if (action === 'delete' && key) {
        options.method = 'POST';
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify({ action: 'delete', key: key });
        url += `?${apiKeyParam}`;
    } else {
        throw new Error(`無効なAPI呼び出しパラメータ: action=${action}, key=${key}, value provided=${value !== undefined}`);
    }

    let response: Response;
    try {
        response = await fetch(url, options);
    } catch (error: any) {
        if (error.name === 'AbortError') {
            console.error(`API call to ${url} timed out.`);
            throw new Error('データベースサービスの応答がタイムアウトしました。');
        }
        console.error(`Network error during API call to ${url}:`, error);
        throw new Error(`データベースサービスへの接続に失敗しました: ${error.message}`);
    }

    if (!response.ok) {
        let errorDetail = `APIステータス: ${response.status} (${response.statusText})`;
        let specificReason = '';
        try {
            const errorJson = await response.json();
            specificReason = errorJson?.data?.message || errorJson?.error || '詳細不明';
        } catch (e) {
            try {
                const errorText = await response.text();
                specificReason = errorText.substring(0, 200);
            } catch (e2) { /* ignore */ }
        }

        if (response.status === 401) {
            errorDetail = `認証エラー (401)。URLパラメータ '${AUTH_PARAM_NAME}' のAPIキーが無効か、設定されていない可能性があります。`;
        } else if (response.status === 429) {
            errorDetail = `レート制限超過 (429)。${specificReason ? `理由: ${specificReason}` : 'しばらく待ってから再試行してください。'}`;
        } else if (specificReason && specificReason !== '詳細不明') {
            errorDetail = `理由: ${specificReason}`;
        }

        console.error(`API Error (${response.status}): ${errorDetail} (URL: ${url}, Method: ${options.method})`);
        throw new Error(`データベース操作に失敗しました (${errorDetail})`);
    }

    let result: any;
    try {
        result = await response.json();
    } catch (e) {
        console.error(`Failed to parse successful JSON response from API (URL: ${url}, Method: ${options.method}):`, e);
        throw new Error('データベースからの応答の解析に失敗しました。');
    }

    if (result && result.success === false) {
        const message = result.data?.message || 'APIからエラーが返されましたが、理由は不明です。';
        console.error(`API returned success=false: ${message} (URL: ${url}, Method: ${options.method})`);
        throw new Error(`データベース操作はAPI側で失敗しました。理由: ${message}`);
    }

    return result;
}

const dbCommand: Command = {
    name: 'db',
    description: 'JSONデータベースを操作します (set/get/delete)。',
    admin: false,
    usage: 'db <set key|get <key|all>|delete key> (setの場合はJSONファイルを添付)',
    execute: async (_client, message: Message, args: string[]) => {
        if (!message.guild || !message.channel || !message.channel.isTextBased() || message.channel.isDMBased()) {
            await message.reply('❌ このコマンドはサーバーのテキストチャンネルでのみ使用できます。').catch(console.error);
            return;
        }
        const channel: GuildTextBasedChannel = message.channel;

        const subCommand = args[0]?.toLowerCase();
        const keyOrAll = args[1];

        let loadingMessage: Message | null = null;

        try {
            switch (subCommand) {
                case 'set': {
                    const setKey = args[1];
                    if (!setKey) {
                        await channel.send(`❌ キーを指定してください。\n使い方: \`${PREFIX}db set <key>\` (JSONファイルを添付)`);
                        return;
                    }
                    if (message.attachments.size !== 1) {
                        await channel.send(`❌ JSONファイルを1つだけ添付してください。`);
                        return;
                    }
                    const attachment = message.attachments.first()!;
                    if (!attachment.name?.toLowerCase().endsWith('.json')) {
                        await channel.send(`❌ 添付ファイルは \`.json\` 形式である必要があります。`);
                        return;
                    }

                    loadingMessage = await channel.send(`⏳ キー「${setKey}」にデータを保存しています...`);
                    const fetchResponse = await fetch(attachment.url);
                    if (!fetchResponse.ok) throw new Error(`添付ファイル (${attachment.name}) のダウンロードに失敗しました (${fetchResponse.statusText})。`);
                    const jsonText = await fetchResponse.text();
                    let jsonData: any;
                    try {
                        jsonData = JSON.parse(jsonText);
                    }
                    catch (e) {
                        throw new Error(`添付されたJSONファイルの形式が正しくありません。\nエラー: ${e instanceof Error ? e.message : String(e)}`);
                    }
                    await callGasDbApi('set', setKey, jsonData);
                    if (loadingMessage) await loadingMessage.delete().catch(console.warn);
                    await message.reply(`✅ キー「${setKey}」にデータを保存しました。`).catch(console.error);
                    break;
                }
                case 'get': {
                    if (!keyOrAll) {
                        await channel.send(`❌ 取得するデータのキー または \`all\` を指定してください。\n使い方: \`${PREFIX}db get <key|all>\``);
                        return;
                    }

                    if (keyOrAll.toLowerCase() === 'all') {
                        loadingMessage = await channel.send("⏳ 全データを取得しています...");
                        const resultGetAll = await callGasDbApi('getAll');
                        const allData = resultGetAll.data;
                        if (loadingMessage) await loadingMessage.delete().catch(console.warn);

                        if (allData === undefined || allData === null) {
                            console.warn("API returned success=true for getAll but data is undefined/null");
                            await message.reply("ℹ️ データベースからデータを取得できましたが、内容が空のようです。").catch(console.error);
                            return;
                        }

                        const keysCount = Object.keys(allData).length;
                        if (keysCount === 0) {
                            await message.reply("ℹ️ データベースにはまだデータが登録されていません。").catch(console.error);
                            return;
                        }
                        const allDataString = JSON.stringify(allData, null, 2);
                        if (allDataString.length <= 1980) {
                            const embed = new EmbedBuilder()
                                .setColor(0x0099FF)
                                .setTitle(`📚 全データ (${keysCount}件)`)
                                .setDescription("```json\n" + allDataString.substring(0, 1980) + (allDataString.length > 1980 ? "\n..." : "") + "\n```")
                                .setTimestamp();
                            await message.reply({ embeds: [embed] }).catch(console.error);
                        } else {
                            const buffer = Buffer.from(allDataString, 'utf-8');
                            const file = new AttachmentBuilder(buffer, { name: 'all_database_data.json' });
                            await message.reply({ content: `✅ 全${keysCount}件のデータをファイルで送信します。`, files: [file] }).catch(console.error);
                        }
                    }
                    else {
                        const getKey = keyOrAll;
                        loadingMessage = await channel.send(`⏳ キー「${getKey}」のデータを取得しています...`);
                        const resultGet = await callGasDbApi('get', getKey);
                        const dataToDisplay = resultGet.data;
                        if (loadingMessage) await loadingMessage.delete().catch(console.warn);

                        if (dataToDisplay === undefined) {
                            await message.reply(`❓ キー「${getKey}」のデータが見つかりませんでした。 (API応答は成功しましたが、データが含まれていませんでした)`).catch(console.error);
                            return;
                        }

                        const jsonStringGet = JSON.stringify(dataToDisplay, null, 2);
                        if (jsonStringGet.length <= 1980) {
                            const embed = new EmbedBuilder()
                                .setColor(0x00FF00)
                                .setTitle(`📄 データ取得: ${getKey}`)
                                .setDescription("```json\n" + jsonStringGet.substring(0, 1980) + (jsonStringGet.length > 1980 ? "\n..." : "") + "\n```")
                                .setTimestamp();
                            await message.reply({ embeds: [embed] }).catch(console.error);
                        } else {
                            const buffer = Buffer.from(jsonStringGet, 'utf-8');
                            const file = new AttachmentBuilder(buffer, { name: `${getKey}.json` });
                            await message.reply({ content: `✅ キー「${getKey}」のデータをファイルで送信します。`, files: [file] }).catch(console.error);
                        }
                    }
                    break;
                }
                case 'delete': {
                    const deleteKey = args[1];
                    if (!deleteKey) {
                        await channel.send(`❌ 削除するデータのキーを指定してください。\n使い方: \`${PREFIX}db delete <key>\``);
                        return;
                    }
                    loadingMessage = await channel.send(`⏳ キー「${deleteKey}」のデータを削除しています...`);
                    await callGasDbApi('delete', deleteKey);
                    if (loadingMessage) await loadingMessage.delete().catch(console.warn);
                    await message.reply(`✅ キー「${deleteKey}」のデータを削除しました。`).catch(console.error);
                    break;
                }
                default:
                    await channel.send(
                        `❌ 不明なサブコマンドです。\n使い方: \`${PREFIX}db <set key|get <key|all>|delete key> (setの場合はJSONファイルを添付)\``
                    );
                    break;
            }

        } catch (error: any) {
            if (loadingMessage) {
                await loadingMessage.delete().catch(e => console.warn("Failed to delete loading message on error:", e));
            }
            console.error(`❌ dbコマンドでエラーが発生 (Sub: ${subCommand}, Key/All: ${keyOrAll}):`, error);

            let userErrorMessage = '❌ データベース操作中に予期せぬエラーが発生しました。';
            if (error instanceof Error) {
                if (error.message.includes('データベース操作に失敗しました') ||
                    error.message.includes('データベースサービス') ||
                    error.message.includes('データベースAPIキーが設定されていません') ||
                    error.message.includes('添付ファイル') ||
                    error.message.includes('JSONファイルの形式') ||
                    error.message.includes('API側で失敗しました') ||
                    error.message.includes('応答の解析に失敗しました')
                ) {
                    userErrorMessage = `❌ ${error.message}`;
                }
                else if (error.name === 'TimeoutError' && !error.message.includes('タイムアウト')) {
                    userErrorMessage = '❌ データベースサービスの応答がタイムアウトしました。';
                }
            }
            await message.reply(userErrorMessage).catch(console.error);
        }
    }
};

registerCommand(dbCommand);