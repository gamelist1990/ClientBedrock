import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import archiver from 'archiver';
import chalk from 'chalk';
import CliTable from 'cli-table3';

const minecraftWorldsPath = path.join(
    process.env.LOCALAPPDATA || '',
    'Packages',
    'Microsoft.MinecraftUWP_8wekyb3d8bbwe',
    'LocalState',
    'games',
    'com.mojang',
    'minecraftWorlds'
);

async function getWorlds(): Promise<{ path: string; name: string; lastModified: Date }[]> {
    try {
        const worldDirectories = await fs.promises.readdir(minecraftWorldsPath);
        const worlds: { path: string; name: string; lastModified: Date }[] = [];

        for (const dir of worldDirectories) {
            const worldPath = path.join(minecraftWorldsPath, dir);
            const levelNamePath = path.join(worldPath, 'levelname.txt');
            // console.log(levelNamePath) 

            try {
                await fs.promises.access(levelNamePath, fs.constants.F_OK | fs.constants.R_OK);

                const worldName = (await fs.promises.readFile(levelNamePath, 'utf-8')).trim();

                const stats = await fs.promises.stat(worldPath);
                const lastModified = stats.mtime;
                worlds.push({ path: worldPath, name: worldName, lastModified: lastModified });
            } catch (error: any) {
                if (error.code === 'ENOENT') {
                } else {
                    console.warn(`ワールド ${dir} の読み込みに失敗しました: ${error}`);
                    console.warn(`詳細:`);
                    console.warn(`  worldPath: ${worldPath}`);
                    console.warn(`  levelNamePath: ${levelNamePath}`);
                    try {
                        const stats = await fs.promises.stat(worldPath);
                        console.warn(`  worldPath の stat: ${JSON.stringify(stats)}`);
                    } catch (statError) {
                        console.warn(`  worldPath の stat の取得に失敗: ${statError}`);
                    }
                }
                continue;
            }
        }
        worlds.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());


        return worlds;
    } catch (error) {
        console.error('Minecraftワールドディレクトリの読み込みエラー:', error);
        return [];
    }
}

async function backupWorld(worldPath: string, backupDirectory: string): Promise<void> {
    const worldName = path.basename(worldPath);
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 14);
    const backupFilePath = path.join(backupDirectory, `${worldName}_${timestamp}.zip`);

    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(backupFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            logMessage(chalk.green(`${worldName}のバックアップが完了しました: ${backupFilePath}`));
            resolve();
        });

        archive.on('error', (err) => {
            console.error(chalk.red('バックアップエラー:'), err);
            reject(err);
        });

        archive.pipe(output);
        archive.directory(worldPath, false);
        archive.finalize();
    });
}

async function manageBackupFiles(backupDirectory: string, maxBackups: number): Promise<void> {
    const files = await fs.promises.readdir(backupDirectory);
    const zipFiles = files.filter(file => file.endsWith('.zip'));

    if (zipFiles.length > maxBackups) {
        const filePaths = zipFiles.map(file => path.join(backupDirectory, file));
        filePaths.sort((a, b) => fs.statSync(a).mtime.getTime() - fs.statSync(b).mtime.getTime());

        const filesToDelete = filePaths.slice(0, zipFiles.length - maxBackups);

        for (const fileToDelete of filesToDelete) {
            await fs.promises.unlink(fileToDelete);
            logMessage(chalk.yellow(`古いバックアップファイルを削除しました: ${fileToDelete}`));
        }
    }
}

interface LogEntry {
    time: string;
    message: string;
}

let logMessages: LogEntry[] = [];

function logMessage(message: string) {
    const now = new Date();
    const time = now.toLocaleTimeString();
    logMessages.push({ time, message });
    if (logMessages.length > 5) {
        logMessages.shift();
    }
}

