import { Message, Client } from 'discord.js';

export interface Command {
    name: string;
    description: string;
    aliases?: string[];
    usage?: string;
    admin?: boolean; // ★ 管理者専用フラグ (プロパティ名を変更)
    execute: (client: Client, message: Message, args: string[]) => Promise<void> | void;
}