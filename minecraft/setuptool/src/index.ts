import * as fs from 'fs';
import chalk from 'chalk';
import { execSync } from 'child_process';
import * as os from 'os';
import inquirer from 'inquirer';
import * as readline from 'readline';

const tsConfigContent = `{
    "include": [
        "src/**/*.ts",
        "global.d.ts"
    ],
    "exclude": [
        "node_modules"
    ],
    "watchOptions": {
        "excludeDirectories": [
            "node_modules"
        ]
    },
    "libChecking": true,
    "compilerOptions": {
        "target": "ESNext",
        "module": "ESNext",
        "moduleResolution": "node",
        "lib": [
            "ESNext",
            "DOM"
        ],
        "typeRoots": [
            "./node_modules/@minecraft",
            "./node_modules/@types"
        ],
        "noEmit": false,
        "emitDecoratorMetadata": true,
        "experimentalDecorators": true,
        "strict": true,
        "allowJs": true,
        "checkJs": true,
        "outDir": "./addon/scripts",
        "strictNullChecks": true,
        "strictFunctionTypes": true,
        "strictPropertyInitialization": true,
        "strictBindCallApply": true,
        "noImplicitReturns": false,
        "noUnusedLocals": true,
        "noImplicitAny": false,
        "alwaysStrict": true,
        "noFallthroughCasesInSwitch": true,
        "noImplicitThis": true,
        "noUnusedParameters": true,
        "sourceMap": false,
        "removeComments": true,
        "allowSyntheticDefaultImports": true
    }
}`;


async function checkNodeInstallation(): Promise<boolean> {
    try {
        execSync('node -v', { stdio: 'ignore' });
        return true;
    } catch (error) {
        return false;
    }
}

async function isEnvironmentSetup(): Promise<boolean> {
    try {
        await fs.promises.access('package.json');
        await fs.promises.access('tsconfig.json');
        await fs.promises.access('src');
        await fs.promises.access('global.d.ts');
        await fs.promises.access('node_modules/@minecraft/server');
        return true;
    } catch (error) {
        return false;
    }
}


async function removeReadOnlyAttribute(filePath: string): Promise<void> {
    try {
        if (os.platform() === 'win32') {
            execSync(`attrib -r "${filePath}"`);
        } else {
            execSync(`chmod +w "${filePath}"`);
        }
    } catch (error) {
        console.warn(chalk.yellow(`警告: ${filePath} の読み取り専用属性の解除に失敗しました。アクセス許可を確認してください。`), error instanceof Error ? error.message : error);
    }
}

async function pressEnterToContinue(): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(chalk.gray('\nEnterキーを押して終了...'), () => {
            rl.close();
            resolve();
        });
    });
}


