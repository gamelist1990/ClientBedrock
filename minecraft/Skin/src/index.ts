import * as fs from 'fs';
import chalk from 'chalk';
import * as path from 'path';
import * as readline from 'readline';
import * as os from 'os';
import inquirer from 'inquirer';
import { execSync, spawn } from 'child_process';
import AdmZip from 'adm-zip';
import crypto from 'crypto';

const MINECRAFT_UWP_PACKAGE_ID = 'Microsoft.MinecraftUWP_8wekyb3d8bbwe';
const PREMIUM_CACHE_SKIN_PACKS_SUBPATH = ['AppData', 'Local', 'Packages', MINECRAFT_UWP_PACKAGE_ID, 'LocalState', 'premium_cache', 'skin_packs'];
const MANIFEST_FILENAME = 'manifest.json';
const MC_ENCRYPTOR_DIR_NAME = 'MCEnc';
const MC_ENCRYPTOR_EXE_NAME = 'McEncryptor.exe';
const TOTAL_MAIN_STEPS = 5;
const SAMPLE_CAPE_ZIP_URL = "https://pexserver.github.io/tool/File/GenSkin/index.html";

function printStepHeader(stepNumber: number, description: string) { console.log(chalk.cyan.bold(`\n===== ステップ ${stepNumber}/${TOTAL_MAIN_STEPS}: ${description} =====`)); }
function printSuccess(message: string) { console.log(chalk.green(`✅ ${message}`)); }
function printWarning(message: string) { console.log(chalk.yellow(`⚠️  ${message}`)); }
function printError(message: string) { console.log(chalk.red.bold(`❌ ${message}`)); }
function printInfo(message: string) { console.log(chalk.blue(`ℹ️ ${message}`)); }

async function pressEnterToContinue(message: string = '\nエンターキーを押して続行...'): Promise<void> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(chalk.gray(message), () => { rl.close(); resolve(); });
    });
}

function getSkinPacksBaseDir(): string | null {
    return os.platform() === 'win32' ? path.join(os.homedir(), ...PREMIUM_CACHE_SKIN_PACKS_SUBPATH) : null;
}

interface SkinPackInfo { name: string; path: string; isTemp?: boolean; originalMcpackPath?: string; }
interface SourcePackResult { path: string; isTemp?: boolean; }


async function scanSkinPacksStep(): Promise<SkinPackInfo[]> {
    printInfo(`Windowsインストール済みスキンパックをスキャン中...`);
    const skinPacksBaseDir = getSkinPacksBaseDir();
    if (!skinPacksBaseDir) {
        printError('Windows以外のプラットフォームでは、インストール済みスキンパックのスキャンはサポートされていません。');
        return [];
    }
    printInfo(`スキンパックディレクトリ: ${skinPacksBaseDir}`);
    try { await fs.promises.access(skinPacksBaseDir); }
    catch (error) {
        printError(`スキンパックディレクトリが見つかりません: ${skinPacksBaseDir}`);
        printWarning('パスが正しいか、Minecraft Bedrock版がインストールされているか確認してください。');
        return [];
    }
    const detectedSkinPacks: SkinPackInfo[] = [];
    const addedPackNames = new Set<string>(); // 追加済みのパック名を管理するSet

    try {
        const entries = await fs.promises.readdir(skinPacksBaseDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const skinPackDir = path.join(skinPacksBaseDir, entry.name);
                const manifestPath = path.join(skinPackDir, MANIFEST_FILENAME);
                try {
                    await fs.promises.access(manifestPath);
                    const manifestContent = await fs.promises.readFile(manifestPath, 'utf-8');
                    const manifestJson = JSON.parse(manifestContent);
                    const packName = manifestJson.header?.name || entry.name;
                    if (!addedPackNames.has(packName)) {
                        detectedSkinPacks.push({ name: packName, path: skinPackDir });
                        addedPackNames.add(packName); // 追加した名前をSetに記録
                    }
                } catch {
                }
            }
        }
    } catch (error) {
        printError(`スキンパックのディレクトリ読み取り中にエラー: ${skinPacksBaseDir}`);
        console.error(error); return [];
    }

    if (detectedSkinPacks.length > 0) {
        // 名前でソート
        detectedSkinPacks.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        printSuccess(`${detectedSkinPacks.length}個のユニークな名前のインストール済みスキンパックを検出しました。`);
    } else {
        printWarning('インストール済みスキンパックが見つかりませんでした。');
    }
    return detectedSkinPacks;
}
async function selectInstalledTargetSkinPack(skinPacks: SkinPackInfo[]): Promise<SkinPackInfo | null> {
    if (skinPacks.length === 0) return null;
    console.log(chalk.blue('\n--- 置き換え対象のインストール済みスキンパックを選択 ---'));
    const choices = skinPacks.map((pack, index) => ({
        name: `  ${index + 1}. ${pack.name}`, // パス情報を削除
        value: index,
    }));
    choices.push({ name: chalk.red('  キャンセル'), value: -1 } as any);
    const { selectedIndex } = await inquirer.prompt([{ type: 'list', name: 'selectedIndex', message: '置き換え先のスキンパックを選択:', choices, pageSize: Math.min(choices.length, 20) },]); // PageSize Increased
    if (selectedIndex === -1 || selectedIndex === undefined) {
        printInfo('スキンパックの選択がキャンセルされました。');
        return null;
    }
    const selectedPack = skinPacks[selectedIndex];
    printSuccess(`ターゲットスキンパック選択: ${selectedPack.name} (内部パス: ${selectedPack.path})`); // 内部パスはログに表示
    return selectedPack;
}

