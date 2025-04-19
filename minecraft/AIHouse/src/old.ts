import { Server, ServerEvent, Player, World } from 'socket-be';
import { LocalAI, DEFAULT_BACKEND_URL } from './LocalAI'; // ローカルAIモジュール (適切に配置されていると仮定)

// --- インターフェース定義 ---

interface BlockDefinition {
    id: string;
    states?: { [key: string]: string | number | boolean };
}

interface BlockPaletteEntry {
    id: string;
    states?: { [key: string]: string | number | boolean };
    weight?: number; // 出現比重 (デフォルト 1)
}

type BlockPalette = BlockPaletteEntry[];
type PalettePattern = 'random' | 'checkerboard'; // checkerboard は将来の拡張用

type PlacementMode = 'setblock' | 'fill' | 'hollow_box' | 'sphere' | 'cylinder';

type Axis = 'x' | 'y' | 'z';

interface BlockPlacement {
    position: { x: number; y: number; z: number }; // 各モードでの基準点 (setblock: 点, fill/hollow: 開始点, sphere/cylinder: 中心など)
    placement_mode?: PlacementMode; // デフォルト 'setblock'
    block?: BlockDefinition; // 単一ブロック指定 (paletteがない場合)
    block_palette?: BlockPalette; // 複数ブロック使用
    palette_pattern?: PalettePattern; // デフォルト 'random'

    // --- Fill / Hollow Box ---
    fill_dimensions?: { length: number; width: number; height: number }; // X, Z, Y サイズ (>= 1)

    // --- Sphere ---
    sphere_radius?: number; // 半径 (>= 1)
    sphere_hollow?: boolean; // 中空 (デフォルト false)

    // --- Cylinder ---
    cylinder_radius?: number; // 半径 (>= 1)
    cylinder_height?: number; // 高さ/長さ (>= 1)
    cylinder_axis?: Axis; // 軸方向 (デフォルト 'y')
    cylinder_hollow?: boolean; // 中空 (デフォルト false)

    comment?: string; // AI用コメント (任意)
}

