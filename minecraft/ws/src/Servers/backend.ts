import { Server, ServerEvent, Player, PlayerChatSignal } from "socket-be";
import { promises as fsPromises } from "fs";
import path from "path";
import { EventEmitter } from "events";
const PLAYER_DATA_FILE = path.join(process.cwd(), "playerData.json");
const DEFAULT_PORT = 8000;
export const COMMAND_PREFIX = "-";
const DEBUG_MODE = "true";
const logger = {
  log: (...args: any[]) => {
    if (DEBUG_MODE) {
      console.log("[System]", ...args);
    }
  },
  warn: (...args: any[]) => {
    if (DEBUG_MODE) {
      console.warn("[System]", ...args);
    }
  },
  error: (...args: any[]) => {
    if (DEBUG_MODE) {
      console.error("[System]", ...args);
    }
  },
};
export interface CommandConfig {
  enabled: boolean;
  adminOnly: boolean;
  requireTag: string[];
}
type CommandExecutor = (
  system: System,
  player: Player,
  args: string[]
) => void | Promise<void>;
export interface Command {
  name: string;
  description: string;
  usage?: string;
  maxArgs?: number;
  minArgs?: number;
  config: CommandConfig;
  executor: CommandExecutor;
}
export interface PlayerData {
  name: string;
  oldNames: string[];
  uuid: string;
  join: string;
  left: string;
  isOnline: boolean;
}
export class System extends EventEmitter {
  private server: Server | null = null;
  public commands: Record<string, Command> = {};
  private playerDataCache: PlayerData[] = [];
  private isShuttingDown = false;
  private port: number;
  constructor(port: number = DEFAULT_PORT) {
    super();
    this.port = port;
    this.setMaxListeners(100);
  }
  async start(): Promise<void> {
    if (this.server) {
      logger.warn("Server is already running.");
      return;
    }
    this.server = new Server({ port: this.port });
    this.server.maxListeners = 100;
    this._setupInternalEventHandlers();
    this.server.on(ServerEvent.Open, async () => {
      console.log(`Socket-BE Server listening on port ${this.port}`);
      await this._initPlayerData();
      try {
        await import("./import");
        logger.log("Commands loaded successfully.");
      } catch (error) {
        logger.error("Error loading commands:", error);
      }
      this.emit(ServerEvent.Open.toString());
    });
    this.server.on(ServerEvent.Close, () => {
      console.log("Socket-BE Server closed.");
      this.server = null;
      this.isShuttingDown = false;
      this.emit(ServerEvent.Close.toString());
    });
    logger.log(
      "System initialization complete. Waiting for server connection..."
    );
  }
  async stop(): Promise<void> {
    await this._gracefulShutdown("Manual Stop");
  }
  private _setupInternalEventHandlers(): void {
    if (!this.server) return;
    const eventsToForward: ServerEvent[] = [
      ServerEvent.WorldAdd,
      ServerEvent.WorldRemove,
    ];
    for (const eventName of eventsToForward) {
      this.server.on(eventName, (...args: any[]) => {
        logger.log(`Forwarding event: ${eventName}`);
        this.emit(eventName.toString(), ...args);
      });
    }
    this.server.on(
      ServerEvent.PlayerJoin,
      async (payload: { player: Player }) => {
        const { player } = payload;
        if (!player || !player.uuid) {
          logger.warn(
            "Player join event with invalid player data received.",
            payload
          );
          return;
        }
        logger.log(`Player joining: ${player.name} (UUID: ${player.uuid})`);
        await this._handlePlayerJoin(player);
        this.emit(ServerEvent.PlayerJoin.toString(), payload);
      }
    );
    this.server.on(
      ServerEvent.PlayerLeave,
      async (payload: { player: Player }) => {
        const { player } = payload;
        if (!player || !player.uuid) {
          logger.warn(
            "Player leave event with potentially partial data.",
            payload
          );
          const uuid =
            player.uuid ||
            this.playerDataCache.find(
              (p) => p.name === player.name && p.isOnline
            )?.uuid;
          if (!uuid) {
            logger.error(
              "Cannot process PlayerLeave: Missing UUID and cannot find online player by name."
            );
            return;
          }
          logger.log(`Player leaving: ${player.name} (UUID: ${uuid})`);
          await this._handlePlayerLeave(player.name, uuid);
        } else {
          logger.log(`Player leaving: ${player.name} (UUID: ${player.uuid})`);
          await this._handlePlayerLeave(player.name, player.uuid);
        }
        this.emit(ServerEvent.PlayerLeave.toString(), payload);
      }
    );
    this.server.on(
      ServerEvent.PlayerChat,
      async (payload: PlayerChatSignal) => {
        const { sender, message } = payload;
        if (!sender || !sender.name) {
          logger.warn("Received chat event with invalid sender:", payload);
          return;
        }
        logger.log(`[Chat] ${sender.name}: ${message}`);
        this.emit(ServerEvent.PlayerChat.toString(), payload);
        if (message.startsWith(COMMAND_PREFIX)) {
          const trimmedMessage = message.slice(COMMAND_PREFIX.length).trim();
          if (!trimmedMessage) return;
          const args =
            trimmedMessage
              .match(/(".*?"|\S+)/g)
              ?.map((match: string) =>
                match.startsWith('"') && match.endsWith('"')
                  ? match.slice(1, -1)
                  : match
              ) ?? [];
          if (args.length === 0) return;
          const commandName = args.shift()!.toLowerCase();
          await this._processCommand(sender, commandName, args);
        }
      }
    );
  }


