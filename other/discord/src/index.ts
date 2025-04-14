import { Client, GatewayIntentBits, Partials, PresenceUpdateStatus, ActivityType, Collection, Events, Message, User, Interaction } from 'discord.js';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Command } from './types/command';
import { loadStaticCommands } from './modules/static-loader';
import { EventEmitter } from 'events';

const CONFIG_FILE_NAME = 'config.json';
const CONFIG_FILE_PATH = path.join(process.cwd(), CONFIG_FILE_NAME);
const PLUGINS_DIR = path.join(__dirname, 'plugins');
export const PREFIX = '#';

const EULA_TEXT = `
========================= 利用規約 (EULA) =========================
このツールは Discord Bot の管理を支援する目的で提供されます。
開発者は、このツールの使用によって生じた、あるいは使用に関連して生じた
いかなる種類の損害（データ損失、アカウント停止、その他の不利益を含むが
これらに限定されない）についても、一切の責任を負いません。
このツールの使用は、完全に自己の責任において行われるものとします。
Discord の利用規約および開発者ポリシーを遵守してください。
=================================================================
`;

interface Config {
    token?: string;
    eulaAgreed?: boolean;
    admins?: string[];
}

export const commands = new Collection<string, Command>();
export let client: Client | null = null;
export let currentConfig: Config = {};

export const discordEventBroker = new EventEmitter();
discordEventBroker.setMaxListeners(50);

export interface CustomMessageEventPayload {
    message: Message;
    user: User;
}

export async function loadConfig(): Promise<Config | null> {
    try {
        const data = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
        currentConfig = JSON.parse(data) as Config;
        return currentConfig;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            currentConfig = {};
            return null;
        }
        console.error(`❌ 設定ファイル (${CONFIG_FILE_NAME}) の読み込みエラー:`, error.message);
        currentConfig = {};
        return null;
    }
}

export async function saveConfig(configToSave: Config): Promise<boolean> {
    try {
        currentConfig = { ...configToSave };
        await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(currentConfig, null, 2), 'utf-8');
        console.log(`✔ 設定を ${CONFIG_FILE_NAME} に保存しました。`);
        return true;
    } catch (error: any) {
        console.error(`❌ 設定ファイル (${CONFIG_FILE_NAME}) の保存エラー:`, error.message);
        return false;
    }
}

function isValidTokenFormat(token: string): boolean {
    return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token);
}

async function promptForToken(): Promise<string | null> {
    const { token } = await inquirer.prompt<{ token: string }>([
        {
            type: 'password', name: 'token', message: 'Discord Bot Token を入力してください:', mask: '*',
            validate: (input: string) => {
                if (!input) return 'トークンは必須です。';
                if (!isValidTokenFormat(input)) return 'トークンの形式が正しくないようです。';
                return true;
            },
        },
    ]);
    return token;
}

async function promptForEula(): Promise<boolean> {
    console.log(EULA_TEXT);
    const { agreed } = await inquirer.prompt<{ agreed: boolean }>([
        { type: 'confirm', name: 'agreed', message: '上記の利用規約に同意し、自己責任で使用しますか？', default: false },
    ]);
    return agreed;
}

export function registerCommand(command: Command, source: string = '不明') {
    if (command && command.name && typeof command.execute === 'function') {
        if (commands.has(command.name)) {
            console.log(`ℹ️ ${source}登録: コマンド名 "${command.name}" は既に登録済。上書きします。`);
        }
        commands.set(command.name, command);
        console.log(`✔ ${source}コマンド [${command.name}] を登録しました。`);

        if (command.aliases && command.aliases.length > 0) {
            command.aliases.forEach(alias => {
                if (commands.has(alias) && commands.get(alias)?.name !== command.name) {
                    console.warn(`⚠️ ${source}登録: エイリアス "${alias}" (from ${command.name}) は既存のコマンド/エイリアス "${commands.get(alias)?.name}" と衝突しています。`);
                } else if (!commands.has(alias)) {
                    commands.set(alias, command);
                }
            });
        }
    } else {
        console.warn(`⚠️ 無効なコマンドオブジェクトの登録試行 (ソース: ${source}):`, command);
    }
}

