import { Server, ServerEvent, Player, World } from 'socket-be';
import { LocalAI, DEFAULT_BACKEND_URL } from './LocalAI';
import * as fs from 'fs';
import * as path from 'path';

interface Config {
    serverPort: number;
    commandPrefix: string;
    proposalTimeoutMinutes: number;
    maxConcurrentAIRequests: number;
    defaultAIProvider: string;
    defaultAIModel: string;
    aiBackendUrl: string;
    builderTag: string;
    enableModelSwitching: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    batchCommandSize: number;
    delayBetweenBatchesMs: number;
    maxCommandFailuresPercent: number;
}

const defaultConfig: Config = {
    serverPort: 8000,
    commandPrefix: '#',
    proposalTimeoutMinutes: 5,
    maxConcurrentAIRequests: 2,
    defaultAIProvider: "Gemini",
    defaultAIModel: 'gemini-2.0-flash',
    aiBackendUrl: DEFAULT_BACKEND_URL,
    builderTag: 'builder',
    enableModelSwitching: true,
    logLevel: 'info',
    batchCommandSize: 50,
    delayBetweenBatchesMs: 50,
    maxCommandFailuresPercent: 50,
};

const configPath = path.join(__dirname, 'config.json');
let config: Config = { ...defaultConfig };

try {
    if (fs.existsSync(configPath)) {
        const rawConfig = fs.readFileSync(configPath, 'utf-8');
        const userConfig = JSON.parse(rawConfig);
        config = { ...defaultConfig, ...userConfig };
        console.log(`設定ファイル '${configPath}' を読み込みました。`);
    } else {
        console.log(`設定ファイルが見つかりません。デフォルト設定を使用します: ${configPath}`);
    }
} catch (err: any) {
    console.error(`設定ファイルの読み込みまたはパース中にエラーが発生しました: ${err.message}`);
    console.warn('デフォルト設定を使用します。');
    config = { ...defaultConfig };
}

config.serverPort = process.env.PORT ? parseInt(process.env.PORT, 10) : config.serverPort;
config.defaultAIModel = process.env.AI_MODEL ?? config.defaultAIModel;
config.defaultAIProvider = process.env.AI_PROVIDER ?? config.defaultAIProvider;
config.aiBackendUrl = process.env.AI_BACKEND_URL ?? config.aiBackendUrl;

const logger = {
    debug: (message: string, ...args: any[]) => { if (['debug'].includes(config.logLevel)) console.debug(`[DEBUG] ${message}`, ...args); },
    info: (message: string, ...args: any[]) => { if (['debug', 'info'].includes(config.logLevel)) console.info(`[INFO] ${message}`, ...args); },
    warn: (message: string, ...args: any[]) => { if (['debug', 'info', 'warn'].includes(config.logLevel)) console.warn(`[WARN] ${message}`, ...args); },
    error: (message: string, ...args: any[]) => { if (['debug', 'info', 'warn', 'error'].includes(config.logLevel)) console.error(`[ERROR] ${message}`, ...args); },
};

interface BlockDefinition {
    id: string;
}

interface BlockPaletteEntry extends BlockDefinition {
    weight?: number;
}

type BlockPalette = BlockPaletteEntry[];
type PalettePattern = 'random' | 'checkerboard';

type PlacementMode = 'setblock' | 'fill' | 'hollow_box' | 'sphere' | 'cylinder';

type Axis = 'x' | 'y' | 'z';

interface BlockPlacement {
    position: { x: number; y: number; z: number };
    placement_mode?: PlacementMode;
    block?: BlockDefinition;
    block_palette?: BlockPalette;
    palette_pattern?: PalettePattern;

    fill_dimensions?: { length: number; width: number; height: number };
    replace_filter?: string;

    sphere_radius?: number;
    sphere_hollow?: boolean;

    cylinder_radius?: number;
    cylinder_height?: number;
    cylinder_axis?: Axis;
    cylinder_hollow?: boolean;

    comment?: string;
}

interface StructureProposalJson {
    structure: {
        position: { x: number; y: number; z: number };
        dimensions?: { length: number; width: number; height: number };
        blocks: BlockPlacement[];
        [key: string]: any;
    };
}

interface PendingProposal {
    playerName: string;
    originX: number;
    originY: number;
    originZ: number;
    description: string;
    buildJson: StructureProposalJson;
    timestamp: number;
    modelUsed: string;
}

const pendingBuildProposals: Map<string, PendingProposal> = new Map();
const PROPOSAL_TIMEOUT_MS = config.proposalTimeoutMinutes * 60 * 1000;
const processingRequests: Set<string> = new Set();
const playerModels: Map<string, string> = new Map();

const server = new Server({ port: config.serverPort });
const localAI = new LocalAI(config.defaultAIProvider, config.defaultAIModel, config.aiBackendUrl);

server.on(ServerEvent.Open, async () => {
    logger.info(`サーバーがポート ${config.serverPort} で起動しました (状態/NBTなし モード)`);
    logger.info(`使用中のAIプロバイダー: ${config.defaultAIProvider}`);
    logger.info(`使用中のAIバックエンド: ${config.aiBackendUrl}`);
    logger.info(`デフォルトAIモデル: ${config.defaultAIModel}`);
    logger.info(`同時AI処理上限: ${config.maxConcurrentAIRequests}`);
    logger.info(`コマンドプレフィックス: '${config.commandPrefix}'`);
    logger.info(`提案タイムアウト: ${config.proposalTimeoutMinutes} 分`);
    logger.info(`建築権限タグ: '${config.builderTag}'`);
    logger.info(`ログレベル: ${config.logLevel}`);

    setInterval(cleanupExpiredProposals, 60 * 1000);

    try {
        const models = await localAI.getAvailableModels();
        if (models && models.length > 0) {
            logger.info(`利用可能なAIモデル: ${models.join(', ')}`);
            if (!models.includes(config.defaultAIModel)) {
                logger.warn(`デフォルトモデル '${config.defaultAIModel}' は利用可能なモデルリストにありません。`);
            }
        } else {
            logger.warn('利用可能なAIモデルリストを取得できませんでした。');
        }
    } catch (err: any) {
        logger.error(`AIモデルリスト取得エラー: ${err.message}`);
    }
});

server.on(ServerEvent.Close, () => logger.info('サーバー停止'));

