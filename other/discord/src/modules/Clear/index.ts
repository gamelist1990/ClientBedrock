import { TextChannel, Message, PermissionsBitField, Collection } from "discord.js";
import { PREFIX, registerCommand } from "../..";
import { Command } from "../../types/command";


const clearCommand: Command = {
    name: 'clear',
    description: '指定された数のメッセージをチャンネルから削除します。管理者のみ実行可能です。',
    admin: true, 
    usage: 'clear <数(1-100)>',
    execute: async (_client, message: Message, args: string[]) => {
        if (!message.guild || !(message.channel instanceof TextChannel || message.channel.isVoiceBased())) {
            await message.reply('❌ このコマンドはサーバーのテキストチャンネルまたはボイスチャンネルのチャットでのみ使用できます。');
            return;
        }
        
        const botMember = message.guild.members.me;
        if (!botMember?.permissionsIn(message.channel.id).has(PermissionsBitField.Flags.ManageMessages)) {
            await message.reply('❌ 私にはこのチャンネルでメッセージを管理する権限がありません。ロール設定を確認してください。');
            return;
        }


        const amountString = args[0];
        if (!amountString) {
            await message.reply(`❌ 削除するメッセージ数を指定してください。\n使い方: \`${PREFIX}clear <数(1-100)>\``);
            return;
        }

        const amount = parseInt(amountString, 10);

        if (isNaN(amount)) {
            await message.reply(`❌ 削除する数は有効な数字で指定してください。\n使い方: \`${PREFIX}clear <数(1-100)>\``);
            return;
        }

        if (amount < 1 || amount > 100) {
            await message.reply(`❌ 削除できるメッセージ数は1から100の間で指定してください。`);
            return;
        }

        try {
            const fetchedMessages: Collection<string, Message> = await message.channel.messages.fetch({ limit: amount });

            const now = Date.now();
            const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;
            const messagesToDelete = fetchedMessages.filter(msg => msg.createdTimestamp > fourteenDaysAgo);

            if (messagesToDelete.size === 0) {
                await message.delete().catch(e => { if (e.code !== 10008) console.error("コマンドメッセージ削除エラー:", e); });
                const replyMsg = await message.channel.send('❌ 削除可能な（14日以内の）メッセージが見つかりませんでした。');
                setTimeout(() => replyMsg.delete().catch(console.error), 5000);
                return;
            }

            const deletedMessages = await message.channel.bulkDelete(messagesToDelete, true);

            await message.delete().catch(e => {
                if (e.code !== 10008) { 
                    console.error("コマンドメッセージの削除中にエラー:", e);
                }
            });
            const replyMsg = await message.channel.send(`✅ ${deletedMessages.size} 件のメッセージを削除しました。(14日以上前のメッセージは対象外)`);
            setTimeout(() => replyMsg.delete().catch(console.error), 5000);

        } catch (error: any) {
            console.error(`❌ clearコマンドでエラーが発生:`, error);
            if (error.code === 50013) {
                await message.reply('❌ メッセージの削除に必要な権限がありません。ボットのロール設定を確認してください。');
            } else if (error.code === 10008) { // Unknown Message
                await message.reply('⚠ メッセージの削除中に問題が発生しました。一部のメッセージが既に存在しない可能性があります。').then(msg => setTimeout(() => msg.delete().catch(console.error), 5000));
            } else {
                await message.reply(`❌ メッセージの削除中に予期せぬエラーが発生しました。`);
            }
            await message.delete().catch(e => {
                if (e.code !== 10008) console.error("コマンドメッセージ削除中のエラー:", e);
            });
        }
    }
};


registerCommand(clearCommand);