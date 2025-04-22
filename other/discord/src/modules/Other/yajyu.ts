import { TextChannel } from 'discord.js';
import { registerCommand } from '../../index';
import { Command } from '../../types/command';

const yajyuMessages: string[] = [

    "まずうちさぁ、屋上…あんだけど…焼いてかない？",
    "ンアッー!(≧д≦)",
    "いいよ！来いよ！胸にかけて胸に！",
    "ぬわあああああん疲れたもおおおおおおん",
    "アイスティーしかなかったけどいいかな？",
    "お前のことが好きだったんだよ！",
    "硬くなってんぜ？",
    "多少はね？",
    "悔い改めて",
    "やりますねぇ！",
    "ファッ！？",
    "しょうがないね",
    "Foo↑気持ちいい～",
    "じゃあ、死のうか",
    "（自分を）売ったんだ！",
    "（ﾋﾟﾝﾎﾟｰﾝ）すいませ～ん！",
    "えぇ…（困惑）",
    "ダメみたいですね",
    "おっ、大丈夫か大丈夫か？",
    "ああ＾～いいっすね～＾",


    "こ↑こ↓",
    "いきすぎィ！",
    "王道を征く",
    "ビール！ビール！",
    "今日は休め。",
    "暴れんなよ…暴れんなよ…",
    "見とけよ見とけよ～",
    "（ｶﾝﾉﾐﾎ…）",
    "3人ぐらい居たんだけど、思い出せない",
    "オォン！アォン！",
    "あっ、そうだ（唐突）",
    "ケツマン（意味深）",
    "おっ、開いてんじゃーん（歓喜）",
    "もう許せるぞオイ！",
    "白菜かけますね（空耳）",
    "114514",
    "810",
    "1919"
];
const yajyuCommand: Command = {
    name: '野獣',
    description: '野獣先輩の言葉をランダムに表示します。',
    usage: '野獣',
    execute: async (_client, message, _args) => {
        if (message.channel instanceof TextChannel) {
            const randomIndex = Math.floor(Math.random() * yajyuMessages.length);
            const randomMessage = yajyuMessages[randomIndex];

            try {
                await message.channel.send(randomMessage);
            } catch (error) {
                console.error(`Error sending yajyu message: ${error}`);
            }
        } else {
            console.log(`Command "yajyu" used outside a TextChannel by ${message.author.tag}`);
        }
    }
};

registerCommand(yajyuCommand);