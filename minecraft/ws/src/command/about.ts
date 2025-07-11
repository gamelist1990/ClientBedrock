import { system, System } from '..';
import { Player } from "socket-be";
import { ver } from "../version";

system.registerCommand({
    name: 'about',
    description: 'このサーバーに関する情報を表示します。',
    maxArgs: 0,
    minArgs: 0,
    config: {
        enabled: true,
        adminOnly: false,
        requireTag: []
    },
    executor: async (_system: System, player: Player) => {
        player.sendMessage(`§l§aAbout For §e${ver} §bWebSocket\n§r開発者: PEXkurann (こう君)\n機能: ScriptAPIの疑似的なPlayer/Worldクラスで、ある程度のコマンドを実現\n注意: 開発段階のため、バグやエラーがあり不安定`);
        player.sendMessage(`§e§lサーバーバージョン: §av${ver}§r`);
    }
});

system.registerCommand({
    name: 'ver',
    description: 'このサーバーのバージョンを返します',
    maxArgs: 0,
    minArgs: 0,
    config: {
        enabled: true,
        adminOnly: false,
        requireTag: []
    },
    executor: async (_system: System, player: Player) => {
        player.sendMessage(`§e§lサーバーバージョン: §av${ver}§r`);
    }
});