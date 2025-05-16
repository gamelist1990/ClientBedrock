
import { Events } from "discord.js";
import { discordEventBroker } from "../..";



discordEventBroker.on(Events.GuildMemberAdd, async (member) => {
    const guildId = member.guild.id;
    const userId = member.user.id;

    // ここでデータベースにアクセスして、必要な処理を行う
    // 例: await database.set(guildId, userId, { joinedAt: new Date() });

    console.log(`User ${userId} joined guild ${guildId}`);
});