server.on(ServerEvent.PlayerChat, async ev => {
    const { sender, message, world } = ev;
    if (sender.name === 'External' || !message.startsWith(config.commandPrefix)) return;

    const playerName = sender.name;
    const commandBody = message.substring(config.commandPrefix.length).trim();
    const args = commandBody.split(/\s+/);
    const command = args[0]?.toLowerCase();
    if (!command) return;

    logger.info(`<${playerName}> ${message}`);

    if (command === 'ping') {
        try { await sender.sendMessage('§a[AI] Pong! (状態/NBTなし モード)'); } catch (e: any) { logger.error(`Pong送信失敗: ${e.message}`); }
        return;
    }

    if (command === 'build') {
        const subCommand = args[1]?.toLowerCase();

        if (subCommand === 'accept') {
            const proposal = pendingBuildProposals.get(playerName);
            if (proposal) {
                logger.info(`プレイヤー ${playerName} が提案 '${proposal.description}' を承認 (モデル: ${proposal.modelUsed})`);
                pendingBuildProposals.delete(playerName);
                await executeBuild(proposal, world, sender);
            } else {
                try { await sender.sendMessage(`§c[AI] 承認待ちの提案がありません。`); } catch (e: any) { logger.error(`Msg送信失敗: ${e.message}`); }
            }
            return;
        }

        if (subCommand === 'deny') {
            const proposal = pendingBuildProposals.get(playerName);
            if (proposal) {
                pendingBuildProposals.delete(playerName);
                logger.info(`プレイヤー ${playerName} が提案 '${proposal.description}' を拒否`);
                try { await sender.sendMessage(`§e[AI] 提案 '${proposal.description ?? ''}' をキャンセルしました。`); } catch (e: any) { logger.error(`Msg送信失敗: ${e.message}`); }
            } else {
                try { await sender.sendMessage(`§c[AI] キャンセルする提案がありません。`); } catch (e: any) { logger.error(`Msg送信失敗: ${e.message}`); }
            }
            return;
        }

        if (subCommand === 'info') {
            const proposal = pendingBuildProposals.get(playerName);
            if (proposal) {
                try {
                    const blockCount = proposal.buildJson.structure.blocks.length;
                    const dimensions = proposal.buildJson.structure.dimensions;
                    let dimStr = dimensions ? ` 推定サイズ ~${dimensions.length}x${dimensions.width}x${dimensions.height}` : "";
                    const timeRemaining = Math.max(0, Math.ceil((proposal.timestamp + PROPOSAL_TIMEOUT_MS - Date.now()) / 60000));

                    await sender.sendMessage(`§b--- AI 建築提案 ---`);
                    await sender.sendMessage(`§7提案者: §f${proposal.playerName}`);
                    await sender.sendMessage(`§7説明: §f${proposal.description}`);
                    await sender.sendMessage(`§7基点座標: §f(${proposal.originX}, ${proposal.originY}, ${proposal.originZ})`);
                    await sender.sendMessage(`§7要素数: §f${blockCount} 個の配置定義`);
                    await sender.sendMessage(`§7使用モデル: §f${proposal.modelUsed}`);
                    if (dimStr) await sender.sendMessage(`§7${dimStr}`);
                    await sender.sendMessage(`§7有効期限: §f約 ${timeRemaining} 分`);
                    await sender.sendMessage(`§e承認: ${config.commandPrefix}build accept | 拒否: ${config.commandPrefix}build deny`);
                } catch (e: any) { logger.error(`提案情報送信失敗: ${e.message}`); }
            } else {
                try { await sender.sendMessage(`§c[AI] 表示する保留中の提案がありません。`); } catch (e: any) { logger.error(`Msg送信失敗: ${e.message}`); }
            }
            return;
        }

        let currentArgIndex = 1;
        let targetModel = playerModels.get(playerName) ?? config.defaultAIModel;

        if (config.enableModelSwitching && (args[currentArgIndex] === '--model' || args[currentArgIndex] === 'model')) {
            if (args.length > currentArgIndex + 1) {
                targetModel = args[currentArgIndex + 1];
                playerModels.set(playerName, targetModel);
                currentArgIndex += 2;
                try { await sender.sendMessage(`§d[AI] 今回のリクエストでモデル '${targetModel}' を使用します。(次回も継続)`); } catch (e) { }
                logger.info(`Player ${playerName} set temporary model to: ${targetModel}`);
            } else {
                try { await sender.sendMessage(`§c[AI] モデル名を指定してください。例: ${config.commandPrefix}build model gpt-4 ~ ~ ~ ...`); } catch (e) { }
                return;
            }
        } else {
            targetModel = playerModels.get(playerName) ?? config.defaultAIModel;
        }

        const coordArgs = args.slice(currentArgIndex, currentArgIndex + 3);
        const promptArgs = args.slice(currentArgIndex + 3);

        if (coordArgs.length !== 3 || promptArgs.length === 0) {
            try {
                let usage = `${config.commandPrefix}build`;
                if (config.enableModelSwitching) usage += ` [model <model_name>]`;
                usage += ` <x|~> <y|~> <z|~> <description>`;
                await sender.sendMessage(`§c[AI] 使用法: ${usage}`);
            } catch (e) { }
            return;
        }

        try {
            const hasPermission = await checkPlayerPermission(sender, config.builderTag);
            if (!hasPermission) {
                logger.warn(`${sender.name} は '${config.builderTag}' タグがないため拒否されました`);
                try { await sender.sendMessage(`§c[AI] このコマンドを使用するには権限 ('${config.builderTag}') が必要です`); } catch (e: any) { logger.error(`メッセージ送信失敗: ${e.message}`); }
                return;
            }
        } catch (tagError: any) {
            logger.error(`${sender.name} のタグ確認中にエラー: ${tagError.message}`);
            try { await sender.sendMessage(`§c[AI] 権限確認中にエラーが発生しました`); } catch (e: any) { logger.error(`エラーメッセージ送信失敗: ${e.message}`); }
            return;
        }


        if (processingRequests.has(playerName)) {
            try { await sender.sendMessage(`§e[AI] 現在、あなたの以前のリクエストを処理中です。完了までお待ちください。`); } catch (e) { }
            return;
        }
        if (processingRequests.size >= config.maxConcurrentAIRequests) {
            logger.warn(`同時処理上限 (${config.maxConcurrentAIRequests}) に達したため、${playerName} のリクエストを拒否`);
            try { await sender.sendMessage(`§e[AI] サーバーが混み合っています (${processingRequests.size}/${config.maxConcurrentAIRequests})。少し待ってから再試行してください。`); } catch (e) { }
            return;
        }

        if (pendingBuildProposals.has(playerName)) {
            const oldProposal = pendingBuildProposals.get(playerName);
            pendingBuildProposals.delete(playerName);
            logger.info(`${playerName} の旧提案 ('${oldProposal?.description}') を削除しました`);
            try { await sender.sendMessage(`§e[AI] 保留中の古い提案を破棄しました。新しい提案を作成します...`); } catch (e) { }
        }

        let x: number, y: number, z: number;
        try {
            const posResult = await resolveCoordinates(sender, coordArgs[0], coordArgs[1], coordArgs[2]);
            x = posResult.x; y = posResult.y; z = posResult.z;
        } catch (posError: any) {
            logger.error(`${playerName} の座標解決中にエラー:`, posError);
            try { await sender.sendMessage(`§c[AI] 座標の指定または取得でエラーが発生しました: ${posError.message}`); } catch (e: any) { logger.error(`エラーメッセージ送信失敗: ${e.message}`); }
            return;
        }

        const userPrompt = promptArgs.join(" ").trim();
        logger.info(`Player ${playerName} requested build: (${x}, ${y}, ${z}), Prompt: "${userPrompt}", Model: ${targetModel}`);

        processingRequests.add(playerName);
        try {
            await sender.sendMessage(`§7[AI] 設計図をAI (${targetModel}) に問い合わせ中 (状態/NBTなし) 建築場所: (${x}, ${y}, ${z})...`);

            const aiSystemPrompt = `あなたはMinecraft Bedrock Edition用の3DブロックデザイナーAIです。ユーザーの指示に基づき、構造物を生成するためのJSON設計図を作成します。ブロックの状態(States)やNBTデータは**指定せず**、基本的なブロックIDのみを使用してください。利用可能な配置モード ('setblock', 'fill', 'hollow_box', 'sphere', 'cylinder') と、ブロックパレット ('block_palette')、置き換えフィルター ('replace_filter') を効果的に活用してください。

**最重要:** 設計図は、必ず以下の単純化されたJSONフォーマットに従い、\`\`\`json ... \`\`\` で囲んでください。JSON内部にコメントを含めないでください。Markdownフォーマット以外に余計なテキストは含めないでください。

応答形式:
1. 生成するオブジェクトの簡単な日本語の説明（50文字以内）。
2. 2つの改行 (\n\n)。
3. 以下のJSON形式の設計データを \`\`\`json ... \`\`\` で囲む。

--- 単純化JSON仕様 (状態/NBTなし) ---
- "structure.position": { "x": 0, "y": 0, "z": 0 } に固定。
- "structure.dimensions": (任意) 全体目安 { "length": X, "width": Z, "height": Y }。
- "structure.blocks": (必須) BlockPlacementオブジェクトの配列。
    - "position": { "x": number, "y": number, "z": number } - 配置の基準となる相対座標。
        - 'setblock': 配置座標。
        - 'fill', 'hollow_box': 範囲の最小座標コーナー (X,Y,Zが最小)。
        - 'sphere', 'cylinder': 形状の中心座標 (Cylinderは底面の円の中心)。
    - "placement_mode": (必須) 'setblock', 'fill', 'hollow_box', 'sphere', 'cylinder' のいずれか。
    - "block": { "id": string (必須, "minecraft:" 接頭辞付き) } - 単一ブロック指定。**状態(states)やNBTは含めないでください。**
    - "block_palette": BlockPaletteEntry[]? - 複数ブロック混合。各エントリ: { "id": string (必須, "minecraft:"付き), "weight": number? }。**状態(states)やNBTは含めないでください。** 'block'指定時は無視。
    - "palette_pattern": "random"? | "checkerboard"? - パレットパターン。デフォルト "random"。 ('checkerboard' はランダムとして処理)。
    - "fill_dimensions": ('fill', 'hollow_box' で必須) { "length": number (X), "width": number (Z), "height": number (Y) } (>= 1)。
    - "replace_filter": ('fill', 'hollow_box' で任意) string? - 例 "minecraft:air"。 /fill コマンドの \`replace <filterBlock>\` に使うブロックID。
    - "sphere_radius": ('sphere' で必須) number >= 0.5。
    - "sphere_hollow": ('sphere' で任意) boolean (デフォルト false)。
    - "cylinder_radius": ('cylinder' で必須) number >= 0.5。
    - "cylinder_height": ('cylinder' で必須) number >= 1。
    - "cylinder_axis": ('cylinder' で任意) "x" | "y" | "z" (デフォルト "y")。
    - "cylinder_hollow": ('cylinder' で任意) boolean (デフォルト false)。
    - "comment": (任意) 設計メモ (実行時無視)。

設計戦略:
- **基礎:** 'fill' ('replace_filter'も活用)で土台や地面。
- **構造:** 'hollow_box', 'cylinder'(hollow=true), 'fill', 'sphere'(hollow=false)。
- **ディテール:** 'setblock'。単純なブロックIDのみ使用。
- **テクスチャ:** 'fill'/'sphere'/'cylinder' + 'block_palette' + 'palette_pattern: "random"'。

注意点:
- ブロックIDには常に "minecraft:" を付けてください。
- 各モードの必須パラメータを確認してください。
- **絶対にブロックの状態(States)やNBTデータを含めないでください。**

JSON 例 (単純な石レンガの球と柱):
\`\`\`json
{
  "structure": {
    "position": { "x": 0, "y": 0, "z": 0 },
    "blocks": [
      {
        "comment": "中空の石球",
        "position": { "x": 0, "y": 9, "z": 0 },
        "placement_mode": "sphere",
        "sphere_radius": 4,
        "sphere_hollow": true,
        "block": { "id": "minecraft:stone" }
      },
      {
        "comment": "石レンガの柱",
        "position": { "x": 0, "y": 0, "z": 0 },
        "placement_mode": "cylinder",
        "cylinder_radius": 1,
        "cylinder_height": 9,
        "block": { "id": "minecraft:stone_bricks" },
        "replace_filter": "minecraft:air"
      }
    ]
  }
}
\`\`\`
`;
            const aiUserMessage = `User Request: ${userPrompt}\nTarget Coordinates (for context only, use relative 0,0,0 in JSON): ${x}, ${y}, ${z}`;

            logger.info(`Sending request to - Provider: ${config.defaultAIProvider}, Model: ${targetModel}`);
            const aiFullResponse = await localAI.chat(`${aiSystemPrompt}\n\n${aiUserMessage}`, { modelName: targetModel });
            logger.debug(`AI response received (Length: ${aiFullResponse.length})`);
            logger.debug(`Raw AI response:\n${aiFullResponse}`);

            const descriptionAndJson = parseAiResponse(aiFullResponse);
            if (!descriptionAndJson) {
                throw new Error("AIからの応答形式が無効です。有効な説明とJSONコードブロックが見つかりませんでした。");
            }
            const { description, jsonString } = descriptionAndJson;

            let buildJson: StructureProposalJson;
            try {
                buildJson = JSON.parse(jsonString);
                validateStructureJson(buildJson);
            } catch (parseError: any) {
                logger.error("AI応答JSONのパースまたは検証に失敗しました:", parseError.message);
                logger.error("エラーが発生したJSON:\n", jsonString);
                throw new Error(`AIからの設計データ解析/検証失敗: ${parseError.message}`);
            }

            logger.info(`AI Description: ${description}`);
            const blockDefCount = buildJson.structure.blocks.length;
            logger.info(`AI JSON parsed successfully: ${blockDefCount} placement definitions.`);

            const newProposal: PendingProposal = {
                playerName, originX: x, originY: y, originZ: z, description, buildJson, timestamp: Date.now(), modelUsed: targetModel
            };
            pendingBuildProposals.set(playerName, newProposal);
            await sender.sendMessage(`§a[AI] 提案 '${description}' (§f${blockDefCount}定義§a) を ${targetModel} が作成しました。(状態/NBTなし)`);
            await sender.sendMessage(`§e建築しますか？ ${config.commandPrefix}build accept | ${config.commandPrefix}build deny`);
            await sender.sendMessage(`§b詳細確認: ${config.commandPrefix}build info`);
            await sender.sendMessage(`§7(提案は ${config.proposalTimeoutMinutes} 分間有効です)`);

        } catch (error: any) {
            logger.error(`Player ${playerName}'s build command failed:`, error);
            try {
                await sendErrorMessageToPlayer(sender, error, config.aiBackendUrl);
            } catch (sendError: any) { logger.error('Failed to send error message to player:', sendError.message); }
        } finally {
            processingRequests.delete(playerName);
            logger.info(`AI request processing finished for ${playerName}. Current concurrent requests: ${processingRequests.size}`);
        }

    }
    else {
        if (commandBody.length > 0) {
            try { await sender.sendMessage(`§c[AI] 無効なコマンド '${command}' です。`); } catch (e) { }
        }
    }
});

