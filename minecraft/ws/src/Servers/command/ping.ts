import { Player } from "socket-be";
import { system, System } from "../backend";



const playerPingHistory: { [playerName: string]: number[] } = {};
const MAX_HISTORY_LENGTH = 10;

let tickIntervals: number[] = [];


function getTPS() {
    if (tickIntervals.length === 0) return 20;
    const avg = tickIntervals.reduce((a, b) => a + b, 0) / tickIntervals.length;
    return Math.min(20, 1000 / avg * 20);
}


system.registerCommand({
    name: 'ping',
    description: 'プレイヤーのPingとTPS、サーバーのPingとTPSを表示します。',
    maxArgs: 1,
    minArgs: 0,
    config: { enabled: true, adminOnly: false, requireTag: [] },
    executor: async (_system: System, player: Player) => {
        const startTime = Date.now();
        try {
            const ping = await player.getPing();
            const endTime = Date.now();
            let serverPing = endTime - startTime;
            let Minecraft_tps = getTPS();

            if (ping >= -1) {
                playerPingHistory[player.name] = (playerPingHistory[player.name] || []).concat(ping).slice(-MAX_HISTORY_LENGTH);
                const averagePlayerPing = playerPingHistory[player.name].reduce((sum, p) => sum + p, 0) / playerPingHistory[player.name].length;

                // プレイヤー情報をセクションで区切って表示
                player.sendMessage(`§6━━━ §e${player.name}のPing情報 §6━━━`);
                player.sendMessage(`§aマイクラ Ping: §b${ping}ms §7(平均: ${Math.round(averagePlayerPing)}ms)`);
                player.sendMessage(`§aマイクラ TPS: §b${Minecraft_tps} tps`);

                // サーバー情報をセクションで区切って表示
                player.sendMessage(`\n§6━━━ §eサーバー情報 §6━━━`);
                player.sendMessage(`§aサーバー Ping: §b${Math.round(serverPing)}ms`);

            }
        } catch (error) {
            player.sendMessage(`§cエラーが発生しました: ${error}`);
        }
    },
});