import { GuildMember, EmbedBuilder, TextChannel } from "discord.js";
import { PREFIX, registerCommand } from "../..";
import { Command } from "../../types/command";


const showCommand: Command = {
    name: 'show',
    description: '指定したユーザーIDのサーバー内情報を表示します。',
    admin: true,
    usage: 'show <userID>',
    execute: async (_client, message, args) => {
        const targetUserId = args[0];

        if (!targetUserId) {
            await message.reply(`❌ 情報を表示するユーザーのIDを指定してください。\n使い方: \`${PREFIX}show <userID>\``);
            return;
        }

        if (!/^\d+$/.test(targetUserId)) {
            await message.reply(`❌ 無効なユーザーID形式です。数字のみで指定してください。`);
            return;
        }

        if (!message.guild) {
            await message.reply('❌ このコマンドはサーバー内でのみ使用できます。');
            return;
        }

        try {
            // サーバーメンバーとしての情報を取得
            const member: GuildMember = await message.guild.members.fetch(targetUserId);
            const user = member.user; // メンバーに紐づくユーザーオブジェクト

            const embed = new EmbedBuilder()
                .setColor(member.displayHexColor === '#000000' ? 0x0099FF : member.displayHexColor) // ユーザーの色、デフォルトは青
                .setTitle(`👤 ユーザー情報: ${user.tag}`)
                .setThumbnail(user.displayAvatarURL({ forceStatic: false }))
                .addFields(
                    { name: 'ID', value: `\`${user.id}\``, inline: true },
                    { name: 'ニックネーム', value: member.nickname || 'なし', inline: true },
                    { name: '現在のステータス', value: member.presence?.status || 'offline', inline: true },
                    { name: 'アカウント作成日時', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F> (<t:${Math.floor(user.createdTimestamp / 1000)}:R>)` },
                    { name: 'サーバー参加日時', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F> (<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)` : '不明' }
                );

            // ロール情報
            const roles = member.roles.cache
                .filter(role => role.id !== message.guild?.id) // @everyoneを除外
                .map(role => `<@&${role.id}>`) // ロールメンション形式
                .join(' ') || 'なし';
            if (roles.length <= 1024) { // フィールドの値上限チェック
                embed.addFields({ name: `ロール (${member.roles.cache.size - 1})`, value: roles });
            } else {
                embed.addFields({ name: `ロール (${member.roles.cache.size - 1})`, value: '多数のため表示省略' });
            }


            // ボイスチャンネル情報
            let voiceStateInfo = 'ボイスチャンネルに参加していません';
            if (member.voice.channel) {
                voiceStateInfo = `チャンネル: <#${member.voice.channel.id}>\n`;
                voiceStateInfo += `サーバーミュート: ${member.voice.serverMute ? 'はい' : 'いいえ'}\n`;
                voiceStateInfo += `サーバースピーカーミュート: ${member.voice.serverDeaf ? 'はい' : 'いいえ'}\n`;
                voiceStateInfo += `自身でミュート: ${member.voice.selfMute ? 'はい' : 'いいえ'}\n`;
                voiceStateInfo += `自身でスピーカーミュート: ${member.voice.selfDeaf ? 'はい' : 'いいえ'}`;
            }
            embed.addFields({ name: 'ボイスステータス', value: voiceStateInfo });

            // タイムアウト情報
            if (member.communicationDisabledUntilTimestamp) {
                const timeoutEnd = Math.floor(member.communicationDisabledUntilTimestamp / 1000);
                embed.addFields({ name: 'タイムアウト中', value: `終了日時: <t:${timeoutEnd}:F> (<t:${timeoutEnd}:R>)` });
                embed.setColor(0xFF0000); // タイムアウト中は赤色に
            }

            embed.setTimestamp();

            if (message.channel instanceof TextChannel) {
                await message.channel.send({ embeds: [embed] });
            }


        } catch (error: any) {
            if (error.code === 10013 || error.code === 10007) { // Unknown User or Unknown Member
                await message.reply(`❌ 指定されたID \`${targetUserId}\` のユーザーはこのサーバーに見つかりませんでした。`);
            } else {
                console.error(`❌ showコマンドでユーザー情報取得エラー (ID: ${targetUserId}):`, error);
                await message.reply(`❌ ユーザー情報の取得中にエラーが発生しました。`);
            }
        }
    }
};

registerCommand(showCommand);

