import { EmbedBuilder, TextChannel } from "discord.js";
import { currentConfig, PREFIX, saveConfig, registerCommand } from "../..";
import { Command } from "../../types/command";


//AdminはDataBaseを使わず 調節configに保存


const adminCommandBase: Command = {
  name: "admin",
  description: "管理者設定を管理します。",
  admin: true,
  usage: "admin <add|remove|list> [userID]",
  execute: async (client, message, args) => {
    const subCommand = args[0]?.toLowerCase();
    const targetUserId = args[1];
    let config = currentConfig;
    if (!config.admins) {
      config.admins = [];
    }

    switch (subCommand) {
      case "add":
        if (!targetUserId) {
          await message.reply(
            `❌ 追加するユーザーのIDを指定してください。\n使い方: \`${PREFIX}admin add <userID>\``
          );
          return;
        }
        if (!/^\d+$/.test(targetUserId)) {
          await message.reply(
            `❌ 無効なユーザーID形式です。数字のみで指定してください。`
          );
          return;
        }
        if (config.admins.includes(targetUserId)) {
          await message.reply(
            `ℹ️ ユーザーID ${targetUserId} は既に管理者です。`
          );
          return;
        }
        try {
          const user = await client.users.fetch(targetUserId);
          config.admins.push(targetUserId);
          const success = await saveConfig(config);
          if (success) {
            await message.reply(
              `✔ ユーザー ${user.tag} (${targetUserId}) を管理者に追加しました。`
            );
          } else {
            await message.reply("❌ 設定の保存中にエラーが発生しました。");
            config.admins.pop();
          }
        } catch {
          await message.reply(
            `❌ 指定されたユーザーID ${targetUserId} のユーザーを見つけられませんでした。IDを確認してください。`
          );
        }
        break;

      case "remove":
        if (!targetUserId) {
          await message.reply(
            `❌ 削除するユーザーのIDを指定してください。\n使い方: \`${PREFIX}admin remove <userID>\``
          );
          return;
        }
        if (!/^\d+$/.test(targetUserId)) {
          await message.reply(`❌ 無効なユーザーID形式です。`);
          return;
        }
        if (message.author.id === targetUserId) {
          await message.reply(
            "❌ 自分自身を管理者から削除することはできません。"
          );
          return;
        }
        const indexToRemove = config.admins.indexOf(targetUserId);
        if (indexToRemove === -1) {
          await message.reply(
            `ℹ️ ユーザーID ${targetUserId} は管理者リストに存在しません。`
          );
          return;
        }

        const removedId = config.admins.splice(indexToRemove, 1)[0];
        const removeSuccess = await saveConfig(config);
        try {
          const user = await client.users.fetch(targetUserId);
          if (removeSuccess) {
            await message.reply(
              `✔ ユーザー ${user.tag} (${targetUserId}) を管理者から削除しました。`
            );
          } else {
            await message.reply("❌ 設定の保存中にエラーが発生しました。");
            config.admins.splice(indexToRemove, 0, removedId);
          }
        } catch {
          if (removeSuccess) {
            await message.reply(
              `✔ ユーザーID ${targetUserId} を管理者から削除しました。(ユーザー情報の取得失敗)`
            );
          } else {
            await message.reply("❌ 設定の保存中にエラーが発生しました。");
            config.admins.splice(indexToRemove, 0, removedId);
          }
        }
        break;

      case "list":
        const embed = new EmbedBuilder()
          .setColor(0x0099ff)
          .setTitle("👑 管理者リスト");
        if (!config.admins || config.admins.length === 0) {
          embed.setDescription("現在、管理者は登録されていません。");
        } else {
          const adminUsersPromises = config.admins.map((id) =>
            client.users.fetch(id).catch(() => ({ id, tag: "不明なユーザー" }))
          );
          const adminUsers = await Promise.all(adminUsersPromises);
          const adminList = adminUsers
            .map((u) => `• ${u.tag} (\`${u.id}\`)`)
            .join("\n");
          embed.setDescription(adminList);
        }
        if (message.channel instanceof TextChannel) {
          await message.channel.send({ embeds: [embed] });
        }

        break;

      default:
        await message.reply(
          `❌ 無効なサブコマンドです。\n使い方: \`${PREFIX}admin <add|remove|list> [userID]\``
        );
        break;
    }
  },
};

registerCommand(adminCommandBase);

