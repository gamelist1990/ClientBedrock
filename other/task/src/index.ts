import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import kill from 'tree-kill';

interface ScheduledTask {
  name: string;
  time: string;
  commands: string[];
}

interface RunningTask {
  process: ChildProcessWithoutNullStreams;
  name: string;
  command: string;
  retries: number;
  isRestarting: boolean;
}

interface ProcessInfo {
  pid: number;
  command: string;
}

class TaskScheduler {
  public tasks: ScheduledTask[] = [];
  private filePath: string;
  public runningTasks: RunningTask[] = [];
  private minecraftServerDir: string = "D:\\MinecraftServer";
  private similarityThreshold: number = 0.4;
  private initialProcesses: { [taskName: string]: ProcessInfo[] } = {};
  private maxRetries: number = 10;
  private retryDelay: number = 5000;
  private killDelay: number = 3000;
  private restartDelay: number = 5000;
  private workingDirCache: { [commandName: string]: string | undefined } = {};
  public isShuttingDown: boolean = false; // シャットダウンフラグ


  constructor(filePath: string) {
    this.filePath = filePath;
    this.loadTasks();
  }

  private loadTasks(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf8');
        this.tasks = JSON.parse(data);
        this.tasks.forEach(this.validateTask);
      }
    } catch (error) {
      console.error('タスクの読み込みエラー:', error);
    }
  }

  private saveTasks(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.tasks, null, 2), 'utf8');
  }

  private validateTask(task: ScheduledTask): void {
    if (!task.name || task.name.trim() === "") {
      throw new Error("タスク名が空です。");
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(task.time)) {
      throw new Error("時刻の形式が無効です。HH:mm (24時間制) を使用してください。");
    }
    if (!task.commands || task.commands.length === 0) {
      throw new Error("タスクには少なくとも1つのコマンドが必要です。");
    }
  }

  private async getTaskDetails(existingTask?: ScheduledTask): Promise<ScheduledTask> {
    const questions = [
      {
        type: 'input',
        name: 'name',
        message: 'タスク名:',
        default: existingTask?.name,
        validate: (input: string) => input.trim() !== '' || 'タスク名は必須です',
      },
      {
        type: 'input',
        name: 'time',
        message: '時刻 (HH:mm):',
        default: existingTask?.time,
        validate: (input: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input) || 'HH:mm形式で入力してください',
      },
      {
        type: 'input',
        name: 'commands',
        message: 'コマンド (カンマ区切り):',
        default: existingTask?.commands.join(', '),
        validate: (input: string) => input.trim() !== '' || 'コマンドは必須です',
      },
    ];

    //@ts-ignore
    const answers = await inquirer.prompt(questions) as { name: string; time: string; commands: string };

    return {
      name: answers.name.trim(),
      time: answers.time.trim(),
      commands: answers.commands.split(',').map((c: string) => c.trim()),
    };
  }

  public async addTask(): Promise<void> {
    try {
      const newTask = await this.getTaskDetails();
      this.validateTask(newTask);
      this.tasks.push(newTask);
      this.saveTasks();
      console.log(`タスク "${newTask.name}" を追加しました。`);
    } catch (error: any) {
      console.error("タスク追加エラー:", error.message);
    }
  }

  public async editTask(): Promise<void> {
    if (this.tasks.length === 0) {
      console.log('編集するタスクがありません。');
      return;
    }

    try {
      const { taskToEdit } = await inquirer.prompt<{ taskToEdit: string }>([
        {
          type: 'list',
          name: 'taskToEdit',
          message: 'どのタスクを編集しますか？',
          choices: this.tasks.map(t => t.name),
        },
      ]);

      const selectedTask = this.tasks.find(t => t.name === taskToEdit);
      if (!selectedTask) {
        console.log('タスクが見つかりません。');
        return;
      }

      const updatedTask = await this.getTaskDetails(selectedTask);
      this.validateTask(updatedTask);
      this.tasks = this.tasks.map(task => (task.name === selectedTask.name ? updatedTask : task));

      this.saveTasks();
      console.log(`タスク "${updatedTask.name}" を更新しました。`);
    } catch (error: any) {
      console.error("タスク編集エラー:", error.message);
    }
  }

  public async deleteTask(): Promise<void> {
    if (this.tasks.length === 0) {
      console.log('削除するタスクがありません。');
      return;
    }

    try {
      const { taskToDelete } = await inquirer.prompt<{ taskToDelete: string }>([
        {
          type: 'list',
          name: 'taskToDelete',
          message: 'どのタスクを削除しますか？',
          choices: this.tasks.map(t => t.name),
        },
      ]);

      this.tasks = this.tasks.filter(t => t.name !== taskToDelete);
      this.saveTasks();
      console.log(`タスク "${taskToDelete}" を削除しました。`);
    } catch (error) {
      console.error("タスク削除エラー:", error);
    }
  }

  public displayTasks(): void {
    if (this.tasks.length === 0) {
      console.log('スケジュールされたタスクはありません。');
      return;
    }

    const table = new Table({
      head: ['タスク名', '時刻', 'コマンド'],
      colWidths: [15, 10, 40],
    });

    this.tasks.forEach(task => {
      table.push([task.name, task.time, task.commands.join(', ')]);
    });

    console.log(table.toString());
  }

  private async executeCommand(commandString: string, taskName: string, retryCount: number = 0): Promise<ProcessInfo | null> {
    if (this.isShuttingDown) {
      console.log(`[${taskName} - ${commandString}] シャットダウン中のため、コマンドの実行をスキップします。`);
      return null;
    }

    commandString = commandString.replace(/^"(.*)"$/, '$1');
    const [command, ...args] = commandString.split(" ");

    if (!command) {
      console.warn(`無効なコマンド: ${commandString}`);
      return null;
    }

    let workingDir: string | undefined;
    try {
      workingDir = await this.determineWorkingDirectory(command);
    } catch (error) {
      console.error("作業ディレクトリ設定エラー:", error);
      workingDir = process.cwd();
    }

    try {
      const child = spawn(command, args, {
        cwd: workingDir,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (data) => {
        process.stdout.write(`[${taskName} - ${commandString}] ${data}`);
      });

      child.stderr.on('data', (data) => {
        process.stderr.write(`[${taskName} - ${commandString}] ${data}`);
      });

      // runningTasks からタスクを探す
      const runningTaskIndex = this.runningTasks.findIndex(t => t.name === taskName && t.command === commandString);

      child.on('close', (code) => {
        console.log(`[${taskName} - ${commandString}] 終了: コード ${code}`);

        if (runningTaskIndex !== -1) {
          const runningTask = this.runningTasks[runningTaskIndex];
          runningTask.isRestarting = false;
          runningTask.retries = retryCount;

          if (code !== 0 && retryCount < this.maxRetries && !this.isShuttingDown) {
            console.error(`[${taskName} - ${commandString}] リトライします (${retryCount + 1}/${this.maxRetries})`);
            setTimeout(() => {
              this.executeCommand(commandString, taskName, retryCount + 1);
            }, this.retryDelay);
          } else {
            if (code !== 0) {
              console.error(`[${taskName} - ${commandString}] リトライ回数上限に達しました。`);
            }
            this.runningTasks.splice(runningTaskIndex, 1);
          }
        } else {
          console.warn(`[${taskName} - ${commandString}] 実行中のタスクが見つかりませんでした。`);
        }
      });

      child.on('error', (err) => {
        console.error(`[${taskName} - ${commandString}] エラー: ${err}. リトライします (${retryCount + 1}/${this.maxRetries})`);

        const runningTaskIndex = this.runningTasks.findIndex(t => t.name === taskName && t.command === commandString);

        if (runningTaskIndex !== -1) {
          const runningTask = this.runningTasks[runningTaskIndex];
          runningTask.isRestarting = false;
          runningTask.retries = retryCount;

          if (retryCount < this.maxRetries && !this.isShuttingDown) {
            setTimeout(() => {
              this.executeCommand(commandString, taskName, retryCount + 1);
            }, this.retryDelay);
          } else {
            console.error(`[${taskName} - ${commandString}] リトライ回数上限に達しました。`);
            this.runningTasks.splice(runningTaskIndex, 1);
          }
        } else {
          console.warn(`[${taskName} - ${commandString}] 実行中のタスクが見つかりませんでした。`);
        }
      });

      const newTask: RunningTask = { process: child, name: taskName, command: commandString, retries: 0, isRestarting: false };
      this.runningTasks.push(newTask);


      if (!child.pid) {
        throw new Error('プロセスIDが取得できませんでした。');
      }
      return { pid: child.pid, command: commandString };

    } catch (error) {
      console.error("コマンド実行エラー:", error);
      if (retryCount < this.maxRetries && !this.isShuttingDown) {
        setTimeout(() => {
          this.executeCommand(commandString, taskName, retryCount + 1);
        }, this.retryDelay);
      } else {
        console.error(`[${taskName} - ${commandString}] リトライ回数上限に達しました。`);
      }
      return null;
    }
  }

  public async runTaskNow(taskName: string): Promise<void> {
    const task = this.tasks.find((t) => t.name === taskName);
    if (!task) {
      console.error(`タスク "${taskName}" が見つかりません。`);
      return;
    }

    await this.killExistingProcessesByTaskName(taskName);

    // 再起動遅延
    await new Promise(resolve => setTimeout(resolve, this.restartDelay));

    console.log(`タスクを即時実行中: ${task.name}`);
    for (const commandString of task.commands) {
      await this.executeCommand(commandString, task.name);
    }
  }


  public async killExistingProcessesByTaskName(taskName: string): Promise<void> {
    if (this.isShuttingDown) {
      console.log(`[${taskName}] シャットダウン中のため、プロセスの強制終了をスキップします。`);
      return;
    }

    const task = this.tasks.find(t => t.name === taskName);
    if (!task) {
      return;
    }
    const processesToKill: ProcessInfo[] = [];

    if (this.initialProcesses[taskName]) {
      processesToKill.push(...this.initialProcesses[taskName]);
    }

    try {
      for (const command of task.commands) {
        const processes = await this.findProcesses(command);
        processesToKill.push(...processes);
      }

      await this.killProcesses(processesToKill);
    } catch (error) {
      console.error("プロセスのキル中にエラーが発生しました:", error);
    }

    // 再起動遅延を追加
    await new Promise(resolve => setTimeout(resolve, this.restartDelay));
  }


  private async killProcesses(processesToKill: ProcessInfo[]): Promise<void> {
    if (this.isShuttingDown) {
      console.log('シャットダウン中のため、個別のプロセス強制終了をスキップします。');
      return;
    }

    for (const p of processesToKill) {
      console.log(`プロセス (PID: ${p.pid}, コマンド: ${p.command}) を強制終了します...`);
      try {
        kill(p.pid, 'SIGKILL', (killErr) => {
          if (killErr) {
            console.error(`強制プロセス終了エラー (PID: ${p.pid}):`, killErr);
          }
        });
      } catch (err: any) {
        console.error(`プロセス終了エラー (PID: ${p.pid}):`, err);
      }
    }

    // プロセスキル遅延を追加
    await new Promise(resolve => setTimeout(resolve, this.killDelay));
  }

  private async findProcesses(fullCommand: string): Promise<ProcessInfo[]> {
    const foundProcesses: ProcessInfo[] = [];

    try {
      let command: string;
      let args: string[];

      if (os.platform() === 'win32') {
        command = 'tasklist';
        args = ['/FO', 'CSV', '/NH'];
      } else {
        command = 'ps';
        args = ['-ax', '-o', 'pid,command'];
      }

      const { stdout } = await new Promise<{ stdout: string, stderr: string }>((resolve, reject) => {
        const process = spawn(command, args);
        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        process.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        process.on('close', (code) => {
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(new Error(`プロセス "${command}" がエラーコード ${code} で終了しました。stderr: ${stderr}`));
          }
        });

        process.on('error', (err) => {
          reject(err);
        });
      });

      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        let pid: string | undefined, processCommand: string | undefined;

        if (os.platform() === 'win32') {
          // Windows: tasklist の出力から PID とコマンドを抽出
          const values = line.split('","').map(v => v.replace(/"/g, '').trim());
          pid = values[1];
          processCommand = values[0];
        } else {
          // Linux/macOS: ps の出力から PID とコマンドを抽出
          const values = line.trim().split(' ');
          pid = values[0];
          processCommand = values.slice(1).join(' ');
        }
        //プロセス名にfullCommandが含まれているか確認
        if (processCommand && processCommand.includes(fullCommand)) {
          const parsedPid = parseInt(pid, 10);
          if (!isNaN(parsedPid)) {
            foundProcesses.push({ pid: parsedPid, command: processCommand });
          }
        }
      }
    } catch (error) {
      console.error("プロセスリスト取得エラー:", error);
      return [];
    }

    return foundProcesses;
  }

  private async determineWorkingDirectory(commandName: string): Promise<string | undefined> {
    if (this.workingDirCache[commandName]) {
      return this.workingDirCache[commandName]; // キャッシュから取得
    }

    let workingDir: string | undefined;
    try {
      // 絶対パスの場合、ディレクトリを取得
      if (path.isAbsolute(commandName)) {
        workingDir = path.dirname(commandName);
      } else {
        // 相対パスの場合、カレントディレクトリからの絶対パスに変換
        const absoluteCommandPath = path.resolve(commandName);
        workingDir = path.dirname(absoluteCommandPath);
      }

      if (fs.existsSync(workingDir) && fs.statSync(workingDir).isDirectory()) {
        // 存在する場合、それを作業ディレクトリとする
        this.workingDirCache[commandName] = workingDir;
        return workingDir;
      }
      else {
        workingDir = undefined
      }

      //以下従来の処理
      if (!workingDir) {
        const minecraftServerDir = this.minecraftServerDir;
        const subdirs = fs.readdirSync(minecraftServerDir, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name);

        // 類似度でソート
        subdirs.sort((a, b) => this.similarityScore(commandName, b) - this.similarityScore(commandName, a));

        let bestMatchDir = "";
        let bestMatchScore = 0;

        for (const subdir of subdirs) {
          const score = this.similarityScore(commandName, subdir);
          if (score > bestMatchScore) {
            bestMatchScore = score;
            bestMatchDir = subdir;
          }
        }

        const threshold = this.similarityThreshold;
        if (bestMatchScore > threshold) {
          workingDir = path.join(minecraftServerDir, bestMatchDir);
        } else {
          const parts = commandName.split("_");
          if (parts.length > 1) {
            const potentialWorkingDir = path.join(minecraftServerDir, parts[0]);
            if (fs.existsSync(potentialWorkingDir) && fs.statSync(potentialWorkingDir).isDirectory()) {
              workingDir = potentialWorkingDir;
            }
          }
        }
      }

      if (!workingDir) {
        workingDir = process.cwd();
        console.warn(`適切な作業ディレクトリを特定できませんでした。デフォルトの作業ディレクトリを使用します。`);
      }
    } catch (error) {
      console.error("作業ディレクトリ設定エラー:", error);
      workingDir = process.cwd();
    }

    this.workingDirCache[commandName] = workingDir; // キャッシュに保存
    return workingDir;
  }


  private similarityScore(str1: string, str2: string): number {
    str1 = str1.toLowerCase();
    str2 = str2.toLowerCase();
    const m = str1.length;
    const n = str2.length;
    if (m === 0 || n === 0) return 0;

    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) {
      dp[i][0] = i;
    }
    for (let j = 0; j <= n; j++) {
      dp[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(dp[i - 1][j - 1] + 1, dp[i][j - 1] + 1, dp[i - 1][j] + 1);
        }
      }
    }

    const maxLength = Math.max(m, n);
    return 1 - (dp[m][n] / maxLength);
  }

  // スケジューラ実行
  public run(runImmediately: boolean = false): void {
    if (this.tasks.length === 0) {
      console.log('実行するスケジュールされたタスクはありません。');
      return;
    }

    this.tasks.forEach(async task => {
      const [hours, minutes] = task.time.split(':');
      const scheduleTask = async () => {
        console.log(`[${new Date().toLocaleString()}] タスク実行: ${task.name}`);
        await this.killExistingProcessesByTaskName(task.name);

        // 再起動遅延
        await new Promise(resolve => setTimeout(resolve, this.restartDelay));

        for (const commandString of task.commands) {
          await this.executeCommand(commandString, task.name);
        }
      };

      const now = new Date();
      const taskTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(hours, 10), parseInt(minutes, 10), 0);
      let delay = taskTime.getTime() - now.getTime();

      if (runImmediately) {
        console.log(`タスク "${task.name}" を即時実行します。`);
        this.initialProcesses[task.name] = [];

        await this.killExistingProcessesByTaskName(task.name);

        // 再起動遅延
        await new Promise(resolve => setTimeout(resolve, this.restartDelay));

        for (const commandString of task.commands) {
          const processInfo = await this.executeCommand(commandString, task.name);
          if (processInfo) {
            this.initialProcesses[task.name].push(processInfo);
          }
        }
        runImmediately = false;
      }

      if (delay < 0) {
        delay += 24 * 60 * 60 * 1000;
      }

      setTimeout(() => {
        scheduleTask();
        setInterval(scheduleTask, 24 * 60 * 60 * 1000);
      }, delay);

      console.log(`タスク "${task.name}" を ${task.time} にスケジュールしました。`);
    });
    console.log('スケジューラを開始しました (インターバルを使用)。 Ctrl+C で終了します。');
  }
}