async function startBackupProcess(worldPath: string, backupDirectory: string, backupIntervalMinutes: number, maxBackups: number) {
    let nextBackupTime: Date = new Date(Date.now() + backupIntervalMinutes * 60 * 1000);

    async function runBackup() {
        try {
            await backupWorld(worldPath, backupDirectory);
            await manageBackupFiles(backupDirectory, maxBackups);
            nextBackupTime = new Date(Date.now() + backupIntervalMinutes * 60 * 1000);
        } catch (error) {
            console.error(chalk.red("バックアップ処理中にエラーが発生しました:"), error);
        }
    }

    await runBackup();

    setInterval(async () => {
        await runBackup();
        displayLogAndNextBackupTime();
    }, backupIntervalMinutes * 60 * 1000);

    console.log(chalk.blue(`自動バックアップを開始しました。${backupIntervalMinutes}分ごとにバックアップします。`));
    displayLogAndNextBackupTime();
    setInterval(displayLogAndNextBackupTime, 1000);

    function displayLogAndNextBackupTime() {
        const now = new Date();
        const timeLeft = nextBackupTime.getTime() - now.getTime();
        const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        const secondsLeft = Math.floor((timeLeft % (1000 * 60)) / 1000);

        console.clear();
        console.log(chalk.bold.underline.white('Minecraftバックアップ画面(Create By koukunn_)'));
        console.log(chalk.gray('---------------------'));

        if (logMessages.length > 0) {
            const logTable = new CliTable({
                head: [chalk.bold.white('時間'), chalk.bold.white('ログ')],
                colWidths: [15, 45],
            });
            logMessages.forEach(log => logTable.push([chalk.gray(log.time), log.message]));
            console.log(logTable.toString());
        }

        const timeTable = new CliTable({
            head: [chalk.bold.cyan('次のバックアップまで')],
            colWidths: [40],
        });
        timeTable.push([chalk.green(`${minutesLeft}分 ${secondsLeft}秒`)]);
        console.log(timeTable.toString());
    }
}

async function main() {
    const worlds = await getWorlds();
    if (!worlds.length) {
        console.log(chalk.red('Minecraftワールドが見つかりませんでした。'));
        return;
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log(chalk.bold('Minecraftワールド選択(Create By koukunn_)'));
    console.log(chalk.gray('---------------------'));

    const table = new CliTable({
        head: [chalk.bold.white('番号'), chalk.bold.white('ワールド名'), chalk.bold.white('最終更新日')],
        colWidths: [10, 40, 25],
        style: { head: ['white'], border: ['white'] }
    });

    for (const [i, world] of worlds.entries()) {
        const formattedDate = world.lastModified.toLocaleDateString();
        table.push([chalk.yellow((i + 1).toString()), world.name, chalk.blue(formattedDate)]);
    }

    console.log(table.toString());

    const selectedWorldIndex = await new Promise<number>((resolve) => {
        rl.question(chalk.green('バックアップするワールドの番号を入力してください (qで終了): '), (answer) => {
            if (answer.toLowerCase() === 'q') {
                resolve(-1);
            } else {
                const index = parseInt(answer) - 1;
                resolve(isNaN(index) || index < 0 || index >= worlds.length ? NaN : index);
            }
        });
    }).then(index => {
        if (isNaN(index)) {
            console.log(chalk.red("無効な入力だったため終了します。"));
            rl.close();
            process.exit(1);
        }
        return index;
    });

    if (selectedWorldIndex === -1) {
        console.log('終了します。');
        rl.close();
        return;
    }

    const selectedWorld = worlds[selectedWorldIndex];
    console.log(chalk.green(`選択されたワールド: ${selectedWorld.name}`));

    const backupInterval = await new Promise<number>((resolve) => {
        rl.question(chalk.cyan('バックアップ間隔を分単位で入力してください (最小1): '), (answer) => {
            const interval = parseInt(answer);
            resolve(isNaN(interval) || interval < 1 ? 1 : interval);
        });
    });

    const maxBackupCount = await new Promise<number>((resolve) => {
        rl.question(chalk.magenta('バックアップファイルの最大保持数を入力してください (最小1, 最大10): '), (answer) => {
            const count = parseInt(answer);
            const result = isNaN(count) || count < 1 ? 1 : count > 10 ? 10 : count;
            rl.close();
            resolve(result);
        });
    });

    const scriptDirectory = process.cwd();
    const backupDirectory = path.join(scriptDirectory, 'backup');

    try {
        await fs.promises.mkdir(backupDirectory, { recursive: true });
        console.log(chalk.green(`バックアップディレクトリを作成しました: ${backupDirectory}`));
    } catch (error: any) {
        console.error(chalk.red('バックアップディレクトリの作成に失敗しました:'), error);
        return;
    }

    startBackupProcess(selectedWorld.path, backupDirectory, backupInterval, maxBackupCount);
}

main();