async function promptForMcpackFilePath(description: string): Promise<string | null> {
    printInfo(description);
    if (os.platform() !== 'win32') {
        printWarning('Windows以外の環境ではファイルダイアログは表示されません。パスを直接入力してください。');
        const { filePath } = await inquirer.prompt([{ type: 'input', name: 'filePath', message: '.mcpackファイルのフルパスを入力してください:' }]);
        return filePath || null;
    }
    const psCommand = `Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog -Prop @{Title="対象の .mcpack ファイルを選択";Filter="MCPACK (*.mcpack)|*.mcpack|ZIP (*.zip)|*.zip|All (*.*)|*.*";InitialDirectory=[System.Environment]::GetFolderPath('Desktop')}; if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){Write-Output $d.FileName}else{Write-Output "CANCELLED_FILE_SELECTION"}`;
    try {
        const encoded = Buffer.from(psCommand, 'utf16le').toString('base64');
        const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, { encoding: 'utf8', stdio: 'pipe' });
        const selPath = out.trim();
        if (selPath === "CANCELLED_FILE_SELECTION" || selPath === "") { printInfo('ファイル選択キャンセル'); return null; }
        if (fs.existsSync(selPath) && fs.lstatSync(selPath).isFile()) {
            if (!selPath.toLowerCase().endsWith('.mcpack') && !selPath.toLowerCase().endsWith('.zip')) {
                printWarning('選択されたファイルは .mcpack または .zip ではありませんが、処理を試みます。');
            }
            printSuccess(`.mcpack/zipファイルとして選択: ${selPath}`); return selPath;
        }
        printError(`無効なファイルパス: "${selPath}"`); return null;
    } catch (e) {
        printError('ファイル選択エラー。パスを手動入力してください。'); if (e instanceof Error) console.error(chalk.red(e.message));
        const { filePath } = await inquirer.prompt([{ type: 'input', name: 'filePath', message: '.mcpack/zipファイルのフルパス入力:' }]);
        return filePath || null;
    }
}

async function unpackMcpackToTempStep(mcpackPath: string): Promise<SkinPackInfo | null> {
    printInfo(`ファイルを一時ディレクトリに解凍中: ${mcpackPath}`);
    const tempDirSuffix = crypto.randomBytes(6).toString('hex');
    const tempDirPath = path.join(os.tmpdir(), `skinpack-temp-${tempDirSuffix}`);
    try {
        await fs.promises.mkdir(tempDirPath, { recursive: true });
        const zip = new AdmZip(mcpackPath);
        zip.extractAllTo(tempDirPath, true);
        printSuccess(`ファイルを一時ディレクトリに解凍: ${tempDirPath}`);
        let packName = path.basename(mcpackPath, path.extname(mcpackPath));
        try {
            const manifestContent = await fs.promises.readFile(path.join(tempDirPath, MANIFEST_FILENAME), 'utf-8');
            const manifestJson = JSON.parse(manifestContent);
            packName = manifestJson.header?.name || packName;
        } catch { printWarning(`manifest.jsonから名前読取不可。ファイル名使用: ${packName}`); }
        return { name: packName, path: tempDirPath, isTemp: true, originalMcpackPath: mcpackPath };
    } catch (error) {
        printError(`ファイル解凍エラー: ${mcpackPath}`); if (error instanceof Error) console.error(chalk.red(error.message));
        await fs.promises.rm(tempDirPath, { recursive: true, force: true }).catch(() => { });
        return null;
    }
}

