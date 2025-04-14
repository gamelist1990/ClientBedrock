import { EmbedBuilder } from "discord.js";
import { PREFIX, registerCommand } from "../.."; // パスは環境に合わせてください
import { Command } from "../../types/command";
import { GasDbApiClient } from "../../System/gasDB";

// --- 定数 ---
export const DB_OBJECT_NAME = "BanData";
export const GLOBAL_BAN_KEY = "globalBan";
export const MINECRAFT_BAN_KEY = "minecraftBan";
export const ITEMS_PER_PAGE = 10; // list コマンドの1ページあたりの表示件数

// --- BAN情報の型定義 ---
export type BanInfo = {
    reason: string;
    timestamp: number; // BANされたUNIXタイムスタンプ (秒)
    bannedBy: string; // BANを実行したユーザーのID
    bannedByTag: string; // BANを実行したユーザーのタグ (表示用)
    unbanAt?: number; // 解除予定時刻のUNIXタイムスタンプ (秒)、なければ無期限
};
// キー: ユーザーID (global) または Minecraftユーザー名 (minecraft)
export type BanListType = Record<string, BanInfo>;


/**
 * 期間文字列 (例: "1d", "2h30m", "1w") を秒数に変換する。
 * @param durationString 期間を表す文字列。
 * @returns 合計秒数。無効な形式またはマッチしない場合は null を返す。
 */
function parseDuration(durationString: string): number | null {
    const regex = /(\d+)\s*(d|h|m|w)/gi; // d:日, h:時, m:分, w:週
    let totalSeconds = 0;
    let match;
    let foundMatch = false;

    // 文字列全体から期間指定を繰り返し抽出して合計する
    while ((match = regex.exec(durationString)) !== null) {
        foundMatch = true;
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();

        if (isNaN(value)) continue; // 数値でなければスキップ

        switch (unit) {
            case 'd':
                totalSeconds += value * 24 * 60 * 60;
                break;
            case 'h':
                totalSeconds += value * 60 * 60;
                break;
            case 'm':
                totalSeconds += value * 60;
                break;
            case 'w':
                totalSeconds += value * 7 * 24 * 60 * 60;
                break;
        }
    }

    // 何かしら有効な期間指定が見つかった場合のみ秒数を返す
    return foundMatch ? totalSeconds : null;
}

/**
 * BANリストの指定されたページを表示するための EmbedBuilder を作成する。
 * @param listType リストの種類 ('Global' または 'Minecraft')。
 * @param banList 表示するBANリストデータ。
 * @param page 表示するページ番号 (1始まり)。
 * @param itemsPerPage 1ページあたりのアイテム数。
 * @returns 作成された EmbedBuilder インスタンス。
 */
function createListPageEmbed(
    listType: 'Global' | 'Minecraft',
    banList: BanListType,
    page: number,
    itemsPerPage: number
): EmbedBuilder {
    const entries = Object.entries(banList);
    // BANされた時刻（timestamp）が新しい順にソート
    entries.sort(([, a], [, b]) => b.timestamp - a.timestamp);

    const totalItems = entries.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage)); // 0件でも1ページとする

    // 無効なページ番号が指定された場合は調整
    const validPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (validPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageEntries = entries.slice(startIndex, endIndex);

    const embed = new EmbedBuilder()
        .setTitle(`🚫 ${listType} BAN List`)
        .setColor(0xFF0000) // BANリストは赤色
        .setFooter({ text: `Page ${validPage}/${totalPages} (${totalItems} total entries)` });

    if (totalItems === 0) {
        embed.setDescription('このリストにはBANされているユーザーがいません。');
        return embed;
    }

    if (pageEntries.length === 0) {
        // totalItems > 0 なのに pageEntries が 0 になるのはページ番号が範囲外の場合
        embed.setDescription(`指定されたページ (${page}) は無効です。総ページ数: ${totalPages}`);
        return embed;
    }

    let description = '';
    pageEntries.forEach(([key, info], index) => {
        const entryNumber = startIndex + index + 1;
        // BANされた日時を相対表示
        const banDate = `<t:${info.timestamp}:R>`;
        // 解除予定日時があれば表示、なければ「永久」
        let unbanText = '永久';
        if (info.unbanAt) {
            const unbanDate = `<t:${info.unbanAt}:F> (<t:${info.unbanAt}:R>)`;
            unbanText = `解除予定: ${unbanDate}`;
        }
        // Global BAN の場合は Discord ユーザーとしてメンションを試みる
        const identifier = listType === 'Global' ? `<@${key}> (\`${key}\`)` : `\`${key}\``;

        description += `**${entryNumber}. ${identifier}**\n`;
        description += `   理由: ${info.reason || 'なし'}\n`; // 理由が空の場合も考慮
        description += `   実行者: ${info.bannedByTag} (<@${info.bannedBy}>)\n`; // 実行者もメンション
        description += `   日時: ${banDate} (<t:${info.timestamp}:f>)\n`; // 相対時刻と絶対時刻
        description += `   期間: ${unbanText}\n\n`; // 各エントリ間にスペース
    });

    // Discord の Embed Description の文字数制限を考慮
    embed.setDescription(description.substring(0, 4090) + (description.length > 4090 ? "..." : ""));

    return embed;
}


