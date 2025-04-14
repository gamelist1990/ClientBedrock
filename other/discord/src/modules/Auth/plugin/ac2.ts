import { TextChannel, ChannelType, EmbedBuilder, Events, GuildMember, Guild, Collection } from "discord.js"; // Guild をインポート
import { AntiCheatModule, DB_KEYS, createErrorEmbed, AntiCheatRegister, AntiCheatEventArgs } from "..";
import EventEmitter from "events";
import JsonDB from "../../../database";

// --- GasDB関連のインポート ---
import { GasDbApiClient } from '../../../System/gasDB';
import { GLOBAL_BAN_KEY, DB_OBJECT_NAME, BanListType } from '../../Other/ban'; // BAN関連の型と定数 (パス確認)

const GLOBAL_BADWORDS: string[] = [
    "http://twitter.com\@ozeu0301",
    "ACVR",
    "https://discord.gg/acvr",
];

// --- 全体BANチェックのクールダウン設定 ---
let isCheckingGlobalBans = false; // チェック実行中のフラグ
let lastGlobalBanCheckTimestamp = 0; // 最後のチェック時刻
const GLOBAL_BAN_CHECK_COOLDOWN = 10 * 60 * 1000; // 10分 (ミリ秒) - この時間は調整してください

const badwordModule: AntiCheatModule = {
    info: {
        name: 'banWord', // モジュール名を変更
        description: 'メッセージ送信時にサーバー全体のBANユーザーをチェック/キックし、禁止ワードも検出します。(高負荷注意)',
        defaultEnabled: true, // デフォルトは有効だが、負荷懸念あり
    },

    executeCheck: async (eventArgs: AntiCheatEventArgs, _eventEmitter?: EventEmitter): Promise<boolean> => {
        if (eventArgs.type !== Events.MessageCreate || !eventArgs.message) {
            return false;
        }

        const { message, db, client } = eventArgs;

        if (!message.guild) return false;

        // --- 1. サーバー全体の Global BAN チェック (クールダウン付き) ---
        const now = Date.now();
        // ユーザーメッセージのみトリガーする (負荷軽減のため少しでも頻度を減らす)
        const isUserMessage = !message.author.bot && !message.system;

        if (isUserMessage && !isCheckingGlobalBans && (now - lastGlobalBanCheckTimestamp >= GLOBAL_BAN_CHECK_COOLDOWN)) {
            isCheckingGlobalBans = true;
            lastGlobalBanCheckTimestamp = now;
            console.log(`[EnforceBans Triggered] Starting global ban enforcement check for guild ${message.guild.id}...`);

            try {
                // enforcebans のロジックを実行 (ヘルパー関数化)
                await enforceGlobalBansHelper(message.guild, client, db);
            } catch (error) {
                console.error(`[EnforceBans Triggered] Error during global ban enforcement:`, error);
            } finally {
                isCheckingGlobalBans = false;
                console.log(`[EnforceBans Triggered] Finished global ban enforcement check for guild ${message.guild.id}.`);
            }
        } else if (isUserMessage && (isCheckingGlobalBans || (now - lastGlobalBanCheckTimestamp < GLOBAL_BAN_CHECK_COOLDOWN))) {
            // console.log(`[EnforceBans Triggered] Skipping global ban enforcement check due to cooldown or ongoing process.`);
        }

        // --- 2. 禁止ワード チェック (通常通り実行) ---
        const guildId = message.guild.id;
        const content = message.content;

        // メッセージ内容がない場合はチェックしない
        if (!content && message.attachments.size === 0 && message.embeds.length === 0 && message.stickers.size === 0) {
            return false;
        }

        const badwords = GLOBAL_BADWORDS;
        if (badwords.length === 0) {
            return false;
        }

        const foundBadword = badwords.find(word => content?.includes(word));

        if (!foundBadword) {
            return false; // 禁止ワードがなければ false
        }

        // --- 禁止ワードが見つかった場合の処理 ---
        const authorTag = message.author?.tag ?? 'System Message';
        console.log(`[Badword] Badword "${foundBadword}" detected in message ${message.id} from ${authorTag}.`);

        try {
            if (message.deletable) await message.delete();
        } catch (e) { console.error(`[Badword] Failed to delete message ${message.id}:`, e); }

        const alertChannelId = await db.get<string>(guildId, DB_KEYS.ALERT_CHANNEL);
        if (alertChannelId) {
            try {
                const alertChannel = await client.channels.fetch(alertChannelId);
                if (alertChannel?.type === ChannelType.GuildText) {
                    const alertEmbed = new EmbedBuilder()
                        .setColor(0xFF0000).setTitle('🚨 禁止ワード検出')
                        .setDescription(`ユーザー ${authorTag} (\`${message.author?.id ?? 'N/A'}\`) が禁止ワードを含むメッセージを送信しました。`)
                        .addFields(
                            { name: '検出ワード', value: `\`${foundBadword}\``, inline: true },
                            { name: 'チャンネル', value: `<#${message.channel.id}>`, inline: true },
                            { name: 'メッセージ内容 (削除済?)', value: `\`\`\`${content?.substring(0, 1000) ?? '(内容なし)'}\`\`\`` }
                        ).setTimestamp().setFooter({ text: `Module: BadwordDetection` }); // Footerは元のままが良いかも
                    await alertChannel.send({ embeds: [alertEmbed] });
                }
            } catch (e) { console.error(`[Badword] Failed to send alert:`, e); }
        }

        if (message.author && !message.author.bot && !message.system) {
            try {
                const dmChannel = await message.author.createDM();
                const dmMsg = `禁止ワード (\`${foundBadword}\`) を含むメッセージ送信が検出されたため、メッセージは削除されました。`;
                await dmChannel.send({ embeds: [createErrorEmbed(dmMsg)] });
            } catch (e: any) {
                if (e.code !== 50007) console.error(`[Badword] Failed to send DM to ${message.author.tag}:`, e);
            }
        }

        // 禁止ワード違反を処理したので true を返す
        return true;
    }
};

