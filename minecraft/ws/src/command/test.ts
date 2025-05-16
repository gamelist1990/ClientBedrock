import { Player } from 'socket-be';
import { COMMAND_PREFIX, system, System } from '..';

system.registerCommand({
    name: 'run',
    description: '実験',
    maxArgs: 2,
    minArgs: 0,
    config: {
        enabled: true,
        adminOnly: false,
        requireTag: []
    },
    usage: `${COMMAND_PREFIX}info [-p <targetName>]`,

    executor: async (system: System, _player: Player, args: string[]) => {
        const arg = args[0];

        if (arg) {
            if (!system) return;
            const world = system.server?.getWorlds()[0]
            if (world) {
                const res = await world.runCommand(`${args}`)
                if (res) {
                    world.runCommand(`me 実験結果: ${res.statusMessage}`);
                    console.log(`実験結果: ${res.statusMessage}`)
                }
        
            }
        }
        
    }
});
