import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import Table from 'cli-table3';

interface ScriptGenerator {
    platform: string;
    generateScript(commands: { command: string, args?: string[] }[], winePath?: string): string;
    getExtension(): string;
}

abstract class AbstractScriptGenerator implements ScriptGenerator {
    abstract platform: string;
    abstract generateScript(commands: { command: string, args?: string[] }[], winePath?: string): string;
    abstract getExtension(): string; // 抽象メソッドとして強制
}

class WindowsBatchScript extends AbstractScriptGenerator {
    platform = "Windows (Batch)";

    generateScript(commands: { command: string, args?: string[] }[]): string {
        let script = `@echo off\n`;
        for (const cmd of commands) {
            script += `start "" "${cmd.command}" ${cmd.args ? cmd.args.join(' ') : ''}\n`;
        }
        return script;
    }
    getExtension(): string {
        return '.bat';
    }
}

class WindowsCmdScript extends AbstractScriptGenerator {
    platform = "Windows (CMD)";

    generateScript(commands: { command: string, args?: string[] }[]): string {
        let script = '';
        for (const cmd of commands) {
            script += `start "" "${cmd.command}" ${cmd.args ? cmd.args.join(' ') : ''} & `;
        }
        return script.slice(0, -3); // Remove the last " & "
    }
    getExtension(): string {
        return '.cmd';
    }
}

class WindowsPowerShellScript extends AbstractScriptGenerator {
    platform = "Windows (PowerShell)";

    generateScript(commands: { command: string, args?: string[] }[]): string {
        let script = '';
        for (const cmd of commands) {
            script += `Start-Process "${cmd.command}"`;

            if (cmd.args && cmd.args.length > 0) {
                script += ` -ArgumentList "${cmd.args.join(', ')}"`;
            }
            script += '\n';
        }
        return script;
    }

    getExtension(): string {
        return '.ps1';
    }
}

class LinuxBashScript extends AbstractScriptGenerator {
    platform = "Linux/macOS (Bash)";

    generateScript(commands: { command: string, args?: string[] }[], winePath: string = 'wine'): string {
        let script = `#!/bin/bash\n`;
        for (const cmd of commands) {
            if (cmd.command.endsWith('.exe')) {
                script += `${winePath} "${cmd.command}" ${cmd.args ? cmd.args.join(' ') : ''} &\n`;
            } else {
                script += `${cmd.command} ${cmd.args ? cmd.args.join(' ') : ''} &\n`;
            }
        }
        script += 'wait';
        return script;
    }

    getExtension(): string {
        return '.sh';
    }
}

class MacOSBashScript extends LinuxBashScript {
    platform = "macOS (Bash)"; 
}