async function loadCommands() {
    const source = '動的';
    console.log(`⚙️ ${source}コマンド/プラグイン読み込み中 (${PLUGINS_DIR})...`);
    try {
        if (!fsSync.existsSync(PLUGINS_DIR)) {
            await fs.mkdir(PLUGINS_DIR, { recursive: true });
            console.warn(`⚠️ ${source}プラグインディレクトリ (${PLUGINS_DIR}) が見つからなかったため作成しました。`);
            return;
        }
        const pluginFiles = fsSync.readdirSync(PLUGINS_DIR)
            .filter(file => file.endsWith('.js') || file.endsWith('.mjs'));

        if (pluginFiles.length === 0) {
            console.log(`ℹ️ 利用可能な${source}コマンド/プラグインファイル (.js/.mjs) が見つかりませんでした。`);
            return;
        }
        console.log(`ℹ️ ${pluginFiles.length} 個の${source}プラグインファイルを検出。読み込み開始...`);
        let loadedFileCount = 0;
        let loadedCommandCount = 0;

        for (const file of pluginFiles) {
            const filePath = path.join(PLUGINS_DIR, file);
            const isEsModule = file.endsWith('.mjs');
            const moduleType = isEsModule ? 'ESM' : 'CJS';

            try {
                let moduleExports: any;
                if (isEsModule) {
                    const fileUrl = `file://${filePath.replace(/\\/g, '/')}`;
                    moduleExports = await import(fileUrl + `?update=${Date.now()}`);
                } else {
                    delete require.cache[require.resolve(filePath)];
                    moduleExports = require(filePath);
                }

                console.log(`   ✔ Módulo [${file}] (${moduleType}) carregado.`);
                loadedFileCount++;

                const command = moduleExports.default as Command || moduleExports.command as Command;

                if (command && command.name && typeof command.execute === 'function') {
                    registerCommand(command, `${source}(${file})`);
                    loadedCommandCount++;
                }

            } catch (error: any) {
                console.error(`❌ ファイル [${file}] (${moduleType}) の読み込み/処理エラー:`, error.message, error.stack);
            }
        }
        console.log(`✔ ${loadedFileCount} 個の${source}プラグインファイルを読み込み、${loadedCommandCount} 個のコマンドを登録しました。`);
    } catch (error: any) {
        console.error(`❌ ${source}プラグイン読み込みプロセス全体でエラー:`, error.message);
    }
}


