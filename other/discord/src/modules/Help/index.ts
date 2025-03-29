import { EmbedBuilder, TextChannel } from 'discord.js'; // EmbedBuilder をインポート
import { registerCommand, commands, PREFIX, currentConfig } from '../../index'; // ★ commands をインポート
import { Command } from '../../types/command';

const helpCommand: Command = {
    name: 'help',
    description: '利用可能なコマンドの一覧や詳細を表示します。',
    aliases: ['h', '?'],
    usage: 'help [コマンド名]',
    execute: async (_client, message, args) => {
        const isAdmin = currentConfig.admins?.includes(message.author.id) ?? false;

        if (args.length === 0) {
            // コマンド一覧
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('🤖 利用可能なコマンド')
                .setDescription(`プレフィックス: \`${PREFIX}\`\n詳細: \`${PREFIX}help [コマンド名]\``);

            // 表示するコマンドをフィルタリング (修正箇所)
            const availableCommands = commands.filter((cmd, key) => {
                return cmd.name === key && (!cmd.admin || isAdmin); // ★ adminOnly を admin に変更
            });

            if (availableCommands.size > 0) {
                let commandList = '';
                availableCommands.sort((a, b) => a.name.localeCompare(b.name)).forEach(cmd => {
                    // 管理者専用コマンドには目印を付ける (修正箇所)
                    const adminMark = cmd.admin ? '👑 ' : ''; // ★ adminOnly を admin に変更
                    commandList += `**\`${PREFIX}${cmd.name}\`**: ${adminMark}${cmd.description || '説明なし'}\n`;
                });
                embed.addFields({ name: 'コマンドリスト', value: commandList || 'コマンドが見つかりません。' });
            } else {
                embed.addFields({ name: 'コマンドリスト', value: '現在利用可能なコマンドはありません。' });
            }

            if (message.channel instanceof TextChannel) {
                await message.channel.send({ embeds: [embed] });
            }

        } else {
            // コマンド詳細
            const commandName = args[0].toLowerCase();
            const command = commands.get(commandName);

            if (!command) {
                await message.reply(`❓ コマンド \`${commandName}\` は見つかりませんでした。`); return;
            }

            // 管理者専用コマンドを管理者以外が見ようとした場合は拒否 (修正箇所)
            if (command.admin && !isAdmin) { // ★ adminOnly を admin に変更
                console.log(`🚫 権限拒否: ${message.author.tag} が管理者コマンド ${command.name} のヘルプを試行`);
                await message.reply(`❓ コマンド \`${commandName}\` は見つかりませんでした。(または権限がありません)`);
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(`コマンド詳細: \`${PREFIX}${command.name}\``)
                .setDescription(command.description || '説明なし');

            // タイトルに管理者専用マークを追加 (修正箇所)
            if (command.admin) { // ★ adminOnly を admin に変更
                embed.setTitle(`👑 コマンド詳細: \`${PREFIX}${command.name}\` (管理者専用)`);
            }

            if (command.aliases && command.aliases.length > 0) {
                embed.addFields({ name: 'エイリアス', value: command.aliases.map(a => `\`${PREFIX}${a}\``).join(', ') });
            }
            embed.addFields({ name: '使い方', value: `\`${PREFIX}${command.usage || command.name}\`` });

            if (message.channel instanceof TextChannel) {
                await message.channel.send({ embeds: [embed] });
            }
        }
    }
};


const aboutCommand: Command = {
    name: 'about',
    description: 'このツールについて表示します。',
    execute: async (_client, message, _args) => {
        if (message.channel instanceof TextChannel) {
            const mes = `Discord 管理ツール (TypeScript版) - Self-Responsibility`
            await message.channel.send(mes);
        }
    }
};

// コマンド登録
registerCommand(helpCommand);
registerCommand(aboutCommand);

