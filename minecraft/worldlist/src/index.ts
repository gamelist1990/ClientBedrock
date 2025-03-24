import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import * as readline from 'readline';

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

function openExplorer(folderPath: string) {
    exec(`explorer "${folderPath}"`, (error) => {
        if (error) console.error('エクスプローラーでフォルダを開く際のエラー:', error);
    });
}

async function main() {
    const worlds = await getWorlds();
    if (!worlds.length) {
        console.log('Minecraftワールドが見つかりませんでした。');
        return;
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log('Minecraftワールド選択(Create By koukunn_)');
    console.log('---------------------');

    for (let i = 0; i < worlds.length; i++) {
        const world = worlds[i];
        const formattedDate = world.lastModified.toLocaleDateString();
        console.log(`${i + 1}. ${world.name} (最終更新日: ${formattedDate})`);
    }

    rl.question('開くワールドの番号を入力してください<1が最新> (または q で終了): ', (answer) => {
        rl.close();

        if (answer.toLowerCase() === 'q') {
            console.log('終了します。');
            return;
        }

        const selectedIndex = parseInt(answer) - 1;

        if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= worlds.length) {
            console.log('無効な番号です。');
            return;
        }

        openExplorer(worlds[selectedIndex].path);
    });
}

main();