async function main() {
  const scheduler = new TaskScheduler('tasks.json');

  // コマンドライン引数の処理
  if (process.argv.includes('--run')) {
    // --run が指定されたら、タスクを即時実行し、その後スケジュールに従って実行
    scheduler.run(true);
    setupInputAndExit(scheduler);
    return;
  }

  if (process.argv.includes('--beta')) {
    const { taskToRun } = await inquirer.prompt<{ taskToRun: string }>([
      {
        type: 'list',
        name: 'taskToRun',
        message: 'どのタスクを即時実行しますか？',
        choices: scheduler.tasks.length > 0 ? scheduler.tasks.map(t => t.name) : ['タスクなし'],
      },
    ]);

    if (taskToRun && taskToRun !== 'タスクなし') {
      await scheduler.runTaskNow(taskToRun);
    }
    setupInputAndExit(scheduler);
    return;
  }

  // 通常のメニュー表示
  await showMenu(scheduler);
}

// 標準入力とSIGINTのセットアップ関数
function setupInputAndExit(scheduler: TaskScheduler) {
  process.stdin.on('data', (data) => {
    const input = data.toString();
    if (scheduler.runningTasks.length > 0) {
      scheduler.runningTasks[scheduler.runningTasks.length - 1].process.stdin.write(input)
    }
  });

  process.on('SIGINT', async () => {
    console.log('\nCtrl+C を検知。実行中のタスクを終了しています...');
    scheduler.isShuttingDown = true; // シャットダウンフラグを設定

    // 実行中のタスクを安全に終了
    for (const t of scheduler.runningTasks) {
      t.process.kill();
      await new Promise<void>((resolve) => {
        if (t.process.pid) {
          kill(t.process.pid, 'SIGKILL', () => resolve());
        } else {
          resolve();
        }
      });
    }

    // タスクに関連する残りのプロセスを強制終了
    for (const task of scheduler.tasks) {
      await scheduler.killExistingProcessesByTaskName(task.name);
    }

    console.log('すべてのプロセスを終了しました。');
    process.exit(0);
  });
}

