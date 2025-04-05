import * as fs from 'fs';
import * as path from 'path';
import { ChildProcess, spawn, SpawnOptions } from 'child_process'; 
import inquirer from 'inquirer';
import http from 'http';
import kill from 'tree-kill';
import { promisify } from 'util';

const treeKillPromise = promisify(kill);

interface ProcessConfig {
  name: string;
  command: string;
  cwd: string; 
}

interface RunningProcessInfo {
  process: ChildProcess | null;
  config: ProcessConfig;
  pid?: number;
  status: 'running' | 'stopped' | 'error' | 'starting' | 'stopping';
  exitCode?: number | null; 
  exitSignal?: NodeJS.Signals | null; 
}

// ステータスの日本語表示とBootstrapクラス取得 (定義を先に移動)
function getStatusInfo(status: RunningProcessInfo['status'] | 'not_configured'): { text: string; badgeClass: string; listItemClass: string } {
  switch (status) {
    case 'running': return { text: '実行中', badgeClass: 'bg-success', listItemClass: 'list-group-item-success' };
    case 'stopped': return { text: '停止済み', badgeClass: 'bg-secondary', listItemClass: '' }; // デフォルトの背景
    case 'error': return { text: 'エラー', badgeClass: 'bg-danger', listItemClass: 'list-group-item-danger' };
    case 'starting': return { text: '起動中', badgeClass: 'bg-info text-dark', listItemClass: 'list-group-item-info' };
    case 'stopping': return { text: '停止中', badgeClass: 'bg-warning text-dark', listItemClass: 'list-group-item-warning' };
    case 'not_configured': return { text: '設定なし', badgeClass: 'bg-light text-dark', listItemClass: 'list-group-item-light' }; // 設定ファイルにない場合
    default: return { text: status, badgeClass: 'bg-dark', listItemClass: '' };
  }
}