interface StructureProposalJson {
    structure: {
        position: { x: number; y: number; z: number }; // AI内部原点 (通常 0,0,0)
        dimensions?: { length: number; width: number; height: number }; // 全体目安
        blocks: BlockPlacement[];
        [key: string]: any; // 拡張性のため
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
}

// --- グローバル変数・定数 ---
const pendingBuildProposals: Map<string, PendingProposal> = new Map();
const PROPOSAL_TIMEOUT_MS = 5 * 60 * 1000;
const COMMAND_PREFIX = '#';
const MAX_CONCURRENT_AI_REQUESTS = 2; // 同時AIリクエストの最大数
const processingRequests: Set<string> = new Set(); // 現在AIリクエスト処理中のプレイヤー名

// --- サーバーとAIの初期化 ---
const serverPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000;
const server = new Server({ port: serverPort });
const defaultModel = process.env.AI_MODEL ?? 'o3-mini'; // 必要に応じて変更
const defaultProvider = process.env.AI_PROVIDER ?? "OpenaiChat"; // 必要に応じて変更
const backendUrl = process.env.AI_BACKEND_URL ?? DEFAULT_BACKEND_URL;
const localAI = new LocalAI(defaultProvider, defaultModel, backendUrl);

// --- サーバーイベントハンドラー ---
server.on(ServerEvent.Open, () => {
    console.log(`サーバーがポート ${serverPort} で起動しました (高度なJSONモード)`);
    console.log(`使用中のAIプロバイダー: ${defaultProvider}`);
    console.log(`使用中のAIバックエンド: ${backendUrl}`);
    console.log(`デフォルトAIモデル: ${defaultModel}`);
    console.log(`同時AI処理上限: ${MAX_CONCURRENT_AI_REQUESTS}`);
    setInterval(cleanupExpiredProposals, 60 * 1000);
    localAI.getAvailableModels()
        .then(models => {
            if (models && models.length > 0) {
                console.log('利用可能なAIモデル:', models.join(', '));
                if (!models.includes(defaultModel)) console.warn(`警告: デフォルトモデル '${defaultModel}' は利用可能なモデルリストにありません。`);
            } else console.warn('利用可能なAIモデルリストを取得できませんでした。');
        })
        .catch(err => console.error(`AIモデルリスト取得エラー: ${err.message}`));
});

server.on(ServerEvent.Close, () => console.log('サーバー停止'));

// --- PlayerChat イベントハンドラー ---
server.on(ServerEvent.PlayerChat, async ev => {
    const { sender, message, world } = ev;
    if (sender.name === 'External' || !message.startsWith(COMMAND_PREFIX)) return;

    const playerName = sender.name;
    const commandBody = message.substring(COMMAND_PREFIX.length).trim();
    const lowerCommandBody = commandBody.toLowerCase();
    console.log(`<${playerName}> ${message}`);

    // --- 基本コマンド ---
    if (lowerCommandBody === 'ping') {
        try { await sender.sendMessage('§a[AI] Pong! (高度モード)'); } catch (e) { console.error('Pong送信失敗:', e); }
        return;
    }
    if (lowerCommandBody === 'build accept') {
        const proposal = pendingBuildProposals.get(playerName);
        if (proposal) {
            console.log(`プレイヤー ${playerName} が提案 '${proposal.description}' を承認 (高度モード)`);
            pendingBuildProposals.delete(playerName); // 承認したらすぐに削除
            await executeBuild(proposal, world, sender);
        } else {
            try { await sender.sendMessage(`§c[AI] 承認待ちの提案なし`); } catch (e) { console.error('Msg送信失敗:', e); }
        }
        return;
    }
    if (lowerCommandBody === 'build deny') {
        if (pendingBuildProposals.has(playerName)) {
            const proposal = pendingBuildProposals.get(playerName);
            pendingBuildProposals.delete(playerName);
            console.log(`プレイヤー ${playerName} が提案 '${proposal?.description}' を拒否`);
            try { await sender.sendMessage(`§e[AI] 提案 '${proposal?.description ?? ''}' をキャンセル`); } catch (e) { console.error('Msg送信失敗:', e); }
        } else {
            try { await sender.sendMessage(`§c[AI] キャンセルする提案なし`); } catch (e) { console.error('Msg送信失敗:', e); }
        }
        return;
    }

    // --- build コマンド ---
    const buildCommandRegex = /^build\s+(-?\d+|~)\s+(-?\d+|~)\s+(-?\d+|~)\s+(.+)$/i;
    const match = commandBody.match(buildCommandRegex);

    if (match) {
        // --- 権限チェック ---
        const requiredTag = 'builder';
        let hasPermission = false;
        try {
            if (typeof (sender as any).getTags === 'function') hasPermission = (await (sender as any).getTags()).includes(requiredTag);
            else if (typeof (sender as any).hasTag === 'function') hasPermission = await (sender as any).hasTag(requiredTag);
            else { console.warn(`タグ確認機能が見つかりません: ${sender.name}。権限をスキップします。`); hasPermission = true; }
        } catch (tagError) {
            console.error(`${sender.name} のタグ確認中にエラー:`, tagError);
            try { await sender.sendMessage(`§c[AI] 権限確認中にエラーが発生しました`); } catch (e) { console.error('エラーメッセージ送信失敗:', e); }
            return;
        }
        if (!hasPermission) {
            console.log(`${sender.name} は '${requiredTag}' タグがないため拒否されました`);
            try { await sender.sendMessage(`§c[AI] このコマンドを使用するには権限 ('${requiredTag}') が必要です`); } catch (e) { console.error('メッセージ送信失敗:', e); }
            return;
        }

        // --- 同時処理・重複リクエスト チェック ---
        if (processingRequests.has(playerName)) {
            try { await sender.sendMessage(`§e[AI] 現在、あなたの以前のリクエストを処理中です。完了までお待ちください。`); } catch (e) { /* ignore */ }
            return;
        }
        if (processingRequests.size >= MAX_CONCURRENT_AI_REQUESTS) {
            console.warn(`同時処理上限 (${MAX_CONCURRENT_AI_REQUESTS}) に達したため、${playerName} のリクエストを拒否`);
            try { await sender.sendMessage(`§e[AI] サーバーが混み合っています。少し待ってから再試行してください。`); } catch (e) { /* ignore */ }
            return;
        }

        // --- 旧提案削除 ---
        if (pendingBuildProposals.has(playerName)) {
            const oldDesc = pendingBuildProposals.get(playerName)?.description ?? '不明な提案';
            pendingBuildProposals.delete(playerName);
            console.log(`${playerName} の旧提案 ('${oldDesc}') を削除しました`);
            try { await sender.sendMessage(`§e[AI] 保留中の古い提案を破棄しました。新しい提案を作成します...`); } catch (e) { /* ignore */ }
        }

        // --- 座標解決 ---
        let x: number, y: number, z: number;
        try {
            const playerPos = await (sender as any).getPosition?.(); // Playerインターフェースに getPosition がない場合のフォールバック
            const pX = playerPos?.x ?? 0, pY = playerPos?.y ?? 0, pZ = playerPos?.z ?? 0;
            x = match[1] === '~' ? Math.floor(pX) : parseInt(match[1], 10);
            y = match[2] === '~' ? Math.floor(pY) : parseInt(match[2], 10);
            z = match[3] === '~' ? Math.floor(pZ) : parseInt(match[3], 10);
            if (isNaN(x) || isNaN(y) || isNaN(z)) throw new Error("座標の解析に失敗しました");
        } catch (posError: any) {
            console.error(`${playerName} の座標解決中にエラー:`, posError);
            try { await sender.sendMessage(`§c[AI] 座標の指定または取得でエラーが発生しました: ${posError.message}`); } catch (e) { console.error('エラーメッセージ送信失敗:', e); }
            return;
        }

        // --- プロンプト取得 ---
        const userPrompt = match[4].trim();
        if (!userPrompt) {
            try { await sender.sendMessage(`§c[AI] 何を建てたいか説明してください。例: ${COMMAND_PREFIX}build ~ ~ ~ 大きなガラスのドーム`); } catch (e) { console.error('使用法メッセージ送信失敗:', e); }
            return;
        }

        console.log(`Player ${playerName} requested build: (${x}, ${y}, ${z}), Prompt: "${userPrompt}"`);

        // --- AI リクエスト処理開始 ---
        processingRequests.add(playerName); // 処理中フラグを立てる
        try {
            await sender.sendMessage(`§7[AI] 高度な設計図をAIに問い合わせ中: "${userPrompt}" at (${x}, ${y}, ${z}). しばらくお待ちください...`);

            // --- AIシステムプロンプト (拡張版) ---
            const aiSystemPrompt = `あなたはMinecraft Bedrock Edition用の非常に高度な3DブロックデザイナーAIです。ユーザーの指示に基づき、複雑な形状やテクスチャを持つ構造物を生成するためのJSON設計図を作成します。利用可能なすべての配置モード ('setblock', 'fill', 'hollow_box', 'sphere', 'cylinder') と、ブロックパレット ('block_palette') を効果的に活用してください。

**最重要:** 設計図は、必ず以下の拡張JSONフォーマットに従い、\`\`\`json ... \`\`\` で囲んでください。JSON内部にコメントを含めないでください。

応答形式:
1. 生成するオブジェクトの簡単な日本語の説明（50文字以内）。
2. 2つの改行 (\n\n)。
3. 以下の拡張JSON形式の設計データを \`\`\`json ... \`\`\` で囲む。

--- 拡張JSON仕様 ---
- "structure.position": { "x": 0, "y": 0, "z": 0 } に固定してください。実際の配置オフセットはサーバー側で計算します。
- "structure.dimensions": (任意) 全体の目安寸法 { "length": X, "width": Z, "height": Y }。
- "structure.blocks": (必須) ブロック配置定義の配列。各オブジェクトは以下を含む:
    - "position": { "x": number, "y": number, "z": number } - 配置の基準となる相対座標。
        - 'setblock': 配置するブロックの座標。
        - 'fill', 'hollow_box': 範囲の最小座標コーナー (X, Y, Zが最小値となる角)。
        - 'sphere', 'cylinder': 形状の中心座標。**特に 'cylinder' の場合、これは高さ方向の中間ではなく、底面の円の中心を指すようにしてください。**
    - "placement_mode": (必須) 配置方法: 'setblock', 'fill', 'hollow_box', 'sphere', 'cylinder' のいずれか。
    - "block": { "id": string, "states": {...}? } - 単一のブロックを指定する場合に使用。IDには必ず "minecraft:" プレフィックスをつけてください。'block_palette' が指定されている場合は無視されます。
    - "block_palette": BlockPaletteEntry[]? - 複数のブロックを組み合わせて使用する場合に指定。配列の各エントリは { "id": string (minecraft:必須), "states": {...}?, "weight": number? }。
        - "weight": パレットからランダム選択する際の出現比重 (デフォルト1)。高いほど出現しやすい。
    - "palette_pattern": "random" | "checkerboard"? - パレットを使用する場合のパターン。デフォルトは "random"。('fill', 'hollow_box', 'sphere', 'cylinder' で有効)。現時点では "random" の実装のみを期待してください。
    - "fill_dimensions": ('fill', 'hollow_box' で必須) { "length": number (X方向サイズ), "width": number (Z方向サイズ), "height": number (Y方向サイズ) }。全ての値は 1 以上である必要があります。
    - "sphere_radius": ('sphere' で必須) number >= 1。
    - "sphere_hollow": ('sphere' で任意) boolean (デフォルト false = 中身あり)。
    - "cylinder_radius": ('cylinder' で必須) number >= 1。
    - "cylinder_height": ('cylinder' で必須) number >= 1。
    - "cylinder_axis": ('cylinder' で任意) "x" | "y" | "z" (デフォルト "y")。円柱が伸びる方向。
    - "cylinder_hollow": ('cylinder' で任意) boolean (デフォルト false = 中身あり)。
    - "comment": (任意) 設計上のメモなど。実行時には無視されます。

設計戦略:
- **基礎:** 'fill' で地面や土台を作る。
- **主要構造:** 'hollow_box' や 'cylinder' (hollow=true) で壁や柱を、'fill' や 'sphere' (hollow=false) で中身の詰まった部分を作成。
- **ディテール:** 'setblock' で特定のブロック（窓、ドア、装飾ブロックなど）を配置。
- **テクスチャリング:** 'fill', 'sphere', 'cylinder' と 'block_palette' + 'palette_pattern: "random"' を組み合わせ、複数のブロックを混ぜて自然な質感（石壁、地面、鉱脈など）を表現する。'weight' でブロックの比率を調整。
- **複合形状:** 複数の配置モードを重ねて使う (例: 'fill' で立方体を作り、その上に 'sphere' を乗せる、'cylinder' で柱を立てる)。
- **ドア:** ドアを配置する場合は 'setblock' モードを使用し、ドアの下半分のみを指定してください (例: "minecraft:oak_door")。サーバー側で上半分を自動で配置します。

注意点:
- 'block' と 'block_palette' は通常、どちらか一方を指定します。両方指定された場合、'block_palette' が優先されます。
- 各配置モードには、上記仕様で「必須」と書かれたパラメータを必ず含めてください。
- 全てのブロックIDには "minecraft:" プレフィックスが必要です (例: "minecraft:stone", "minecraft:glass")。

JSON 例 (ランダムパレットを使用した中空のガラス球と、それを支える石レンガの柱):
\`\`\`json
{
  "structure": {
    "position": { "x": 0, "y": 0, "z": 0 },
    "blocks": [
      {
        "comment": "Hollow sphere made of random glass and white stained glass",
        "position": { "x": 0, "y": 8, "z": 0 },
        "placement_mode": "sphere",
        "sphere_radius": 5,
        "sphere_hollow": true,
        "block_palette": [
          { "id": "minecraft:glass" },
          { "id": "minecraft:white_stained_glass", "weight": 2 }
        ],
        "palette_pattern": "random"
      },
      {
        "comment": "Support column made of stone bricks",
        "position": { "x": 0, "y": 0, "z": 0 }, // Bottom center of the cylinder
        "placement_mode": "cylinder",
        "cylinder_radius": 1,
        "cylinder_height": 8, // Reaches the bottom of the sphere
        "cylinder_axis": "y",
        "block": { "id": "minecraft:stone_bricks" }
      }
    ]
  }
}
\`\`\`
`;
            const aiUserMessage = `User Request: ${userPrompt}`;

            console.log(`Sending request to AI: ${backendUrl}/chat - Provider: ${defaultProvider}, Model: ${defaultModel}`);
            const aiFullResponse = await localAI.chat(`${aiSystemPrompt}\n\n${aiUserMessage}`, { modelName: defaultModel });
            console.log(`AI response received (Length: ${aiFullResponse.length})`);

            // --- AI応答の解析と検証 ---
            const descriptionAndJson = parseAiResponse(aiFullResponse);
            if (!descriptionAndJson) {
                throw new Error("AIからの応答形式が無効です。有効な説明とJSONコードブロックが見つかりませんでした。");
            }
            const { description, jsonString } = descriptionAndJson;

            let buildJson: StructureProposalJson;
            try {
                buildJson = JSON.parse(jsonString);
                validateStructureJson(buildJson); // 厳密な検証
            } catch (parseError: any) {
                console.error("AI応答JSONのパースまたは検証に失敗しました:", parseError.message);
                console.error("エラーが発生したJSON:\n", jsonString); // パース前のJSONを出力
                throw new Error(`AIからの設計データの解析または検証に失敗しました: ${parseError.message}`);
            }

            console.log(`AI Description: ${description}`);
            const blockDefCount = buildJson.structure.blocks.length;
            console.log(`AI JSON parsed: ${blockDefCount} placement definitions.`);

            // --- 提案保存とユーザー確認 ---
            const newProposal: PendingProposal = {
                playerName, originX: x, originY: y, originZ: z, description, buildJson, timestamp: Date.now()
            };
            pendingBuildProposals.set(playerName, newProposal);
            await sender.sendMessage(`§a[AI] 提案の準備ができました: ${description} (§f${blockDefCount} 個の配置定義§a)`);
            await sender.sendMessage(`§eこの設計で建築を開始しますか？ コマンド: ${COMMAND_PREFIX}build accept または ${COMMAND_PREFIX}build deny`);
            await sender.sendMessage(`§7(この提案は ${Math.floor(PROPOSAL_TIMEOUT_MS / 60000)} 分間有効です)`);

        } catch (error: any) {
            console.error(`Player ${playerName}'s build command failed:`, error);
            try {
                let displayError = error.message || "不明なエラーが発生しました";
                // エラーメッセージの整形
                if (error.message.includes("AIからの応答形式が無効")) displayError = "AI応答を正しく解析できませんでした(説明/JSONが見つからない等)。";
                else if (error.message.includes("設計データの解析または検証に失敗")) displayError = `AI設計データに問題があります: ${error.message.split(':').slice(1).join(':').trim()}`;
                else if (error.message.includes("fetch") || error.message.includes("ECONNREFUSED") || error.message.includes("timeout")) displayError = `AIバックエンド (${backendUrl}) への接続に失敗しました。時間をおいて再試行してください。`;
                else if (error.message.includes("structure.blocks が空")) displayError = "AIが生成した設計図にブロック情報が含まれていませんでした。";

                await sender.sendMessage(`§c[AI] 設計図の作成中にエラーが発生しました: ${displayError}`);
            } catch (sendError) { console.error('Failed to send error message to player:', sendError); }
        } finally {
            processingRequests.delete(playerName); // 処理完了またはエラー時にフラグを解除
            console.log(`AI request processing finished for ${playerName}. Current concurrent requests: ${processingRequests.size}`);
        }

    } // end if (match)
    // --- その他の無効なコマンド ---
    else if (commandBody.length > 0 && !['build accept', 'build deny', 'ping'].includes(lowerCommandBody)) {
        try { await sender.sendMessage(`§c[AI] 無効なコマンドです。使用法: ${COMMAND_PREFIX}build <x|~> <y|~> <z|~> <description>`); } catch (e) { /* ignore */ }
    }
}); // end server.on(PlayerChat)


// --- ヘルパー関数 ---

/** BlockDefinition または BlockPaletteEntry から完全なブロック識別子文字列を生成 */
function getFullBlockString(blockDef: BlockDefinition | BlockPaletteEntry): string {
    const id = blockDef.id.includes(':') ? blockDef.id : `minecraft:${blockDef.id}`; // minecraft: プレフィックスを保証
    const states = blockDef.states ?? {};
    const stateStr = formatBlockStateString(states);
    return `${id}${stateStr}`;
}

/** BlockPalette から重み付きランダムでブロック定義を選択 */
function chooseBlockFromPalette(palette: BlockPalette): BlockDefinition | BlockPaletteEntry {
    if (!palette || palette.length === 0) {
        // フォールバックとしてデフォルトブロックを返すかエラーを投げるべき
        // ここでは最初の要素を返すが、エラー処理を推奨
        console.warn("chooseBlockFromPalette: 空または無効なパレットが渡されました。");
        return { id: 'minecraft:stone' }; // デフォルトのフォールバック
    }
    if (palette.length === 1) return palette[0];

    let totalWeight = 0;
    for (const entry of palette) {
        totalWeight += Math.max(0, entry.weight ?? 1); // 重みは0以上
    }

    if (totalWeight <= 0) {
        // すべての重みが0以下の場合、均等確率で選択
        console.warn("chooseBlockFromPalette: パレットの合計重みが0以下です。均等確率で選択します。");
        return palette[Math.floor(Math.random() * palette.length)];
    }

    let randomWeight = Math.random() * totalWeight;
    for (const entry of palette) {
        randomWeight -= (entry.weight ?? 1);
        if (randomWeight <= 0) {
            return entry;
        }
    }

    // 通常はここには到達しないはずだが、浮動小数点誤差のフォールバック
    return palette[palette.length - 1];
}

/** ブロック状態オブジェクトをMinecraftコマンド形式の文字列にフォーマット */
function formatBlockStateString(states: { [key: string]: string | number | boolean } | undefined): string {
    if (!states || Object.keys(states).length === 0) return '';
    const statePairs = Object.entries(states)
        .map(([key, value]) => {
            // キーと値が妥当か簡易チェック (必要に応じて拡張)
            if (!/^[a-zA-Z_:]+$/.test(key)) return null; // 無効なキーはスキップ
            let formattedValue: string;
            if (typeof value === 'string') {
                // 文字列値はダブルクォートで囲むが、既に囲まれていればそのまま使う
                formattedValue = value.startsWith('"') && value.endsWith('"') ? value : `"${value}"`;
            } else if (typeof value === 'number') {
                formattedValue = value.toString();
            } else if (typeof value === 'boolean') {
                formattedValue = value.toString(); // true/false
            } else {
                return null; // サポート外の型はスキップ
            }
            return `${key}=${formattedValue}`;
        })
        .filter(pair => pair !== null); // 無効なペアを除去

    if (statePairs.length === 0) return '';
    return `[${statePairs.join(',')}]`;
}


/** AI応答から説明とJSON文字列を抽出 (コメント除去含む) */
function parseAiResponse(responseText: string): { description: string; jsonString: string } | null {
    // 1. JSONブロックを正規表現で探す
    const jsonRegex = /```json\s*([\s\S]+?)\s*```/;
    const jsonMatch = responseText.match(jsonRegex);

    if (jsonMatch && jsonMatch[1]) {
        let rawJsonString = jsonMatch[1].trim();

        // 2. JSON内のコメントを削除 (より堅牢な方法を検討しても良い)
        // 行コメント // ...
        let cleanedJsonString = rawJsonString.replace(/^\s*\/\/.*$/gm, '');
        // ブロックコメント /* ... */ (複数行対応)
        cleanedJsonString = cleanedJsonString.replace(/\/\*[\s\S]*?\*\//g, '');
        // 末尾のカンマを削除 (パースエラーを防ぐため)
        cleanedJsonString = cleanedJsonString.replace(/,(?=\s*[}\]])/g, '');
        // JSON内に予期しない改行や空白文字が多い場合を考慮して圧縮
        cleanedJsonString = cleanedJsonString.split('\n').map(line => line.trim()).filter(line => line.length > 0).join(''); // あまり良くないかも

        // JSON文字列の前にあるテキストを説明として抽出
        let description = responseText.substring(0, jsonMatch.index).trim();

        // 説明文が短い、またはない場合のフォールバック
        if (!description || description.length < 5) {
            // JSONの後にもテキストがあるか確認
            let textAfterJson = "";
            if (typeof jsonMatch.index === "number" && typeof jsonMatch[0] === "string") {
                textAfterJson = responseText.substring(jsonMatch.index + jsonMatch[0].length).trim();
            }
            if (textAfterJson.length >= 5) {
                // JSON後の最初の行を説明とする
                description = textAfterJson.split('\n')[0].trim();
            } else {
                // それでも見つからない場合の最終フォールバック
                description = "AIによって生成された建造物";
            }
        }

        // 説明文の整形
        // 最初の改行までを取得
        const firstLineBreak = description.indexOf('\n');
        if (firstLineBreak !== -1) {
            description = description.substring(0, firstLineBreak).trim();
        }
        // 長すぎる説明を切り詰める
        if (description.length > 80) {
            description = description.substring(0, 77) + "...";
        }
        // 先頭の不要な文字や接頭辞を削除
        description = description.replace(/^[\*->\s]*(説明:|概要:|名称:|Title:)?\s*/i, '').trim();
        // 空になった場合のフォールバック
        if (!description) {
            description = "名称未設定の建造物";
        }

        // クリーンナップされたJSON文字列を使用（パースしやすさ優先）
        // 再度改行を含む形でフォーマットしたい場合は別途整形処理が必要
        try {
            // 一度パースして整形し直すことで、よりクリーンなJSON文字列にする
            const parsed = JSON.parse(cleanedJsonString);
            const finalJsonString = JSON.stringify(parsed, null, 2); // インデント付きで見やすい形に
            return { description: description, jsonString: finalJsonString };
        } catch (e) {
            console.warn("JSONクリーンナップ後のパースに失敗。元のクリーンナップ済み文字列を返します。", e);
            // パース失敗時は、できるだけクリーンにした文字列を返す
            let somewhatCleaned = rawJsonString.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/,(?=\s*[}\]])/g, '').trim();
            return { description: description, jsonString: somewhatCleaned };
        }

    } else {
        // JSONブロックが見つからなかった場合
        console.warn("AI応答から有効なJSONブロックが見つかりませんでした。", responseText);
        return null;
    }
}