// メニュー表示と処理を行う関数
async function showMenu(scheduler: TaskScheduler) {
  while (true) {
    console.clear();
    scheduler.displayTasks();

    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: 'アクションを選択してください:',
        choices: [
          'タスク追加',
          'タスク編集',
          'タスク削除',
          'スケジューラ実行',
          '終了',
        ],
      },
    ]);

    switch (action) {
      case 'タスク追加':
        await scheduler.addTask();
        break;
      case 'タスク編集':
        await scheduler.editTask();
        break;
      case 'タスク削除':
        await scheduler.deleteTask();
        break;
      case 'スケジューラ実行':
        scheduler.run();
        setupInputAndExit(scheduler);
        return;
      case '終了':
        scheduler.isShuttingDown = true; // シャットダウンフラグを設定

        // 実行中のタスクを安全に終了
        for (const t of scheduler.runningTasks) {
          t.process.kill();
          await new Promise<void>((resolve) => {
            if (t.process.pid) {
              kill(t.process.pid, 'SIGKILL', () => resolve());
            } else {
              resolve();
            }
          });
        }

        // タスクに関連する残りのプロセスを強制終了
        for (const task of scheduler.tasks) {
          await scheduler.killExistingProcessesByTaskName(task.name);
        }

        console.log('すべてのプロセスを終了しました。');
        process.exit(0);

      default:
        console.log('無効なアクションです。');
    }
  }
}

main();