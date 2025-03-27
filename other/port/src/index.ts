import fetch from 'node-fetch';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import inquirer from 'inquirer';
import CliTable from 'cli-table3';
import chalk from 'chalk';
import { platform, arch } from 'process';

const CONFIG_FILE = 'config.json';

interface Config {
    discordWebhookUrl: string;
    firstRun?: boolean;  // 初回起動フラグ (オプショナル)
    noopen?: boolean; // ブラウザを開かないオプション (オプショナル)
}

interface ServerInfo {
    port: string;
    protocol: string;
    address: string;
}

const serverTable = new CliTable({
    head: [
        chalk.cyanBright('ポート'),
        chalk.cyanBright('プロトコル'),
        chalk.cyanBright('アドレス'),
    ],
    colWidths: [10, 15, 80],
    style: { 'padding-left': 1, 'padding-right': 1 },
});

const servers = new Map<string, ServerInfo>();
let controlUrl: string | null = null;
let secureShareNetProcess: ChildProcess | null = null;

async function loadOrCreateConfig(): Promise<Config> {
    if (fs.existsSync(CONFIG_FILE)) {
        const configData = fs.readFileSync(CONFIG_FILE, 'utf8');
        return JSON.parse(configData);
    } else {
        const answers = await inquirer.prompt([
            {
                type: 'password',
                name: 'webhookUrl',
                message: 'Discord Webhook URL を入力してください:',
                mask: '*',
                validate: (input) => {
                    if (!input) {
                        return 'Webhook URL は必須です。';
                    }
                    const urlRegex =
                        /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[a-zA-Z0-9_-]+$/;
                    if (!urlRegex.test(input)) {
                        return '無効な Discord Webhook URL 形式です。';
                    }
                    return true;
                },
            },
        ]);

        const config: Config = {
            discordWebhookUrl: answers.webhookUrl,
            firstRun: true, // 初回起動フラグを true に設定
        };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        return config;
    }
}

async function sendToDiscord(
    webhookUrl: string,
    message: string,
    embeds: any[] = []
) {
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: message,
                embeds: embeds,
            }),
        });
        if (!response.ok) {
            console.error(
                chalk.redBright(
                    `Discordへの送信に失敗: ${response.status} ${response.statusText}`
                )
            );
            const responseText = await response.text();
            console.error(chalk.red('レスポンスボディ:'), responseText);
        }
    } catch (error) {
        console.error(chalk.redBright('Discordへの送信エラー:'), error);
    }
}

function updateTable() {
    serverTable.length = 0;

    servers.forEach((serverInfo) => {
        let addressOrUrl = chalk.blueBright(serverInfo.address);

        serverTable.push([
            chalk.greenBright(serverInfo.port),
            chalk.magentaBright(serverInfo.protocol),
            addressOrUrl,
        ]);
    });
    console.clear();
    console.log(serverTable.toString());
    if (controlUrl) {
        console.log(chalk.yellowBright(`コントロールURL: ${controlUrl}`)); // 完全なURLを表示
    }
}

function getSecureShareNetExecutableName(): string {
    if (platform === 'win32') {
        return 'securesharenet.exe';
    } else if (platform === 'linux') {
        if (arch === 'x64') {
            return 'securesharenet';
        } else if (arch === 'arm64') {
            return 'securesharenet-arm64';
        }
    }
    return '';
}

async function waitForEnter() {
    await inquirer.prompt([
        {
            type: 'input',
            name: 'continue',
            message: '続行するには Enter キーを押してください...',
        },
    ]);
}

async function showDownloadInstructions() {
    console.log(chalk.redBright('SecureShareNet が見つかりません。'));
    console.log(
        chalk.yellowBright(
            '以下の URL からお使いの環境に合ったものをダウンロードしてください:'
        )
    );
    console.log(chalk.cyan('https://manage.ssnetwork.io/h/?fdl=yes'));
    console.log('');
    if (platform === 'win32') {
        console.log(chalk.green('Windows 10以上 64bit (CUI版) をダウンロードしてください。'));
        console.log(chalk.green('ダウンロード後、このアプリケーションと同じディレクトリに配置して、再度起動してください。'));
    } else if (platform === 'linux') {
        if (arch === 'x64') {
            console.log(chalk.green('Linux x86_64 をダウンロードしてください。'));
            console.log(
                chalk.green(
                    'ダウンロード後、このアプリケーションと同じディレクトリに配置し、実行権限を付与してから起動してください。'
                )
            );
            console.log(chalk.gray('  (例: chmod +x ./securesharenet)'));
        } else if (arch === 'arm64') {
            console.log(chalk.green('Linux arm64(aarch64) をダウンロードしてください。'));
            console.log(
                chalk.green(
                    'ダウンロード後、このアプリケーションと同じディレクトリに配置し、実行権限を付与してから起動してください。'
                )
            );
            console.log(chalk.gray('  (例: chmod +x ./securesharenet-arm64)'));
        } else {
            console.log(
                chalk.red('お使いの Linux 環境 (アーキテクチャ) はサポートされていません。')
            );
        }
    } else {
        console.log(chalk.red('お使いの OS はサポートされていません。'));
    }
    await waitForEnter();
    process.exit(1);
}

