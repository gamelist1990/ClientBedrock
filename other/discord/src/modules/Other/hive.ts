import { EmbedBuilder } from 'discord.js';
import { PREFIX, registerCommand } from '../..';
import { Command } from '../../types/command';
import fetch from 'node-fetch'; 

// --- 利用可能なゲームIDと表示名の定義 ---
const AVAILABLE_GAMES = [
    'wars', 'dr', 'hide', 'sg', 'murder', 'sky', 'ctf', 'drop', 'ground',
    'build', 'party', 'bridge', 'grav', 'bed','main'
] as const;

type GameId = typeof AVAILABLE_GAMES[number]; // 型安全なゲームID

// ゲームIDに対応する表示名 (必要に応じて調整・追加してください)
const GAME_NAMES: Record<GameId, string> = {
    wars: 'Treasure Wars',
    dr: 'DeathRun',
    hide: 'Hide and Seek',
    sg: 'Survival Games',
    murder: 'Murder Mystery',
    sky: 'SkyWars',
    ctf: 'Capture the Flag',
    drop: 'Block Drop',
    ground: 'Ground Wars',
    build: 'Just Build',
    party: 'Block Party',
    main: 'Overall (Main Games)',
    bridge: 'The Bridge',
    grav: 'Gravity',
    bed: 'BedWars'
};

// --- PlayHive APIからデータを取得するヘルパー関数 (変更なし) ---
async function fetchPlayHiveData(endpoint: string): Promise<any> {
    const baseUrl = 'https://api.playhive.com/v0';
    const url = `${baseUrl}${endpoint}`;
    console.log(`Fetching: ${url}`); // デバッグ用ログ

    try {
        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('NotFound'); // プレイヤー/ゲーム/統計が見つからない場合
            }
            let errorBody: any = {};
            try {
                errorBody = await response.json();
            } catch (parseError) { }
            console.error(`API Error ${response.status}: ${response.statusText}`, errorBody);
            throw new Error(`APIリクエスト失敗 ステータス: ${response.status}`);
        }

        const text = await response.text();
        if (!text) {
            console.warn(`API returned empty response for ${url}`);
            throw new Error('APIから空のレスポンスが返されました。');
        }
        try {
            return JSON.parse(text);
        } catch (e) {
            console.error(`Failed to parse JSON response from ${url}:`, text);
            throw new Error('APIからのJSONレスポンスの解析に失敗しました。');
        }
    } catch (error: any) {
        if (error.message === 'NotFound') {
            throw error;
        }
        console.error(`Error fetching PlayHive API (${url}):`, error);
        throw new Error(`PlayHive APIへの接続中にエラーが発生しました: ${error.message}`);
    }
}


