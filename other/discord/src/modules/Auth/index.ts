import {
    EmbedBuilder, PermissionsBitField, Collection, GuildMember,
    TextChannel, ChannelType, Message, Events, Client
} from 'discord.js';
import { client, discordEventBroker, PREFIX, registerCommand } from '../..';
import JsonDB from '../../database';
import { Command } from '../../types/command';
import EventEmitter from 'events';

export interface AntiCheatEventArgs {
    type: Events.MessageCreate | Events.GuildMemberAdd | string;
    db: JsonDB;
    client: Client;
    message?: Message;
    member?: GuildMember;
}

export interface AntiCheatModuleInfo {
    name: string;
    description: string;
    defaultEnabled: boolean;
}

export interface AntiCheatModule {
    info: AntiCheatModuleInfo;
    executeCheck: (eventArgs: AntiCheatEventArgs, eventEmitter?: EventEmitter) => Promise<boolean>;
}

export const DB_KEYS = {
    BANNED_USERS: 'banned_users',
    MUTED_USERS: 'muted_users',
    REGISTERED_USERS: 'registered_users',
    ALERT_CHANNEL: 'alert_channel',
    ENABLED_FEATURES: 'enabled_features'
};

export const db = new JsonDB('anticheat');

const registeredModules: Map<string, AntiCheatModule> = new Map();

export function AntiCheatRegister(module: AntiCheatModule): boolean {
    const moduleName = module.info.name.toLowerCase();
    if (registeredModules.has(moduleName)) {
        console.warn(`[AntiCheat] Module "${moduleName}" is already registered. Skipping.`);
        return false;
    }
    registeredModules.set(moduleName, module);
    console.log(`[AntiCheat] Module "${module.info.name}" (${moduleName}) registered (Default: ${module.info.defaultEnabled ? 'Enabled' : 'Disabled'}).`);
    return true;
}

export function getAvailableFeatureNames(): string[] {
    return Array.from(registeredModules.keys());
}

export function getModuleInfo(name: string): AntiCheatModuleInfo | undefined {
    return registeredModules.get(name.toLowerCase())?.info;
}

export function getModule(name: string): AntiCheatModule | undefined {
    return registeredModules.get(name.toLowerCase());
}

export function getAllRegisteredModules(): Map<string, AntiCheatModule> {
    return registeredModules;
}

export function createErrorEmbed(message: string): EmbedBuilder {
    return new EmbedBuilder().setColor(0xFF0000).setDescription(`❌ ${message}`);
}

export function createSuccessEmbed(message: string): EmbedBuilder {
    return new EmbedBuilder().setColor(0x00FF00).setDescription(`✅ ${message}`);
}