class TaskManager {
  public tasks: ProcessConfig[] = [];
  private filePath: string;
  public runningProcesses: Map<string, RunningProcessInfo> = new Map();

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
    this.loadTasks();
    this.initializeRunningProcessesFromTasks();
  }

  private loadTasks(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf8');
        const loadedData = JSON.parse(data);
        if (
          Array.isArray(loadedData) &&
          loadedData.every(
            (item) =>
              typeof item === 'object' &&
              item !== null &&
              typeof item.name === 'string' && item.name.trim() !== '' &&
              typeof item.command === 'string' && item.command.trim() !== '' &&
              typeof item.cwd === 'string' && item.cwd.trim() !== '' &&
              path.isAbsolute(item.cwd)
          )
        ) {
          this.tasks = loadedData.map(task => ({ ...task, cwd: path.resolve(task.cwd) }));
          console.log(`タスク設定を ${this.filePath} から読み込みました。`);
        } else {
          console.warn(
            `警告: ${this.filePath} の形式が無効か、必要なプロパティが不足しているか、'cwd' が絶対パスではありません。空のリストで開始します。`
          );
          this.tasks = [];
        }
      } else {
        console.log(`設定ファイル ${this.filePath} が見つかりません。空のリストで開始します。`);
        this.tasks = [];
      }
    } catch (error) {
      console.error(`タスクの読み込みエラー (${this.filePath}):`, error);
      this.tasks = [];
    }
  }

  private initializeRunningProcessesFromTasks(): void {
    const newTaskNames = new Set(this.tasks.map(t => t.name));

    for (const [name, info] of this.runningProcesses.entries()) {
      if (!newTaskNames.has(name)) {
        console.warn(`警告: 実行中のプロセス "${name}" の設定が ${this.filePath} から削除されました。`);
      } else {
        const correspondingTask = this.tasks.find(t => t.name === name);
        if (correspondingTask) {
          info.config = correspondingTask;
        }
      }
    }

    for (const task of this.tasks) {
      if (!this.runningProcesses.has(task.name)) {
        this.runningProcesses.set(task.name, {
          process: null,
          config: task,
          pid: undefined,
          status: 'stopped',
          exitCode: undefined,
          exitSignal: undefined,
        });
      }
    }
  }

  private saveTasks(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`ディレクトリ ${dir} を作成しました。`);
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.tasks, null, 2), 'utf8');
      console.log(`タスク設定を ${this.filePath} に保存しました。`);
      this.initializeRunningProcessesFromTasks();
    } catch (error) {
      console.error(`タスクの保存エラー (${this.filePath}):`, error);
    }
  }

  private async getTaskDetails(existingTask?: ProcessConfig): Promise<ProcessConfig | null> {
    const questions = [
      {
        type: 'input',
        name: 'name',
        message: 'プロセス名（識別用）:',
        default: existingTask?.name,
        validate: (input: string) => {
          const trimmed = input.trim();
          if (trimmed === '') return 'プロセス名は必須です。';
          if (!existingTask && this.tasks.some(task => task.name === trimmed)) {
            return `名前 "${trimmed}" は既に使用されています。`;
          }
          if (existingTask && existingTask.name !== trimmed && this.tasks.some(task => task.name === trimmed)) {
            return `名前 "${trimmed}" は他のプロセスで使用されています。`;
          }
          return true;
        },
      },
      {
        type: 'input',
        name: 'command',
        message: '実行コマンド:',
        default: existingTask?.command,
        validate: (input: string) => input.trim() !== '' || 'コマンドは必須です。',
      },
      {
        type: 'input',
        name: 'cwd',
        message: '作業ディレクトリ（絶対パス）:',
        default: existingTask?.cwd ?? process.cwd(),
        validate: async (input: string) => {
          const trimmedInput = input.trim();
          if (trimmedInput === '') return '作業ディレクトリは必須です。';
          if (!path.isAbsolute(trimmedInput)) return '作業ディレクトリは絶対パスである必要があります。';
          const resolvedPath = path.resolve(trimmedInput);
          try {
            const stats = await fs.promises.stat(resolvedPath);
            if (!stats.isDirectory()) return 'パスは存在しますが、ディレクトリではありません。';
            return true;
          } catch (error: any) {
            if (error.code === 'ENOENT') {
              console.warn(`\n警告: ディレクトリ '${resolvedPath}' は現在存在しません。実行時に有効であることを確認してください。`);
              return true;
            }
            return `パス検証エラー: ${error.message}`;
          }
        },
        filter: (input: string) => path.resolve(input.trim()),
      },
    ];

    try {
      // @ts-ignore Inquirer の型定義と実際の動作の差異のため無視する場合がある
      const answers = await inquirer.prompt(questions);
      return {
        name: answers.name.trim(),
        command: answers.command.trim(),
        cwd: answers.cwd,
      };
    } catch (error: any) {
      if (error.isTtyError) {
        console.error('\n現在の環境ではプロンプトを表示できませんでした。');
      } else if (error.message.includes('closed') || error.message.includes('prompt') && error.message.includes('promise was rejected')) {
        console.log('\n入力をキャンセルしました。');
      } else {
        console.error('\n入力中にエラーが発生しました:', error);
      }
      return null;
    }
  }

  public async addTask(): Promise<void> {
    console.log('\n--- 新規プロセス追加 ---');
    const newTask = await this.getTaskDetails();
    if (newTask) {
      if (!path.isAbsolute(newTask.cwd)) {
        console.error(`エラー: 作業ディレクトリ '${newTask.cwd}' は絶対パスではありません。追加できません。`);
        return;
      }
      if (this.tasks.some(task => task.name === newTask.name)) {
        console.warn(`警告: 名前 "${newTask.name}" のプロセスは既に存在します。追加をスキップします。`);
        return;
      }

      this.tasks.push(newTask);
      this.saveTasks();
      console.log(`プロセス "${newTask.name}" を追加しました。`);
    } else {
      console.log("プロセスの追加はキャンセルされました。");
    }
  }

  public async editTask(): Promise<void> {
    console.log('\n--- プロセス編集 ---');
    if (this.tasks.length === 0) {
      console.log('編集するプロセスがありません。');
      return;
    }

    try {
      const { taskNameToEdit } = await inquirer.prompt<{ taskNameToEdit: string }>([
        {
          type: 'list',
          name: 'taskNameToEdit',
          message: '編集するプロセスを選択:',
          choices: [
            ...this.tasks.map(t => t.name),
            new inquirer.Separator(),
            'キャンセル',
          ],
          loop: false,
        },
      ]);

      if (taskNameToEdit === 'キャンセル') {
        console.log("編集をキャンセルしました。");
        return;
      }

      const taskIndex = this.tasks.findIndex(t => t.name === taskNameToEdit);
      if (taskIndex === -1) {
        console.log('選択されたプロセスが見つかりません。');
        return;
      }

      const originalTask = this.tasks[taskIndex];
      console.log(`\nプロセス "${originalTask.name}" を編集中:`);
      const updatedTask = await this.getTaskDetails(originalTask);

      if (updatedTask) {
        if (!path.isAbsolute(updatedTask.cwd)) {
          console.error(`エラー: 作業ディレクトリ '${updatedTask.cwd}' は絶対パスではありません。更新できません。`);
          return;
        }
        if (updatedTask.name !== originalTask.name && this.tasks.some((task, index) => index !== taskIndex && task.name === updatedTask.name)) {
          console.warn(`警告: 新しい名前 "${updatedTask.name}" は他のプロセスで使用されています。更新をスキップします。`);
          return;
        }

        const runningInfo = this.runningProcesses.get(originalTask.name);
        this.tasks[taskIndex] = updatedTask;
        this.saveTasks(); // 保存と同期

        if (runningInfo && updatedTask.name !== originalTask.name) {
          this.runningProcesses.delete(originalTask.name);
          runningInfo.config = updatedTask;
          this.runningProcesses.set(updatedTask.name, runningInfo);
          console.warn(`警告: プロセス "${originalTask.name}" は実行中に名前が "${updatedTask.name}" に変更されました。新しい名前で追跡されますが、再起動が必要な場合があります。`);
        } else if (runningInfo) {
          runningInfo.config = updatedTask; // config 更新
          if (runningInfo.status === 'running' || runningInfo.status === 'starting') {
            console.warn(`警告: 実行中のプロセス "${updatedTask.name}" の設定が変更されました。変更を反映するには手動で再起動してください。`);
          }
        }

        console.log(`プロセス "${updatedTask.name}" を更新しました。`);
      } else {
        console.log("プロセスの編集はキャンセルされました。");
      }

    } catch (error: any) {
      if (error.isTtyError) {
        console.error('\n現在の環境ではプロンプトを表示できませんでした。');
      } else if (error.message.includes('closed') || error.message.includes('prompt') && error.message.includes('promise was rejected')) {
        console.log('\n編集操作をキャンセルしました。');
      } else {
        console.error("プロセス編集エラー:", error);
      }
    }
  }

  public async deleteTask(): Promise<void> {
    console.log('\n--- プロセス削除 ---');
    if (this.tasks.length === 0) {
      console.log('削除するプロセスがありません。');
      return;
    }

    try {
      const { taskNameToDelete } = await inquirer.prompt<{ taskNameToDelete: string }>([
        {
          type: 'list',
          name: 'taskNameToDelete',
          message: '削除するプロセスを選択:',
          choices: [
            ...this.tasks.map(t => t.name),
            new inquirer.Separator(),
            'キャンセル',
          ],
          loop: false,
        },
      ]);

      if (taskNameToDelete === 'キャンセル') {
        console.log("削除をキャンセルしました。");
        return;
      }

      const taskIndexToDelete = this.tasks.findIndex(t => t.name === taskNameToDelete);

      if (taskIndexToDelete !== -1) {
        if (this.runningProcesses.has(taskNameToDelete)) {
          const info = this.runningProcesses.get(taskNameToDelete);
          if (info && (info.status === 'running' || info.status === 'starting' || info.status === 'stopping')) {
            console.log(`実行中または処理中のプロセス "${taskNameToDelete}" を停止します...`);
            await this.stopTask(taskNameToDelete, true);
          }
          this.runningProcesses.delete(taskNameToDelete);
          console.log(`プロセス "${taskNameToDelete}" を実行リストから削除しました。`);
        }

        this.tasks.splice(taskIndexToDelete, 1);
        this.saveTasks();
        console.log(`プロセス "${taskNameToDelete}" の設定を削除しました。`);

      } else {
        console.log(`プロセス "${taskNameToDelete}" が見つかりませんでした。`);
      }
    } catch (error: any) {
      if (error.isTtyError) {
        console.error('\n現在の環境ではプロンプトを表示できませんでした。');
      } else if (error.message.includes('closed') || error.message.includes('prompt') && error.message.includes('promise was rejected')) {
        console.log('\n削除操作をキャンセルしました。');
      } else {
        console.error("プロセス削除エラー:", error);
      }
    }
  }

  public displayTasks(): void {
    console.log('\n--- 設定済みプロセス ---');
    if (this.tasks.length === 0) {
      console.log('設定されているプロセスはありません。');
      return;
    }

    this.tasks.forEach((task, index) => {
      const runningInfo = this.runningProcesses.get(task.name);
      // getStatusText を getStatusInfo().text に修正
      const status = runningInfo ? getStatusInfo(runningInfo.status).text : '未追跡';
      const pid = runningInfo?.pid ?? 'N/A';
      console.log(`[${index + 1}] 名前    : ${task.name} (状態: ${status}, PID: ${pid})`);
      console.log(`    コマンド: ${task.command}`);
      console.log(`    作業Dir : ${task.cwd}`);
      console.log('--------------------');
    });
  }

  private spawnProcess(config: ProcessConfig): void {
    const name = config.name;

    if (!fs.existsSync(config.cwd)) {
      console.error(`プロセス "${name}" を起動できません: 作業ディレクトリ "${config.cwd}" が存在しません。`);
      this.runningProcesses.set(name, {
        process: null,
        config: config,
        status: 'error',
        pid: undefined,
        exitCode: undefined,
        exitSignal: undefined,
      });
      return;
    }

    console.log(`プロセス "${name}" を起動しています... コマンド: ${config.command}, CWD: ${config.cwd}`);

    this.runningProcesses.set(name, {
      process: null,
      config: config,
      status: 'starting',
      pid: undefined,
      exitCode: undefined,
      exitSignal: undefined,
    });

    // stdio の型エラー修正: SpawnOptions を使用し、stdio に 'ignore' を指定
    const spawnOptions: SpawnOptions = {
      cwd: config.cwd,
      shell: true,
      stdio: 'ignore', // ここで 'ignore' を使用
      detached: false,
    };

    try {
      const child = spawn(config.command, [], spawnOptions);

      const currentInfo = this.runningProcesses.get(name);
      if (!currentInfo) {
        console.warn(`プロセス "${name}" の情報が起動直後に見つかりません。停止を試みます。`);
        if (child.pid) {
          treeKillPromise(child.pid).catch(err => console.error(`起動直後のプロセス ${child.pid} の停止失敗: ${err.message}`));
        }
        return;
      }

      currentInfo.process = child;
      currentInfo.pid = child.pid;
      currentInfo.status = 'running';
      this.runningProcesses.set(name, currentInfo);

      console.log(`プロセス "${name}" が起動しました (PID: ${child.pid})`);

      child.on('spawn', () => {
        const info = this.runningProcesses.get(name);
        if (info && info.status !== 'running') {
          console.log(`プロセス "${name}" (PID: ${child.pid}) spawn イベント発生、状態を running に更新`);
          info.status = 'running';
          this.runningProcesses.set(name, info);
        }
      });

      child.on('error', (err) => {
        console.error(`プロセス "${name}" (PID: ${child.pid ?? 'N/A'}) の起動/実行中にエラーが発生しました:`, err.message);
        const info = this.runningProcesses.get(name);
        if (info) {
          info.status = 'error';
          info.process = null;
          info.pid = undefined;
          this.runningProcesses.set(name, info);
        }
      });

      child.on('exit', (code, signal) => {
        const info = this.runningProcesses.get(name);
        const intendedStop = info?.status === 'stopping';
        // 終了コードやシグナルに基づいて stopped か error か判断
        const finalStatus = intendedStop
          ? 'stopped'
          : (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT' || signal === null) // 正常終了 or tree-kill による SIGTERM
            ? 'stopped'
            : 'error'; // それ以外はエラー扱い

        // getStatusText を getStatusInfo().text に修正
        console.log(`プロセス "${name}" (PID: ${info?.pid ?? 'N/A'}) が終了しました。コード: ${code}, シグナル: ${signal}, 最終状態: ${getStatusInfo(finalStatus).text}`);

        if (info) {
          info.status = finalStatus;
          info.process = null;
          info.exitCode = code;
          info.exitSignal = signal;
          this.runningProcesses.set(name, info);
        }
      });

      // close イベントハンドラの未使用引数警告修正: _code, _signal を使用
      child.on('close', (_code, _signal) => {
        // console.log(`プロセス "${name}" (PID: ${child.pid}) の stdio が閉じました。コード: ${_code}, シグナル: ${_signal}`);
      });

    } catch (error: any) {
      console.error(`プロセス "${name}" の spawn 呼び出し自体に失敗しました:`, error.message);
      const info = this.runningProcesses.get(name);
      if (info) {
        info.status = 'error';
        info.process = null;
        this.runningProcesses.set(name, info);
      }
    }
  }


  public startTask(name: string): void {
    const taskConfig = this.tasks.find(t => t.name === name);
    if (!taskConfig) {
      console.error(`"${name}" を開始できません: 設定が見つかりません。`);
      return;
    }

    const runningInfo = this.runningProcesses.get(name);
    if (runningInfo && (runningInfo.status === 'running' || runningInfo.status === 'starting')) {
      console.log(`プロセス "${name}" は既に実行中または起動中です。`);
      return;
    }
    if (runningInfo && runningInfo.status === 'stopping') {
      console.log(`プロセス "${name}" は現在停止処理中です。完了後に再度試してください。`);
      return;
    }

    this.spawnProcess(taskConfig);
  }

  public runAllManaged(): void {
    if (this.tasks.length === 0) {
      console.log('実行する設定済みプロセスがありません。');
      return;
    }
    console.log('\n設定済みの全プロセスを起動します...');
    this.tasks.forEach(task => {
      const info = this.runningProcesses.get(task.name);
      if (!info || (info.status !== 'running' && info.status !== 'starting' && info.status !== 'stopping')) {
        this.startTask(task.name);
      } else {
        // getStatusText を getStatusInfo().text に修正
        console.log(`プロセス "${task.name}" は既に ${getStatusInfo(info.status).text} のため、起動をスキップします。`);
      }
    });
    console.log('\n全てのプロセスの起動試行が完了しました。');
  }

  public async stopTask(name: string, log: boolean = true): Promise<boolean> {
    const runningInfo = this.runningProcesses.get(name);

    if (!runningInfo) {
      if (log) console.log(`プロセス "${name}" は追跡されていません。`);
      return false;
    }

    // getStatusText を getStatusInfo().text に修正
    if (runningInfo.status === 'stopping' || runningInfo.status === 'stopped' || runningInfo.status === 'error') {
      if (log) console.log(`プロセス "${name}" は既に ${getStatusInfo(runningInfo.status).text} です。`);
      return true;
    }

    if (runningInfo.status === 'starting') {
      if (log) console.log(`プロセス "${name}" はまだ起動中です。停止を試みます...`);
      // starting中でも停止試行は継続
    }

    if (!runningInfo.pid) {
      // getStatusText を getStatusInfo().text に修正
      if (log) console.log(`プロセス "${name}" は ${getStatusInfo(runningInfo.status).text} ですが、PID が不明です。状態を 'stopped' に設定します。`);
      runningInfo.status = 'stopped';
      runningInfo.process = null;
      this.runningProcesses.set(name, runningInfo);
      return true;
    }

    if (log) console.log(`プロセス "${name}" (PID: ${runningInfo.pid}) の停止を試みます (tree-kill)...`);
    runningInfo.status = 'stopping';
    this.runningProcesses.set(name, runningInfo);

    try {
      // Tree-kill を使用してプロセスツリー全体を強制停止
      await treeKillPromise(runningInfo.pid);
      if (log) console.log(` -> プロセス "${name}" (PID: ${runningInfo.pid}) とその子孫プロセスに停止シグナル (SIGTERM) を送信しました。`);

      const finalInfo = this.runningProcesses.get(name);
      // exit イベントで既に処理されていなければ stopped に更新
      if (finalInfo && finalInfo.status === 'stopping') {
        finalInfo.status = 'stopped';
        finalInfo.process = null;
        this.runningProcesses.set(name, finalInfo);
      }
      return true;
    } catch (error: any) {
      if (log) console.error(` -> プロセス "${name}" (PID: ${runningInfo.pid}) の停止中にエラーが発生しました: ${error.message}`);
      const errorInfo = this.runningProcesses.get(name);
      if (errorInfo) {
        if (error.message.includes('No such process')) {
          if (log) console.log(` -> プロセス "${name}" (PID: ${runningInfo.pid}) が見つかりません。既に停止しているようです。`);
          errorInfo.status = 'stopped';
          errorInfo.process = null;
          this.runningProcesses.set(name, errorInfo);
          return true;
        } else {
          errorInfo.status = 'error';
          errorInfo.process = null;
          this.runningProcesses.set(name, errorInfo);
          return false;
        }
      }
      return false;
    }
  }

  public async restartTask(name: string): Promise<void> {
    const taskConfig = this.tasks.find(t => t.name === name);

    if (!taskConfig) {
      console.error(`"${name}" を再起動できません: 設定が見つかりません。`);
      return;
    }

    console.log(`プロセス "${name}" を再起動しています...`);
    const stopped = await this.stopTask(name); // tree-kill で停止

    if (stopped) {
      console.log(`プロセス "${name}" の停止を確認しました。すぐに再起動します...`);
      setTimeout(() => {
        console.log(`プロセス "${name}" を再度起動しています...`);
        this.startTask(name);
      }, 500);
    } else {
      console.warn(`"${name}" の停止に失敗したか、既に停止していました。起動を試みます...`);
      setTimeout(() => {
        this.startTask(name);
      }, 500);
    }
  }

  public async stopAllTasks(): Promise<void> {
    console.log('\n追跡中の全プロセスを停止しようとしています (tree-kill 使用)...');
    const tasksToStop = Array.from(this.runningProcesses.entries())
      .filter(([_, info]) => ['running', 'starting', 'stopping'].includes(info.status) && info.pid)
      .map(([name, _]) => name);

    if (tasksToStop.length === 0) {
      console.log("現在、停止対象となる実行中のプロセスはありません。");
      return;
    }

    console.log(`停止対象: ${tasksToStop.join(', ')}`);
    const stopPromises = tasksToStop.map(name => this.stopTask(name, true)); // tree-kill で停止

    try {
      const results = await Promise.allSettled(stopPromises);
      console.log('全ての対象プロセスの停止試行が完了しました。');
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(` -> プロセス ${tasksToStop[index]} の停止中に予期せぬエラー:`, result.reason);
        }
      });
    } catch (error) {
      console.error('全プロセス停止処理中に予期せぬエラーが発生しました:', error);
    }
  }
}