async function checkPlayerPermission(player: Player, requiredTag: string): Promise<boolean> {
    if (!requiredTag) return true;
    try {
        const playerAny = player as any;
        if (typeof playerAny.getTags === 'function') {
            const tags = await playerAny.getTags();
            return tags.includes(requiredTag);
        } else if (typeof playerAny.hasTag === 'function') {
            return await playerAny.hasTag(requiredTag);
        } else {
            logger.warn(`タグ確認機能が見つかりません (Player: ${player.name})。権限チェックをスキップします。`);
            return true;
        }
    } catch (error: any) {
        logger.error(`${player.name} のタグ確認中にエラー:`, error);
        throw new Error(`権限確認中にエラーが発生しました。`);
    }
}

async function resolveCoordinates(player: Player, xStr: string, yStr: string, zStr: string): Promise<{ x: number; y: number; z: number }> {
    let playerX = 0, playerY = 0, playerZ = 0;
    let needsPlayerPos = xStr === '~' || yStr === '~' || zStr === '~';

    if (needsPlayerPos) {
        try {
            const playerAny = player as any;
            if (typeof playerAny.getPosition === 'function') {
                const pos = await playerAny.getPosition();
                if (!pos) throw new Error("プレイヤーの位置情報を取得できませんでした。");
                playerX = Math.floor(pos.x);
                playerY = Math.floor(pos.y);
                playerZ = Math.floor(pos.z);
            } else {
                logger.warn(`プレイヤー ${player.name} の getPosition 関数が見つかりません。相対座標の基点を (0,0,0) とします。`);
            }
        } catch (err: any) {
            logger.error(`プレイヤー ${player.name} の位置取得中にエラー:`, err);
            throw new Error("プレイヤーの現在位置を取得できませんでした。");
        }
    }

    const x = xStr === '~' ? playerX : parseInt(xStr, 10);
    const y = yStr === '~' ? playerY : parseInt(yStr, 10);
    const z = zStr === '~' ? playerZ : parseInt(zStr, 10);

    if (isNaN(x) || isNaN(y) || isNaN(z)) {
        throw new Error("座標の値が無効です。数値または ~ を使用してください。");
    }
    return { x, y, z };
}

