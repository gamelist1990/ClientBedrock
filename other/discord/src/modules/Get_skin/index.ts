import { EmbedBuilder, Message, TextChannel } from "discord.js";
import { PREFIX, registerCommand } from "../.."; // パスは実際のプロジェクト構造に合わせてください
import { Command } from "../../types/command"; // パスは実際のプロジェクト構造に合わせてください
// Node.js v18 未満の場合は 'node-fetch' などを import してください
// import fetch from 'node-fetch'; // 例: node-fetch を使う場合

console.log('⚙️ get_skin コマンド定義読み込み...');

const getSkinCommand: Command = {
    name: 'get_skin',
    description: '指定されたMinecraftユーザー名(BE/Geyser)のスキン情報を表示します。',
    admin: false, // 一般ユーザーも使用可能にする場合は false
    usage: 'get_skin <userName>',
    execute: async (_client, message: Message, args: string[]) => {
        const userName = args[0];

        if (!userName) {
            await message.reply(`❌ スキン情報を取得するユーザー名を指定してください。\n使い方: \`${PREFIX}get_skin <userName>\``);
            return;
        }

        // --- 1. XUIDの取得 ---
        let xuid: string | null = null;
        try {
            const xuidResponse = await fetch(`https://api.geysermc.org/v2/xbox/xuid/${encodeURIComponent(userName)}`);

            if (!xuidResponse.ok) {
                if (xuidResponse.status === 404) {
                    await message.reply(`❌ ユーザー名 \`${userName}\` が見つかりませんでした。GeyserMCに接続したことがある有効なXboxゲーマータグを指定してください。`);
                } else {
                    // その他のHTTPエラー
                    await message.reply(`❌ XUIDの取得中にエラーが発生しました (HTTPステータス: ${xuidResponse.status})。`);
                    console.error(`Geyser API (XUID) エラー: ${xuidResponse.status} - ${await xuidResponse.text()}`);
                }
                return;
            }

            const xuidData: { xuid: string } = await xuidResponse.json();
            if (!xuidData || !xuidData.xuid) {
                await message.reply(`❌ APIから有効なXUIDを取得できませんでした。`);
                console.error(`Geyser API (XUID) 無効なレスポンス:`, xuidData);
                return;
            }
            xuid = xuidData.xuid;

        } catch (error: any) {
            console.error(`❌ get_skinコマンド (XUID取得) でエラーが発生 (ユーザー名: ${userName}):`, error);
            await message.reply(`❌ XUIDの取得中にネットワークエラーまたは予期せぬエラーが発生しました。`);
            return;
        }

        if (!xuid) {
            // このポイントには通常到達しないはずだが念のため
            await message.reply(`❌ 不明なエラーによりXUIDを取得できませんでした。`);
            return;
        }


        // --- 2. スキン情報の取得 ---
        try {
            const skinResponse = await fetch(`https://api.geysermc.org/v2/skin/${xuid}`);

            if (!skinResponse.ok) {
                // XUIDが見つからない、またはスキン情報がない場合など
                await message.reply(`❌ XUID \`${xuid}\` に関連するスキン情報の取得中にエラーが発生しました (HTTPステータス: ${skinResponse.status})。`);
                console.error(`Geyser API (Skin) エラー: ${skinResponse.status} - ${await skinResponse.text()}`);
                return;
            }

            // APIレスポンスの型定義 (必要最低限)
            interface SkinData {
                texture_id: string;
                last_update: number; // Unix timestamp (milliseconds)
                // 他にも hash, is_steve, signature, value などがあるが必要に応じて追加
            }

            const skinData: SkinData = await skinResponse.json();

            if (!skinData || !skinData.texture_id || typeof skinData.last_update !== 'number') {
                await message.reply(`❌ APIから有効なスキン情報を取得できませんでした。`);
                console.error(`Geyser API (Skin) 無効なレスポンス:`, skinData);
                return;
            }

            // --- 3. 結果の表示 ---
            const textureId = skinData.texture_id;
            const skinImageUrl = `http://textures.minecraft.net/texture/${textureId}`;
            const lastUpdateTimestamp = Math.floor(skinData.last_update / 1000); // 秒単位に変換

            const embed = new EmbedBuilder()
                .setColor(0x5865F2) // Discordの色っぽい青色など
                .setTitle(`👤 スキン情報: ${userName}`)
                .addFields(
                    { name: 'ユーザー名', value: `\`${userName}\``, inline: true },
                    { name: 'XUID', value: `\`${xuid}\``, inline: true },
                    { name: '最終更新日時', value: `<t:${lastUpdateTimestamp}:F> (<t:${lastUpdateTimestamp}:R>)` },
                    { name: 'テクスチャID', value: `\`${textureId}\``}
                )
                .setImage(skinImageUrl) // スキン画像をEmbedに設定
                .setTimestamp()
                .setFooter({ text: 'Powered by GeyserMC API & textures.minecraft.net' });


            const channel = message.channel as TextChannel;
            await channel.send({ embeds: [embed] });

        } catch (error: any) {
            console.error(`❌ get_skinコマンド (スキン情報取得) でエラーが発生 (XUID: ${xuid}):`, error);
            await message.reply(`❌ スキン情報の取得中にネットワークエラーまたは予期せぬエラーが発生しました。`);
        }
    }
};

// コマンドを登録
registerCommand(getSkinCommand);