// --- Main Application Logic ---

async function main() {
  const taskFilePath = 'process-manager-tasks.json';
  console.log(`タスク設定ファイル: ${path.resolve(taskFilePath)}`);
  const taskManager = new TaskManager(taskFilePath);

  if (process.argv.includes('--run')) {
    const port = 9000;
    taskManager.runAllManaged();
    startHttpServer(taskManager, port);
    console.log(`\n全プロセスを起動試行しました。HTTP管理サーバーがポート ${port} で実行中です。`);
    console.log('メインアプリケーションはサーバーをホストするために実行し続けます。');
    console.log(`管理UI: http://localhost:${port}`);
    console.log('このターミナルで Ctrl+C を押すか、Web UIの「シャットダウン」ボタンを使用して終了してください。');

    const shutdown = async (signal: NodeJS.Signals) => {
      console.log(`\n${signal} シグナル受信。シャットダウン処理を開始します (tree-kill 使用)...`);
      await taskManager.stopAllTasks(); 
      console.log("シャットダウン処理完了。プログラムを終了します。");
      process.exit(0);
    };
    process.removeAllListeners('SIGINT').on('SIGINT', () => shutdown('SIGINT'));
    process.removeAllListeners('SIGTERM').on('SIGTERM', () => shutdown('SIGTERM'));
    process.removeAllListeners('SIGQUIT').on('SIGQUIT', () => shutdown('SIGQUIT'));

  } else {
    await showMenu(taskManager);
  }
}