async function sendErrorMessageToPlayer(sender: Player, error: Error, aiBackendUrl: string): Promise<void> {
    let displayError = error.message || "不明なエラーが発生しました";

    if (error.message.includes("AIからの応答形式が無効")) {
        displayError = "AI応答を正しく解析できませんでした(説明やJSONが見つからない等)。";
    } else if (error.message.includes("設計データ解析/検証失敗")) {
        displayError = `AIが生成した設計データに問題があります: ${error.message.split(':').slice(1).join(':').trim()}`;
    } else if (error.message.includes("fetch") || /ECONNREFUSED|ETIMEDOUT|timeout/.test(error.message)) {
        displayError = `AIバックエンド (${aiBackendUrl}) への接続に失敗しました。時間をおいて再試行してください。`;
    } else if (error.message.includes("structure.blocks が空")) {
        displayError = "AIがブロック情報のない空の設計図を生成しました。";
    }
    else if (displayError.length > 100) {
        displayError = displayError.substring(0, 97) + "...";
    }

    try {
        await sender.sendMessage(`§c[AI] エラー: ${displayError}`);
    } catch (sendError: any) {
        logger.error('Failed to send error message to player:', sendError.message);
    }
}

function getBlockIdString(blockDef: BlockDefinition | BlockPaletteEntry): string {
    if (!blockDef || !blockDef.id) {
        logger.warn("無効なブロック定義が渡されました:", blockDef);
        return 'minecraft:stone';
    }
    const id = blockDef.id.startsWith('minecraft:') ? blockDef.id : `minecraft:${blockDef.id}`;
    return id;
}