async function selectSourceResourcePackStep(): Promise<SourcePackResult | null> {
    printStepHeader(2, '置き換え元リソースパックの選択');
    const { action } = await inquirer.prompt([
        {
            type: 'list', name: 'action', message: '置き換え元のリソースパックをどのように指定しますか？',
            choices: [
                { name: '既存の解凍済みフォルダを自分で選択する', value: 'select_folder_manual' },
                { name: `Webで生成した.mcpackファイルを指定 (URLを開きDL後、ファイル選択)`, value: 'select_mcpack_web' },
                new inquirer.Separator(), { name: 'キャンセル', value: 'cancel' },
            ], pageSize: 4,
        },
    ]);

    if (action === 'cancel') { printInfo('リソースパックの選択をキャンセルしました。'); return null; }

    if (action === 'select_mcpack_web') {
        printInfo(`ブラウザでスキンパック生成ツールを開きます: ${chalk.underline(SAMPLE_CAPE_ZIP_URL)}`);
        try {
            const openPackage = await import('open'); await openPackage.default(SAMPLE_CAPE_ZIP_URL);
            printInfo('URLを開きました。ツールで .mcpack を生成・ダウンロードしてください。');
            await pressEnterToContinue('ダウンロードが完了したら、エンターキーを押して、その .mcpack ファイルを選択する画面に進みます...');
        } catch (err) {
            printError('URL自動起動失敗。'); printWarning(`手動で ${chalk.underline(SAMPLE_CAPE_ZIP_URL)} へアクセスしDLしてください。`);
            if (err instanceof Error) console.error("詳細:", err.message);
            await pressEnterToContinue('準備ができたらエンターキーでファイル選択へ...');
        }
        const mcpackPath = await promptForMcpackFilePath('Webで生成・ダウンロードした .mcpack ファイルを選択:');
        if (!mcpackPath) { printInfo('.mcpack ファイル選択キャンセル'); return null; }

        printInfo(`.mcpackを一時ディレクトリに解凍中: ${mcpackPath}`);
        const tempDirSfx = crypto.randomBytes(6).toString('hex');
        const tempSrcPath = path.join(os.tmpdir(), `sourcepack-temp-${tempDirSfx}`);
        try {
            await fs.promises.mkdir(tempSrcPath, { recursive: true });
            new AdmZip(mcpackPath).extractAllTo(tempSrcPath, true);
            printSuccess(`.mcpackをソースとして一時ディレクトリに解凍: ${tempSrcPath}`);
            return { path: tempSrcPath, isTemp: true };
        } catch (e) {
            printError(`.mcpack解凍エラー: ${mcpackPath}`); if (e instanceof Error) console.error(chalk.red(e.message));
            await fs.promises.rm(tempSrcPath, { recursive: true, force: true }).catch(() => { }); return null;
        }
    } else if (action === 'select_folder_manual') {
        printInfo('置き換えに使用する既存の解凍済みリソースパックフォルダを選択...');
        if (os.platform() !== 'win32') {
            printWarning('Windows以外はファイルダイアログ非対応。パス手動入力。');
            const { fp } = await inquirer.prompt([{ type: 'input', name: 'fp', message: 'フォルダパス入力:' }]);
            if (!fp || !fs.existsSync(fp) || !fs.lstatSync(fp).isDirectory()) { printError('無効なパス'); return null; }
            printSuccess(`ソースフォルダ選択: ${fp}`); return { path: fp, isTemp: false };
        }
        const desc = '置き換えに使用する解凍済みリソースパックフォルダ (manifest.json を含む)';
        const psCmd = `Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog -Prop @{RootFolder='Desktop';Description='${desc.replace(/'/g, "''")}';ShowNewFolderButton=$false}; $o=New-Object System.Windows.Forms.NativeWindow; if($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK){Write-Output $d.SelectedPath}else{Write-Output "CANCELLED_FOLDER_SELECTION"}`;
        try {
            const enc = Buffer.from(psCmd, 'utf16le').toString('base64');
            const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${enc}`, { encoding: 'utf8', stdio: 'pipe' });
            const sp = out.trim();
            if (sp === "CANCELLED_FOLDER_SELECTION") { printInfo('フォルダ選択キャンセル'); return null; }
            if (sp && fs.existsSync(sp) && fs.lstatSync(sp).isDirectory()) { printSuccess(`ソースフォルダ選択: ${sp}`); return { path: sp, isTemp: false }; }
            printError(`無効パス: "${sp}"`); return null;
        } catch (e) {
            printError('フォルダ選択エラー。パス手動入力。'); if (e instanceof Error) console.error(chalk.red(e.message));
            const { fp } = await inquirer.prompt([{ type: 'input', name: 'fp', message: 'フォルダパス入力:' }]);
            if (!fp || !fs.existsSync(fp) || !fs.lstatSync(fp).isDirectory()) { printError('無効なパス'); return null; }
            printSuccess(`ソースフォルダ選択: ${fp}`); return { path: fp, isTemp: false };
        }
    }
    return null;
}

async function validateSourcePack(sourceFolderPath: string): Promise<boolean> {
    const sourceManifestPath = path.join(sourceFolderPath, MANIFEST_FILENAME);
    try { await fs.promises.access(sourceManifestPath); printInfo(`  ✔️ ソース内 '${MANIFEST_FILENAME}' 確認`); return true; }
    catch { printError(`ソースフォルダに '${MANIFEST_FILENAME}' 無し`); printWarning(`パス: ${sourceFolderPath}`); return false; }
}

async function replaceSkinPackContentsStep(targetPack: SkinPackInfo, sourceFolderPath: string): Promise<boolean> {
    printStepHeader(3, `スキンパック '${targetPack.name}' の内容置き換え`);
    printInfo(`  ターゲット: ${targetPack.path}`); printInfo(`  ソース:     ${sourceFolderPath}`);
    const { confirmReplace } = await inquirer.prompt([{ type: 'confirm', name: 'confirmReplace', message: chalk.red.bold('本当に内容を置き換えますか？元に戻せません。'), default: false }]);
    if (!confirmReplace) { printInfo('置き換えキャンセル'); return false; }
    try {
        printInfo(`  - 既存コンテンツ削除中 (${MANIFEST_FILENAME}除く)...`);
        const entries = await fs.promises.readdir(targetPack.path);
        for (const entry of entries) {
            if (entry.toLowerCase() !== MANIFEST_FILENAME.toLowerCase()) {
                await fs.promises.rm(path.join(targetPack.path, entry), { recursive: true, force: true });
            }
        }
        printSuccess('  - 既存コンテンツ削除完了');
    } catch (e) { printError('既存コンテンツ削除エラー'); if (e instanceof Error) console.error(chalk.red(e.message)); return false; }
    try {
        printInfo(`  - 新コンテンツコピー中 (${MANIFEST_FILENAME}除く)...`);
        await fs.promises.cp(sourceFolderPath, targetPack.path, { recursive: true, filter: (src) => path.basename(src).toLowerCase() !== MANIFEST_FILENAME.toLowerCase() });
        printSuccess(`スキンパック '${targetPack.name}' 置き換え完了`); return true;
    } catch (e) { printError('コピーエラー'); if (e instanceof Error) console.error(chalk.red(e.message)); return false; }
}

async function repackAndSaveMcpackStep(tempPackDir: string, originalMcpackPath: string): Promise<boolean> {
    const mcEncryptorExists = fs.existsSync(path.join(process.cwd(), MC_ENCRYPTOR_DIR_NAME, MC_ENCRYPTOR_EXE_NAME));
    printStepHeader(TOTAL_MAIN_STEPS - (mcEncryptorExists ? 0 : 1), '変更スキンパックの再圧縮と保存');
    const defaultNewFileName = originalMcpackPath.replace(/(\.mcpack|\.zip)$/i, `_modified${path.extname(originalMcpackPath)}`);
    const { saveAction, newFilePath } = await inquirer.prompt([
        { type: 'list', name: 'saveAction', message: '変更スキンパック保存方法:', choices: [{ name: `元ファイルを上書き (${originalMcpackPath})`, value: 'overwrite' }, { name: '新ファイルとして保存', value: 'save_as_new' }, { name: '保存せず終了', value: 'cancel' }] },
        { type: 'input', name: 'newFilePath', message: '新MCPACKファイルパス名入力 (.mcpack含):', default: defaultNewFileName, when: (ans) => ans.saveAction === 'save_as_new', validate: (inp) => inp.trim() !== "" || "パスは空にできません" }
    ]);
    if (saveAction === 'cancel') { printInfo('保存キャンセル。一時ファイル削除。'); return false; }
    let outputPath = saveAction === 'overwrite' ? originalMcpackPath : newFilePath;
    if (!outputPath) { printError('保存パス無効'); return false; }
    if (!outputPath.toLowerCase().endsWith('.mcpack')) outputPath += '.mcpack';
    printInfo(`再圧縮中: ${tempPackDir} -> ${outputPath}`);
    try {
        const zip = new AdmZip(); zip.addLocalFolder(tempPackDir); zip.writeZip(outputPath);
        printSuccess(`変更スキンパック保存完了: ${outputPath}`); return true;
    } catch (e) { printError(`再圧縮/保存エラー: ${outputPath}`); if (e instanceof Error) console.error(chalk.red(e.message)); return false; }
}

async function runMcEncryptorStep(targetPackPath: string): Promise<boolean> {
    const scriptDir = process.cwd();
    const mcEncryptorExePath = path.join(scriptDir, MC_ENCRYPTOR_DIR_NAME, MC_ENCRYPTOR_EXE_NAME);
    if (!fs.existsSync(mcEncryptorExePath)) {
        printStepHeader(TOTAL_MAIN_STEPS, `'${MC_ENCRYPTOR_EXE_NAME}' スキップ`); // Final step if enc not exists
        printWarning(`'${MC_ENCRYPTOR_EXE_NAME}' が見つかりません (${mcEncryptorExePath})。このステップをスキップします。`);
        return true;
    }
    printStepHeader(TOTAL_MAIN_STEPS, `'${MC_ENCRYPTOR_EXE_NAME}' による暗号化`);
    printInfo(`'${MC_ENCRYPTOR_EXE_NAME}' パス: ${mcEncryptorExePath}`);
    printInfo(`起動しパス '${targetPackPath}' を入力...`);
    return new Promise((resolvePromise) => {
        const proc = spawn(mcEncryptorExePath, [], { cwd: path.dirname(mcEncryptorExePath), stdio: ['pipe', 'inherit', 'inherit'] });
        if (proc.stdin) { proc.stdin.write(targetPackPath + os.EOL); proc.stdin.end(); }
        else { printError("McEncryptor標準入力アクセス不可"); resolvePromise(false); return; }
        proc.on('close', (c) => { if (c === 0) { printSuccess(`'${MC_ENCRYPTOR_EXE_NAME}' 処理完了`); resolvePromise(true); } else { printError(`'${MC_ENCRYPTOR_EXE_NAME}' エラー終了 ${c}`); resolvePromise(false); } });
        proc.on('error', (e) => { printError(`'${MC_ENCRYPTOR_EXE_NAME}' 起動/実行エラー`); console.error(e); resolvePromise(false); });
    });
}

async function cleanupTempDirStep(tempDirPath: string | undefined | null) {
    if (tempDirPath && fs.existsSync(tempDirPath)) {
        printInfo(`一時ディレクトリ掃除中: ${tempDirPath}`);
        try { await fs.promises.rm(tempDirPath, { recursive: true, force: true }); printSuccess('一時ディレクトリ掃除完了'); }
        catch (e) { printWarning(`一時ディレクトリ掃除エラー: ${tempDirPath}`); if (e instanceof Error) console.error(chalk.yellow(e.message)); }
    }
}

async function main() {
    console.log(chalk.bold.hex('#FFA500')('Minecraft スキンパック自動置き換え & 暗号化ツール'));
    printStepHeader(1, '置き換え対象スキンパックの選択');
    const { targetType } = await inquirer.prompt([{
        type: 'list', name: 'targetType', message: '置き換え対象スキンパック指定方法:',
        choices: [{ name: 'インストール済パックから選択(Win)', value: 'installed' }, { name: 'MCPACKファイル(.mcpack)指定', value: 'mcpack_file' }, { name: '解凍済スキンパックフォルダ指定', value: 'folder' }, new inquirer.Separator(), { name: 'キャンセル', value: 'cancel' }],
    }]);
    let targetPackInfo: SkinPackInfo | null = null;
    if (targetType === 'cancel') { printInfo('処理キャンセル'); await pressEnterToContinue(); return; }
    if (targetType === 'installed') {
        const iPs = await scanSkinPacksStep(); if (iPs.length === 0) { await pressEnterToContinue(); return; } targetPackInfo = await selectInstalledTargetSkinPack(iPs);
    } else if (targetType === 'mcpack_file') {
        const mcPath = await promptForMcpackFilePath('対象 .mcpack ファイル選択:'); if (mcPath) { targetPackInfo = await unpackMcpackToTempStep(mcPath); }
    } else if (targetType === 'folder') {
        printInfo('対象の解凍済スキンパックフォルダ選択...');
        const fPResult = await selectSourceResourcePackStep(); // Re-using this function makes sense if it returns { path: string, isTemp: boolean }
        // but the "Webで生成" option should not be available here
        // Let's assume for now this function can be adapted or a simpler folder chooser is used
        if (fPResult && !fPResult.isTemp) { // Only accept non-temporary folders as target
            let pName = path.basename(fPResult.path);
            try { pName = JSON.parse(await fs.promises.readFile(path.join(fPResult.path, MANIFEST_FILENAME), 'utf-8')).header?.name || pName; } catch { printWarning(`manifestから名前読取不可、フォルダ名使用: ${pName}`); }
            targetPackInfo = { name: pName, path: fPResult.path, isTemp: false };
        }
    }

    if (!targetPackInfo) { printError('ターゲット未選択/無効'); await pressEnterToContinue(); return; }
    printSuccess(`ターゲット選択完了: '${targetPackInfo.name}' (処理パス: ${targetPackInfo.path})`);

    let sourcePackResult: SourcePackResult | null = await selectSourceResourcePackStep();
    let tempSourcePathToClean: string | undefined = undefined;
    if (sourcePackResult?.isTemp) tempSourcePathToClean = sourcePackResult.path;

    if (!sourcePackResult) { await pressEnterToContinue(); await cleanupTempDirStep(targetPackInfo.isTemp ? targetPackInfo.path : null); return; }

    const isSrcValid = await validateSourcePack(sourcePackResult.path);
    if (!isSrcValid) { await pressEnterToContinue(); await cleanupTempDirStep(targetPackInfo.isTemp ? targetPackInfo.path : null); await cleanupTempDirStep(tempSourcePathToClean); return; }

    const replSuccess = await replaceSkinPackContentsStep(targetPackInfo, sourcePackResult.path);
    if (!replSuccess) { printWarning('置換失敗'); await pressEnterToContinue(); await cleanupTempDirStep(targetPackInfo.isTemp ? targetPackInfo.path : null); await cleanupTempDirStep(tempSourcePathToClean); return; }

    const encSuccess = await runMcEncryptorStep(targetPackInfo.path);

    let finalMsg = chalk.bold.green('\n🎉 処理ほぼ完了！');
    if (targetPackInfo.isTemp && targetPackInfo.originalMcpackPath) {
        const repackOk = await repackAndSaveMcpackStep(targetPackInfo.path, targetPackInfo.originalMcpackPath);
        if (repackOk) finalMsg = chalk.bold.green('\n🎉 全処理完了！');
        else { finalMsg = chalk.bold.yellow('\n⚠️ 再圧縮/保存失敗。一時フォルダに変更は適用済: ' + targetPackInfo.path); printWarning("手動で .mcpack に圧縮後、一時フォルダを削除ください。"); await pressEnterToContinue("Enterで一時フォルダ削除へ..."); }
    } else {
        if (encSuccess) finalMsg = chalk.bold.green('\n🎉 全処理完了！');
        else finalMsg = chalk.bold.yellow('\n⚠️ 暗号化で問題発生の可能性');
    }

    await cleanupTempDirStep(targetPackInfo.isTemp ? targetPackInfo.path : null);
    await cleanupTempDirStep(tempSourcePathToClean);
    console.log(finalMsg);
    await pressEnterToContinue('Enterで終了...');
}

main().catch(async (e) => {
    printError('スクリプト実行中 予期せぬ致命的エラー');
    if (e instanceof Error) console.error(chalk.red(e.message), e.stack); else console.error(e);
    await pressEnterToContinue('Enterで終了...'); process.exit(1);
});