async function showMenu(taskManager: TaskManager) {
  while (true) {
    console.clear();
    taskManager.displayTasks();

    try {
      const { action } = await inquirer.prompt<{ action: string }>([
        {
          type: 'list',
          name: 'action',
          message: 'アクションを選択:',
          choices: [
            'プロセス追加',
            'プロセス編集',
            'プロセス削除',
            new inquirer.Separator(),
            '全プロセス起動 & HTTPサーバー実行 (--run)',
            new inquirer.Separator(),
            '終了',
          ],
          loop: false,
        },
      ]);

      switch (action) {
        case 'プロセス追加':
          await taskManager.addTask();
          break;
        case 'プロセス編集':
          await taskManager.editTask();
          break;
        case 'プロセス削除':
          await taskManager.deleteTask();
          break;
        case '全プロセス起動 & HTTPサーバー実行 (--run)':
          process.argv.push('--run');
          await main();
          return;
        case '終了':
          console.log('プログラムを終了します。');
          await taskManager.stopAllTasks(); // 終了前に tree-kill で停止
          process.exit(0);
        default:
          console.log('無効なアクションが選択されました。');
      }

      if (action !== '終了') {
        await new Promise(resolve => setTimeout(resolve, 100));
        await inquirer.prompt({ type: 'input', name: 'continue', message: 'エンターキーを押してメニューに戻る...', filter: () => '' });
      }

    } catch (error: any) {
      if (error.isTtyError) {
        console.error('\n現在の環境ではメニューを表示できませんでした。終了します。');
        process.exit(1);
      } else if (error.message.includes('closed') || error.message.includes('prompt') && error.message.includes('promise was rejected')) {
        console.log('\nメニュー操作をキャンセルしました。終了します。');
        await taskManager.stopAllTasks(); // 終了前に tree-kill で停止
        process.exit(0);
      } else {
        console.error("\nメニュー処理中に予期せぬエラーが発生しました:", error);
        await inquirer.prompt({ type: 'input', name: 'continue', message: 'エラーが発生しました。エンターキーを押してメニューに戻る...', filter: () => '' });
      }
    }
  }
}