// --- ヘルパー関数: サーバー全体のBAN強制実行 ---
async function enforceGlobalBansHelper(guild: Guild, client: any, db: JsonDB): Promise<void> {
    const guildId = guild.id;
    let apiClient: GasDbApiClient | null;
    try {
        apiClient = await GasDbApiClient.create();
    } catch (error) {
        console.error("[EnforceBans Helper] Failed to initialize GasDbApiClient:", error);
        return; // APIクライアント初期化失敗時は処理中断
    }

    // 1. GasDBからBANリスト取得
    let banList: BanListType = {};
    try {
        const getResponse = await apiClient.get<BanListType>(GLOBAL_BAN_KEY, DB_OBJECT_NAME);
        if (getResponse.success && getResponse.data && typeof getResponse.data === 'object' && !Array.isArray(getResponse.data)) {
            banList = getResponse.data;
        } else if (!getResponse.success && getResponse.status !== 404) {
            console.error(`[EnforceBans Helper] Failed to get Global BAN list: ${getResponse.data?.message || 'Unknown error'}`);
            return; // BANリスト取得失敗時は中断
        }
    } catch (gasDbError) {
        console.error("[EnforceBans Helper] Error accessing GasDB:", gasDbError);
        return; // GasDBアクセスエラー時は中断
    }

    const bannedUserIds = Object.keys(banList);
    if (bannedUserIds.length === 0) {
        console.log("[EnforceBans Helper] No users found in the Global BAN list.");
        return;
    }

    // 2. サーバーメンバーを取得 (キャッシュ優先、なければFetch - 高負荷注意！)
    let members: Collection<string, GuildMember>;
    try {
        // members.fetch() は非常に重いので、キャッシュを活用する
        // guild.members.cache だけだと不完全な場合があるので fetch する
        console.log(`[EnforceBans Helper] Fetching members for guild ${guildId}... (This might take time and resources)`);
        members = await guild.members.fetch(); // 全メンバー取得
        console.log(`[EnforceBans Helper] Fetched ${members.size} members.`);
    } catch (error) {
        console.error(`[EnforceBans Helper] Failed to fetch members for guild ${guildId}:`, error);
        return; // メンバー取得失敗時は中断
    }

    // 3. メンバーとBANリストを照合してキック
    let kickSuccessCount = 0;
    let kickFailCount = 0;
    const kickFailDetails: string[] = [];
    const alertMessages: EmbedBuilder[] = [];

    const alertChannelId = await db.get<string>(guildId, DB_KEYS.ALERT_CHANNEL);
    let alertChannel: TextChannel | null = null;
    if (alertChannelId) {
        try {
            const fetchedChannel = await client.channels.fetch(alertChannelId);
            if (fetchedChannel?.type === ChannelType.GuildText) alertChannel = fetchedChannel as TextChannel;
        } catch (e) { console.error(`[EnforceBans Helper] Failed to fetch alert channel ${alertChannelId}:`, e); }
    }
    const botId = client.user?.id;

    for (const member of members.values()) {
        const userId = member.id;
        const banInfo = banList[userId];

        // BANリストに存在し、Bot/管理者ではないか？
        if (banInfo && userId !== botId && !member.permissions.has('Administrator')) {
            console.log(`[EnforceBans Helper] Found banned user in guild: ${member.user.tag} (${userId}). Attempting kick.`);
            const kickReason = `[Auto Enforce] Globally Banned: ${banInfo.reason || 'N/A'}. By ${banInfo.bannedByTag || 'N/A'}.`.substring(0, 512);
            try {
                await member.kick(kickReason);
                kickSuccessCount++;
                console.log(`[EnforceBans Helper] Kicked ${member.user.tag} (${userId}).`);
                if (alertChannel) {
                    const kickEmbed = new EmbedBuilder().setColor(0xFF0000).setTitle('🚨 Global BAN ユーザー キック実行 (自動)')
                        .setDescription(`**${member.user.tag}** (\`${userId}\`) をキックしました。`)
                        .addFields({ name: 'BAN理由', value: banInfo.reason || 'なし' }, { name: 'BAN実行者', value: banInfo.bannedByTag || '不明' })
                        .setThumbnail(member.user.displayAvatarURL()).setTimestamp().setFooter({ text: `Module: ${badwordModule.info.name}` });
                    alertMessages.push(kickEmbed);
                }
            } catch (kickError: any) {
                kickFailCount++;
                const failMsg = `\`${member.user.tag}\`: ${kickError?.message || '不明'}`;
                kickFailDetails.push(failMsg);
                console.error(`[EnforceBans Helper] Failed to kick ${member.user.tag} (${userId}):`, kickError);
                if (alertChannel) {
                    const failEmbed = new EmbedBuilder().setColor(0xFFCC00).setTitle('⚠️ Global BAN ユーザー キック失敗 (自動)')
                        .setDescription(`**${member.user.tag}** (\`${userId}\`) のキック失敗: \`${kickError?.message || '不明'}\``)
                        .setFooter({ text: `Module: ${badwordModule.info.name} - ACTION MAY BE REQUIRED` });
                    alertMessages.push(failEmbed);
                }
            }
            // APIレート制限対策
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    console.log(`[EnforceBans Helper] Kick Results: Success=${kickSuccessCount}, Failed=${kickFailCount}`);

    // アラート送信 (一括)
    if (alertChannel && alertMessages.length > 0) {
        console.log(`[EnforceBans Helper] Sending ${alertMessages.length} alerts...`);
        for (let i = 0; i < alertMessages.length; i += 10) {
            const chunk = alertMessages.slice(i, i + 10);
            try { await alertChannel.send({ embeds: chunk }); await new Promise(resolve => setTimeout(resolve, 1000)); }
            catch (alertSendError) { console.error(`[EnforceBans Helper] Failed to send alert chunk:`, alertSendError); break; }
        }
    }
}


// 修正されたモジュールを登録
AntiCheatRegister(badwordModule);