async function isProcessRunning(executableName: string): Promise<number | null> {
    const command = platform === 'win32' ? 'tasklist' : 'ps';
    const args = platform === 'win32' ? ['/FI', `IMAGENAME eq ${executableName}`] : ['-ax', '-c'];

    try {
        const { exec } = await import('child_process'); // Dynamic import to avoid issues in non-Node environments

        return new Promise((resolve, _reject) => {
            exec(`${command} ${args.join(' ')}`, (error, stdout, _stderr) => {
                if (error) {
                    return resolve(null); // エラーが発生した場合、プロセスID を null で返す
                }

                if (platform === 'win32') {
                    if (stdout.includes(executableName)) {
                        const lines = stdout.split('\n');
                        for (const line of lines) {
                            if (line.includes(executableName)) {
                                const parts = line.trim().split(/\s+/);
                                const pid = parseInt(parts[1], 10);
                                if (!isNaN(pid)) {
                                    console.log(chalk.yellowBright(`プロセス ${executableName} (PID: ${pid}) は既に実行中です。`));
                                    resolve(pid); // プロセスIDを返す
                                    return;
                                }
                            }
                        }
                    }
                    resolve(null);
                } else {
                    const lines = stdout.split('\n');
                    for (const line of lines) {
                        if (line.includes(executableName) && !line.includes('grep')) {
                            const parts = line.trim().split(/\s+/);
                            const pid = parseInt(parts[0], 10);
                            if (!isNaN(pid)) {
                                console.log(chalk.yellowBright(`プロセス ${executableName} (PID: ${pid}) は既に実行中です。`));
                                resolve(pid); // プロセスIDを返す
                                return;
                            }
                        }
                    }
                    resolve(null);
                }


            });
        });
    } catch (err) {
        console.error(chalk.red(`プロセスのチェックに必要なモジュールの動的インポート中にエラーが発生しました: ${err}`));
        return null; // モジュールのインポートエラーが発生した場合、プロセスID を null で返す
    }
}

async function killProcess(pid: number): Promise<void> {
    try {
        if (platform === 'win32') {
            await new Promise<void>((resolve, reject) => {
                const { exec } = require('child_process');
                exec(`taskkill /F /PID ${pid}`, (error, _stdout, _stderr) => {
                    if (error) {
                        console.error(chalk.red(`プロセスの強制終了中にエラーが発生しました (PID: ${pid}): ${error}`));
                        reject(error);
                    } else {
                        console.log(chalk.yellowBright(`プロセス (PID: ${pid}) を強制終了しました。`));
                        resolve();
                    }
                });
            });
        } else {
            process.kill(pid, 'SIGKILL');
            console.log(chalk.yellowBright(`プロセス (PID: ${pid}) を強制終了しました。`));
        }
    } catch (error) {
        console.error(chalk.red(`プロセスの強制終了中にエラーが発生しました (PID: ${pid}): ${error}`));
    }
}