  registerCommand(command: Command): void {
    const commandNameLower = command.name.toLowerCase();
    if (this.commands[commandNameLower]) {
      logger.warn(
        `Command '${commandNameLower}' already registered. Overwriting.`
      );
    }
    const originalExecutor = command.executor;
    this.commands[commandNameLower] = {
      ...command,
      name: commandNameLower,
      executor: (system: System, player: Player, args: string[]) =>
        originalExecutor(system, player, args),
    };
    logger.log(`Command '${commandNameLower}' registered.`);
  }
  removeCommand(name: string): void {
    const commandNameLower = name.toLowerCase();
    if (this.commands[commandNameLower]) {
      delete this.commands[commandNameLower];
      logger.log(`Command '${commandNameLower}' removed.`);
    } else {
      logger.warn(`Command '${commandNameLower}' not found for removal.`);
    }
  }
  private async _processCommand(
    player: Player,
    commandName: string,
    args: string[]
  ): Promise<void> {
    const command = this.commands[commandName];
    if (!command) {
      player.sendMessage(
        `§c不明なコマンドです: ${COMMAND_PREFIX}${commandName}`
      );
      return;
    }
    const hasPermission = await this._verifier(player, command.config);
    if (!hasPermission) {
      return;
    }
    const usagePrefix = `${COMMAND_PREFIX}${command.name}`;
    const usageMessage = command.usage
      ? `使用法: ${usagePrefix} ${command.usage}`
      : `使用法: ${usagePrefix}`;
    if (command.minArgs !== undefined && args.length < command.minArgs) {
      player.sendMessage(`§c引数が不足しています。${usageMessage}`);
      return;
    }
    if (command.maxArgs !== undefined && args.length > command.maxArgs) {
      player.sendMessage(`§c引数が多すぎます。${usageMessage}`);
      return;
    }
    try {
      logger.log(
        `Executing command '${commandName}' for ${
          player.name
        } with args: [${args.join(", ")}]`
      );
      await command.executor(this, player, args);
    } catch (error) {
      logger.error(
        `Error executing command '${commandName}' for player ${player.name}:`,
        error
      );
      player.sendMessage("§cコマンドの実行中に予期せぬエラーが発生しました。");
    }
  }
  private async _loadPlayerData(): Promise<PlayerData[]> {
    try {
      await fsPromises.access(PLAYER_DATA_FILE);
      const data = await fsPromises.readFile(PLAYER_DATA_FILE, "utf-8");
      if (data.trim() === "") {
        this.playerDataCache = [];
        return [];
      }
      const jsonData = JSON.parse(data);
      if (!Array.isArray(jsonData)) {
        logger.warn(
          "playerData.json is not an array. Initializing with empty array."
        );
        await fsPromises.writeFile(PLAYER_DATA_FILE, "[]", "utf-8");
        this.playerDataCache = [];
        return [];
      }
      this.playerDataCache = jsonData;
      logger.log(`Loaded ${this.playerDataCache.length} player data entries.`);
      return this.playerDataCache;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.log("playerData.json not found. Creating a new file.");
        await fsPromises.writeFile(PLAYER_DATA_FILE, "[]", "utf-8");
        this.playerDataCache = [];
        return [];
      }
      logger.error("Error reading or parsing player data file:", error);
      this.playerDataCache = [];
      return [];
    }
  }
  private async _savePlayerData(): Promise<void> {
    try {
      const data = JSON.stringify(this.playerDataCache, null, 2);
      await fsPromises.writeFile(PLAYER_DATA_FILE, data, "utf8");
      logger.log("Player data saved.");
    } catch (error) {
      logger.error("Error saving player data:", error);
    }
  }
  private async _initPlayerData(): Promise<void> {
    await this._loadPlayerData();
    let changed = false;
    this.playerDataCache.forEach((p) => {
      if (p.isOnline) {
        p.isOnline = false;
        p.left = p.left || this._formatTimestamp();
        changed = true;
      }
    });
    if (changed) {
      logger.log(
        "Marked previously online players as offline during initialization."
      );
      await this._savePlayerData();
    }
  }
  private _findPlayerDataIndex(uuid: string): number {
    if (!uuid) return -1;
    return this.playerDataCache.findIndex((p) => p.uuid === uuid);
  }
  private async _handlePlayerJoin(player: Player): Promise<void> {
    const timestamp = this._formatTimestamp();
    let playerIndex = this._findPlayerDataIndex(player.uuid);
    if (playerIndex === -1) {
      const newEntry: PlayerData = {
        name: player.name,
        oldNames: [],
        uuid: player.uuid,
        join: timestamp,
        left: "",
        isOnline: true,
      };
      this.playerDataCache.push(newEntry);
      logger.log(`New player data created for ${player.name}`);
    } else {
      const existingEntry = this.playerDataCache[playerIndex];
      if (existingEntry.name !== player.name) {
        logger.log(
          `Player name changed: ${existingEntry.name} -> ${player.name} (UUID: ${player.uuid})`
        );
        if (!existingEntry.oldNames.includes(existingEntry.name)) {
          existingEntry.oldNames.unshift(existingEntry.name);
          if (existingEntry.oldNames.length > 5) {
            existingEntry.oldNames.pop();
          }
        }
        existingEntry.name = player.name;
      }
      existingEntry.isOnline = true;
      existingEntry.join = timestamp;
      existingEntry.left = "";
      logger.log(`Updated player data for returning player ${player.name}`);
    }
    await this._savePlayerData();
  }
  private async _handlePlayerLeave(
    playerName: string,
    playerUUID: string
  ): Promise<void> {
    const timestamp = this._formatTimestamp();
    let playerIndex = this._findPlayerDataIndex(playerUUID);
    if (playerIndex !== -1) {
      this.playerDataCache[playerIndex].isOnline = false;
      this.playerDataCache[playerIndex].left = timestamp;
      logger.log(
        `Marked player ${this.playerDataCache[playerIndex].name} as offline.`
      );
      await this._savePlayerData();
    } else {
      logger.warn(
        `Could not find player data in cache for leaving player: ${playerName} (${playerUUID}). Creating offline record.`
      );
      const newEntry: PlayerData = {
        name: playerName,
        oldNames: [],
        uuid: playerUUID,
        join: "",
        left: timestamp,
        isOnline: false,
      };
      this.playerDataCache.push(newEntry);
      await this._savePlayerData();
    }
  }
  private _formatTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const day = now.getDate().toString().padStart(2, "0");
    const hours = now.getHours().toString().padStart(2, "0");
    const minutes = now.getMinutes().toString().padStart(2, "0");
    const seconds = now.getSeconds().toString().padStart(2, "0");
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
  }
  private async _verifier(
    player: Player,
    config: CommandConfig
  ): Promise<boolean> {
    if (config.enabled !== true) {
      player.sendMessage("§cこのコマンドは現在無効です。");
      return false;
    }
    if (config.adminOnly === true) {
      try {
        if (!(await player.hasTag("admin"))) {
          player.sendMessage(
            "§cこのコマンドを使用するには管理者権限が必要です。"
          );
          return false;
        }
      } catch (error) {
        logger.error(`Error checking admin tag for ${player.name}:`, error);
        player.sendMessage("§c権限の確認中にエラーが発生しました。");
        return false;
      }
    }
    if (config.requireTag.length > 0) {
      try {
        const playerTags = await player.getTags();
        const hasRequiredTag = config.requireTag.some((requiredTag) =>
          playerTags.includes(requiredTag)
        );
        if (!hasRequiredTag) {
          player.sendMessage(
            `§cこのコマンドを使用するには次のタグが必要です: ${config.requireTag.join(
              ", "
            )}`
          );
          return false;
        }
      } catch (error) {
        logger.error(`Error checking required tags for ${player.name}:`, error);
        player.sendMessage("§cタグの確認中にエラーが発生しました。");
        return false;
      }
    }
    return true;
  }
  async executeMinecraftCommand(command: string): Promise<any> {
    if (!this.server) {
      logger.error("Server not initialized. Cannot execute command.");
      throw new Error("Server not initialized.");
    }
    const worlds = this.server.getWorlds();
    if (worlds.length === 0) {
      logger.error("No world available to execute command.");
      throw new Error("No world available.");
    }
    const world = worlds[0];
    try {
      logger.log(`Executing Minecraft command: /${command}`);
      const result = await world.runCommand(command);
      return result;
    } catch (error) {
      logger.error(`Error executing Minecraft command "/${command}":`, error);
      throw new Error(
        `Failed to execute command: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  async broadcastMessage(message: string): Promise<void> {
    if (!this.server) {
      logger.error("Server not initialized. Cannot broadcast message.");
      return;
    }
    const worlds = this.server.getWorlds();
    if (worlds.length === 0) {
      logger.error("No world available to broadcast message.");
      return;
    }
    const world = worlds[0];
    try {
      logger.log(`Broadcasting message: ${message}`);
      await world.runCommand(
        `tellraw @a {"rawtext":[{"text":"${message.replace(/"/g, '\\"')}"}]}`
      );
    } catch (error) {
      logger.error(`Error broadcasting message:`, error);
    }
  }
  async getPlayers(): Promise<Player[]> {
    if (!this.server) return [];
    const worlds = this.server.getWorlds();
    if (worlds.length === 0) return [];
    try {
      const world = worlds[0];
      if (world) {
        return await world.getPlayers();
      }
      return [];
    } catch (error) {
      logger.error("Error getting players:", error);
      return [];
    }
  }
  async getOnlinePlayerData(): Promise<PlayerData[]> {
    return JSON.parse(
      JSON.stringify(this.playerDataCache.filter((p) => p.isOnline))
    );
  }
  async getAllPlayerData(): Promise<PlayerData[]> {
    return JSON.parse(JSON.stringify(this.playerDataCache));
  }
  private async _gracefulShutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    console.log(`\n${signal} signal received. Shutting down gracefully...`);
    try {
      if (this.server) {
        console.log(
          "Marking remaining online players as offline in data file..."
        );
        const onlinePlayersUUIDs = this.playerDataCache
          .filter((p) => p.isOnline)
          .map((p) => p.uuid);
        const timestamp = this._formatTimestamp();
        let changed = false;
        for (const uuid of onlinePlayersUUIDs) {
          const idx = this._findPlayerDataIndex(uuid);
          if (idx !== -1) {
            this.playerDataCache[idx].isOnline = false;
            this.playerDataCache[idx].left = timestamp;
            changed = true;
            logger.log(
              `Marked ${this.playerDataCache[idx].name} as offline during shutdown.`
            );
          }
        }
        if (changed) {
          await this._savePlayerData();
          console.log("Saved final player statuses.");
        }
        console.log("Closing Socket-BE server connection...");
        this.server = null;
      }
      console.log("Server closed gracefully.");
      setTimeout(() => process.exit(0), 500);
    } catch (err) {
      console.error("Error during graceful shutdown:", err);
      process.exit(1);
    }
  }
  setupProcessListeners(): void {
    process.removeAllListeners("SIGINT");
    process.on("SIGINT", () => this._gracefulShutdown("SIGINT"));
    process.removeAllListeners("SIGTERM");
    process.on("SIGTERM", () => this._gracefulShutdown("SIGTERM"));
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", (reason, promise) => {
      console.error("Unhandled Rejection at:", promise, "reason:", reason);
      this._gracefulShutdown("UnhandledRejection").catch(() => process.exit(1));
    });
    process.removeAllListeners("uncaughtException");
    process.on("uncaughtException", (error) => {
      console.error("Uncaught Exception:", error);
      this._gracefulShutdown("UncaughtException").catch(() => process.exit(1));
    });
  }
}
const port = parseInt(
  process.env.SOCKET_BE_PORT || process.argv[2] || `${DEFAULT_PORT}`,
  10
);
let actualPort = port;
if (isNaN(port)) {
  console.error(
    `Invalid port number provided. Using default port ${DEFAULT_PORT}.`
  );
  actualPort = DEFAULT_PORT;
}
export const system = new System(actualPort);
system.setupProcessListeners();
system.start().catch((error) => {
  console.error("Failed to start the system:", error);
  process.exit(1);
});