// --- HTTP Server Logic ---

function startHttpServer(taskManager: TaskManager, port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathParts = url.pathname.split('/').filter(p => p);

    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(generateHtml(taskManager));
      } else if (req.method === 'POST' && pathParts.length === 2 && ['start', 'stop', 'restart'].includes(pathParts[0])) {
        const action = pathParts[0];
        const taskName = decodeURIComponent(pathParts[1]);
        console.log(`HTTP: プロセス ${action} 要求: ${taskName}`);

        let promise: Promise<any>;
        if (action === 'start') {
          taskManager.startTask(taskName);
          promise = Promise.resolve();
        } else if (action === 'stop') {
          promise = taskManager.stopTask(taskName); 
        } else { 
          promise = taskManager.restartTask(taskName); 
        }

        promise.catch(err => {
          console.error(`HTTP ${action} 操作中にエラーが発生しました (${taskName}):`, err);
        }).finally(() => {
          setTimeout(() => {
            if (!res.writableEnded) {
              res.writeHead(302, { 'Location': '/' });
              res.end();
            }
          }, 3000);
        });

      } else if (req.method === 'POST' && url.pathname === '/shutdown') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.write('全てのプロセスとサーバーをシャットダウンしています...');
        console.log("HTTPインターフェース経由でシャットダウン要求を受け付けました (tree-kill 使用)。");

        const shutdownTimeout = setTimeout(() => {
          console.warn("シャットダウンタイムアウトのため強制終了します。");
          process.exit(1);
        }, 15000);

        await taskManager.stopAllTasks(); 
        clearTimeout(shutdownTimeout);

        res.end(' サーバーをシャットダウンします。');
        server.close(() => {
          console.log('HTTPサーバーを閉じました。');
          process.exit(0);
        });
        setTimeout(() => {
          console.log("サーバークローズ後のタイムアウト、強制終了します。");
          process.exit(0);
        }, 3000);

      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
      }
    } catch (error) {
      console.error("HTTPリクエスト処理中にエラーが発生しました:", error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      if (!res.writableEnded) {
        res.end('Internal Server Error');
      }
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`エラー: ポート ${port} は既に使用されています。`);
    } else {
      console.error(`HTTPサーバーエラー: ${err}`);
    }
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`HTTP管理サーバーが http://localhost:${port} で待機中`);
  });

  return server;
}