async function main() {
    const generators: ScriptGenerator[] = [
        new WindowsBatchScript(),
        new WindowsCmdScript(),
        new WindowsPowerShellScript(),
        new LinuxBashScript(),
        new MacOSBashScript(),
    ];

    const { targetDir } = await inquirer.prompt<{ targetDir: string }>([
        {
            type: 'input',
            name: 'targetDir',
            message: 'スクリプトの生成先ディレクトリを入力してください (Enterでデフォルト: process.env.PWD):',
            default: process.env.PWD || process.cwd(),
            validate: (input: string) => {
                try {
                    if (!fs.existsSync(input) || !fs.statSync(input).isDirectory()) {
                        return '指定されたディレクトリは存在しないか、ディレクトリではありません。';
                    }
                    return true;
                } catch {
                    return '指定されたディレクトリは存在しません。';
                }
            },
        },
    ]);

    const { selectedPlatforms } = await inquirer.prompt<{ selectedPlatforms: ScriptGenerator[] }>([
        {
            type: 'checkbox',
            name: 'selectedPlatforms',
            message: '生成するスクリプトのプラットフォームを選択してください (スペースキーで選択/解除、aキーで全て選択/解除、iキーで反転、Enterで決定):', // message を改善
            choices: [
                new inquirer.Separator('=== Windows ==='), 
                { name: "Windows (バッチファイル .bat)", value: generators[0], short: "Batch" },
                { name: "Windows (コマンドプロンプト .cmd)", value: generators[1], short: "CMD" },
                { name: "Windows (PowerShell .ps1)", value: generators[2], short: "PowerShell" },
                new inquirer.Separator('=== Linux/macOS ==='), 
                { name: "Linux (Bash .sh)", value: generators[3], short: "Linux Bash" },
                { name: "macOS (Bash .sh)", value: generators[4], short: "macOS Bash" },
            ],
            validate: (answer: ScriptGenerator[]) => {
                if (answer.length < 1) {
                    return '少なくとも1つのプラットフォームを選択してください。';
                }
                return true;
            },
            pageSize: 7 // 一度に表示する行数を制限 (必要に応じて調整)
        },
    ]);



    if (selectedPlatforms.length === 0) {
        console.log(chalk.yellow('プラットフォームが選択されなかったため、処理を終了します。'));
        return;
    }


    const commands: { command: string, args?: string[] }[] = [];
    while (true) {
        const { command } = await inquirer.prompt<{ command: string }>([
            {
                type: 'input',
                name: 'command',
                message: '実行するコマンドを入力してください (終了するにはEnterだけを入力):',
            },
        ]);

        if (!command) {
            break;
        }

        const { args } = await inquirer.prompt<{ args: string }>([
            {
                type: 'input',
                name: 'args',
                message: 'コマンドの引数を入力してください (スペース区切り, なければEnter):',
                default: '',
            }
        ]);

        commands.push({ command, args: args ? args.split(' ') : undefined });
    }


    let winePath:string | undefined = undefined;
    if (selectedPlatforms.some(p => p.platform.includes("Linux") || p.platform.includes("macOS"))) {
        const { useWine } = await inquirer.prompt<{ useWine: boolean }>([
            {
                type: 'confirm',
                name: 'useWine',
                message: '.exeファイルを実行するためにWineを使用しますか？',
                default: true
            }
        ]);

        if (useWine) {
            const { customWinePath } = await inquirer.prompt<{ customWinePath: string }>([
                {
                    type: 'input',
                    name: 'customWinePath',
                    message: 'Wineのパスを入力してください (デフォルト: wine):',
                    default: 'wine',
                }
            ]);
            winePath = customWinePath;
        }

    }

    // スクリプト生成処理 (編集機能を削除)
    const scriptsToGenerate: { platform: string; content: string; filename: string }[] = [];

    for (const generator of selectedPlatforms) {
        const initialContent = generator.generateScript(commands, winePath); // initialContent を直接使用
        const filename = `${generator.platform.replace(/[\s()]/g, '_').toLowerCase()}${generator.getExtension()}`;

        scriptsToGenerate.push({
            platform: generator.platform,
            content: initialContent,  // initialContent を使用
            filename,
        });
    }

    // 以降の処理は変更なし (テーブル表示、ファイル生成、確認メッセージなど)
    const table = new Table({
        head: [
            chalk.blueBright('プラットフォーム'),
            chalk.blueBright('ファイル名'),
            chalk.blueBright('保存先'),
        ],
    });

    if (scriptsToGenerate.length > 0) {
        for (const script of scriptsToGenerate) {
            table.push([
                script.platform,
                script.filename,
                path.join(targetDir, script.filename),
            ]);
        }
    }

    console.log(table.toString());



    const { confirmGeneration } = await inquirer.prompt<{ confirmGeneration: boolean }>([
        {
            type: 'confirm',
            name: 'confirmGeneration',
            message: '上記の場所にスクリプトファイルを生成しますか？',
            default: true,
        },
    ]);

    if (confirmGeneration) {
        for (const script of scriptsToGenerate) {
            const filePath = path.join(targetDir, script.filename);
            try {
                fs.writeFileSync(filePath, script.content);
                console.log(chalk.green(`✔ ${filePath} を生成しました。`));
            } catch (err) {
                console.error(chalk.red(`✖ ${filePath} の生成中にエラーが発生しました: ${err}`));
                const { stopOnError } = await inquirer.prompt<{ stopOnError: boolean }>([
                    {
                        type: 'confirm',
                        name: 'stopOnError',
                        message: 'エラーが発生しました。処理を停止しますか？',
                        default: true,
                    }
                ]);
                if (stopOnError) {
                    throw err;
                }
            }
        }
        console.log(chalk.green('スクリプトの生成が完了しました。'));
    } else {
        console.log(chalk.yellow('スクリプトの生成はキャンセルされました。'));
    }
}


main().catch((err) => {
    console.error(chalk.red('エラーが発生しました:'), err);
});