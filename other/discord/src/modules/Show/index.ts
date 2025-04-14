import { GuildMember, EmbedBuilder } from "discord.js";
import { PREFIX, registerCommand } from "../..";
import { Command } from "../../types/command";
import { GasDbApiClient } from "../../System/gasDB";
import { BanListType, DB_OBJECT_NAME, GLOBAL_BAN_KEY } from "../Other/ban";


const showCommand: Command = {
    name: 'show',
    description: '指定したユーザーIDのサーバー内情報とグローバルBAN状態を表示します。',
    admin: true, // 必要に応じて権限を設定
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

        const embed = new EmbedBuilder()
            .setTitle(`👤 ユーザー情報: ${targetUserId}`) // まずIDでタイトル設定
            .setColor(0x0099FF); // デフォルトカラー

        let member: GuildMember | null = null;
        if (message.guild) {
            try {
                member = await message.guild.members.fetch(targetUserId);
            } catch (error: any) {
                if (error.code !== 10007 && error.code !== 10013) { // Unknown Member/User 以外はエラーログ
                    console.error(`❌ showコマンドでメンバー情報取得エラー (ID: ${targetUserId}):`, error);
                }
                //メンバーが見つからなくても処理を続行（BAN情報などを表示するため）
            }
        } else {
            await message.reply('⚠️ このコマンドはサーバー外では限定的な情報しか表示できません。');
            // DMの場合、サーバー固有情報は取得できない
        }


        if (member) {
            const user = member.user;
            embed.setTitle(`👤 ユーザー情報: ${user.tag}`)
                .setColor(member.displayHexColor === '#000000' ? 0x0099FF : member.displayHexColor)
                .setThumbnail(user.displayAvatarURL({ forceStatic: false }))
                .addFields(
                    { name: 'ID', value: `\`${user.id}\``, inline: true },
                    { name: 'ニックネーム', value: member.nickname || 'なし', inline: true },
                    { name: '現在のステータス', value: member.presence?.status || 'offline', inline: true }, // presence Intent が必要かも
                    { name: 'アカウント作成日時', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F> (<t:${Math.floor(user.createdTimestamp / 1000)}:R>)` },
                    { name: 'サーバー参加日時', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F> (<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)` : '不明' }
                );

            const roles = member.roles.cache
                .filter(role => role.id !== message.guild?.id)
                .map(role => `<@&${role.id}>`)
                .join(' ') || 'なし';
            if (roles.length <= 1024) {
                embed.addFields({ name: `ロール (${member.roles.cache.size - 1})`, value: roles });
            } else {
                embed.addFields({ name: `ロール (${member.roles.cache.size - 1})`, value: '多数のため表示省略' });
            }

            let voiceStateInfo = 'ボイスチャンネルに参加していません';
            if (member.voice.channel) {
                voiceStateInfo = `チャンネル: <#${member.voice.channel.id}>\n`;
                voiceStateInfo += `ミュート状態: ${member.voice.serverMute ? 'サーバーM /' : ''}${member.voice.selfMute ? '自身M /' : ''}${member.voice.serverDeaf ? 'サーバーS /' : ''}${member.voice.selfDeaf ? '自身S' : ''}`;
                voiceStateInfo = voiceStateInfo.replace(/ \/\s*$/, ''); // 末尾の / を削除
                if (!voiceStateInfo.includes('/')) voiceStateInfo += "なし"; // 何もミュートしてない場合
            }
            embed.addFields({ name: 'ボイスステータス', value: voiceStateInfo });

            if (member.communicationDisabledUntilTimestamp) {
                const timeoutEnd = Math.floor(member.communicationDisabledUntilTimestamp / 1000);
                embed.addFields({ name: 'タイムアウト中', value: `終了日時: <t:${timeoutEnd}:F> (<t:${timeoutEnd}:R>)` });
                embed.setColor(0xFFCC00); // タイムアウトは黄色系
            }
        } else if (message.guild) {
            embed.addFields({ name: 'サーバー情報', value: 'このサーバーのメンバーではありません。' });
        }

        // グローバルBAN情報を追記
        try {
            const apiClient = await GasDbApiClient.create();
            const banCheckResponse = await apiClient.get<BanListType>(GLOBAL_BAN_KEY, DB_OBJECT_NAME);
            if (banCheckResponse.success && banCheckResponse.data && banCheckResponse.data[targetUserId]) {
                const banInfo = banCheckResponse.data[targetUserId];
                const banDate = `<t:${banInfo.timestamp}:R>`;
                let unbanText = '';
                if (banInfo.unbanAt) {
                    unbanText = `\n解除予定: <t:${banInfo.unbanAt}:R>`;
                }
                embed.addFields({
                    name: '🚨 グローバルBAN情報',
                    value: `**BANされています**\n理由: ${banInfo.reason}\n日時: ${banDate} by ${banInfo.bannedByTag}${unbanText}`
                });
                embed.setColor(0x8B0000); // BANされている場合は濃い赤色に上書き
            } else if (!member && message.guild) {
                // サーバーメンバーではなく、BANもされていない場合
                embed.addFields({ name: '🚨 グローバルBAN情報', value: 'BANされていません。' });
            } else if (!message.guild) {
                // DMでBAN情報がない場合
                embed.addFields({ name: '🚨 グローバルBAN情報', value: banCheckResponse.success ? 'BANされていません。' : 'BAN情報の取得に失敗しました。' });
            }
        } catch (apiError) {
            console.error("❌ showコマンドでのグローバルBAN情報取得エラー:", apiError);
            embed.addFields({ name: '🚨 グローバルBAN情報', value: 'BAN情報の取得中にエラーが発生しました。' });
        }

        embed.setTimestamp();

        try {
            await message.reply({ embeds: [embed] });
        } catch (replyError) {
            console.error("❌ showコマンドでの返信エラー:", replyError);
        }
    }
};


registerCommand(showCommand);



