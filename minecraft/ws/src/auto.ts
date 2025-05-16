import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn, ChildProcess } from 'child_process';

// --- 設定 ---
const librariesToInstall: string[] = ['socket-be']; // インストールしたいライブラリ
const targetJavaScriptFile: string = 'beta.js'; // 起動したいJSファイル
const projectRoot: string = process.cwd(); // このスクリプトがあるディレクトリをプロジェクトルートとする
const packageJsonPath: string = path.join(projectRoot, 'package.json');
const nodeModulesPath: string = path.join(projectRoot, 'node_modules');

// --- ヘルパー関数 ---

/**
 * コマンドを同期的に実行し、標準出力を返す
 */
function runCommandSync(command: string, cwd: string = projectRoot): string {
    try {
        console.log(`Executing: ${command} in ${cwd}`);
        const output = execSync(command, { cwd, encoding: 'utf8' });
        console.log(output);
        return output;
    } catch (error: any) {
        console.error(`Error executing command: ${command}`);
        console.error(error.stderr || error.message);
        throw error;
    }
}

/**
 * ライブラリがインストールされているか簡易的にチェック
 * (node_modules にディレクトリが存在するかで判断)
 */
function isLibraryInstalled(libraryName: string): boolean {
    return fs.existsSync(path.join(nodeModulesPath, libraryName));
}

/**
 * package.json が存在しなければ初期化する
 */
function ensurePackageJson(): void {
    if (!fs.existsSync(packageJsonPath)) {
        console.log('package.json not found. Initializing...');
        runCommandSync('npm init -y');
    }
}

/**
 * 必要なライブラリをインストールする
 */
async function installDependencies(dependencies: string[]): Promise<void> {
    const missingDependencies = dependencies.filter(dep => !isLibraryInstalled(dep));

    if (missingDependencies.length > 0) {
        console.log(`Installing missing dependencies: ${missingDependencies.join(', ')}...`);
        // npm install <lib1> <lib2> ... --save
        // --save オプションで package.json の dependencies にも追加する
        runCommandSync(`npm install ${missingDependencies.join(' ')} --save`);
        console.log('Dependencies installed.');
    } else {
        console.log('All required dependencies are already installed.');
    }
}

/**
 * 指定されたJavaScriptファイルを実行する
 */
function launchScript(scriptPath: string): ChildProcess {
    const fullScriptPath = path.join(projectRoot, scriptPath);
    if (!fs.existsSync(fullScriptPath)) {
        console.error(`Target script not found: ${fullScriptPath}`);
        process.exit(1);
    }

    console.log(`Launching script: ${fullScriptPath}...`);
    const child = spawn(process.platform === "win32" ? "node.exe" : "node", [fullScriptPath], {
        cwd: projectRoot,
        stdio: 'inherit', // 親プロセスの標準入出力を共有
    });

    child.on('error', (error) => {
        console.error(`Failed to start script: ${error.message}`);
    });

    child.on('close', (code) => {
        console.log(`Target script exited with code ${code}`);
    });

    return child;
}

// --- メイン処理 ---
async function main() {
    try {
        console.log('Starting setup process...');

        // 0. Node.js の存在確認 (簡易的)
        try {
            runCommandSync('node -v');
        } catch (error) {
            console.error("Node.js does not seem to be installed or not in PATH.");
            console.error("Please install Node.js manually and try again.");
            process.exit(1);
        }

        // 1. package.json の確認と初期化 (任意)
        ensurePackageJson();

        // 2. 必要なライブラリのインストール
        await installDependencies(librariesToInstall);

        // 3. 指定されたJSファイルの起動
        launchScript(targetJavaScriptFile);

    } catch (error) {
        console.error('An error occurred during the setup process:');
        if (error instanceof Error) {
            console.error(error.message);
        } else {
            console.error(error);
        }
        process.exit(1);
    }
}

main();