// --- メインの ban コマンド ---
const banCommand: Command = {
    name: 'ban',
    description: 'ユーザーをグローバルBANリストまたはMinecraft BANリストに追加/削除/表示します。',
    admin: true,
    usage: [ // 複数の使い方を配列で示す
        'ban add <userID> [期間] [理由]',
        'ban add mine <username> [期間] [理由]',
        'ban remove global <userID>',
        'ban remove mine <username>',
        'ban list global [ページ番号]',
        'ban list mine [ページ番号]'
    ].join('\n'), // ヘルプ表示用に改行で連結
    execute: async (client, message, args) => {
        const subCommand = args[0]?.toLowerCase(); // add, remove, list
        const typeArg = args[1]?.toLowerCase(); // global, mine

        let apiClient: GasDbApiClient;
        try {
            apiClient = await GasDbApiClient.create();
        } catch (error) {
            console.error("❌ GasDbApiClient の初期化に失敗しました:", error);
            await message.reply('❌ データベースクライアントの初期化に失敗しました。設定を確認してください。');
            return;
        }

        // --- サブコマンド: add ---
        if (subCommand === 'add') {
            let targetIdOrName: string | undefined;
            let isMinecraftBan = false;
            let durationStringIndex = 2; // 期間文字列が始まる可能性のあるインデックス

            if (typeArg === 'mine') {
                isMinecraftBan = true;
                targetIdOrName = args[2]; // ban add mine <username> ...
                durationStringIndex = 3;
            } else {
                // typeArg が 'mine' でない場合、userID とみなす
                // ban add <userID> ...
                targetIdOrName = typeArg; // ここでは typeArg が userID に相当
                isMinecraftBan = false;
                // この場合、durationStringIndex は 2 のまま
            }

            // 対象ID/名前が指定されているかチェック
            if (!targetIdOrName) {
                await message.reply(`❌ BAN対象の ${isMinecraftBan ? 'Minecraftユーザー名' : 'ユーザーID'} を指定してください。\n使い方:\n\`${PREFIX}ban add ${isMinecraftBan ? 'mine <username>' : '<userID>'} [期間] [理由]\``);
                return;
            }

            // Global BAN の場合、ID形式をチェック
            if (!isMinecraftBan && !/^\d+$/.test(targetIdOrName)) {
                await message.reply(`❌ 無効なユーザーID形式です。DiscordユーザーID (数字のみ) を指定してください。`);
                return;
            }

            // 期間と理由をパース
            let durationSeconds: number | null = null;
            let reasonStartIndex = durationStringIndex;
            let reason = '';

            // 期間指定があるかチェック (例: 1d, 2h30m)
            if (args[durationStringIndex]) {
                const parsed = parseDuration(args[durationStringIndex]);
                if (parsed !== null) {
                    durationSeconds = parsed;
                    reasonStartIndex = durationStringIndex + 1; // 期間指定があったので理由の開始インデックスをずらす
                }
                // parseDuration が null を返した場合、それは期間指定ではなく理由の一部とみなす
            }

            reason = args.slice(reasonStartIndex).join(' ') || '理由なし';

            const dbKey = isMinecraftBan ? MINECRAFT_BAN_KEY : GLOBAL_BAN_KEY;
            const listName = isMinecraftBan ? 'Minecraft' : 'Global';

            try {
                // 1. 現在のリストを取得
                const getResponse = await apiClient.get<BanListType>(dbKey, DB_OBJECT_NAME);
                let banList: BanListType = {};

                if (getResponse.success && getResponse.data && typeof getResponse.data === 'object' && !Array.isArray(getResponse.data)) {
                    banList = getResponse.data;
                } else if (!getResponse.success && getResponse.status !== 404) { // 404 (Not Found) 以外のエラー
                    await message.reply(`❌ ${listName} BANリストの取得に失敗しました: ${getResponse.data?.message || '不明なエラー'}`);
                    return;
                }
                // 404 またはデータが null/undefined の場合は空のリストとして初期化される

                // 2. 既にBANされているか確認
                if (banList[targetIdOrName]) {
                    const existingBanInfo = banList[targetIdOrName];
                    const banDate = `<t:${existingBanInfo.timestamp}:f>`;
                    await message.reply(`ℹ️ ${isMinecraftBan ? 'ユーザー' : 'ユーザー'} \`${targetIdOrName}\` は既に \`${existingBanInfo.bannedByTag}\` によって ${banDate} にBANされています。\n理由: ${existingBanInfo.reason}${existingBanInfo.unbanAt ? ` (解除予定: <t:${existingBanInfo.unbanAt}:R>)` : ''}`);
                    return;
                }

                // 3. 新しいBAN情報を作成
                const now = Math.floor(Date.now() / 1000);
                const newBanInfo: BanInfo = {
                    reason: reason,
                    timestamp: now,
                    bannedBy: message.author.id,
                    bannedByTag: message.author.tag,
                    unbanAt: durationSeconds ? now + durationSeconds : undefined // 期間指定があれば解除時刻を設定
                };
                banList[targetIdOrName] = newBanInfo;

                // 4. 更新したリストを保存
                const setResponse = await apiClient.set(dbKey, banList, DB_OBJECT_NAME);

                if (setResponse.success) {
                    let targetDisplay = targetIdOrName;
                    if (!isMinecraftBan) {
                        try {
                            const user = await client.users.fetch(targetIdOrName);
                            targetDisplay = user.tag;
                        } catch { /* ignore fetch error */ }
                    }
                    const durationText = durationSeconds ? ` (期間: ${args[durationStringIndex]})` : '';
                    const unbanTimeText = newBanInfo.unbanAt ? ` 解除予定: <t:${newBanInfo.unbanAt}:F>` : '';

                    await message.reply(`✅ ${isMinecraftBan ? 'Minecraftユーザー' : 'ユーザー'} \`${targetDisplay}\` を ${listName} BANリストに追加しました${durationText}。\n理由: ${reason}${unbanTimeText}`);
                    console.log(`[ban add] ${listName} BAN: ${targetIdOrName} banned by ${message.author.tag}. Duration: ${durationSeconds ? args[durationStringIndex] : 'permanent'}. Reason: ${reason}`);
                } else {
                    await message.reply(`❌ ${listName} BANリストの更新に失敗しました: ${setResponse.data?.message || '不明なエラー'}`);
                }

            } catch (error) {
                console.error(`❌ ban add (${listName}) エラー:`, error);
                await message.reply(`❌ ${listName} BAN追加処理中に予期せぬエラーが発生しました。`);
            }

            // --- サブコマンド: remove ---
        } else if (subCommand === 'remove') {
            const targetType = args[1]?.toLowerCase(); // 'global' or 'mine'
            const targetIdOrName = args[2];

            if (!targetType || (targetType !== 'global' && targetType !== 'mine')) {
                await message.reply(`❌ BAN解除対象のリストタイプ ('global' または 'mine') を指定してください。\n使い方:\n\`${PREFIX}ban remove global <userID>\`\n\`${PREFIX}ban remove mine <username>\``);
                return;
            }

            if (!targetIdOrName) {
                await message.reply(`❌ BAN解除対象の ${targetType === 'global' ? 'ユーザーID' : 'Minecraftユーザー名'} を指定してください。`);
                return;
            }

            // Global BAN の場合、ID形式をチェック
            if (targetType === 'global' && !/^\d+$/.test(targetIdOrName)) {
                await message.reply(`❌ 無効なユーザーID形式です。DiscordユーザーID (数字のみ) を指定してください。`);
                return;
            }

            const dbKey = targetType === 'mine' ? MINECRAFT_BAN_KEY : GLOBAL_BAN_KEY;
            const listName = targetType === 'mine' ? 'Minecraft' : 'Global';

            try {
                // 1. 現在のリストを取得
                const getResponse = await apiClient.get<BanListType>(dbKey, DB_OBJECT_NAME);

                if (!getResponse.success || !getResponse.data || typeof getResponse.data !== 'object' || Array.isArray(getResponse.data)) {
                    // 404 Not Found の場合も含む
                    await message.reply(`❌ ${listName} BANリストが見つからないか、取得に失敗しました。`);
                    return;
                }

                const banList: BanListType = getResponse.data;

                // 2. 指定された対象がリストに存在するか確認
                if (!banList[targetIdOrName]) {
                    await message.reply(`ℹ️ ${targetType === 'global' ? 'ユーザー' : 'ユーザー'} \`${targetIdOrName}\` は ${listName} BANリストに見つかりませんでした。`);
                    return;
                }

                // 3. リストから対象を削除
                const removedBanInfo = banList[targetIdOrName]; // ログ用
                delete banList[targetIdOrName];

                // 4. 更新したリストを保存
                const setResponse = await apiClient.set(dbKey, banList, DB_OBJECT_NAME);

                if (setResponse.success) {
                    let targetDisplay = targetIdOrName;
                    if (targetType === 'global') {
                        try {
                            const user = await client.users.fetch(targetIdOrName);
                            targetDisplay = user.tag;
                        } catch { /* ignore fetch error */ }
                    }
                    await message.reply(`✅ ${targetType === 'global' ? 'ユーザー' : 'Minecraftユーザー'} \`${targetDisplay}\` を ${listName} BANリストから削除しました。`);
                    console.log(`[ban remove] ${listName} BAN: ${targetIdOrName} unbanned by ${message.author.tag}. Previous reason: ${removedBanInfo.reason}`);
                } else {
                    await message.reply(`❌ ${listName} BANリストの更新に失敗しました: ${setResponse.data?.message || '不明なエラー'}`);
                }

            } catch (error) {
                console.error(`❌ ban remove (${listName}) エラー:`, error);
                await message.reply(`❌ ${listName} BAN解除処理中に予期せぬエラーが発生しました。`);
            }


            // --- サブコマンド: list ---
        } else if (subCommand === 'list') {
            const targetType = args[1]?.toLowerCase(); // 'global' or 'mine'
            let page = 1;

            if (!targetType || (targetType !== 'global' && targetType !== 'mine')) {
                await message.reply(`❌ 表示するリストタイプ ('global' または 'mine') を指定してください。\n使い方:\n\`${PREFIX}ban list global [ページ番号]\`\n\`${PREFIX}ban list mine [ページ番号]\``);
                return;
            }

            // ページ番号のパース
            if (args[2] && /^\d+$/.test(args[2])) {
                page = parseInt(args[2]);
                if (page < 1) page = 1; // ページ番号は1以上
            }

            const dbKey = targetType === 'mine' ? MINECRAFT_BAN_KEY : GLOBAL_BAN_KEY;
            const listName = targetType === 'mine' ? 'Minecraft' : 'Global';

            try {
                // 1. リストを取得
                const getResponse = await apiClient.get<BanListType>(dbKey, DB_OBJECT_NAME);
                let banList: BanListType = {};

                if (getResponse.success && getResponse.data && typeof getResponse.data === 'object' && !Array.isArray(getResponse.data)) {
                    banList = getResponse.data;
                } else if (!getResponse.success && getResponse.status !== 404) { // 404 以外のエラー
                    await message.reply(`❌ ${listName} BANリストの取得に失敗しました: ${getResponse.data?.message || '不明なエラー'}`);
                    return;
                }
                // 404 またはデータが null/undefined の場合は空のリスト

                // 2. Embed を作成して送信
                const embed = createListPageEmbed(listName, banList, page, ITEMS_PER_PAGE);
                await message.reply({ embeds: [embed] });

            } catch (error) {
                console.error(`❌ ban list (${listName}) エラー:`, error);
                await message.reply(`❌ ${listName} BANリスト表示中に予期せぬエラーが発生しました。`);
            }


            // --- 不明なサブコマンド または サブコマンドなし ---
        } else {
            // 使い方を表示
            const usageEmbed = new EmbedBuilder()
                .setTitle('`ban` コマンドの使い方')
                .setDescription('ユーザーのBAN管理を行います。')
                .setColor(0x0099FF)
                .addFields(
                    { name: 'BAN追加 (Global)', value: `\`${PREFIX}ban add <userID> [期間] [理由]\`\n例: \`${PREFIX}ban add 123456789012345678 1d スパム\`` },
                    { name: 'BAN追加 (Minecraft)', value: `\`${PREFIX}ban add mine <username> [期間] [理由]\`\n例: \`${PREFIX}ban add mine Steve 7w 不正行為\`` },
                    { name: 'BAN解除 (Global)', value: `\`${PREFIX}ban remove global <userID>\`\n例: \`${PREFIX}ban remove global 123456789012345678\`` },
                    { name: 'BAN解除 (Minecraft)', value: `\`${PREFIX}ban remove mine <username>\`\n例: \`${PREFIX}ban remove mine Steve\`` },
                    { name: 'BANリスト表示 (Global)', value: `\`${PREFIX}ban list global [ページ番号]\`\n例: \`${PREFIX}ban list global 2\`` },
                    { name: 'BANリスト表示 (Minecraft)', value: `\`${PREFIX}ban list mine [ページ番号]\`\n例: \`${PREFIX}ban list mine\`` }
                )
                .setFooter({ text: '期間の単位: w (週), d (日), h (時), m (分)。組み合わせ可能 (例: 1w2d3h)。' });
            await message.reply({ embeds: [usageEmbed] });
        }
    }
};

// コマンドを登録
registerCommand(banCommand);