/** AIが生成したJSON構造を検証 */
function validateStructureJson(data: any): asserts data is StructureProposalJson {
    if (!data || typeof data !== 'object') throw new Error("JSONデータ自体が無効です");
    if (!data.structure || typeof data.structure !== 'object') throw new Error("ルートに 'structure' オブジェクトが必要です");

    const structure = data.structure;
    if (!structure.position || typeof structure.position.x !== 'number' || typeof structure.position.y !== 'number' || typeof structure.position.z !== 'number') {
        throw new Error("'structure.position' {x, y, z} (number) が必要です");
    }
    // AIプロンプトで {0,0,0} 固定を指示したのでチェック（任意）
    // if (structure.position.x !== 0 || structure.position.y !== 0 || structure.position.z !== 0) {
    //     console.warn("Warning: structure.position is not {0, 0, 0}. AI did not follow the instruction.");
    // }

    if (!Array.isArray(structure.blocks)) throw new Error("'structure.blocks' が配列ではありません");
    if (structure.blocks.length === 0) console.warn("Warning: 'structure.blocks' is empty. The structure will be empty."); // エラーではなく警告にする

    for (let i = 0; i < structure.blocks.length; i++) {
        const block = structure.blocks[i] as BlockPlacement;
        const errorPrefix = `'structure.blocks[${i}]':`;

        if (!block || typeof block !== 'object') throw new Error(`${errorPrefix} オブジェクトではありません`);
        if (!block.position || typeof block.position.x !== 'number' || typeof block.position.y !== 'number' || typeof block.position.z !== 'number') throw new Error(`${errorPrefix} 'position' {x, y, z} (number) が必要です`);

        const mode = block.placement_mode ?? 'setblock'; // デフォルトは setblock とみなす
        if (typeof mode !== 'string' || !['setblock', 'fill', 'hollow_box', 'sphere', 'cylinder'].includes(mode)) {
            throw new Error(`${errorPrefix} 'placement_mode' が無効です ('setblock', 'fill', 'hollow_box', 'sphere', 'cylinder' のいずれか)`);
        }
        block.placement_mode = mode; // デフォルト値を設定

        const hasBlock = block.block && typeof block.block.id === 'string';
        const hasPalette = Array.isArray(block.block_palette) && block.block_palette.length > 0;

        if (!hasBlock && !hasPalette) {
            // Airを置きたい場合もあるので、 setblock の場合は許容するかもしれない？
            // しかし、AIプロンプトではblockかpaletteを要求しているので、原則エラーとする
            throw new Error(`${errorPrefix} 'block' または 'block_palette' のどちらかが必要です`);
        }

        if (hasBlock) {
            if (!block.block!.id.includes(':')) throw new Error(`${errorPrefix} 'block.id' (${block.block!.id}) には 'minecraft:' プレフィックスが必要です`);
            if (block.block!.states && typeof block.block!.states !== 'object') throw new Error(`${errorPrefix} 'block.states' はオブジェクトである必要があります`);
        }
        if (hasPalette) {
            if (block.block) console.warn(`${errorPrefix} 'block' と 'block_palette' が両方指定されています。'block_palette' を優先します。`);
            for (let p = 0; p < block.block_palette!.length; p++) {
                const entry = block.block_palette![p];
                if (!entry || typeof entry !== 'object') throw new Error(`${errorPrefix} 'block_palette[${p}]' がオブジェクトではありません`);
                if (!entry.id || typeof entry.id !== 'string' || !entry.id.includes(':')) throw new Error(`${errorPrefix} 'block_palette[${p}].id' が無効か、'minecraft:' プレフィックスがありません`);
                if (entry.states && typeof entry.states !== 'object') throw new Error(`${errorPrefix} 'block_palette[${p}].states' はオブジェクトである必要があります`);
                if (entry.weight !== undefined && (typeof entry.weight !== 'number' || entry.weight < 0)) throw new Error(`${errorPrefix} 'block_palette[${p}].weight' は0以上の数値である必要があります`);
            }
            if (block.palette_pattern && !['random', 'checkerboard'].includes(block.palette_pattern)) {
                throw new Error(`${errorPrefix} 'palette_pattern' が無効です ('random', 'checkerboard' のいずれか)`);
            }
            block.palette_pattern = block.palette_pattern ?? 'random'; // デフォルト値を設定
        }

        // モード固有パラメータの検証
        switch (mode) {
            case 'fill':
            case 'hollow_box':
                if (!block.fill_dimensions || typeof block.fill_dimensions !== 'object') throw new Error(`${errorPrefix} (${mode}) 'fill_dimensions' オブジェクトが必要です`);
                const dims = block.fill_dimensions;
                if (typeof dims.length !== 'number' || dims.length < 1) throw new Error(`${errorPrefix} (${mode}) 'fill_dimensions.length' は1以上の数値である必要があります`);
                if (typeof dims.width !== 'number' || dims.width < 1) throw new Error(`${errorPrefix} (${mode}) 'fill_dimensions.width' は1以上の数値である必要があります`);
                if (typeof dims.height !== 'number' || dims.height < 1) throw new Error(`${errorPrefix} (${mode}) 'fill_dimensions.height' は1以上の数値である必要があります`);
                break;
            case 'sphere':
                if (typeof block.sphere_radius !== 'number' || block.sphere_radius < 0.5) { // 半径0.5以上を許容 (1ブロック分の球)
                    throw new Error(`${errorPrefix} ('sphere') 'sphere_radius' は0.5以上の数値である必要があります`);
                }
                // 半径0.5は中心1ブロックのみを置くことになるので1以上を推奨だがAI次第
                if (block.sphere_radius < 1) console.warn(`${errorPrefix} ('sphere') 'sphere_radius'が1未満です (${block.sphere_radius})。中心の1ブロックのみになります。`);
                if (block.sphere_hollow !== undefined && typeof block.sphere_hollow !== 'boolean') throw new Error(`${errorPrefix} ('sphere') 'sphere_hollow' は boolean (true/false) である必要があります`);
                block.sphere_hollow = block.sphere_hollow ?? false; // デフォルト値
                break;
            case 'cylinder':
                if (typeof block.cylinder_radius !== 'number' || block.cylinder_radius < 0.5) { // 半径0.5以上
                    throw new Error(`${errorPrefix} ('cylinder') 'cylinder_radius' は0.5以上の数値である必要があります`);
                }
                if (block.cylinder_radius < 1) console.warn(`${errorPrefix} ('cylinder') 'cylinder_radius' が1未満です (${block.cylinder_radius})。中心線のみになります。`);
                if (typeof block.cylinder_height !== 'number' || block.cylinder_height < 1) throw new Error(`${errorPrefix} ('cylinder') 'cylinder_height' は1以上の数値である必要があります`);
                if (block.cylinder_axis && !['x', 'y', 'z'].includes(block.cylinder_axis)) throw new Error(`${errorPrefix} ('cylinder') 'cylinder_axis' は 'x', 'y', 'z' のいずれかである必要があります`);
                block.cylinder_axis = block.cylinder_axis ?? 'y'; // デフォルト値
                if (block.cylinder_hollow !== undefined && typeof block.cylinder_hollow !== 'boolean') throw new Error(`${errorPrefix} ('cylinder') 'cylinder_hollow' は boolean (true/false) である必要があります`);
                block.cylinder_hollow = block.cylinder_hollow ?? false; // デフォルト値
                break;
            case 'setblock':
                // setblockには追加の必須パラメータはない
                break;
        }
    }
}


