import * as fs from 'fs';
import chalk from 'chalk';
import { execSync } from 'child_process';
import * as readline from 'readline';
import * as os from 'os';

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
        // Check if package.json, tsconfig.json, src folder, and global.d.ts exist
        await fs.promises.access('package.json');
        await fs.promises.access('tsconfig.json');
        await fs.promises.access('src');
        await fs.promises.access('global.d.ts');
        return true;
    } catch (error) {
        return false;
    }
}

async function removeReadOnlyAttribute(filePath: string): Promise<void> {
    try {
        if (os.platform() === 'win32') {
            execSync(`attrib -r "${filePath}"`); // Windows
        } else {
            execSync(`chmod +w "${filePath}"`); // Linux and macOS
        }
    } catch (error) {
        console.warn(chalk.yellow(`Failed to remove read-only attribute from ${filePath}:`), error);
    }
}


async function installTypeScriptEnvironment(): Promise<void> {
    try {
        await fs.promises.mkdir('src', { recursive: true });

        const globalDTsContent = `import * as Server from "@minecraft/server";
import * as ServerUi from "@minecraft/server-ui";

declare global {
  var console: Console;
  interface Console {
    log: (...arg: any) => void;
    error: (...arg: any) => void;
    warn: (...arg: any) => void;
  }
}`;
        await fs.promises.writeFile('global.d.ts', globalDTsContent);
        await removeReadOnlyAttribute('global.d.ts');

        const indexTsContent = 'console.log("helloworld");';
        await fs.promises.writeFile('src/index.ts', indexTsContent);
        await removeReadOnlyAttribute('src/index.ts');

        const packageJsonContent = `{
            "name": "minecraft-script",
            "version": "1.0.0",
            "description": "Minecraft Bedrock Script",
            "scripts": {
              "watch": "tsc --watch --project ./tsconfig.json"
            },
            "author": "koukunn_",
            "license": "MIT",
            "devDependencies": {
              "typescript": "*"
            }
          }`;
        await fs.promises.writeFile('package.json', packageJsonContent);
        await removeReadOnlyAttribute('package.json');


        await fs.promises.writeFile('tsconfig.json', tsConfigContent);
        await removeReadOnlyAttribute('tsconfig.json');


        console.log(chalk.yellow('Installing dependencies...'));
        execSync('npm install @minecraft/server @minecraft/server-ui typescript', { stdio: 'inherit' });

        console.log(chalk.green('TypeScript environment setup complete!'));
    } catch (error) {
        console.error(chalk.red('Failed to setup TypeScript environment:'), error);
        process.exit(1);
    }
}

async function startWatch(): Promise<void> {
    console.log(chalk.yellow('既にセットアップ済みの環境を検出しました。tsc --watch を開始します...'));
    try {
        execSync('npm run watch', { stdio: 'inherit' });  // Start the watch script
    } catch (error) {
        console.error(chalk.red('tsc --watch の実行に失敗しました:'), error);
        process.exit(1);
    }
}

async function main() {

    if (!await checkNodeInstallation()) {
        console.log(chalk.red('Node.js がインストールされていません。'));
        console.log(chalk.yellow('Node.js を https://nodejs.org/ja からダウンロードしてインストールしてください。'));
        process.exit(1);
    }

    if (await isEnvironmentSetup()) {
        await startWatch();
        process.exit(0); // Exit after starting watch
    }

    await installTypeScriptEnvironment();

    console.log(chalk.green("TypeScript 環境のセットアップが完了しました。'npm run watch' を実行して TypeScript コンパイラを開始してください。"));

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    rl.question(chalk.blue('Enterキーを押して終了してください...'), () => {
        rl.close();
    });
}

main();