function generateHtml(taskManager: TaskManager): string {
  let processListHtml = '';
  const allKnownNames = new Set([...taskManager.runningProcesses.keys(), ...taskManager.tasks.map(t => t.name)]);

  if (allKnownNames.size === 0) {
    processListHtml = '<p>設定済みまたは追跡中のプロセスはありません。</p>';
  } else {
    processListHtml = '<ul class="list-group">';
    allKnownNames.forEach(name => {
      const runningInfo = taskManager.runningProcesses.get(name);
      const taskConfig = taskManager.tasks.find(t => t.name === name);
      const config = runningInfo?.config ?? taskConfig;

      let status: RunningProcessInfo['status'] | 'not_configured' = 'not_configured';
      if (runningInfo) {
        status = runningInfo.status;
      } else if (taskConfig) {
        status = 'stopped';
      }

      const pid = runningInfo?.pid ?? 'N/A';
      const exitInfo = runningInfo?.exitCode !== undefined ? ` (コード: ${runningInfo.exitCode})` : (runningInfo?.exitSignal ? ` (シグナル: ${runningInfo.exitSignal})` : '');
      // ここで getStatusInfo を使用 (定義はファイルの先頭に移動済み)
      const { text: statusText, badgeClass, listItemClass } = getStatusInfo(status);

      let buttonsHtml = '';
      const encodedName = encodeURIComponent(name);
      const isProcessing = status === 'starting' || status === 'stopping';
      const canBeStarted = status === 'stopped' || status === 'error';
      const canBeStopped = status === 'running' || status === 'starting';

      if (config) {
        if (canBeStarted) {
          buttonsHtml += `
                    <form action="/start/${encodedName}" method="POST" style="display: inline-block; margin-right: 5px;">
                        <button type="submit" class="btn btn-success btn-sm" ${isProcessing ? 'disabled' : ''}>開始</button>
                    </form>`;
        } else {
          buttonsHtml += `
                    <button type="button" class="btn btn-success btn-sm" disabled style="margin-right: 5px;">開始</button>
                 `;
        }

        if (canBeStopped) {
          buttonsHtml += `
                   <form action="/stop/${encodedName}" method="POST" style="display: inline-block; margin-right: 5px;">
                       <button type="submit" class="btn btn-warning btn-sm" ${isProcessing ? 'disabled' : ''} title="プロセスツリー全体を停止 (tree-kill)">停止</button>
                   </form>`;
        } else {
          buttonsHtml += `
                    <button type="button" class="btn btn-warning btn-sm" disabled style="margin-right: 5px;">停止</button>
                 `;
        }

        buttonsHtml += `
                <form action="/restart/${encodedName}" method="POST" style="display: inline-block;">
                    <button type="submit" class="btn btn-info btn-sm" ${isProcessing ? 'disabled' : ''} title="プロセスツリー全体を停止後に再起動">再起動</button>
                </form>`;

      } else {
        buttonsHtml = '<span class="text-muted">設定ファイルに存在しません。</span>';
        if (runningInfo && runningInfo.pid && (runningInfo.status === 'running' || runningInfo.status === 'starting')) {
          buttonsHtml += `
                 <form action="/stop/${encodedName}" method="POST" style="display: inline-block; margin-left: 10px;">
                     <button type="submit" class="btn btn-danger btn-sm" title="設定がないプロセスを強制停止 (tree-kill)">強制停止</button>
                 </form>`;
        }
      }


      processListHtml += `
                <li class="list-group-item ${listItemClass} mb-3 shadow-sm">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <h5 class="mb-0">${name}</h5>
                        <span class="badge ${badgeClass} fs-6">${statusText}${pid !== 'N/A' ? ` (PID: ${pid})` : ''}${exitInfo}</span>
                    </div>
                    ${config ? `
                    <div class="mb-1">
                       <small class="text-muted">コマンド:</small> <code>${config.command}</code>
                    </div>
                    <div class="mb-2">
                       <small class="text-muted">作業ディレクトリ:</small> <code>${config.cwd}</code>
                    </div>
                    ` : `
                    <div class="mb-2 text-danger">
                       <small>このプロセスの設定は process-manager-tasks.json に見つかりません。</small>
                    </div>
                    `}
                    <div>
                        ${buttonsHtml}
                    </div>
                </li>`;
    });
    processListHtml += '</ul>';
  }

  return `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>プロセス管理</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-T3c6CoIi6uLrA9TneNEoa7RxnatzjcDSCmG1MXxSR1GAsXEV/Dwwykc2MPK8M2HN" crossorigin="anonymous">
        <style>
            body { background-color: #f8f9fa; }
            .container { max-width: 960px; }
            h1 { color: #343a40; }
            .list-group-item { transition: background-color 0.3s ease; }
            code { font-size: 0.85em; padding: 0.2em 0.4em; border-radius: 3px; background-color: rgba(0,0,0,0.05);}
            .badge { font-weight: 500; }
            .mb-1 { margin-bottom: 0.25rem !important; }
            .mb-2 { margin-bottom: 0.5rem !important; }
            .mb-3 { margin-bottom: 1rem !important; }
             .shadow-sm { box-shadow: 0 .125rem .25rem rgba(0,0,0,.075)!important; }
            #shutdown-form { margin-top: 30px; border-top: 1px solid #dee2e6; padding-top: 20px; }
        </style>
        <script>
           // setTimeout(() => { window.location.reload(); }, 5000); // 5秒リロード
           function confirmShutdown() {
               return confirm('全てのプロセスを停止し (Tree-kill)、管理サーバーを終了しますか？\\nこの操作は元に戻せません。');
           }
        </script>
    </head>
    <body>
        <div class="container mt-4 mb-5">
            <h1 class="mb-4 display-6">プロセス管理ダッシュボード</h1>
            <div id="process-list">
                ${processListHtml}
            </div>

            <form id="shutdown-form" action="/shutdown" method="POST" onsubmit="return confirmShutdown();">
                <button type="submit" class="btn btn-danger btn-lg">全プロセス停止 & サーバー終了</button>
            </form>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js" integrity="sha384-C6RzsynM9kWDrMNeT87bh95OGNyZPhcTNXj1NW7RuBCsyN/o0jlpcV8Qyq46cDfL" crossorigin="anonymous"></script>
    </body>
    </html>
  `;
}


// --- Script Execution ---

main().catch(error => {
  console.error("プログラム実行中に致命的なエラーが発生しました:", error);
  process.exit(1);
});