async function main() {
    console.log('🔧 Discord 管理ツール起動...');

    await loadConfig();
    let token: string | undefined = currentConfig.token;
    let tokenSource: 'config' | 'prompt' | 'none' = 'none';

    if (token && isValidTokenFormat(token)) {
        console.log(`ℹ️ 設定ファイルからトークンを読み込みました。`);
        tokenSource = 'config';
    } else {
        if (token) { console.warn(`⚠️ 設定ファイルのトークン形式が不正です。再入力を求めます。`); }
        else { console.log(`ℹ️ 設定ファイルが見つからないか、トークンがありません。`); }

        const promptedToken = await promptForToken();
        if (promptedToken) {
            token = promptedToken;
            currentConfig.token = token;
            tokenSource = 'prompt';
        } else {
            console.error('❌ トークンを取得できませんでした。終了します。');
            process.exit(1);
        }
    }
    if (!token) { console.error('❌ 有効なトークンがありません。終了します。'); process.exit(1); }


    if (!currentConfig.eulaAgreed) {
        const agreedToEula = await promptForEula();
        if (!agreedToEula) {
            console.log('ℹ️ 利用規約に同意されなかったため、ツールを終了します。');
            process.exit(0);
        }
        console.log('✔ 利用規約に同意しました。');
        currentConfig.eulaAgreed = true;
        await saveConfig(currentConfig);
    } else {
        console.log('ℹ️ 利用規約には既に同意済みです。');
    }

    if (tokenSource === 'prompt' && currentConfig.token) {
        const savedConfig = await loadConfig();
        if (savedConfig?.token !== currentConfig.token) {
            const { save } = await inquirer.prompt<{ save: boolean }>([
                { type: 'confirm', name: 'save', message: `入力されたトークンを ${CONFIG_FILE_NAME} に保存しますか？`, default: true }
            ]);
            if (save) {
                await saveConfig(currentConfig);
            }
        }
    }

    await loadStaticCommands();
    const staticCommandCount = commands.filter((c, k) => c.name === k).size;
    console.log(`ℹ️ 静的コマンド登録完了 (${staticCommandCount} 個)`);

    await loadCommands();
    const totalCommandCount = commands.filter((c, k) => c.name === k).size;
    const totalAliasCount = commands.size;
    console.log(`✔ 合計 ${totalCommandCount} 個のコマンド (${totalAliasCount} エイリアス含む) が利用可能です。`);


    console.log('⚙️ Discord への接続準備中...');
    client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildVoiceStates,
        ],
        partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User],
    });

    client.once(Events.ClientReady, async (readyClient) => {
        console.log(`✔ ${readyClient.user.tag} としてログインしました！`);

        if (!currentConfig.admins || currentConfig.admins.length === 0) {
            console.log('ℹ️ 管理者リストが空です。Botオーナーを自動登録します...');
            try {
                if (!readyClient.application?.owner) await readyClient.application?.fetch();
                const owner = readyClient.application?.owner;

                if (owner instanceof User) {
                    currentConfig.admins = [owner.id];
                    await saveConfig(currentConfig);
                    console.log(`✔ Botオーナー ${owner.tag} (${owner.id}) を管理者に自動登録しました。`);
                } else if (owner && 'members' in owner) {
                    console.warn('⚠️ BotオーナーがTeamのため、自動登録できませんでした。Teamメンバーを手動で管理者に登録してください (`admin add <userID>`)。');
                    if (!currentConfig.admins) currentConfig.admins = [];
                    await saveConfig(currentConfig);
                } else {
                    console.warn('⚠️ Botオーナー情報の取得に失敗しました。手動で管理者を登録してください (`admin add <userID>`)。');
                    if (!currentConfig.admins) currentConfig.admins = [];
                    await saveConfig(currentConfig);
                }
            } catch (error: any) {
                console.error('❌ Botオーナー情報の取得または管理者登録中にエラー:', error.message);
                if (!currentConfig.admins) {
                    currentConfig.admins = [];
                    await saveConfig(currentConfig);
                }
            }
        }

        try {
            readyClient.user.setPresence({
                activities: [{ name: `サーバー監視中 | ${PREFIX}help`, type: ActivityType.Watching }],
                status: PresenceUpdateStatus.Online,
            });
            
            console.log(`ℹ️ Botステータス設定完了。`);
        } catch (error: any) {
            console.error('❌ Botステータス設定エラー:', error.message);
        }

        discordEventBroker.emit(Events.ClientReady, readyClient);

        console.log(`⌨️ イベントリスナー/コマンド待機中... (終了するには Ctrl+C)`);
    });

    const RATE_LIMIT_COUNT = 4; // 許可されるコマンド数
    const RATE_LIMIT_WINDOW_MS = 3 * 1000; // 制限チェックの時間窓 (3秒)
    const RATE_LIMIT_DURATION_MS = 30 * 60 * 1000; // 制限時間 (30分)

    // --- レート制限用のデータ構造 ---
    // キー: userId, 値: コマンド実行タイムスタンプの配列 (ミリ秒)
    const userCommandTimestamps = new Map<string, number[]>();
    // キー: userId, 値: レート制限の解除時刻 (ミリ秒)
    const rateLimitedUsers = new Map<string, number>(); // 指定された通り Map を使用

    // --- MessageCreate イベントリスナー ---
    client.on(Events.MessageCreate, async (message: Message) => {
        // イベントブローカーへの転送 (早期に実行)
        try {
            // client が利用可能かチェック (非同期処理の前に確認)
            if (client) {
                discordEventBroker.emit(Events.MessageCreate, message, client);
            } else {
                console.warn(`⚠️ イベント転送スキップ (${Events.MessageCreate}): Client is not available.`);
            }
        } catch (e) {
            console.error(`❌ イベント転送エラー (${Events.MessageCreate}):`, e);
        }

        // ボットやDM、プレフィックスで始まらないメッセージは無視 (変更なし)
        if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) {
            return;
        }

        // --- レート制限チェック ---
        const userId = message.author.id;
        const now = Date.now();

        // 1. 現在レート制限中かチェック
        const expiryTimestamp = rateLimitedUsers.get(userId);
        if (expiryTimestamp) {
            if (now < expiryTimestamp) {
                // まだ制限中
             //   const timeLeftMinutes = Math.ceil((expiryTimestamp - now) / (60 * 1000));
                try {
                   /// await message.reply(`⏳ コマンドの使用が制限されています。あと約 ${timeLeftMinutes} 分お待ちください。`).catch(() => { }); // 返信失敗は無視
                } catch { }
                return; // コマンド処理を中断
            } else {
                // 制限時間が過ぎたので解除
                rateLimitedUsers.delete(userId);
                console.log(`✅ レート制限解除: ${message.author.tag} (${userId})`);
            }
        }

        // 2. タイムスタンプの記録とチェック
        const timestamps = userCommandTimestamps.get(userId) || [];

        // 3秒以上経過した古いタイムスタンプを除去
        const recentTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

        // 3. 制限回数を超えていないかチェック (現在のコマンドを含める前にチェック)
        if (recentTimestamps.length >= RATE_LIMIT_COUNT) {
            // 制限超過！レート制限を適用
            const newExpiry = now + RATE_LIMIT_DURATION_MS;
            rateLimitedUsers.set(userId, newExpiry);
            // レート制限適用時は、過去のタイムスタンプ情報は不要になるのでクリア
            userCommandTimestamps.delete(userId);
            console.log(`🚫 レート制限適用: ${message.author.tag} (${userId}) - 解除時刻: ${new Date(newExpiry).toLocaleString()}`);
            try {
                await message.author.send(`⚠️ コマンドを短時間に送信しすぎたため、一時的に制限されました。約30分後に解除されます。`).catch(() => { });
            } catch { }
            return; // コマンド処理を中断
        }

        // 4. 制限に達していない場合、現在のタイムスタンプを追加
        recentTimestamps.push(now);
        userCommandTimestamps.set(userId, recentTimestamps);


        // --- コマンド解析と実行 (元のロジック) ---
        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const commandNameInput = args.shift(); // 元の大文字小文字を保持

        if (!commandNameInput) return;

        // commands Map からコマンドを取得 (大文字小文字を区別する前提)
        const command = commands.get(commandNameInput);

        if (!command) {
            // コマンドが見つからない場合は何もしない (レート制限カウンタには影響済み)
            return;
        }

        // --- 管理者権限チェック (変更なし) ---
        if (command.admin) {
            const isAdmin = currentConfig.admins?.includes(message.author.id) ?? false;
            if (!isAdmin) {
                console.log(`🚫 権限拒否: ${message.author.tag} が管理者コマンド ${command.name} を試行 (入力: ${commandNameInput})`);
                try { await message.reply('❌ このコマンドを実行する権限がありません。').catch(() => { }); } catch { }
                // 権限不足でもレート制限カウントは消費される
                return;
            }
        }

        try {
            // client が必要なら渡す。不要なら command.execute の型定義に合わせる
            if (!client) throw new Error("Client is unavailable for command execution");
            await Promise.resolve(command.execute(client, message, args));
        } catch (error: any) {
            // エラーログ改善: エラーオブジェクト全体やスタックトレースを含めるとデバッグしやすい
            console.error(`❌ コマンド [${command.name}] 実行エラー (入力: ${commandNameInput}, User: ${message.author.tag}):`, error);
            try { await message.reply('❌ コマンド実行中にエラーが発生しました。').catch(() => { }); } catch { }
        }
    });

    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        try {
            discordEventBroker.emit(Events.InteractionCreate, interaction);
        } catch (e) {
            console.error(`❌ イベント転送エラー (${Events.InteractionCreate}):`, e)
        }

        if (!interaction.isButton()) return;

        const customId = interaction.customId;
        const commandName = customId.split('_')[0];
        if (!commandName) {
            console.warn(`⚠️ Interaction customId (${customId}) has no command prefix.`);
            return;
        }
        const command = commands.get(commandName);
        if (command && typeof command.handleInteraction === 'function') {
            try {
                await command.handleInteraction(interaction);
            } catch (error) {
                console.error(`❌ Interaction処理エラー (${commandName} / ID: ${customId}):`, error);
                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: '🤕 Interaction処理中にエラーが発生しました。', ephemeral: true });
                    } else {
                        await interaction.reply({ content: '🤕 Interaction処理中にエラーが発生しました。', ephemeral: true });
                    }
                } catch (replyError) { console.error(`エラー返信失敗 (${commandName}):`, replyError); }
            }
        } else {
            console.warn(`⚠️ コマンド '${commandName}' に handleInteraction が未定義 (ID: ${customId})`);
        }
    });

    client.on(Events.GuildMemberAdd, (member) => {
        try {
            discordEventBroker.emit(Events.GuildMemberAdd, member);
        } catch (e) {
            console.error(`❌ イベント転送エラー (${Events.GuildMemberAdd}):`, e)
        }
    });

    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
        try {
            discordEventBroker.emit(Events.VoiceStateUpdate, oldState, newState);
        } catch (e) {
            console.error(`❌ イベント転送エラー (${Events.VoiceStateUpdate}):`, e)
        }
    });


    client.on(Events.Error, (error) => console.error('❌ Discord クライアントエラー:', error.message, error));
    client.on(Events.Warn, (warning) => console.warn('⚠️ Discord クライアント警告:', warning));

    console.log('🔌 Discord へログイン試行中...');
    try {
        await client.login(token);
    } catch (error: any) {
        console.error('❌ Discord ログイン失敗:', error.message);
        if (error.code === 'TokenInvalid' || error.message.includes('TOKEN_INVALID')) {
            console.error('   ➥ 提供されたトークンが無効です。Discord Developer Portal で確認してください。');
            if (tokenSource === 'config') {
                console.log(`   ℹ️ ${CONFIG_FILE_NAME} を確認または削除して再試行してください。`);
                const { clear } = await inquirer.prompt<{ clear: boolean }>([
                    { type: 'confirm', name: 'clear', message: `設定ファイル (${CONFIG_FILE_NAME}) から無効なトークンを削除しますか？`, default: false }
                ]);
                if (clear && currentConfig) {
                    delete currentConfig.token;
                    await saveConfig(currentConfig);
                    console.log(`✔ ${CONFIG_FILE_NAME} からトークンを削除しました。`);
                }
            }
        } else if (error.code === 'DisallowedIntents') {
            console.error('   ➥ Botに必要なインテントが Discord Developer Portal で有効になっていません。');
            const requiredIntents = Object.keys(GatewayIntentBits).filter(k => client?.options.intents.has(GatewayIntentBits[k as keyof typeof GatewayIntentBits]));
            console.error(`   ➥ 現在設定されているインテント: ${requiredIntents.join(', ')} をDeveloper Portalで有効にしてください。`);
        }
        process.exit(1);
    }
}