async function installTypeScriptEnvironment(): Promise<void> {
    console.log(chalk.blue('TypeScript 開発環境をセットアップしています...'));
    try {
        console.log(chalk.cyan('  - 必要なディレクトリとファイルを作成中...'));
        await fs.promises.mkdir('src', { recursive: true });

        const globalDTsContent = `//使用しなくてOk`;
        await fs.promises.writeFile('global.d.ts', globalDTsContent);
        await removeReadOnlyAttribute('global.d.ts');

        const indexTsContent = `import { world, system } from "@minecraft/server";

console.log("スクリプトが読み込まれました サンプルコード//");

system.runInterval(() => {
}, 20);

world.afterEvents.worldInitialize.subscribe(() => {
  console.log("World Initialized!");
  world.sendMessage("§aTypeScriptスクリプトが正常に動作しています！");
});
`;
        await fs.promises.writeFile('src/index.ts', indexTsContent);
        await removeReadOnlyAttribute('src/index.ts');

        const packageJsonContent = `{
            "name": "minecraft-script",
            "version": "1.0.0",
            "description": "Minecraft Bedrock スクリプト",
            "type": "module",
            "scripts": {
              "build": "tsc --project ./tsconfig.json",
              "watch": "tsc --watch --project ./tsconfig.json",
              "setup": "node setup.js"
            },
            "author": "あなたの名前",
            "license": "MIT",
            "devDependencies": {
              "typescript": "^5.0.0",
              "inquirer": "^9.2.0",
              "@types/inquirer": "^9.0.7"
            },
            "dependencies": {
              "@minecraft/server": "latest",
              "@minecraft/server-ui": "latest",
              "chalk": "^5.3.0"
            }
          }`;
        await fs.promises.writeFile('package.json', packageJsonContent);
        await removeReadOnlyAttribute('package.json');

        await fs.promises.writeFile('tsconfig.json', tsConfigContent);
        await removeReadOnlyAttribute('tsconfig.json');

        console.log(chalk.yellow('\n  - 依存関係をインストールしています (npm install)... しばらくお待ちください...'));
        execSync('npm install', { stdio: 'inherit' });
        console.log(chalk.green('  - 依存関係のインストールが完了しました。'));

        console.log(chalk.green('\nTypeScript 開発環境のセットアップが完了しました！'));
        console.log(chalk.cyan("\n次のステップ:"));
        console.log(chalk.cyan("  1. コマンドプロンプトやターミナルで 'npm run watch' を実行して、TypeScriptファイルの変更を監視・自動コンパイルします。"));
        console.log(chalk.cyan("  2. src/index.ts などのファイルを編集してスクリプト開発を開始します。"));
        console.log(chalk.cyan("  3. 必要に応じて、このスクリプト (node setup.js) を再度実行してモジュールを更新できます。"));

        console.log(chalk.blue('\nセットアップ スクリプトを終了します。'));
        await pressEnterToContinue();

    } catch (error) {
        console.error(chalk.red('\nTypeScript 開発環境のセットアップ中にエラーが発生しました:'), error);
        console.log(chalk.red('エラーが発生したため、セットアップを中断しました。'));
        await pressEnterToContinue();
        process.exit(1);
    }
}

async function startWatch(): Promise<void> {
    console.log(chalk.cyan('\nTypeScript コンパイラを監視モード (tsc --watch) で起動します...'));
    try {
        execSync('npm run watch', { stdio: 'inherit' });
        console.log(chalk.yellow("watch プロセスが終了しました。"));
    } catch (error) {
        console.log(chalk.yellow("watch プロセスが停止しました。"));
    }
}

interface NpmVersionInfo {
    version: string;
    tag?: string;
}

async function getPackageVersions(packageName: string): Promise<NpmVersionInfo[]> {
    try {
        console.log(chalk.blue(`${packageName} のバージョン情報 (latest/beta/rc) を取得しています...`));
        const tagsJson = execSync(`npm view ${packageName} dist-tags --json`, { encoding: 'utf8' });
        const tags: { [key: string]: string } = JSON.parse(tagsJson);

        let taggedVersionInfo: NpmVersionInfo[] = [];
        const includedVersions = new Set<string>();

        for (const tag in tags) {
            if (tag === 'latest' || tag === 'beta' || tag === 'rc') {
                const version = tags[tag];
                if (version && !includedVersions.has(version)) {
                    taggedVersionInfo.push({ version: version, tag: tag });
                    includedVersions.add(version);
                }
            }
        }

        taggedVersionInfo.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true, sensitivity: 'base' }));

        if (taggedVersionInfo.length === 0) {
            console.log(chalk.yellow(`${packageName} に 'latest', 'beta', 'rc' タグを持つバージョンが見つかりませんでした。`));
        }

        return taggedVersionInfo;

    } catch (error) {
        console.error(chalk.red(`${packageName} のバージョン情報取得に失敗しました:`), error);
        return [];
    }
}

async function selectVersion(packageName: string, versions: NpmVersionInfo[]): Promise<string | null | undefined> {
    if (versions.length === 0) {
        console.log(chalk.yellow(`${packageName} の更新対象バージョンが見つかりません。スキップします。`));
        return null;
    }

    const skipChoice = { name: chalk.gray('このパッケージの更新をスキップ'), value: null };
    const cancelChoice = { name: chalk.red('キャンセルしてメニューに戻る'), value: undefined };
    const versionChoices = versions.map(v => {
        const tagString = v.tag ? chalk.magenta(` (${v.tag})`) : '';
        return {
            name: `${v.version}${tagString}`,
            value: v.version
        };
    });

    try {
        const { selectedVersion } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selectedVersion',
                message: `${chalk.bold(packageName)} のバージョンを選択してください (矢印キーで選択、Enterで決定):`,
                choices: [skipChoice, cancelChoice, new inquirer.Separator(), ...versionChoices],
                pageSize: versions.length + 4
            }
        ]);
        return selectedVersion;
    } catch (error) {
        return undefined;
    }
}