const acCommand: Command = {
    name: 'ac',
    description: 'アンチチート関連の管理コマンド。',
    admin: true,
    usage: `ac <subcommand> [args...] | サブコマンド: help, register, ban, unban, mute, unmute, alertchannel, toggle, list, enforcebans`,
    execute: async (client, message, args) => {

        if (!message.guild) {
            await message.reply({ embeds: [createErrorEmbed('このコマンドはサーバー内でのみ使用できます。')] });
            return;
        }
        if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
            await message.reply({ embeds: [createErrorEmbed('このコマンドの実行には管理者権限が必要です。')] });
            return;
        }

        const subCommand = args[0]?.toLowerCase();
        const guildId = message.guild.id;
        const availableFeatures = getAvailableFeatureNames();

        switch (subCommand) {
            case 'register': {
                const targetUserId = args[1];
                if (targetUserId) {
                    if (!/^\d+$/.test(targetUserId)) {
                        await message.reply({ embeds: [createErrorEmbed(`無効なユーザーID形式です: \`${targetUserId}\``)] }); return;
                    }
                    try {
                        const member = await message.guild.members.fetch(targetUserId);
                        if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                            await message.reply({ embeds: [createErrorEmbed(`ユーザー \`${targetUserId}\` は管理者のため、監視対象に登録できません。`)] }); return;
                        }
                        if (member.user.bot) {
                            await message.reply({ embeds: [createErrorEmbed(`ユーザー \`${targetUserId}\` はBotのため、監視対象に登録できません。`)] }); return;
                        }
                    } catch {
                        await message.reply({ embeds: [createErrorEmbed(`サーバーに存在しないユーザーID、または情報の取得に失敗しました: \`${targetUserId}\``)] }); return;
                    }
                    const added = await db.addToList<string>(guildId, DB_KEYS.REGISTERED_USERS, targetUserId);
                    await message.reply({ embeds: [added ? createSuccessEmbed(`ユーザー \`${targetUserId}\` を監視対象に登録しました。`) : createErrorEmbed(`ユーザー \`${targetUserId}\` は既に登録されています。`)] });
                } else {
                    await message.reply('⏳ サーバーメンバー全員（管理者・Botを除く）の監視登録処理を開始します...');
                    let members: Collection<string, GuildMember>;
                    try {
                        await message.guild.members.fetch();
                        members = message.guild.members.cache;
                        if (members.size === 0) { await message.reply({ embeds: [createErrorEmbed('メンバー情報を取得できませんでした。')] }); return; }
                    } catch (error) {
                        console.error("Error fetching guild members:", error);
                        await message.reply({ embeds: [createErrorEmbed('メンバー情報の取得中にエラーが発生しました。')] }); return;
                    }
                    let addedCount = 0, skippedAdminCount = 0, skippedBotCount = 0, alreadyRegisteredCount = 0, errorCount = 0;
                    const currentRegisteredUsers = await db.getList<string>(guildId, DB_KEYS.REGISTERED_USERS);
                    for (const member of members.values()) {
                        if (member.user.bot) { skippedBotCount++; continue; }
                        if (member.permissions.has(PermissionsBitField.Flags.Administrator)) { skippedAdminCount++; continue; }
                        if (currentRegisteredUsers.includes(member.id)) { alreadyRegisteredCount++; continue; }
                        try {
                            const added = await db.addToList<string>(guildId, DB_KEYS.REGISTERED_USERS, member.id);
                            if (added) { addedCount++; currentRegisteredUsers.push(member.id); } else { alreadyRegisteredCount++; }
                        } catch (dbError) { console.error(`Error adding user ${member.id} to DB:`, dbError); errorCount++; }
                    }
                    const resultEmbed = new EmbedBuilder()
                        .setColor(addedCount > 0 ? 0x00FF00 : 0xFFCC00)
                        .setTitle('✅ 全メンバー登録処理完了')
                        .addFields(
                            { name: '新規登録', value: `${addedCount} 人`, inline: true }, { name: '登録済み', value: `${alreadyRegisteredCount} 人`, inline: true },
                            { name: '管理者(除外)', value: `${skippedAdminCount} 人`, inline: true }, { name: 'Bot(除外)', value: `${skippedBotCount} 人`, inline: true },
                            { name: 'エラー', value: `${errorCount} 人`, inline: true }
                        ).setTimestamp();
                    await message.reply({ embeds: [resultEmbed] });
                }
                break;
            }
            case 'ban': {
                const targetUserId = args[1];
                const reason = args.slice(2).join(' ') || '理由なし';
                if (!targetUserId) { await message.reply({ embeds: [createErrorEmbed(`BANするユーザーIDを指定してください。\n使い方: \`${PREFIX}ac ban <userID> [reason]\``)] }); return; }
                if (!/^\d+$/.test(targetUserId)) { await message.reply({ embeds: [createErrorEmbed(`無効なユーザーID形式です: \`${targetUserId}\``)] }); return; }
                const bannedUsers = await db.getMap(guildId, DB_KEYS.BANNED_USERS);
                if (bannedUsers[targetUserId]) { await message.reply({ embeds: [createErrorEmbed(`ユーザー \`${targetUserId}\` は既にBAN登録されています。`)] }); return; }
                await db.setMapValue(guildId, DB_KEYS.BANNED_USERS, targetUserId, { reason, timestamp: Date.now() });
                await message.reply({ embeds: [createSuccessEmbed(`ユーザー \`${targetUserId}\` をデータベースにBAN登録しました。\n理由: ${reason}`)] });
                break;
            }
            case 'unban': {
                const targetUserId = args[1];
                if (!targetUserId) { await message.reply({ embeds: [createErrorEmbed(`BAN解除するユーザーIDを指定してください。\n使い方: \`${PREFIX}ac unban <userID>\``)] }); return; }
                if (!/^\d+$/.test(targetUserId)) { await message.reply({ embeds: [createErrorEmbed(`無効なユーザーID形式です: \`${targetUserId}\``)] }); return; }
                const deleted = await db.deleteMapValue(guildId, DB_KEYS.BANNED_USERS, targetUserId);
                await message.reply({ embeds: [deleted ? createSuccessEmbed(`ユーザー \`${targetUserId}\` のデータベースBAN登録を解除しました。`) : createErrorEmbed(`ユーザー \`${targetUserId}\` はBAN登録されていません。`)] });
                break;
            }
            case 'mute': {
                const targetUserId = args[1];
                const reason = args.slice(2).join(' ') || '理由なし';
                if (!targetUserId) { await message.reply({ embeds: [createErrorEmbed(`MUTEするユーザーIDを指定してください。\n使い方: \`${PREFIX}ac mute <userID> [reason]\``)] }); return; }
                if (!/^\d+$/.test(targetUserId)) { await message.reply({ embeds: [createErrorEmbed(`無効なユーザーID形式です: \`${targetUserId}\``)] }); return; }
                const mutedUsers = await db.getMap(guildId, DB_KEYS.MUTED_USERS);
                if (mutedUsers[targetUserId]) { await message.reply({ embeds: [createErrorEmbed(`ユーザー \`${targetUserId}\` は既にMUTE登録されています。`)] }); return; }
                await db.setMapValue(guildId, DB_KEYS.MUTED_USERS, targetUserId, { reason, timestamp: Date.now() });
                await message.reply({ embeds: [createSuccessEmbed(`ユーザー \`${targetUserId}\` をデータベースにMUTE登録しました。\n理由: ${reason}`)] });
                break;
            }
            case 'unmute': {
                const targetUserId = args[1];
                if (!targetUserId) { await message.reply({ embeds: [createErrorEmbed(`MUTE解除するユーザーIDを指定してください。\n使い方: \`${PREFIX}ac unmute <userID>\``)] }); return; }
                if (!/^\d+$/.test(targetUserId)) { await message.reply({ embeds: [createErrorEmbed(`無効なユーザーID形式です: \`${targetUserId}\``)] }); return; }
                const deleted = await db.deleteMapValue(guildId, DB_KEYS.MUTED_USERS, targetUserId);
                await message.reply({ embeds: [deleted ? createSuccessEmbed(`ユーザー \`${targetUserId}\` のデータベースMUTE登録を解除しました。`) : createErrorEmbed(`ユーザー \`${targetUserId}\` はMUTE登録されていません。`)] });
                break;
            }
            case 'alertchannel': {
                const channelInput = args[1];
                if (!channelInput) {
                    const currentChannelId = await db.get<string>(guildId, DB_KEYS.ALERT_CHANNEL);
                    if (currentChannelId) {
                        await message.reply({ embeds: [createSuccessEmbed(`現在のアラートチャンネルは <#${currentChannelId}> (\`${currentChannelId}\`) です。\n解除する場合は \`${PREFIX}ac alertchannel clear\` と入力してください。`)] });
                    } else {
                        await message.reply({ embeds: [createErrorEmbed(`アラートチャンネルを指定してください (例: <#channelId> または チャンネルID)。\n使い方: \`${PREFIX}ac alertchannel <#channel|channelID>\``)] });
                    } return;
                }
                if (channelInput.toLowerCase() === 'clear') {
                    const deleted = await db.delete(guildId, DB_KEYS.ALERT_CHANNEL);
                    await message.reply({ embeds: [deleted ? createSuccessEmbed(`アラートチャンネルの設定を解除しました。`) : createErrorEmbed(`アラートチャンネルは設定されていません。`)] }); return;
                }
                const channelId = channelInput.match(/^<#(\d+)>$/)?.[1] || channelInput;
                if (!/^\d+$/.test(channelId)) { await message.reply({ embeds: [createErrorEmbed(`無効なチャンネルID形式です: \`${channelInput}\``)] }); return; }
                try {
                    const fetchedChannel = await message.guild.channels.fetch(channelId);
                    if (fetchedChannel?.type === ChannelType.GuildText) {
                        const targetChannel = fetchedChannel as TextChannel;
                        const botMember = await message.guild.members.fetch(client.user!.id);
                        const permissions = targetChannel.permissionsFor(botMember);
                        if (!permissions || !permissions.has(PermissionsBitField.Flags.SendMessages) || !permissions.has(PermissionsBitField.Flags.EmbedLinks)) {
                            await message.reply({ embeds: [createErrorEmbed(`ボットにはチャンネル <#${targetChannel.id}> へのメッセージ送信権限と埋め込みリンク権限がありません。`)] }); return;
                        }
                        await db.set(guildId, DB_KEYS.ALERT_CHANNEL, targetChannel.id);
                        await message.reply({ embeds: [createSuccessEmbed(`アラートチャンネルを <#${targetChannel.id}> に設定しました。`)] });
                    } else {
                        await message.reply({ embeds: [createErrorEmbed(`指定されたID \`${channelId}\` はテキストチャンネルではありません、または存在しません。`)] });
                    }
                } catch (error) {
                    console.error(`Error setting alert channel ${channelId}:`, error);
                    await message.reply({ embeds: [createErrorEmbed(`指定されたチャンネル \`${channelInput}\` の設定中にエラーが発生しました。`)] });
                }
                break;
            }
            case 'toggle': {
                const featureName = args[1]?.toLowerCase();
                if (!featureName) { await message.reply({ embeds: [createErrorEmbed(`有効/無効を切り替える機能を指定してください。\n利用可能な機能: ${availableFeatures.join(', ') || 'なし'}`)] }); return; }
                if (!availableFeatures.includes(featureName)) { await message.reply({ embeds: [createErrorEmbed(`指定された機能 \`${featureName}\` は存在しません。\n利用可能な機能: ${availableFeatures.join(', ') || 'なし'}`)] }); return; }
                const moduleInfo = getModuleInfo(featureName);
                if (!moduleInfo) { await message.reply({ embeds: [createErrorEmbed(`機能 \`${featureName}\` の情報が見つかりませんでした。内部エラー。`)] }); console.error(`Module info not found: ${featureName}`); return; }
                const features = await db.getMap<boolean>(guildId, DB_KEYS.ENABLED_FEATURES);
                const currentStatus = features[featureName] ?? moduleInfo.defaultEnabled;
                const newStatus = !currentStatus;
                features[featureName] = newStatus;
                await db.set(guildId, DB_KEYS.ENABLED_FEATURES, features);
                await message.reply({ embeds: [createSuccessEmbed(`機能 \`${featureName}\` を ${newStatus ? '有効 ✅' : '無効 ❌'} に切り替えました。\n(${moduleInfo.description})`)] });
                break;
            }
            case 'list': {
                const bannedUsersMap = await db.getMap<{ reason: string, timestamp: number }>(guildId, DB_KEYS.BANNED_USERS);
                const mutedUsersMap = await db.getMap<{ reason: string, timestamp: number }>(guildId, DB_KEYS.MUTED_USERS);
                const registeredUsersList = await db.getList<string>(guildId, DB_KEYS.REGISTERED_USERS);
                const alertChannelId = await db.get<string>(guildId, DB_KEYS.ALERT_CHANNEL);
                const enabledFeaturesDb = await db.getMap<boolean>(guildId, DB_KEYS.ENABLED_FEATURES);
                const embed = new EmbedBuilder().setColor(0x0099FF).setTitle(`🛡️ アンチチート設定リスト (${message.guild.name})`).setTimestamp();
                const regListStr = registeredUsersList.length > 0 ? registeredUsersList.map(id => `\`${id}\``).join(', ') : 'なし';
                embed.addFields({ name: `✅ 登録ユーザー (${registeredUsersList.length})`, value: regListStr.substring(0, 1020) + (regListStr.length > 1020 ? '...' : '') || 'なし' });
                const banEntries = Object.entries(bannedUsersMap);
                const banListStr = banEntries.length > 0 ? banEntries.map(([userId, data]) => `\`${userId}\` (<t:${Math.floor(data.timestamp / 1000)}:R>) - ${data.reason || '理由なし'}`).join('\n') : 'なし';
                embed.addFields({ name: `🚫 BANリスト (${banEntries.length})`, value: banListStr.substring(0, 1020) + (banListStr.length > 1020 ? '...' : '') || 'なし' });
                const muteEntries = Object.entries(mutedUsersMap);
                const muteListStr = muteEntries.length > 0 ? muteEntries.map(([userId, data]) => `\`${userId}\` (<t:${Math.floor(data.timestamp / 1000)}:R>) - ${data.reason || '理由なし'}`).join('\n') : 'なし';
                embed.addFields({ name: `🔇 MUTEリスト (${muteEntries.length})`, value: muteListStr.substring(0, 1020) + (muteListStr.length > 1020 ? '...' : '') || 'なし' });
                const alertChannelStr = alertChannelId ? `<#${alertChannelId}> (\`${alertChannelId}\`)` : '未設定';
                embed.addFields({ name: '📢 アラートチャンネル', value: alertChannelStr });
                const featureStr = availableFeatures.length > 0 ? availableFeatures.map(featureName => {
                    const moduleInfo = getModuleInfo(featureName)!; const status = enabledFeaturesDb[featureName] ?? moduleInfo.defaultEnabled;
                    return `\`${featureName}\`: ${status ? '有効 ✅' : '無効 ❌'} - ${moduleInfo.description}`;
                }).join('\n') : '利用可能な機能モジュールが登録されていません。';
                embed.addFields({ name: '⚙️ 機能トグル (モジュール)', value: featureStr.substring(0, 1020) + (featureStr.length > 1020 ? '...' : '') || '機能未登録' });
                await message.reply({ embeds: [embed] });
                break;
            }
            case 'enforcebans': {
                await message.reply('⏳ データベースのBANリストとサーバーメンバーを照合し、対象者をキックします...');
                let bannedUsersMap: Record<string, { reason: string, timestamp: number }>;
                try { bannedUsersMap = await db.getMap<{ reason: string, timestamp: number }>(guildId, DB_KEYS.BANNED_USERS); }
                catch (dbError) { console.error(`[AC EnforceBans] Failed to get banned users for guild ${guildId}:`, dbError); await message.reply({ embeds: [createErrorEmbed('データベースからBANリストの取得に失敗しました。')] }); return; }
                const bannedUserIds = Object.keys(bannedUsersMap);
                if (bannedUserIds.length === 0) { await message.reply({ embeds: [createSuccessEmbed('データベースにBAN登録されているユーザーはいません。')] }); return; }
                let kickSuccessCount = 0, kickFailCount = 0, notFoundCount = 0, skippedCount = 0;
                const kickFailDetails: string[] = []; const alertMessages: EmbedBuilder[] = [];
                const alertChannelId = await db.get<string>(guildId, DB_KEYS.ALERT_CHANNEL);
                let alertChannel: TextChannel | null = null;
                if (alertChannelId) {
                    try {
                        const fetchedChannel = await client.channels.fetch(alertChannelId);
                        if (fetchedChannel?.type === ChannelType.GuildText) { alertChannel = fetchedChannel as TextChannel; }
                        else { console.warn(`[AC EnforceBans] Alert channel ${alertChannelId} is not a text channel or not found.`); }
                    } catch (fetchErr) { console.error(`[AC EnforceBans] Failed to fetch alert channel ${alertChannelId}:`, fetchErr); }
                }
                const botId = client.user?.id;
                for (const userId of bannedUserIds) {
                    if (userId === botId || userId === message.author.id) { skippedCount++; continue; }
                    try {
                        const memberToKick = await message.guild.members.fetch(userId);
                        if (memberToKick) {
                            if (memberToKick.permissions.has(PermissionsBitField.Flags.Administrator)) {
                                console.log(`[AC EnforceBans] Skipping administrator ${memberToKick.user.tag} (${userId}).`);
                                skippedCount++; continue;
                            }
                            const banInfo = bannedUsersMap[userId]; const kickReason = `[AC EnforceBans] DB Banned: ${banInfo.reason || '理由なし'}`.substring(0, 512);
                            try {
                                await memberToKick.kick(kickReason); kickSuccessCount++;
                                console.log(`[AC EnforceBans] Kicked ${memberToKick.user.tag} (${userId}). Reason: ${kickReason}`);
                                if (alertChannel) {
                                    const alertEmbed = new EmbedBuilder().setColor(0xFF0000).setTitle('🚨 DB BANユーザー キック実行 (Enforce)')
                                        .setDescription(`**${memberToKick.user.tag}** (\`${userId}\`) をキックしました。`)
                                        .addFields({ name: 'BAN理由 (DB)', value: banInfo.reason || 'なし' }, { name: 'BAN日時 (DB)', value: `<t:${Math.floor(banInfo.timestamp / 1000)}:F>` }, { name: '実行者 (コマンド)', value: `${message.author.tag}` })
                                        .setThumbnail(memberToKick.user.displayAvatarURL()).setTimestamp();
                                    alertMessages.push(alertEmbed);
                                }
                            } catch (kickError: any) {
                                kickFailCount++; const failMsg = `\`${memberToKick.user.tag}\`: ${kickError?.message || '不明'}`; kickFailDetails.push(failMsg);
                                console.error(`[AC EnforceBans] Failed to kick ${memberToKick.user.tag} (${userId}):`, kickError);
                                if (alertChannel) {
                                    const failAlertEmbed = new EmbedBuilder().setColor(0xFFCC00).setTitle('⚠️ DB BANユーザー キック失敗 (Enforce)')
                                        .setDescription(`**${memberToKick.user.tag}** (\`${userId}\`) のキックに失敗しました。`)
                                        .addFields({ name: '失敗理由', value: `\`${kickError?.message || '不明'}\`` }, { name: 'BAN情報 (DB)', value: `理由: ${banInfo.reason || 'なし'}` }, { name: '実行者 (コマンド)', value: `${message.author.tag}` })
                                        .setThumbnail(memberToKick.user.displayAvatarURL()).setTimestamp();
                                    alertMessages.push(failAlertEmbed);
                                }
                            }
                        } else { notFoundCount++; console.log(`[AC EnforceBans] Member data not available for ${userId} after fetch.`); }
                    } catch (fetchError: any) {
                        if (fetchError.code === 10007 || fetchError.code === 10013) { notFoundCount++; console.log(`[AC EnforceBans] User ${userId} not found in guild.`); }
                        else { kickFailCount++; const failMsg = `\`${userId}\`: Fetch Error (${fetchError?.message || '不明'})`; kickFailDetails.push(failMsg); console.error(`[AC EnforceBans] Error fetching member ${userId}:`, fetchError); }
                    }
                    await new Promise(resolve => setTimeout(resolve, 250));
                }
                const resultEmbed = new EmbedBuilder().setTitle('🛡️ DB BAN 強制実行 結果').setDescription(`DB BANリスト (${bannedUserIds.length}件) との照合・キック処理完了。`)
                    .addFields(
                        { name: '✅ キック成功', value: `${kickSuccessCount} 人`, inline: true }, { name: '❌ キック失敗', value: `${kickFailCount} 人`, inline: true },
                        { name: '💨 対象外 (不在)', value: `${notFoundCount} 人`, inline: true }, { name: '🚫 スキップ (Bot/実行者/管理者)', value: `${skippedCount} 人`, inline: true }
                    ).setColor(kickSuccessCount > 0 ? 0x00FF00 : (kickFailCount > 0 ? 0xFFCC00 : 0x0099FF)).setTimestamp();
                if (kickFailDetails.length > 0) { resultEmbed.addFields({ name: '失敗詳細 (一部)', value: kickFailDetails.slice(0, 5).join('\n') || 'なし' }); }
                await message.reply({ embeds: [resultEmbed] });
                if (alertChannel && alertMessages.length > 0) {
                    for (let i = 0; i < alertMessages.length; i += 10) {
                        const chunk = alertMessages.slice(i, i + 10);
                        try { await alertChannel.send({ embeds: chunk }); await new Promise(resolve => setTimeout(resolve, 1000)); }
                        catch (alertSendError) { console.error(`[AC EnforceBans] Failed to send alert chunk:`, alertSendError); break; }
                    }
                }
                break;
            }
            case 'help':
            default: {
                const helpEmbed = new EmbedBuilder().setColor(0x0099FF).setTitle('🛡️ アンチチート管理コマンド (`ac`) ヘルプ').setDescription('サブコマンドを使用してアンチチート機能を管理します。管理者権限が必要です。')
                    .addFields(
                        { name: `${PREFIX}ac help`, value: 'このヘルプメッセージを表示します。' }, { name: `${PREFIX}ac register [userID]`, value: 'ユーザーを監視対象に登録/一括登録。' },
                        { name: `${PREFIX}ac ban <userID> [reason]`, value: 'ユーザーをDB BAN登録。' }, { name: `${PREFIX}ac unban <userID>`, value: 'ユーザーのDB BAN登録を解除。' },
                        { name: `${PREFIX}ac mute <userID> [reason]`, value: 'ユーザーをDB MUTE登録。' }, { name: `${PREFIX}ac unmute <userID>`, value: 'ユーザーのDB MUTE登録を解除。' },
                        { name: `${PREFIX}ac alertchannel <#channel|channelID|clear>`, value: 'アラートチャンネルを設定/確認/解除。' },
                        { name: `${PREFIX}ac list`, value: '現在のアンチチート設定を表示。' }, { name: `${PREFIX}ac enforcebans`, value: 'DB BANリストに基づきサーバー内の対象者をキック。' }
                    );
                const toggleHelpValue = availableFeatures.length > 0 ? `機能モジュールの有効/無効を切り替え。\n利用可能な機能:\n${availableFeatures.map(name => {
                    const info = getModuleInfo(name)!; return ` - \`${name}\`: ${info.description}`;
                }).join('\n')}`.substring(0, 1020) + (availableFeatures.length > 10 ? '...' : '') : '機能モジュール未登録。';
                helpEmbed.addFields({ name: `${PREFIX}ac toggle <featureName>`, value: toggleHelpValue || 'なし' });
                helpEmbed.setFooter({ text: `使用例: ${PREFIX}ac toggle badword` });
                await message.reply({ embeds: [helpEmbed] });
                break;
            }
        }
    }
};

registerCommand(acCommand);
setTimeout(() => {
    if (client) {
        initializeAntiCheatListeners(client)
    }
}, 3000)

export async function initializeAntiCheatListeners(client: Client) {
    console.log('🛡️ Initializing AntiCheat listeners...');

    try {
        await import("./plugin/ac1");
        await import("./plugin/ac2");
    } catch (error) {
        console.error('[AC Init] Failed to load modules:', error);
    }

    if (!(discordEventBroker instanceof EventEmitter)) {
        console.error('[AC Init] discordEventBroker is not available or not an EventEmitter! Listeners will not be set up.');
        return;
    }

    console.log('[AC Init] Setting up listeners on discordEventBroker...');

    discordEventBroker.on(Events.MessageCreate, async (message: Message) => {
        if (!message.guild) return;

        const guildId = message.guild.id;

        try {
            const enabledFeatures = await db.getMap<boolean>(guildId, DB_KEYS.ENABLED_FEATURES);
            const modulesToCheck = getAllRegisteredModules();

            const eventArgs: AntiCheatEventArgs = {
                type: Events.MessageCreate,
                message: message,
                db: db,
                client: client,
            };

            for (const [moduleName, module] of modulesToCheck.entries()) {
                const isEnabled = enabledFeatures[moduleName] ?? module.info.defaultEnabled;
                if (isEnabled) {
                    try {
                        const violationHandled = await module.executeCheck(eventArgs, discordEventBroker);
                        if (violationHandled) {
                            console.log(`[AC Listener] Violation handled by "${moduleName}" for ${eventArgs.type} (MsgID: ${message.id}).`);
                            break;
                        }
                    } catch (moduleError) {
                        console.error(`[AC Listener] Error in module "${moduleName}" for ${eventArgs.type}:`, moduleError);
                    }
                }
            }
        } catch (error) {
            console.error(`[AC Listener] Error during ${Events.MessageCreate} check process:`, error);
        }
    });

    discordEventBroker.on(Events.GuildMemberAdd, async (member: GuildMember) => {
        if (!member.guild) return;
        if (member.user.bot) {
            console.log(`[AC AutoRegister] Ignoring bot joining: ${member.user.tag} (${member.id})`);
            return;
        }
        if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            console.log(`[AC AutoRegister] Ignoring administrator joining: ${member.user.tag} (${member.id})`);
            return;
        }

        const guildId = member.guild.id;

        try {
            const added = await db.addToList<string>(guildId, DB_KEYS.REGISTERED_USERS, member.id);
            if (added) {
                console.log(`[AC AutoRegister] Automatically registered new member: ${member.user.tag} (${member.id}) in guild ${guildId}`);
                const alertChannelId = await db.get<string>(guildId, DB_KEYS.ALERT_CHANNEL);
                if (alertChannelId) {
                    try {
                        const channel = await client.channels.fetch(alertChannelId);
                        if (channel?.type === ChannelType.GuildText) {
                            const embed = new EmbedBuilder()
                                .setColor(0x00FF00)
                                .setTitle('👤 新規メンバー自動登録')
                                .setDescription(`**${member.user.tag}** (\`${member.id}\`) を監視対象に自動登録しました。`)
                                .setThumbnail(member.user.displayAvatarURL())
                                .setTimestamp();
                            await (channel as TextChannel).send({ embeds: [embed] });
                        }
                    } catch (alertError) {
                        console.error(`[AC AutoRegister] Failed to send auto-register alert to ${alertChannelId}:`, alertError);
                    }
                }
            } else {
                console.log(`[AC AutoRegister] Member already registered (or failed to add): ${member.user.tag} (${member.id})`);
            }

            const enabledFeatures = await db.getMap<boolean>(guildId, DB_KEYS.ENABLED_FEATURES);
            const modulesToCheck = getAllRegisteredModules();

            const eventArgs: AntiCheatEventArgs = {
                type: Events.GuildMemberAdd,
                member: member,
                db: db,
                client: client,
            };

            for (const [moduleName, module] of modulesToCheck.entries()) {
                const isEnabled = enabledFeatures[moduleName] ?? module.info.defaultEnabled;
                if (isEnabled) {
                    try {
                        const violationHandled = await module.executeCheck(eventArgs, discordEventBroker);
                        if (violationHandled) {
                            console.log(`[AC Listener] Violation handled by "${moduleName}" for ${eventArgs.type} (MemberID: ${member.id}).`);
                            break;
                        }
                    } catch (moduleError) {
                        console.error(`[AC Listener] Error in module "${moduleName}" for ${eventArgs.type}:`, moduleError);
                    }
                }
            }

        } catch (error) {
            console.error(`[AC Listener] Error during ${Events.GuildMemberAdd} process for ${member.id}:`, error);
        }
    });
}
