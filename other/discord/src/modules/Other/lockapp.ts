import {
    PermissionsBitField,
    Role,
    ChannelType, // ChannelTypeをインポート
    GuildBasedChannel,
    Collection // Collectionをインポート
} from "discord.js";
import { PREFIX, registerCommand } from "../.."; // パスはプロジェクト構成に合わせて調整してください
import { Command } from "../../types/command"; // パスはプロジェクト構成に合わせて調整してください

const lockAppCommand: Command = {
    name: 'lockapp', // コマンド名は小文字が一般的です
    description: '指定ロール（デフォルトは@everyone）に対し、全チャンネルでの「外部アプリの使用」権限を無効化します。',
    admin: true, // 管理者のみ実行可能
    usage: `lockapp [default | @everyone | <roleID>]`,
    execute: async (_client, message, args) => {
        if (!message.guild) {
            await message.reply('❌ このコマンドはサーバー内でのみ実行できます。');
            return;
        }

        // Botに必要な権限を確認
        if (!message.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            await message.reply('❌ Botにチャンネル管理権限がありません。権限を確認してください。');
            return;
        }
        // ※ ManageRoles はロール指定時に必要になるが、@everyoneの場合は不要。今回は指定時にも不要。

        let targetRole: Role | undefined | null = null;
        const targetArg = args[0]?.toLowerCase();

        // 対象ロールの特定
        if (!targetArg || targetArg === 'default' || targetArg === '@everyone') {
            targetRole = message.guild.roles.everyone;
        } else {
            if (!/^\d+$/.test(args[0])) {
                await message.reply(`❌ 無効なロールID形式です。数字のみで指定するか、'default' または '@everyone' を指定してください。\n使い方: \`${PREFIX}${lockAppCommand.usage}\``);
                return;
            }
            try {
                targetRole = await message.guild.roles.fetch(args[0]);
                if (!targetRole) {
                    // fetchがnullを返す場合 (キャッシュになく、APIからも取得できなかった場合など)
                    await message.reply(`❌ 指定されたロールIDが見つかりません: \`${args[0]}\``);
                    return;
                }
            } catch (error) {
                console.error(`❌ lockappコマンドでロール取得エラー (ID: ${args[0]}):`, error);
                await message.reply(`❌ 指定されたロールIDが見つかりません: \`${args[0]}\``);
                return;
            }
        }

        if (!targetRole) {
            // このケースは通常発生しないはずだが念のため
            await message.reply('❌ 対象ロールの特定に失敗しました。');
            return;
        }

        const processingMessage = await message.reply(`⏳ \`${targetRole.name}\` ロールに対し、全チャンネルの「外部アプリの使用」権限を無効化しています... (チャンネル数: ${message.guild.channels.cache.size})`);

        let updatedCount = 0;
        let failedCount = 0;
        const failedChannels: string[] = [];

        // 全チャンネルを取得 (テキスト、ボイス、カテゴリ)
        const channelsToUpdate: Collection<string, GuildBasedChannel> = message.guild.channels.cache.filter(ch =>
            ch.type === ChannelType.GuildText ||
            ch.type === ChannelType.GuildVoice ||
            ch.type === ChannelType.GuildCategory
        );

        for (const channel of channelsToUpdate.values()) {
            try {
                if ('permissionOverwrites' in channel) {
                    await (channel as any).permissionOverwrites.edit(targetRole.id, {
                        UseExternalApps: false
                    }, { reason: `lockappコマンド実行 by ${message.author.tag}` }); // 理由を追記
                    updatedCount++;
                }
            } catch (error: any) {
                failedCount++;
                failedChannels.push(channel.name);
                console.error(`❌ チャンネル[${channel.name}] (${channel.id}) の権限更新に失敗:`, error.message);
                // レートリミットなどの特定のエラーに対応する場合はここに追加
            }
            // レートリミット対策で少し待機を入れることも検討 (多数チャンネルがある場合)
            // await new Promise(resolve => setTimeout(resolve, 250)); // 例: 250ミリ秒待機
        }

        let resultMessage = `✅ 完了: \`${targetRole.name}\` ロールの「外部アプリの使用」権限を無効化しました。\n`;
        resultMessage += `👍 成功: ${updatedCount} チャンネル\n`;
        if (failedCount > 0) {
            resultMessage += `👎 失敗: ${failedCount} チャンネル (${failedChannels.slice(0, 5).join(', ')}${failedCount > 5 ? '...' : ''})\n`;
            resultMessage += `ℹ️ 失敗したチャンネルの詳細はコンソールログを確認してください。Botの権限が不足している可能性があります。`;
        }

        try {
            await processingMessage.edit(resultMessage);
        } catch (editError) {
            // processingMessage が削除された場合など
            console.error("❌ lockapp 完了メッセージの編集に失敗:", editError);
            await message.reply(resultMessage); // 代替として新しいメッセージを送信
        }
    }
};

// コマンドを登録
registerCommand(lockAppCommand);