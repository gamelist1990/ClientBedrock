import { TextChannel, ChannelType, EmbedBuilder, Events } from "discord.js";
import { AntiCheatModule, DB_KEYS, createErrorEmbed, AntiCheatRegister, AntiCheatEventArgs } from "..";
import EventEmitter from "events";


// 除外したいコマンド名のリスト (小文字)
const FORBIDDEN_SLASH_COMMANDS: string[] = ['spam',"help"]; // 例: help と ping は許可

// ★ 正規表現を定義
const SLASH_COMMAND_REGEX = /^\/[^\s].*/;

const slashCommandDetectionModule: AntiCheatModule = {
    // モジュール情報
    info: {
        name: 'slash', // ac toggle で使う名前 (内部ID: slashcommanddetection)
        description: 'ユーザーによるスラッシュコマンド形式 (`/command ...`) のメッセージ送信を検出し、削除・通知します。',
        defaultEnabled: false, // デフォルトでは無効推奨
    },

    // メッセージ受信時のチェック処理
    executeCheck: async (eventArgs: AntiCheatEventArgs, _eventEmitter?: EventEmitter): Promise<boolean> => {
        if (eventArgs.type !== Events.MessageCreate || !eventArgs.message) {
            return false;
        }
        const { message, db } = eventArgs;
        const content = message.content.trim();

        // ★ 正規表現でスラッシュコマンド形式かチェック
        if (!SLASH_COMMAND_REGEX.test(content)) {
            // パターンに一致しない場合は違反なし
            return false;
        }

        // パターンに一致した場合のみ、許可リストのチェックを行う
        const commandPart = content.split(' ')[0].substring(1).toLowerCase(); // スラッシュを除いた最初の単語
        if (!FORBIDDEN_SLASH_COMMANDS.includes(commandPart)) {
            // 許可リストに含まれているコマンドなら違反なし
            return false;
        }

        const guildId = message.guild!.id;
        const detectedCommandLike = content.split(' ')[0];

        console.log(`[SlashCommandDetection] Slash command like usage detected: "${detectedCommandLike}" from ${message.author.tag} (${message.author.id}) in ${message.guild!.name}`);

        // a) メッセージ削除
        try {
            await message.delete();
            console.log(`[SlashCommandDetection] Deleted message: ${message.id}`);
        } catch (deleteError) {
            console.error(`[SlashCommandDetection] Failed to delete message ${message.id}:`, deleteError);
        }

        // b) アラートチャンネルに通知
        const alertChannelId = await db.get<string>(guildId, DB_KEYS.ALERT_CHANNEL);
        if (alertChannelId) {
            try {
                const alertChannel = await message.client.channels.fetch(alertChannelId) as TextChannel;
                if (alertChannel?.type === ChannelType.GuildText) {
                    const alertEmbed = new EmbedBuilder()
                        .setColor(0xFFCC00)
                        .setTitle('🚨 スラッシュコマンド形式 使用検出')
                        .setDescription(`ユーザー ${message.author.tag} (\`${message.author.id}\`) がスラッシュコマンド形式のメッセージを使用しました。`)
                        .addFields(
                            { name: '検出内容 (冒頭)', value: `\`${detectedCommandLike}\``, inline: true },
                            { name: 'チャンネル', value: `<#${message.channel.id}>`, inline: true },
                            { name: 'メッセージ内容 (削除済)', value: `\`\`\`${content.substring(0, 1000)}\`\`\`` }
                        )
                        .setTimestamp()
                        .setFooter({ text: `Module: SlashCommandDetection` });
                    await alertChannel.send({ embeds: [alertEmbed] });
                } else {
                    console.warn(`[SlashCommandDetection] Alert channel ${alertChannelId} not found or not a text channel.`);
                }
            } catch (alertError) {
                console.error(`[SlashCommandDetection] Failed to send alert to channel ${alertChannelId}:`, alertError);
            }
        } else {
            console.log(`[SlashCommandDetection] Alert channel not set for guild ${guildId}.`);
        }

        // c) (任意) ユーザーへの警告DM
        try {
            const dmChannel = await message.author.createDM();
            await dmChannel.send({ embeds: [createErrorEmbed(`許可されていないスラッシュコマンド形式のメッセージ送信が検出されたため、メッセージは削除されました。\n検出内容: \`${detectedCommandLike}\``)] });
        } catch (dmError: any) {
            if (dmError.code === 50007) {
                console.log(`[SlashCommandDetection] Cannot send DM to ${message.author.tag}.`);
            } else {
                console.error(`[SlashCommandDetection] Failed to send DM to ${message.author.tag}:`, dmError);
            }
        }

        return true; // 違反を検出し、対応したことを示す
    }
};

// モジュールを登録 (このファイルが読み込まれた時点で登録される)
AntiCheatRegister(slashCommandDetectionModule);