function chooseBlockFromPalette(palette: BlockPalette): BlockDefinition | BlockPaletteEntry | null {
    if (!palette || palette.length === 0) {
        logger.warn("chooseBlockFromPalette: 空または無効なパレットが渡されました。");
        return null;
    }
    if (palette.length === 1) return palette[0];

    let totalWeight = 0;
    for (const entry of palette) {
        totalWeight += Math.max(0, entry.weight ?? 1);
    }

    if (totalWeight <= 0) {
        logger.warn("chooseBlockFromPalette: パレットの合計重みが0以下。均等確率で選択します。");
        return palette[Math.floor(Math.random() * palette.length)];
    }

    let randomWeight = Math.random() * totalWeight;
    for (const entry of palette) {
        const currentWeight = Math.max(0, entry.weight ?? 1);
        if (randomWeight <= currentWeight) {
            return entry;
        }
        randomWeight -= currentWeight;
    }

    logger.warn("chooseBlockFromPalette: フォールバック選択が発生しました。");
    return palette[palette.length - 1];
}


function parseAiResponse(responseText: string): { description: string; jsonString: string } | null {
    const jsonRegex = /```json\s*([\s\S]+?)\s*```/;
    const jsonMatch = responseText.match(jsonRegex);
    let rawJsonString = '';

    if (jsonMatch && jsonMatch[1]) {
        rawJsonString = jsonMatch[1].trim();
        logger.debug("Found JSON block using ```json markup.");
    } else {
        const simpleJsonRegex = /(\{\s*("structure":\s*\{[\s\S]*})\s*\})/m;
        const simpleJsonMatch = responseText.match(simpleJsonRegex);
        if (simpleJsonMatch && simpleJsonMatch[1]) {
            rawJsonString = simpleJsonMatch[1].trim();
            logger.warn("JSON block in ```json markup not found. Using simple {...} match as fallback.");
        } else {
            logger.error("AI response does not contain a recognizable JSON block (```json or simple {...}).");
            logger.debug("Response Text:", responseText);
            return null;
        }
    }

    let cleanedJsonString = rawJsonString.replace(/^\s*\/\/.*$/gm, '');
    cleanedJsonString = cleanedJsonString.replace(/\/\*[\s\S]*?\*\//g, '');
    cleanedJsonString = cleanedJsonString.replace(/,(?=\s*[}\]])/g, '');


    let description = "AIによって生成された建造物";
    const jsonStartIndex = responseText.indexOf(rawJsonString);
    let textBeforeJson = "";

    if (jsonMatch?.index !== undefined) {
        textBeforeJson = responseText.substring(0, jsonMatch.index).trim();
    } else if (jsonStartIndex > 0) {
        textBeforeJson = responseText.substring(0, jsonStartIndex).trim();
    } else {
        textBeforeJson = responseText.replace(rawJsonString, "").trim();
    }


    if (textBeforeJson) {
        const lines = textBeforeJson.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        if (lines.length > 0) {
            description = lines[lines.length - 1];
        } else {
            description = textBeforeJson.split('\n')[0].trim();
        }
    } else {
        let textAfterJson = "";
        const jsonEndIndex = jsonStartIndex + rawJsonString.length;
        if (jsonStartIndex >= 0 && jsonEndIndex < responseText.length) {
            textAfterJson = responseText.substring(jsonEndIndex).trim();
            const lines = textAfterJson.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            if (lines.length > 0) {
                description = lines[0];
            }
        }
    }

    description = description.replace(/^[\*->\s!"'#]*(説明|概要|名称|Title|Description):?\s*/i, '').trim();
    description = description.replace(/^\(?(.*?)\)?$/, '$1').trim();
    if (description.length > 80) {
        description = description.substring(0, 77) + "...";
    }
    if (!description) {
        description = "名称未設定のAI建造物";
    }

    logger.debug("Parsed description:", description);
    logger.debug("Cleaned JSON string (before final parse/stringify):\n", cleanedJsonString);

    try {
        const parsedJson = JSON.parse(cleanedJsonString);
        if (!parsedJson.structure || !Array.isArray(parsedJson.structure.blocks)) {
            logger.warn("Parsed JSON lacks basic structure ('structure.blocks' array).");
        }
        const finalJsonString = JSON.stringify(parsedJson, null, 2);
        return { description, jsonString: finalJsonString };
    } catch (e: any) {
        logger.error(`Failed to parse cleaned JSON string: ${e.message}`);
        logger.warn("Returning the cleaned JSON string without re-formatting. Validation might fail later.");
        return { description, jsonString: cleanedJsonString };
    }
}

function validateStructureJson(data: any): asserts data is StructureProposalJson {
    if (!data || typeof data !== 'object') throw new Error("JSONデータ自体が無効");
    if (!data.structure || typeof data.structure !== 'object') throw new Error("ルートに 'structure' オブジェクトが必要");

    const structure = data.structure;
    if (!structure.position || typeof structure.position.x !== 'number' || typeof structure.position.y !== 'number' || typeof structure.position.z !== 'number') {
        throw new Error("'structure.position' {x, y, z} (number) が必須");
    }
    if (structure.position.x !== 0 || structure.position.y !== 0 || structure.position.z !== 0) {
        logger.warn("structure.position が {0, 0, 0} ではありません。");
    }

    if (!Array.isArray(structure.blocks)) throw new Error("'structure.blocks' は配列である必要あり");
    if (structure.blocks.length === 0) logger.warn("Warning: 'structure.blocks' は空です。");

    structure.blocks.forEach((block: any, i: number) => {
        const errorPrefix = `structure.blocks[${i}]`;
        if (!block || typeof block !== 'object') throw new Error(`${errorPrefix}: オブジェクト形式が必要`);
        if (!block.position || typeof block.position.x !== 'number' || typeof block.position.y !== 'number' || typeof block.position.z !== 'number') {
            throw new Error(`${errorPrefix}: 'position' {x, y, z} (number) が必須`);
        }

        const mode = block.placement_mode ?? 'setblock';
        if (typeof mode !== 'string' || !['setblock', 'fill', 'hollow_box', 'sphere', 'cylinder'].includes(mode)) {
            throw new Error(`${errorPrefix}: 'placement_mode' が無効 (${mode})`);
        }
        block.placement_mode = mode;

        const hasSingleBlock = block.block && typeof block.block === 'object';
        const hasPalette = Array.isArray(block.block_palette) && block.block_palette.length > 0;

        if (!hasSingleBlock && !hasPalette) {
            throw new Error(`${errorPrefix}: 'block' または 'block_palette' のいずれかが必要`);
        }
        if (hasSingleBlock && hasPalette) {
            logger.warn(`${errorPrefix}: 'block' と 'block_palette' が両方指定。'block_palette' を優先`);
        }

        const blockDefsToCheck: any[] = hasPalette ? block.block_palette : [block.block];
        const isPaletteContext = hasPalette;
        blockDefsToCheck.forEach((bDef: any, pIdx: number) => {
            const defPrefix = isPaletteContext ? `${errorPrefix}.block_palette[${pIdx}]` : `${errorPrefix}.block`;
            if (!bDef || typeof bDef !== 'object') throw new Error(`${defPrefix}: オブジェクト形式が必要`);
            if (typeof bDef.id !== 'string' || !bDef.id.startsWith('minecraft:')) {
                throw new Error(`${defPrefix}: 'id' (string) が必須で、"minecraft:" で始まる必要あり (Got: ${bDef.id})`);
            }
            if (bDef.states !== undefined) {
                logger.warn(`${defPrefix}: 'states' が指定されていますが、無視されます。`);
            }
            if (bDef.nbt !== undefined) {
                logger.warn(`${defPrefix}: 'nbt' が指定されていますが、無視されます。`);
            }
            if (isPaletteContext && bDef.weight !== undefined && (typeof bDef.weight !== 'number' || bDef.weight < 0)) {
                throw new Error(`${defPrefix}: 'weight' は0以上の数値である必要あり`);
            }
        });

        if (hasPalette) {
            const pattern = block.palette_pattern ?? 'random';
            if (typeof pattern !== 'string' || !['random', 'checkerboard'].includes(pattern)) {
                throw new Error(`${errorPrefix}: 'palette_pattern' が無効 (${pattern})`);
            }
            block.palette_pattern = pattern;
            if (pattern === 'checkerboard') logger.warn(`${errorPrefix}: 'palette_pattern: checkerboard' は 'random' として扱われます。`);
        }

        switch (mode) {
            case 'fill':
            case 'hollow_box':
                if (!block.fill_dimensions || typeof block.fill_dimensions !== 'object') throw new Error(`${errorPrefix} (${mode}): 'fill_dimensions' が必須`);
                const dims = block.fill_dimensions;
                if (typeof dims.length !== 'number' || dims.length < 1) throw new Error(`${errorPrefix} (${mode}): 'fill_dimensions.length' (X) は1以上`);
                if (typeof dims.width !== 'number' || dims.width < 1) throw new Error(`${errorPrefix} (${mode}): 'fill_dimensions.width' (Z) は1以上`);
                if (typeof dims.height !== 'number' || dims.height < 1) throw new Error(`${errorPrefix} (${mode}): 'fill_dimensions.height' (Y) は1以上`);
                if (block.replace_filter !== undefined && typeof block.replace_filter !== 'string') {
                    throw new Error(`${errorPrefix} (${mode}): 'replace_filter' は文字列`);
                }
                if (block.replace_filter && !block.replace_filter.startsWith('minecraft:')) {
                    logger.warn(`${errorPrefix} (${mode}): 'replace_filter' (${block.replace_filter}) に "minecraft:" を追加します。`);
                    block.replace_filter = `minecraft:${block.replace_filter}`;
                }
                break;
            case 'sphere':
                if (typeof block.sphere_radius !== 'number' || block.sphere_radius < 0.5) throw new Error(`${errorPrefix} (sphere): 'sphere_radius' は0.5以上`);
                if (block.sphere_radius < 1) logger.warn(`${errorPrefix} (sphere): 'sphere_radius' (${block.sphere_radius}) が1未満`);
                if (block.sphere_hollow !== undefined && typeof block.sphere_hollow !== 'boolean') throw new Error(`${errorPrefix} (sphere): 'sphere_hollow' は boolean`);
                block.sphere_hollow = block.sphere_hollow ?? false;
                break;
            case 'cylinder':
                if (typeof block.cylinder_radius !== 'number' || block.cylinder_radius < 0.5) throw new Error(`${errorPrefix} (cylinder): 'cylinder_radius' は0.5以上`);
                if (block.cylinder_radius < 1) logger.warn(`${errorPrefix} (cylinder): 'cylinder_radius' (${block.cylinder_radius}) が1未満`);
                if (typeof block.cylinder_height !== 'number' || block.cylinder_height < 1) throw new Error(`${errorPrefix} (cylinder): 'cylinder_height' は1以上`);
                const axis = block.cylinder_axis ?? 'y';
                if (typeof axis !== 'string' || !['x', 'y', 'z'].includes(axis)) throw new Error(`${errorPrefix} (cylinder): 'cylinder_axis' は 'x', 'y', 'z' のいずれか`);
                block.cylinder_axis = axis;
                if (block.cylinder_hollow !== undefined && typeof block.cylinder_hollow !== 'boolean') throw new Error(`${errorPrefix} (cylinder): 'cylinder_hollow' は boolean`);
                block.cylinder_hollow = block.cylinder_hollow ?? false;
                break;
            case 'setblock':
                break;
        }
    });
}

async function executeBuild(proposal: PendingProposal, world: World, player: Player): Promise<void> {
    const { playerName, description, buildJson, originX, originY, originZ } = proposal;
    logger.info(`Executing build '${description}' for ${playerName} at (${originX}, ${originY}, ${originZ}).`);

    try {
        const structureBlocks = buildJson.structure.blocks ?? [];
        if (structureBlocks.length === 0) {
            logger.warn(`Build cancelled: '${description}' has no blocks defined.`);
            await player.sendMessage(`§e[AI] 設計図に配置するブロックがありませんでした。`);
            return;
        }

        await player.sendMessage(`§b[AI] 建築開始: ${description} (${structureBlocks.length}定義)... (状態/NBTなし)`);

        const aiOrigin = buildJson.structure.position ?? { x: 0, y: 0, z: 0 };
        const offsetX = originX - aiOrigin.x;
        const offsetY = originY - aiOrigin.y;
        const offsetZ = originZ - aiOrigin.z;

        const buildCommands: { command: string, type: PlacementMode }[] = [];
        let skippedDefinitions = 0;
        let totalBlocksEstimated = 0;

        logger.info(`Generating commands for ${structureBlocks.length} definitions...`);
        for (let i = 0; i < structureBlocks.length; i++) {
            const bp = structureBlocks[i];
            const defIndex = i + 1;
            const mode = bp.placement_mode ?? 'setblock';
            const relPos = bp.position;
            const baseX = offsetX + relPos.x;
            const baseY = offsetY + relPos.y;
            const baseZ = offsetZ + relPos.z;

            try {
                const palette = bp.block_palette;
                const singleBlockDef = bp.block;

                const blockProvider = palette
                    ? () => chooseBlockFromPalette(palette)
                    : () => singleBlockDef ?? null;

                if (!palette && !singleBlockDef) {
                    throw new Error("No block or block_palette specified.");
                }

                switch (mode) {
                    case 'setblock': {
                        const blockToPlace = blockProvider();
                        if (!blockToPlace) throw new Error("No valid block from provider.");
                        const blockIdStr = getBlockIdString(blockToPlace);

                        const fullCommand = `/setblock ${baseX} ${baseY} ${baseZ} ${blockIdStr} replace`.trim();
                        buildCommands.push({ command: fullCommand, type: mode });
                        totalBlocksEstimated++;
                        break;
                    }
                    case 'fill':
                    case 'hollow_box': {
                        if (!bp.fill_dimensions) throw new Error("'fill_dimensions' is required.");
                        const { length: len, width: wid, height: hgt } = bp.fill_dimensions;
                        if (len < 1 || wid < 1 || hgt < 1) throw new Error("'fill_dimensions' values must be >= 1.");

                        const x1 = baseX, y1 = baseY, z1 = baseZ;
                        const x2 = x1 + len - 1, y2 = y1 + hgt - 1, z2 = z1 + wid - 1;
                        const startX = Math.min(x1, x2), startY = Math.min(y1, y2), startZ = Math.min(z1, z2);
                        const endX = Math.max(x1, x2), endY = Math.max(y1, y2), endZ = Math.max(z1, z2);
                        const vol = (endX - startX + 1) * (endY - startY + 1) * (endZ - startZ + 1);

                        if (palette) {
                            logger.warn(`Definition ${defIndex} (${mode}): Using block_palette. Generating individual setblock commands (${vol} estimated).`);
                            for (let curY = startY; curY <= endY; curY++) {
                                for (let curZ = startZ; curZ <= endZ; curZ++) {
                                    for (let curX = startX; curX <= endX; curX++) {
                                        const isHollow = mode === 'hollow_box';
                                        const isSurface = (curX === startX || curX === endX || curY === startY || curY === endY || curZ === startZ || curZ === endZ);
                                        if (isHollow && !isSurface) continue;

                                        const blockToPlace = blockProvider();
                                        if (!blockToPlace) continue;
                                        const blockIdStr = getBlockIdString(blockToPlace);
                                        buildCommands.push({ command: `/setblock ${curX} ${curY} ${curZ} ${blockIdStr} replace`, type: 'setblock' });
                                    }
                                }
                            }
                            totalBlocksEstimated += (mode === 'hollow_box' && vol > 1) ? 2 * (len * wid + len * hgt + wid * hgt) : vol;
                        } else {
                            const blockToPlace = blockProvider();
                            if (!blockToPlace) throw new Error("No valid block from provider.");
                            const blockIdStr = getBlockIdString(blockToPlace);
                            const replaceFilter = bp.replace_filter ? ` replace ${bp.replace_filter}` : ' replace';

                            if (mode === 'fill') {
                                buildCommands.push({ command: `/fill ${startX} ${startY} ${startZ} ${endX} ${endY} ${endZ} ${blockIdStr}${replaceFilter}`, type: mode });
                                totalBlocksEstimated += vol;
                            } else {
                                buildCommands.push({ command: `/fill ${startX} ${startY} ${startZ} ${endX} ${endY} ${endZ} ${blockIdStr} replace`, type: mode });
                                if (len > 2 && wid > 2 && hgt > 2) {
                                    buildCommands.push({ command: `/fill ${startX + 1} ${startY + 1} ${startZ + 1} ${endX - 1} ${endY - 1} ${endZ - 1} minecraft:air replace ${blockIdStr}`, type: mode });
                                    totalBlocksEstimated += (2 * (len * wid + len * hgt + wid * hgt) - 4 * (len + wid + hgt) + 8);
                                } else {
                                    totalBlocksEstimated += vol;
                                }
                            }
                        }
                        break;
                    }
                    case 'sphere': {
                        if (typeof bp.sphere_radius !== 'number' || bp.sphere_radius < 0.5) throw new Error("'sphere_radius' is invalid.");
                        const r = bp.sphere_radius;
                        const hollow = bp.sphere_hollow ?? false;
                        const rSq = r * r;
                        const innerRSq = hollow ? Math.max(0, (r - 1) * (r - 1)) : -1;
                        const ceilR = Math.ceil(r);
                        let blocksInSphere = 0;

                        for (let dy = -ceilR; dy <= ceilR; dy++) {
                            for (let dz = -ceilR; dz <= ceilR; dz++) {
                                for (let dx = -ceilR; dx <= ceilR; dx++) {
                                    const distSq = dx * dx + dy * dy + dz * dz;
                                    if (distSq <= rSq) {
                                        if (hollow && distSq < innerRSq) continue;

                                        const curX = baseX + dx, curY = baseY + dy, curZ = baseZ + dz;
                                        const blockToPlace = blockProvider();
                                        if (!blockToPlace) continue;
                                        const blockIdStr = getBlockIdString(blockToPlace);
                                        buildCommands.push({ command: `/setblock ${curX} ${curY} ${curZ} ${blockIdStr} replace`, type: 'setblock' });
                                        blocksInSphere++;
                                    }
                                }
                            }
                        }
                        totalBlocksEstimated += blocksInSphere;
                        break;
                    }
                    case 'cylinder': {
                        if (typeof bp.cylinder_radius !== 'number' || bp.cylinder_radius < 0.5) throw new Error("'cylinder_radius' is invalid.");
                        if (typeof bp.cylinder_height !== 'number' || bp.cylinder_height < 1) throw new Error("'cylinder_height' is invalid.");
                        const r = bp.cylinder_radius;
                        const h = Math.ceil(bp.cylinder_height);
                        const axis = bp.cylinder_axis ?? 'y';
                        const hollow = bp.cylinder_hollow ?? false;
                        const rSq = r * r;
                        const innerRSq = hollow ? Math.max(0, (r - 1) * (r - 1)) : -1;
                        const ceilR = Math.ceil(r);
                        let blocksInCylinder = 0;

                        for (let i = 0; i < h; i++) {
                            for (let dr1 = -ceilR; dr1 <= ceilR; dr1++) {
                                for (let dr2 = -ceilR; dr2 <= ceilR; dr2++) {
                                    const distSq = dr1 * dr1 + dr2 * dr2;
                                    if (distSq <= rSq) {
                                        if (hollow && distSq < innerRSq) continue;

                                        let dx = 0, dy = 0, dz = 0;
                                        switch (axis) {
                                            case 'x': dx = i; dy = dr1; dz = dr2; break;
                                            case 'y': dx = dr1; dy = i; dz = dr2; break;
                                            case 'z': dx = dr1; dy = dr2; dz = i; break;
                                        }
                                        const curX = baseX + dx, curY = baseY + dy, curZ = baseZ + dz;

                                        const blockToPlace = blockProvider();
                                        if (!blockToPlace) continue;
                                        const blockIdStr = getBlockIdString(blockToPlace);
                                        buildCommands.push({ command: `/setblock ${curX} ${curY} ${curZ} ${blockIdStr} replace`, type: 'setblock' });
                                        blocksInCylinder++;
                                    }
                                }
                            }
                        }
                        totalBlocksEstimated += blocksInCylinder;
                        break;
                    }
                    default:
                        logger.warn(`Definition ${defIndex}: Unknown placement_mode '${mode}'. Skipping.`);
                        skippedDefinitions++;
                }
            } catch (defError: any) {
                logger.error(`Error processing definition ${defIndex} (${bp.placement_mode ?? 'setblock'}): ${defError.message}. Skipping.`, bp);
                skippedDefinitions++;
            }
        }

        const totalCommands = buildCommands.length;
        logger.info(`${structureBlocks.length} definitions processed. Generated ${totalCommands} commands (~${totalBlocksEstimated} blocks). ${skippedDefinitions} definitions skipped.`);

        if (totalCommands === 0) {
            if (skippedDefinitions > 0) await player.sendMessage(`§c[AI] エラーのため、実行可能な建築コマンドを生成できませんでした。`);
            else await player.sendMessage(`§e[AI] 建築コマンドが生成されませんでした。`);
            return;
        }

        let executedCount = 0;
        let failedCount = 0;
        const maxFailuresAbsolute = Math.floor(totalCommands * (config.maxCommandFailuresPercent / 100));

        logger.info(`Starting batch command execution: ${totalCommands} commands, Batch Size: ${config.batchCommandSize}, Delay: ${config.delayBetweenBatchesMs}ms`);
        await player.sendMessage(`§b[AI] 約 ${totalCommands} 個の建築コマンドを実行します... (推定ブロック数: ~${totalBlocksEstimated})`);

        for (let i = 0; i < totalCommands; i += config.batchCommandSize) {
            const batch = buildCommands.slice(i, i + config.batchCommandSize);
            if (batch.length === 0) continue;

            logger.debug(`Executing batch ${Math.floor(i / config.batchCommandSize) + 1}/${Math.ceil(totalCommands / config.batchCommandSize)} (${batch.length} commands)`);
            const results = await Promise.allSettled(batch.map(cmdData => world.runCommand(cmdData.command)));

            let batchSuccesses = 0;
            let batchFailures = 0;
            results.forEach((res, idx) => {
                if (res.status === 'fulfilled') {
                    batchSuccesses++;
                } else {
                    batchFailures++;
                    logger.warn(`Cmd Fail: ${batch[idx].command} - Reason: ${res.reason?.message ?? res.reason ?? 'Unknown error'}`);
                }
            });

            executedCount += batchSuccesses;
            failedCount += batchFailures;

            if (batchFailures > 0) {
                logger.warn(`Batch ${Math.floor(i / config.batchCommandSize) + 1}: ${batchSuccesses} succeeded, ${batchFailures} failed. Total Failed: ${failedCount}/${totalCommands}`);
            } else {
                logger.debug(`Batch ${Math.floor(i / config.batchCommandSize) + 1} completed. Executed ${executedCount}/${totalCommands} total.`);
            }

            if (failedCount > maxFailuresAbsolute && totalCommands > 20) {
                logger.error(`Too many command failures (${failedCount}/${totalCommands} > ${config.maxCommandFailuresPercent}%). Aborting build.`);
                await player.sendMessage(`§c[AI] 建築中にエラーが多発したため中断しました (${executedCount}/${totalCommands} コマンド成功)。`);
                return;
            }

            if (i + config.batchCommandSize < totalCommands) {
                await new Promise(resolve => setTimeout(resolve, config.delayBetweenBatchesMs));
            }
        }

        logger.info(`Build execution finished for '${description}'. ${executedCount}/${totalCommands} commands succeeded, ${failedCount} failed, ${skippedDefinitions} definitions skipped.`);
        if (failedCount === 0 && skippedDefinitions === 0) {
            await player.sendMessage(`§a[AI] 建築完了！ '${description}' が正常に建てられました (${executedCount} コマンド実行)。`);
        } else {
            let summary = `§e[AI] 建築終了。 '${description}' は部分的に完了しました。`;
            summary += ` (${executedCount}/${totalCommands} コマンド成功`;
            if (failedCount > 0) summary += `, ${failedCount} 失敗`;
            if (skippedDefinitions > 0) summary += `, ${skippedDefinitions} 定義スキップ`;
            summary += `)。`;
            await player.sendMessage(summary);
            if (failedCount > 0) await player.sendMessage(`§e失敗したコマンドの詳細はサーバーログを確認してください。`);
        }

    } catch (error: any) {
        logger.error(`Critical error during build execution for '${description}':`, error);
        try { await player.sendMessage(`§c[AI] 建築プロセス中に致命的なエラーが発生しました。詳細はサーバーログを確認してください。`); }
        catch (e) { logger.error('Failed to send critical build error message:', e); }
    }
}

function cleanupExpiredProposals() {
    const now = Date.now();
    let cleanedCount = 0;
    pendingBuildProposals.forEach((proposal, playerName) => {
        if (now - proposal.timestamp > PROPOSAL_TIMEOUT_MS) {
            pendingBuildProposals.delete(playerName);
            cleanedCount++;
            logger.info(`Expired proposal '${proposal.description}' for player ${playerName} removed.`);
        }
    });
    if (cleanedCount > 0) {
        logger.debug(`Cleaned up ${cleanedCount} expired build proposals.`);
    }
}

logger.info('Starting Minecraft AI Builder Server (No States/NBT Mode)...');

process.on('SIGINT', () => {
    logger.info("\nShutting down server gracefully...");
    pendingBuildProposals.clear();
    logger.info("Server shut down.");
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    logger.error("FATAL ERROR: Server shutting down due to uncaught exception.");
    process.exit(1);
});