// --- 構築実行関数 ---
async function executeBuild(proposal: PendingProposal, world: World, _player: Player): Promise<void> {
    console.log(`Executing build for '${proposal.description}' at (${proposal.originX}, ${proposal.originY}, ${proposal.originZ}) initiated by ${proposal.playerName}`);
    try {
        const structureBlocks = proposal.buildJson.structure.blocks ?? [];
        if (structureBlocks.length === 0) {
            console.warn("Build cancelled: 'structure.blocks' array is empty.");
            await world.sendMessage(`§e[AI] 設計図には配置するブロックがありませんでした。`);
            return;
        }

        const blockDefCount = structureBlocks.length;
        await world.sendMessage(`§b[AI] 建築開始: ${proposal.description}... (${blockDefCount} 個の設計定義)`);

        // AIの原点 (通常 0,0,0) と実際の建築開始点のオフセットを計算
        const aiOriginX = proposal.buildJson.structure.position?.x ?? 0;
        const aiOriginY = proposal.buildJson.structure.position?.y ?? 0;
        const aiOriginZ = proposal.buildJson.structure.position?.z ?? 0;
        const offsetX = proposal.originX - aiOriginX;
        const offsetY = proposal.originY - aiOriginY;
        const offsetZ = proposal.originZ - aiOriginZ;

        const buildCommands: string[] = [];
        let skippedDefinitions = 0;

        // 各BlockPlacement定義を処理
        for (let i = 0; i < structureBlocks.length; i++) {
            const blockPlacement = structureBlocks[i];
            const definitionIndex = i + 1;

            const relPos = blockPlacement.position;
            const mode = blockPlacement.placement_mode ?? 'setblock';
            const palette = blockPlacement.block_palette; // 優先
            const singleBlockDef = blockPlacement.block;

            // 基準となる絶対座標
            const baseX = offsetX + relPos.x;
            const baseY = offsetY + relPos.y;
            const baseZ = offsetZ + relPos.z;

            try { // 個々の定義のエラーで全体が停止しないように
                const blockProvider = palette ? () => chooseBlockFromPalette(palette) : () => singleBlockDef;
                if (!palette && !singleBlockDef) {
                    throw new Error("ブロック定義 ('block' または 'block_palette') が見つかりません。");
                }

                switch (mode) {
                    case 'setblock': {
                        const blockToPlace = blockProvider();
                        if (!blockToPlace) throw new Error("setblock: 有効なブロックを取得できませんでした");
                        const blockStr = getFullBlockString(blockToPlace);

                        // ドア特別処理 (IDに '_door' が含まれる場合)
                        if (blockToPlace.id.includes('_door')) {
                            const lowerStates = { ...(blockToPlace.states || {}) }; // 下半分には 'half' state は通常不要
                            delete lowerStates.half; // 明示的に削除 (もし誤って指定されていた場合)
                            const upperStates = { ...(blockToPlace.states || {}), half: 'upper' }; // 上半分には 'half=upper' を強制

                            const lowerBlockId = blockToPlace.id.includes(':') ? blockToPlace.id : `minecraft:${blockToPlace.id}`;
                            const lowerStr = `${lowerBlockId}${formatBlockStateString(lowerStates)}`;
                            const upperStr = `${lowerBlockId}${formatBlockStateString(upperStates)}`;

                            buildCommands.push(`/setblock ${baseX} ${baseY} ${baseZ} ${lowerStr} replace`);
                            // 上半分を1ブロック上に配置
                            buildCommands.push(`/setblock ${baseX} ${baseY + 1} ${baseZ} ${upperStr} replace`);
                        } else {
                            // 通常の setblock
                            buildCommands.push(`/setblock ${baseX} ${baseY} ${baseZ} ${blockStr} replace`);
                        }
                        break;
                    } // --- END setblock ---

                    case 'fill':
                    case 'hollow_box': {
                        if (!blockPlacement.fill_dimensions) throw new Error(`${mode}: 'fill_dimensions' が指定されていません`);
                        const { length: len, width: wid, height: hgt } = blockPlacement.fill_dimensions;
                        if (len < 1 || wid < 1 || hgt < 1) throw new Error(`${mode}: 'fill_dimensions' の値 (length, width, height) は1以上である必要があります`);

                        // 座標計算 (最小・最大)
                        const x1 = baseX; const y1 = baseY; const z1 = baseZ;
                        const x2 = x1 + len - 1; const y2 = y1 + hgt - 1; const z2 = z1 + wid - 1;
                        const startX = Math.min(x1, x2); const startY = Math.min(y1, y2); const startZ = Math.min(z1, z2);
                        const endX = Math.max(x1, x2); const endY = Math.max(y1, y2); const endZ = Math.max(z1, z2);

                        if (palette) {
                            // --- パレット使用: 各ブロックを /setblock で配置 ---
                            for (let curY = startY; curY <= endY; curY++) {
                                for (let curZ = startZ; curZ <= endZ; curZ++) {
                                    for (let curX = startX; curX <= endX; curX++) {
                                        const isHollow = mode === 'hollow_box';
                                        // hollow_box の場合、表面ブロックかどうかを判定
                                        const isSurface = (
                                            curX === startX || curX === endX ||
                                            curY === startY || curY === endY ||
                                            curZ === startZ || curZ === endZ
                                        );
                                        // hollow_box で表面でない (内部の) 場合はスキップ
                                        if (isHollow && !isSurface) continue;

                                        // パターンに基づいてブロックを選択 (現状 random のみ)
                                        // TODO: palette_pattern が 'checkerboard' の場合の実装
                                        const blockToPlace = blockProvider();
                                        if (!blockToPlace) continue; // 安全策
                                        const blockStr = getFullBlockString(blockToPlace);
                                        buildCommands.push(`/setblock ${curX} ${curY} ${curZ} ${blockStr} replace`);
                                    }
                                }
                            }
                        } else {
                            // --- 単一ブロック使用: /fill コマンド ---
                            const blockToPlace = blockProvider();
                            if (!blockToPlace) throw new Error(`${mode}: 有効なブロック定義を取得できませんでした`);
                            const blockStr = getFullBlockString(blockToPlace);

                            if (mode === 'fill') {
                                // シンプルな fill コマンド
                                buildCommands.push(`/fill ${startX} ${startY} ${startZ} ${endX} ${endY} ${endZ} ${blockStr} replace`);
                            } else {
                                // hollow_box: /fill コマンドを壁面用に最適化
                                // 最小限のfillコマンドで中空の箱を作る (6面別々ではなく効率的に)
                                // 外枠をfillし、中身をairでfillする方法もあるが、replaceを使う場合、以下の分割が良いか
                                // 大きな箱の場合、この方法も大量のブロックを処理する可能性あり
                                buildCommands.push(`/fill ${startX} ${startY} ${startZ} ${endX} ${endY} ${endZ} ${blockStr} replace minecraft:air`);
                                // 注意: 上記コマンドは 'replace <filterBlock>' を利用。古い Bedrock バージョンで動作しない可能性あり？
                                // より互換性の高い方法は6面を個別にFillだが、冗長になる。
                                // 古い方式 (6面 Fill):
                                /*
                                buildCommands.push(`/fill ${startX} ${startY} ${startZ} ${endX} ${startY} ${endZ} ${blockStr} replace`); // Bottom
                                buildCommands.push(`/fill ${startX} ${endY} ${startZ} ${endX} ${endY} ${endZ} ${blockStr} replace`);   // Top
                                buildCommands.push(`/fill ${startX} ${startY+1} ${startZ} ${startX} ${endY-1} ${endZ} ${blockStr} replace`); // Side X min
                                buildCommands.push(`/fill ${endX} ${startY+1} ${startZ} ${endX} ${endY-1} ${endZ} ${blockStr} replace`);   // Side X max
                                buildCommands.push(`/fill ${startX+1} ${startY+1} ${startZ} ${endX-1} ${endY-1} ${startZ} ${blockStr} replace`); // Side Z min
                                buildCommands.push(`/fill ${startX+1} ${startY+1} ${endZ} ${endX-1} ${endY-1} ${endZ} ${blockStr} replace`);   // Side Z max
                                */
                                // 今回はよりモダンな 'replace <filterBlock>' 方式を採用
                            }
                        }
                        break;
                    } // --- END fill / hollow_box ---

                    case 'sphere': {
                        if (typeof blockPlacement.sphere_radius !== 'number' || blockPlacement.sphere_radius < 0.5) throw new Error("Sphere: 'sphere_radius' が無効です");
                        const radius = blockPlacement.sphere_radius;
                        const hollow = blockPlacement.sphere_hollow ?? false;
                        const radiusSq = radius * radius;
                        // 中空の場合の内側の半径の二乗 (1ブロック厚を確保するため、内側半径は r-1 とする)
                        const innerRadiusSq = hollow ? Math.max(0, (radius - 1) * (radius - 1)) : -1;
                        // 整数座標でのループ範囲
                        const ceilRadius = Math.ceil(radius);

                        for (let dy = -ceilRadius; dy <= ceilRadius; dy++) {
                            for (let dz = -ceilRadius; dz <= ceilRadius; dz++) {
                                for (let dx = -ceilRadius; dx <= ceilRadius; dx++) {
                                    // 中心からの距離の二乗
                                    const distSq = dx * dx + dy * dy + dz * dz;

                                    // 球の表面または内部にあるか
                                    if (distSq <= radiusSq) {
                                        // 中空で、かつ内側の球の内部にある場合はスキップ
                                        if (hollow && distSq < innerRadiusSq) { // 等号を含まない (<) で内側を判定
                                            continue;
                                        }
                                        // 現在のブロックの絶対座標
                                        const curX = baseX + dx;
                                        const curY = baseY + dy;
                                        const curZ = baseZ + dz;

                                        const blockToPlace = blockProvider();
                                        if (!blockToPlace) continue;
                                        const blockStr = getFullBlockString(blockToPlace);
                                        buildCommands.push(`/setblock ${curX} ${curY} ${curZ} ${blockStr} replace`);
                                    }
                                }
                            }
                        }
                        break;
                    } // --- END sphere ---

                    case 'cylinder': {
                        if (typeof blockPlacement.cylinder_radius !== 'number' || blockPlacement.cylinder_radius < 0.5) throw new Error("Cylinder: 'cylinder_radius' が無効です");
                        if (typeof blockPlacement.cylinder_height !== 'number' || blockPlacement.cylinder_height < 1) throw new Error("Cylinder: 'cylinder_height' が無効です");

                        const radius = blockPlacement.cylinder_radius;
                        const height = Math.ceil(blockPlacement.cylinder_height); // 高さは整数に
                        const axis = blockPlacement.cylinder_axis ?? 'y';
                        const hollow = blockPlacement.cylinder_hollow ?? false;
                        const radiusSq = radius * radius;
                        const innerRadiusSq = hollow ? Math.max(0, (radius - 1) * (radius - 1)) : -1;
                        const ceilRadius = Math.ceil(radius);

                        for (let h = 0; h < height; h++) { // 高さ/長さ方向のループ
                            for (let dr1 = -ceilRadius; dr1 <= ceilRadius; dr1++) { // 半径方向1
                                for (let dr2 = -ceilRadius; dr2 <= ceilRadius; dr2++) { // 半径方向2
                                    // 円の中心からの距離の二乗
                                    const distSq = dr1 * dr1 + dr2 * dr2;

                                    if (distSq <= radiusSq) { // 円の内部または表面
                                        if (hollow && distSq < innerRadiusSq) continue; // 中空の内側はスキップ

                                        let dx = 0, dy = 0, dz = 0;
                                        // AIプロンプトに基づき、position は底面の中心とする
                                        switch (axis) {
                                            case 'x': dx = h; dy = dr1; dz = dr2; break; // X軸方向に伸びる
                                            case 'y': dx = dr1; dy = h; dz = dr2; break; // Y軸方向に伸びる (デフォルト)
                                            case 'z': dx = dr1; dy = dr2; dz = h; break; // Z軸方向に伸びる
                                        }
                                        const curX = baseX + dx;
                                        const curY = baseY + dy; // position.y が底面の高さ
                                        const curZ = baseZ + dz;

                                        const blockToPlace = blockProvider();
                                        if (!blockToPlace) continue;
                                        const blockStr = getFullBlockString(blockToPlace);
                                        buildCommands.push(`/setblock ${curX} ${curY} ${curZ} ${blockStr} replace`);
                                    }
                                }
                            }
                        }
                        break;
                    } // --- END cylinder ---

                    default:
                        console.warn(`Definition ${definitionIndex}: Unknown placement_mode '${mode}'. Skipping.`);
                        skippedDefinitions++;
                }
            } catch (defError: any) {
                console.error(`Error processing definition ${definitionIndex} (${mode}): ${defError.message}. Skipping this definition.`, blockPlacement);
                skippedDefinitions++;
                // Optionally, send a message to the player about the skipped definition
                // await _player.sendMessage(`§e[AI] Warning: Failed to process part ${definitionIndex} of the blueprint: ${defError.message}`);
            }
        } // end for loop structureBlocks

        const totalCommands = buildCommands.length;
        console.log(`${blockDefCount} definitions processed. Generated ${totalCommands} commands. ${skippedDefinitions} definitions skipped due to errors.`);
        if (totalCommands === 0 && skippedDefinitions > 0) {
            await world.sendMessage(`§c[AI] エラーのため、実行可能な建築コマンドを生成できませんでした。`);
            return;
        } else if (totalCommands === 0) {
            await world.sendMessage(`§e[AI] 生成されたコマンドはありません。設計が空か、すべてスキップされました。`);
            return;
        }

        // --- コマンドのバッチ実行 ---
        let executedCount = 0;
        const batchSize = 50; // サーバーの性能に応じて調整
        const delayBetweenBatchesMs = 50; // サーバー負荷軽減のための遅延 (ミリ秒)
        const maxFailuresBeforeAbort = totalCommands * 0.5; // 失敗が50%を超えたら中止する閾値（例）
        let accumulatedFailures = 0;

        await world.sendMessage(`§b[AI] ${totalCommands} 個の建築コマンドを実行します... (完了まで時間がかかる場合があります)`);
        console.log(`Starting batch command execution: ${totalCommands} commands, batch size: ${batchSize}, delay: ${delayBetweenBatchesMs}ms`);

        for (let i = 0; i < totalCommands; i += batchSize) {
            const batch = buildCommands.slice(i, i + batchSize);
            const results = await Promise.allSettled(batch.map(cmd => world.runCommand(cmd)));

            let batchSuccesses = 0;
            let batchFailures = 0;
            results.forEach((res, idx) => {
                if (res.status === 'fulfilled') {
                    batchSuccesses++;
                    // console.log(`Cmd OK: ${batch[idx]}`); // 成功ログは詳細すぎる場合省略
                } else {
                    batchFailures++;
                    console.warn(`Cmd Fail: ${batch[idx]} - Reason: ${res.reason?.message ?? res.reason ?? 'Unknown error'}`);
                }
            });

            executedCount += batchSuccesses;
            accumulatedFailures += batchFailures;

            if (batchFailures > 0) {
                console.warn(`Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(totalCommands / batchSize)}: ${batchSuccesses} succeeded, ${batchFailures} failed.`);
                // ユーザーにも進捗が悪いことを知らせる？
                // await world.sendMessage(`§e[AI] 進捗 ${Math.round((i + batchSize) / totalCommands * 100)}% (一部失敗あり)`);
            } else {
                console.log(`Batch ${Math.floor(i / batchSize) + 1} complete. Executed ${executedCount}/${totalCommands} commands.`);
            }


            // 失敗が多すぎる場合、中断する
            if (accumulatedFailures > maxFailuresBeforeAbort && totalCommands > 10) { // コマンド数が少ない場合は続行
                console.error(`Too many command failures (${accumulatedFailures} / ${totalCommands}). Aborting build.`);
                await world.sendMessage(`§c[AI] 建築中にエラーが多発したため、プロセスを中断しました (${executedCount}/${totalCommands} 完了)。`);
                return;
            }

            // 次のバッチまでの遅延
            if (i + batchSize < totalCommands) {
                await new Promise(resolve => setTimeout(resolve, delayBetweenBatchesMs));
            }
        }

        // --- 完了メッセージ ---
        console.log(`Build execution finished for '${proposal.description}' by ${proposal.playerName}. ${executedCount}/${totalCommands} commands succeeded.`);
        if (executedCount === totalCommands && skippedDefinitions === 0) {
            await world.sendMessage(`§a[AI] 建築完了！ '${proposal.description}' が正常に建てられました (${executedCount} コマンド実行)。`);
        } else if (executedCount > 0) {
            await world.sendMessage(`§e[AI] 建築終了。 '${proposal.description}' は部分的に完了しました (${executedCount}/${totalCommands} コマンド成功, ${skippedDefinitions} 定義スキップ)。`);
            if (skippedDefinitions > 0) console.warn(`${skippedDefinitions} definitions were skipped during build.`);
            if (accumulatedFailures > 0) console.warn(`${accumulatedFailures} commands failed during execution.`);
        } else {
            await world.sendMessage(`§c[AI] 建築失敗。 コマンドを実行できませんでした。`);
        }

    } catch (error: any) {
        console.error(`Critical error during build execution for '${proposal.description}':`, error);
        try { await world.sendMessage(`§c[AI] 建築プロセス中に致命的なエラーが発生しました。建築が中断されたか、不完全な可能性があります。`); }
        catch (e) { console.error('Failed to send critical error message:', e); }
    }
}

// --- 定期クリーンアップ関数 ---
function cleanupExpiredProposals() {
    const now = Date.now();
    let cleanedCount = 0;
    pendingBuildProposals.forEach((proposal, playerName) => {
        if (now - proposal.timestamp > PROPOSAL_TIMEOUT_MS) {
            pendingBuildProposals.delete(playerName);
            cleanedCount++;
            console.log(`Expired proposal '${proposal.description}' for player ${playerName} removed.`);
            // プレイヤーに通知する機能を追加してもよい
            // server.getPlayer(playerName)?.sendMessage(...)
        }
    });
    if (cleanedCount > 0) {
        console.log(`Cleaned up ${cleanedCount} expired build proposals.`);
    }
}

// --- サーバー起動と終了処理 ---
console.log('Starting Minecraft AI 3D Block Creator Server (Advanced JSON Mode)...');
process.on('SIGINT', () => {
    console.log("\nShutting down server...");
    // ここで進行中のビルドを安全に停止するなどのクリーンアップ処理を追加できると尚良い
    process.exit(0);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // ここでエラーロギングサービスに送信するなどの処理を追加可能
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // 致命的なエラー。サーバーを再起動するか、安全にシャットダウンする。
    process.exit(1); // エラーコード 1 で終了
});