// --- hive コマンドの定義 ---
const hiveCommand: Command = {
    name: 'hive',
    description: 'PlayHiveの指定されたゲームのプレイヤー統計を取得します。',
    admin: false,
    // 新しいUsage形式
    usage: `hive getData <game> <username>\n利用可能なゲーム: ${AVAILABLE_GAMES.join(', ')}`,
    execute: async (_client, message, args) => {
        const action = args[0]?.toLowerCase(); // アクション (getData)
        const gameIdInput = args[1]?.toLowerCase(); // ゲームID
        const username = args[2]; // プレイヤー名

        // --- アクション: getData ---
        if (action === 'getdata') {
            // 引数のチェック
            if (!gameIdInput || !username) {
                await message.reply(`❌ 引数が不足しています。\n**使い方:** \`${PREFIX}hive getData <game> <username>\`\n**利用可能なゲーム:** \`${AVAILABLE_GAMES.join(', ')}\``);
                return;
            }

            // ゲームIDの検証
            if (!(AVAILABLE_GAMES as ReadonlyArray<string>).includes(gameIdInput)) {
                await message.reply(`❌ 無効なゲームIDです: \`${gameIdInput}\`\n**利用可能なゲーム:** \`${AVAILABLE_GAMES.join(', ')}\``);
                return;
            }
            // 型安全なゲームIDを取得
            const gameId = gameIdInput as GameId;
            const gameName = GAME_NAMES[gameId] || gameId; // 表示名を取得、なければIDをそのまま使う

            // ユーザー名形式チェック (変更なし)
            if (!/^[a-zA-Z0-9_ ]{3,16}$/.test(username)) {
                await message.reply(`⚠️ 指定されたユーザー名 \`${username}\` はPlayHiveの形式と異なる可能性がありますが、続行します。`);
            }

            // 処理中メッセージ
            const processingMessage = await message.reply(`⏳ プレイヤー \`${username}\` の **${gameName}** 統計を取得中...`);

            try {
                // 指定されたゲームの統計を取得
                const endpoint = `/game/all/${gameId}/${encodeURIComponent(username)}`;
                const stats = await fetchPlayHiveData(endpoint);

                // 主要な統計データを取得 (存在しない場合は null or undefined になる)
                const kills = stats.kills;
                const deaths = stats.deaths;
                const played = stats.played;
                const wins = stats.victories; // 'victories' が一般的なキー名
                const firstPlayedTimestamp = stats.first_played; // Unixタイムスタンプ
                const usernameCc = stats.username_cc || username; // API提供の大文字小文字区別ユーザー名
                const playerUUID = stats.UUID;

                // プレイ履歴がない、または主要な統計が取得できない場合
                if (played == null || played === 0 || (kills == null && deaths == null && wins == null)) {
                    await processingMessage.edit(`❓ プレイヤー \`${usernameCc}\` は **${gameName}** をプレイしたことがないか、統計情報が見つかりません。`);
                    return;
                }

                // --- K/D 比率の計算 ---
                let kdRatio: string = 'N/A'; // デフォルトはN/A
                if (typeof kills === 'number' && typeof deaths === 'number') {
                    if (deaths === 0) {
                        kdRatio = kills > 0 ? `${kills.toLocaleString()} (∞)` : '0.00';
                    } else {
                        kdRatio = (kills / deaths).toFixed(2);
                    }
                } else if (typeof kills === 'number') {
                    // キルのみ存在する場合 (デスが null/undefined)
                    kdRatio = `${kills.toLocaleString()} (∞)`;
                }

                // --- W/L 比率の計算 (任意) ---
                let wlRatio: string = 'N/A';
                if (typeof wins === 'number' && typeof played === 'number' && played > 0) {
                    const losses = played - wins;
                    if (losses <= 0) { // 負けがないか、計算がおかしい場合
                        wlRatio = wins > 0 ? `${wins.toLocaleString()} (∞)` : '0.00';
                    } else {
                        wlRatio = (wins / losses).toFixed(2);
                    }
                }

                // --- 結果を埋め込みメッセージで表示 ---
                const embed = new EmbedBuilder()
                    .setColor(0xFFAA00) // 基本色 (必要ならゲームごとに変えても良い)
                    .setTitle(`📊 ${usernameCc} の ${gameName} 統計`) // タイトルを汎用化
                    .setThumbnail(`https://th.bing.com/th/id/R.c35f87e178e51e3ed966991b02f618ad?rik=DCI%2bgWTD2OzCJA&riu=http%3a%2f%2fpm1.aminoapps.com%2f8685%2fe330d619674ff9286884b09d8e75ca94f607ad27r1-400-400v2_uhq.jpg&ehk=y7%2f%2bDC%2bzqmonyXCrVoWFHVgebbaHdA2NQgcXmgH3VLE%3d&risl=&pid=ImgRaw&r=0`) // アバター
                    .addFields(
                        // 共通で表示できそうな項目
                        { name: 'Kills', value: typeof kills === 'number' ? kills.toLocaleString() : 'N/A', inline: true },
                        { name: 'Deaths', value: typeof deaths === 'number' ? deaths.toLocaleString() : 'N/A', inline: true },
                        { name: 'K/D Ratio', value: kdRatio, inline: true }, // 計算結果を表示
                        { name: 'Wins', value: typeof wins === 'number' ? wins.toLocaleString() : 'N/A', inline: true },
                        { name: 'Played', value: typeof played === 'number' ? played.toLocaleString() : 'N/A', inline: true },
                        { name: 'W/L Ratio', value: wlRatio, inline: true } // W/L比率 (任意)
                    )
                    .setFooter({ text: 'データ提供: PlayHive API' })
                    .setTimestamp();

                // 初回プレイ日時があれば追加
                if (typeof firstPlayedTimestamp === 'number') {
                    embed.addFields({ name: 'First Played', value: `<t:${firstPlayedTimestamp}:R>`, inline: true });
                }

                // UUIDがあればフッターに追加
                if (playerUUID) {
                    embed.setFooter({ text: `データ提供: PlayHive API | UUID: ${playerUUID}` });
                }

                await processingMessage.edit({ content: null, embeds: [embed] });

            } catch (error: any) {
                if (error.message === 'NotFound') {
                    // プレイヤー検索フォールバック (共通)
                    try {
                        const searchEndpoint = `/player/search/${encodeURIComponent(username)}`;
                        const searchResults = await fetchPlayHiveData(searchEndpoint);

                        if (Array.isArray(searchResults) && searchResults.length > 0) {
                            const suggestions = searchResults
                                .slice(0, 5)
                                .map((p: { username: string }) => `\`${p.username}\``)
                                .join('\n');
                            await processingMessage.edit(`❌ プレイヤー \`${username}\` の **${gameName}** 統計が見つかりませんでした。\nプレイヤー自体は存在します。\n類似のユーザー名:\n${suggestions}`);
                        } else {
                            await processingMessage.edit(`❌ プレイヤー \`${username}\` はPlayHiveに見つかりませんでした。ユーザー名が正しいか確認してください。`);
                        }
                    } catch (searchError: any) {
                        console.error(`Player search fallback error for ${username}:`, searchError);
                        await processingMessage.edit(`❌ プレイヤー \`${username}\` が見つかりませんでした。ユーザー検索にも失敗しました。`);
                    }
                } else {
                    // その他のエラー
                    console.error(`Error processing 'hive getData' for ${username} (${gameId}):`, error);
                    await processingMessage.edit(`❌ **${gameName}** 統計情報の取得中にエラーが発生しました。(${error.message})`);
                }
            }

        } else {
            // 不明なアクションまたは引数なし
            await message.reply(`❓ 不明なコマンド形式、または引数が不足しています。\n**使い方:** \`${PREFIX}hive getData <game> <username>\`\n**利用可能なゲーム:** \`${AVAILABLE_GAMES.join(', ')}\``);
        }
    }
};

// --- コマンドの登録 ---
registerCommand(hiveCommand);
