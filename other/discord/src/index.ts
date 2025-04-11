import { Client, GatewayIntentBits, Partials, PresenceUpdateStatus, ActivityType, Collection, Events, Message, User, Interaction } from 'discord.js';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Command } from './types/command';
import { loadStaticCommands } from './modules/static-loader';

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
let client: Client | null = null;
export let currentConfig: Config = {};

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

export function registerCommand(command: Command) {
    if (command && command.name && typeof command.execute === 'function') {
        const source = '静的';
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
        console.warn('⚠️ 無効なコマンドオブジェクトの静的登録試行:', command);
    }
}

async function loadCommands() {
    const source = '動的';
    console.log(`⚙️ ${source}コマンドプラグイン読み込み中 (${PLUGINS_DIR})...`);
    try {
        if (!fsSync.existsSync(PLUGINS_DIR)) {
            console.warn(`⚠️ ${source}プラグインディレクトリ (${PLUGINS_DIR}) が見つかりません。`);
            return;
        }
        const commandFiles = fsSync.readdirSync(PLUGINS_DIR)
            .filter(file => file.endsWith('.js') || file.endsWith('.mjs'));

        if (commandFiles.length === 0) {
            console.log(`ℹ️ 利用可能な${source}コマンドプラグインファイル (.js/.mjs) が見つかりませんでした。`);
            return;
        }
        console.log(`ℹ️ ${commandFiles.length} 個の${source}コマンドファイルを検出。読み込み開始...`);
        let loadedFileCount = 0;

        for (const file of commandFiles) {
            const filePath = path.join(PLUGINS_DIR, file);
            let command: Command | undefined;
            const isEsModule = file.endsWith('.mjs');
            const moduleType = isEsModule ? 'ESM' : 'CJS';

            try {
                if (isEsModule) {
                    const module = await import(`file://${filePath}`);
                    command = module.default as Command;
                    if (!command && typeof module === 'object' && module !== null) {
                        console.warn(`  ⚠️ ファイル [${file}] (${moduleType}) は default export されていません。`);
                    }
                } else {
                    delete require.cache[require.resolve(filePath)];
                    command = require(filePath) as Command;
                }

                if (command && command.name && typeof command.execute === 'function') {
                    if (commands.has(command.name)) {
                        console.warn(`⚠️ ${source}登録: コマンド名 "${command.name}" (from ${file}) は既に登録済。上書きします。`);
                    }
                    commands.set(command.name, command);
                    console.log(`✔ ${source}コマンド [${command.name}] (${moduleType}) を読み込み/登録しました。`);
                    loadedFileCount++;

                    if (command.aliases && command.aliases.length > 0) {
                        command.aliases.forEach(alias => {
                            if (commands.has(alias) && commands.get(alias)?.name !== command?.name && command) {
                                console.warn(`⚠️ ${source}登録: エイリアス "${alias}" (from ${command.name}) は既存のコマンド/エイリアス "${commands.get(alias)?.name}" と衝突しています。`);
                            } else if (!commands.has(alias) && command) {
                                commands.set(alias, command);
                            }
                        });
                    }
                } else {
                    console.warn(`⚠️ ファイル [${file}] (${moduleType}) は有効なコマンド形式(name, execute)をエクスポートしていません。`);
                }
            } catch (error: any) {
                console.error(`❌ ファイル [${file}] (${moduleType}) の読み込み/処理エラー:`, error.message);
            }
        }
        console.log(`✔ ${loadedFileCount} 個の${source}コマンドファイルを処理しました。`);
    } catch (error: any) {
        console.error(`❌ ${source}コマンドプラグイン読み込みプロセス全体でエラー:`, error.message);
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
            console.error('❌ トークンを取得できませんでした。終了します。'); process.exit(1);
        }
    }
    if (!token) { console.error('❌ 有効なトークンがありません。終了します。'); process.exit(1); }


    if (!currentConfig.eulaAgreed) {
        const agreedToEula = await promptForEula();
        if (!agreedToEula) { console.log('ℹ️ 利用規約に同意されなかったため、ツールを終了します。'); process.exit(0); }
        console.log('✔ 利用規約に同意しました。');
        currentConfig.eulaAgreed = true;
        await saveConfig(currentConfig);
    } else {
        console.log('ℹ️ 利用規約には既に同意済みです。');
    }

    if (tokenSource === 'prompt' && currentConfig.token) {
        const savedToken = (await loadConfig())?.token;
        if (savedToken !== currentConfig.token) {
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
    const staticAliasCount = commands.size;
    console.log(`ℹ️ 静的コマンド登録完了 (${staticCommandCount} 個 / ${staticAliasCount} エイリアス含む)`);

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
        ],
        partials: [Partials.Channel, Partials.Message],
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
                } else {
                    console.warn('⚠️ BotオーナーがTeamのため、自動登録できませんでした。手動で管理者を登録してください (`admin add <userID>`)。');
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
        } catch (error: any) { console.error('❌ Botステータス設定エラー:', error.message); }
        console.log(`⌨️ プレフィックス "${PREFIX}" でコマンド待機中... (終了するには Ctrl+C)`);
    });

    client.on(Events.MessageCreate, async (message: Message) => {
        if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) { return; }
        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const commandName = args.shift()?.toLowerCase();
        if (!commandName) return;
        const command = commands.get(commandName);
        if (!command) return;

        if (command.admin) {
            const isAdmin = currentConfig.admins?.includes(message.author.id) ?? false;
            if (!isAdmin) {
                console.log(`🚫 権限拒否: ${message.author.tag} が管理者コマンド ${command.name} を試行`);
                await message.reply('❌ このコマンドを実行する権限がありません。').catch(() => { });
                return;
            }
        }

        try {
            await Promise.resolve(command.execute(client as Client, message, args));
        } catch (error: any) {
            console.error(`❌ コマンド [${command.name}] 実行エラー:`, error.message);
            try { await message.reply('❌ コマンド実行中にエラーが発生しました。'); } catch { /* ignore */ }
        }
    });



    //ボタンインタラクション用の コード(多分バグが無い限り機能する[オセロ/OxGameを動かしてる感じエラーはまだ起きていない])
    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        if (!interaction.isButton()) return;

        const customId = interaction.customId;
        const commandName = customId.split('_')[0];

        if (!commandName) {
            console.warn(`⚠️ ボタンの customId (${customId}) からコマンド名を特定できませんでした。`);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '🤔 無効なボタン操作のようです。', ephemeral: true });
                }
            } catch (e) { console.error("無効ボタンへの返信失敗:", e); }
            return;
        }
        const command = commands.get(commandName);
        if (command && typeof command.handleInteraction === 'function') {
            try {
                await command.handleInteraction(interaction);
            } catch (error) {
                console.error(`❌ ボタン処理エラー (${commandName} / ID: ${customId}):`, error);
                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: '🤕 ボタン操作の処理中にエラーが発生しました。', ephemeral: true });
                    } else {
                        await interaction.reply({ content: '🤕 ボタン操作の処理中にエラーが発生しました。', ephemeral: true });
                    }
                } catch (replyError) {
                    console.error(`インタラクションエラー (${commandName}) の返信失敗:`, replyError);
                }
            }
        } else {
            console.warn(`⚠️ '${commandName}' コマンドまたは handleInteraction が見つかりません (Button ID: ${customId})`);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '🤔 このボタンに対応する機能が見つからないか、現在利用できないようです。', ephemeral: true });
                }
            } catch (e) { console.error("未対応ボタンへの返信失敗:", e); }
        }
    });
    

    client.on(Events.Error, (error) => console.error('❌ Discord クライアントエラー:', error.message));
    client.on(Events.Warn, (warning) => console.warn('⚠️ Discord クライアント警告:', warning));

    console.log('🔌 Discord へログイン試行中...');
    try {
        await client.login(token);
    } catch (error: any) {
        console.error('❌ Discord ログイン失敗:', error.message);
        if (error.message.includes('TOKEN_INVALID') || error.code === 'TokenInvalid') {
            console.error('   ➥ 提供されたトークンが無効です。Discord Developer Portal で確認してください。');
            if (tokenSource === 'config') { console.log(`   ℹ️ ${CONFIG_FILE_NAME} を確認または削除して再試行してください。`); }
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
process.on('uncaughtException', async (error) => {
    console.error('💥 キャッチされない例外が発生しました:', error);
    await handleExit('uncaughtException');
    process.exit(1);
});
process.on('unhandledRejection', async (reason) => {
    console.error('💥 ハンドルされない Promise 拒否:', reason);
    process.exit(1);
});

main().catch((error) => {
    console.error('💥 main 関数で未処理のエラーが発生しました:', error);
    process.exit(1);
});