async function startSecureShareNet(config: Config) {
    const executableName = getSecureShareNetExecutableName();

    if (!executableName || !fs.existsSync(executableName)) {
        showDownloadInstructions();
        return;
    }

    // 既存のプロセスをチェックして終了
    const existingPid = await isProcessRunning(executableName);
    if (existingPid) {
        await killProcess(existingPid);
    }

    if (platform === 'linux') {
        try {
            fs.chmodSync(executableName, '755');
        } catch (error) {
            console.error(chalk.yellowBright(`実行権限の付与に失敗しましたが、続行します: ${error}`));
        }
    }

    const args = config.noopen ? ['noopen'] : []; // noopen が true なら 'noopen' 引数を追加
    secureShareNetProcess = spawn(`./${executableName}`, args, { stdio: 'pipe' });

    if (!secureShareNetProcess.stdout || !secureShareNetProcess.stderr) {
        console.error(chalk.red('Failed to get stdout or stderr from process'));
        return;
    }

    secureShareNetProcess.stdout.on('data', (data: Buffer) => {
        const output = data.toString();

        if (!controlUrl) {
            const controlUrlMatch = output.match(/コントロールURL: (https:\/\/manage\.ssnetwork\.io\/h\/\?c=.+)/);
            if (controlUrlMatch) {
                controlUrl = controlUrlMatch[1]; // 完全なURLを保存
                updateTable();
            }
        }

        const startMatches = output.matchAll(/公開開始: サーバーを公開しました。 \(ポート: (\d+) \((TCPのみ|UDPのみ|TCP, UDP両方)\) ===> (.*)\)/g);
        for (const match of startMatches) {
            const port = match[1];
            const protocol = match[2];
            const address = match[3];
            const key = `${port}-${protocol}-${address}`;

            if (servers.has(key)) {
                console.log(chalk.yellow(`重複: ${key}`));
                continue;
            }

            servers.set(key, { port, protocol, address });
            sendToDiscord(config.discordWebhookUrl, '', [
                {
                    title: ':rocket: サーバー公開',
                    color: 0x2ecc71,
                    fields: [
                        { name: 'ポート', value: port, inline: true },
                        { name: 'プロトコル', value: protocol, inline: true },
                        { name: 'アドレス', value: `\`${address}\``, inline: false },
                    ],
                    timestamp: new Date().toISOString(),
                },
            ]);
            updateTable();
        }

        const stopMatches = output.matchAll(/公開停止: サーバー公開を停止しました。 \(ポート: (\d+) \((TCPのみ|UDPのみ|TCP, UDP両方)\) ===> (.*)\)/g);
        for (const match of stopMatches) {
            const port = match[1];
            const protocol = match[2];
            const address = match[3];
            const key = `${port}-${protocol}-${address}`;

            if (servers.delete(key)) {
                sendToDiscord(config.discordWebhookUrl, '', [
                    {
                        title: ':octagonal_sign: サーバー停止',
                        color: 0xe74c3c,
                        fields: [
                            { name: 'ポート', value: port, inline: true },
                            { name: 'プロトコル', value: protocol, inline: true },
                            { name: 'アドレス', value: `\`${address}\``, inline: false },
                        ],
                        timestamp: new Date().toISOString(),
                    },
                ]);
            }
            updateTable();
        }
    });

    secureShareNetProcess.stderr.on('data', (data: Buffer) => {
        console.error(chalk.redBright(`securesharenet エラー: ${data}`));
    });

    secureShareNetProcess.on('close', async (code) => {
        secureShareNetProcess = null; // プロセスをnullにする

        let message = '';
        if (code === 0) {
            message = chalk.greenBright(`securesharenet が正常終了しました (コード: ${code})`);
            await sendToDiscord(config.discordWebhookUrl, ':wave: ポートの公開が終了しました!!');
        } else if (code === null) {
            message = chalk.yellowBright('securesharenet がシグナルにより終了しました');
            await sendToDiscord(config.discordWebhookUrl, ':information_source: ポートの公開が中断されました。');
        } else {
            message = chalk.redBright(`securesharenet が異常終了しました (コード: ${code})`);
            await sendToDiscord(config.discordWebhookUrl, ':warning: securesharenet が予期せず終了しました。');
        }

        console.log(message); // ログメッセージを表示
        process.exit(0); // 終了コードを0で終了
    });
}

async function main() {
    let config = await loadOrCreateConfig();

    // 初回起動時 かつ Windows の場合のみ質問する
    if (config.firstRun && platform === 'win32') {
        const answers = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'noopen',
                message: 'ブラウザで管理画面を開かないようにしますか？',
                default: false, // デフォルトでは開く
            },
        ]);
        config.noopen = answers.noopen;
        config.firstRun = false; // 初回起動フラグを false に更新
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8'); // 設定を保存
    }


    process.on('SIGINT', async () => {
        console.log(chalk.yellow('\nCtrl+C が押されました。終了処理を行います...'));
        if (secureShareNetProcess) {
            secureShareNetProcess.kill('SIGINT');
        }
        process.exit(0);
    });

    try {
        await startSecureShareNet(config); // 設定を渡す
    } catch (error) {
        console.error(chalk.red('起動中にエラーが発生しました:'), error);
        // エラーが発生した場合でも securesharenet を停止
        if (secureShareNetProcess) {
            secureShareNetProcess.kill('SIGINT');
        }
        process.exit(1);  // エラーコードで終了
    } finally {
        // 予期せぬエラーで強制終了されても、確実に securesharenet を停止する
        process.on('exit', () => {
            if (secureShareNetProcess) {
                console.log(chalk.red('予期せぬ終了が発生しました。securesharenetを停止します'));
                secureShareNetProcess.kill('SIGINT');
            }
        });
    }
}

main();