async function handleExit(signal: NodeJS.Signals | string) {
    console.log(`\nℹ️ ${signal} シグナル受信。終了処理を開始します...`);
    if (client) {
        console.log('🔌 Discord からログアウトしています...');
        try {
            await client.destroy();
            console.log('✔ Discord から正常にログアウトしました。');
        } catch (error: any) {
            console.error('❌ Discord ログアウト中にエラーが発生:', error.message);
        } finally {
            client = null;
        }
    } else {
        console.log('ℹ️ Discord クライアントは初期化されていないか、既に破棄されています。');
    }
    console.log('👋 ツールを終了します。');
    process.exit(0);
}

process.on('SIGINT', () => handleExit('SIGINT'));
process.on('SIGTERM', () => handleExit('SIGTERM'));

process.on('uncaughtException', async (error, origin) => {
    console.error(`💥 キャッチされない例外が発生しました (Origin: ${origin}):`, error);
    try {
        await handleExit('uncaughtException');
    } catch {
    } finally {
        process.exit(1);
    }
});

process.on('unhandledRejection', async (reason, _promise) => {
    console.error('💥 ハンドルされない Promise 拒否:', reason);
});


main().catch((error) => {
    console.error('💥 main 関数で致命的なエラーが発生しました:', error);
    process.exit(1);
});