async function updateModules(): Promise<void> {
    let packagesToInstall: string[] = [];
    let cancelled = false;

    try {
        const serverVersions = await getPackageVersions('@minecraft/server');
        const selectedServerVersion = await selectVersion('@minecraft/server', serverVersions);

        if (selectedServerVersion === undefined) {
            cancelled = true;
        } else if (selectedServerVersion !== null) {
            packagesToInstall.push(`@minecraft/server@${selectedServerVersion}`);
        }

        if (!cancelled) {
            const serverUiVersions = await getPackageVersions('@minecraft/server-ui');
            const selectedServerUiVersion = await selectVersion('@minecraft/server-ui', serverUiVersions);

            if (selectedServerUiVersion === undefined) {
                cancelled = true;
            } else if (selectedServerUiVersion !== null) {
                packagesToInstall.push(`@minecraft/server-ui@${selectedServerUiVersion}`);
            }
        }

        if (!cancelled && packagesToInstall.length > 0) {
            const installCommand = 'npm install ' + packagesToInstall.join(' ');
            console.log(chalk.yellow(`\n実行中: ${installCommand}`));
            try {
                execSync(installCommand, { stdio: 'inherit' });
                console.log(chalk.green('モジュールの更新が完了しました！'));
            } catch (error) {
                console.error(chalk.red('選択されたモジュールのインストールに失敗しました:'), error);
            }
        } else if (cancelled) {
            console.log(chalk.yellow("\nバージョン選択がキャンセルされました。更新は行われません。"));
        } else {
            console.log(chalk.blue('\n更新対象のモジュールが選択されませんでした。'));
        }

    } catch (error) {
        console.error(chalk.red('\nモジュール更新プロセス中に予期せぬエラーが発生しました:'), error);
    }
}


async function main() {
    console.log(chalk.bold.hex('#FFA500')('Minecraft TypeScript セットアップ & ウォッチャー'));

    if (!await checkNodeInstallation()) {
        console.log(chalk.red('\nNode.js がインストールされていません。'));
        console.log(chalk.yellow('Node.js を https://nodejs.org/ja からダウンロードしてインストールしてください。'));
        await pressEnterToContinue();
        process.exit(1);
    }

    let envReady = await isEnvironmentSetup();

    if (!envReady) {
        console.log(chalk.yellow('\n必要なファイルが見つかりません。初回セットアップを開始します...'));
        await installTypeScriptEnvironment();
        process.exit(0);
    } else {
        console.log(chalk.green('\n既存の TypeScript 開発環境を検出しました。'));
        try {
            while (true) {
                const { action } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'action',
                        message: chalk.cyan('\n実行するアクションを選択してください:'),
                        choices: [
                            { name: 'TypeScript ウォッチャーを開始 (tsc --watch)', value: 'watch' },
                            { name: '@minecraft モジュールを更新', value: 'update' },
                            { name: '終了', value: 'exit' }
                        ],
                        loop: false
                    }
                ]);

                if (action === 'watch') {
                    await startWatch();
                    console.log(chalk.blue("\nメインメニューに戻ります (または終了します)。"));
                    return;
                } else if (action === 'update') {
                    await updateModules();
                    console.log(chalk.gray('\n(モジュール更新完了)'));
                } else if (action === 'exit') {
                    console.log(chalk.blue('\nスクリプトを終了します。'));
                    return;
                }
            }
        } catch (error) {
            if ((error as any).isTtyError) {
                console.log(chalk.yellow('\nプロンプトを表示できませんでした。TTY環境を確認してください。'));
            } else {
                console.log(chalk.yellow("\n操作がキャンセルまたは中断されました。"));
            }
            process.exit(0);
        }
    }
}

main().catch(error => {
    console.error(chalk.red('\nスクリプト実行中に予期せぬ致命的なエラーが発生しました:'), error);
    pressEnterToContinue().finally(() => {
        process.exit(1);
    });
});