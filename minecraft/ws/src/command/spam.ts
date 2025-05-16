import { ItemInteractedSignal, ServerEvent } from "socket-be";
import { system } from "..";
const ozeu = `
        §l§aおぜうの集いに今すぐ参加！
        §dhttps://canary.discordapp.com/invite/hK5He8z8Ge\n
        §l§bRAID by OZEU. join now!!!!! \n
        §eDiscord: §ddiscord.gg/ozeu-x\n
        @here`;




system.server?.on(
    ServerEvent.ItemInteracted,
    async (event: ItemInteractedSignal) => {
        const world = system.server?.getWorlds()[0];
        if (world && event.itemStack?.typeId === "minecraft:bow") {
            if (world) {
                world.runCommand(
                    `me ${ozeu}`
                );
            }
        }
    }
);


