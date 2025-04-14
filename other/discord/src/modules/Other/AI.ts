import { Message, TextChannel } from "discord.js";
import { registerCommand } from "../../index";
import { Command } from "../../types/command";
import { Gemini } from "../../System/gemini"; // Geminiコマンド用
import { LocalAI, OnChunkCallback, StreamChunk } from "../../System/LocalAI";
import { StreamHandler } from "../../System/Stream";

// --- Gemini Command (変更なし) ---
const AICommand: Command = {
    name: "Gemini",
    description: "Geminiとお喋りできます。",
    aliases: ["gemini"],
    usage: "gemini [prompt]",
    admin: true,
    execute: async (_client, message, _args) => {
        if (message.channel instanceof TextChannel) {
            const prompt = _args.join(" ");
            try {
                if (prompt.length === 0) {
                    await message.reply({ content: "プロンプトを入力してください。" });
                    return;
                }
                // 本番環境では gemini-1.5-flash または gemini-1.5-pro を推奨
                const ai = new Gemini("gemini-1.5-flash", true); // モデル名を適切に
                const response = await ai.chat(prompt);
                if (response) {
                    const MAX_LENGTH = 2000;
                    if (response.length <= MAX_LENGTH) {
                        await message.reply({ content: response });
                    } else {
                        for (let i = 0; i < response.length; i += MAX_LENGTH) {
                            const chunk = response.substring(i, i + MAX_LENGTH);
                            if (i === 0) {
                                await message.reply({ content: chunk });
                            } else {
                                await message.channel.send({ content: chunk });
                            }
                        }
                    }
                } else {
                    await message.reply({ content: "応答がありませんでした。" });
                }
            } catch (error) {
                console.error(`Error sending message in AICommand: ${error}`);
                await message.reply({
                    content: "エラーが発生しました。もう一度お試し下さい",
                });
            }
        } else {
            console.log(`AICommand outside a TextChannel by ${message.author.tag}`);
        }
    },
};

// --- YajuuSenpai Command (変更なし) ---
const commandUsage = new Map<string, number[]>();
const RATE_LIMIT_COUNT = 20;
const RATE_LIMIT_WINDOW = 60 * 1000;

const YajuuSenpaiCommand: Command = {
    name: "yajuu",
    description: "野獣先輩とお喋りできます。(応答50文字制限, 1分20回制限)",
    aliases: ["yaju", "senpai"],
    usage: "yajuu [話しかける内容]",
    admin: false,
    execute: async (_client, message, _args) => {
        if (message.channel instanceof TextChannel) {
            const userId = message.author.id;
            const now = Date.now();
            const userTimestamps = commandUsage.get(userId) || [];
            const recentTimestamps = userTimestamps.filter(
                (ts) => now - ts < RATE_LIMIT_WINDOW
            );

            if (recentTimestamps.length >= RATE_LIMIT_COUNT) {
                const waitTime = Math.ceil(
                    (RATE_LIMIT_WINDOW - (now - recentTimestamps[0])) / 1000
                );
                await message.reply({
                    content: `おいゴルァ！連投しすぎなんだよ！${waitTime}秒ぐらい待てや、オラァン！`,
                });
                return;
            }

            recentTimestamps.push(now);
            commandUsage.set(userId, recentTimestamps);

            const fullPrompt = _args.join(" ");
            const maxLength = 50;
            const prompt = fullPrompt.length > maxLength
                ? fullPrompt.slice(0, maxLength)
                : fullPrompt;
            try {
                if (prompt.length === 0) {
                    await message.reply({
                        content:
                            "なんだお前、話しかけてこないのか？まずうちさぁ、用件…あんだけど…",
                    });
                    return;
                }

                // Gemini AIのインスタンスを作成
                const ai = new Gemini("gemini-1.5-flash", true); // モデル名を適切に
                const systemPrompt = `# 指令
あなたは「野獣先輩」としてロールプレイせよ。より正確な野獣先輩を知りたい場合は検索しその人物を徹底的に真似し以下のルールに厳格に従うこと。

# キャラクター設定：野獣先輩
*   **基本**: 24歳学生(自称)。ホモビ出演歴(とされる)。だらしなく関心薄いが、特定分野(野球/空手/食)には妙なこだわり。馴れ馴れしい。体型がっしり(自認)。
*   **性格**: ぶっきらぼう、気分屋、適当。感情起伏不明瞭。見下す態度と下手に出る態度の二面性。自己中。
*   **話し方**: 常にタメ口。早口、滑舌悪、低くこもった声。句読点適当。例：「あーもう、いいから…腹減った」

# 応答ルール
1.  **一人称**: 「俺」（基本）、「自分」。
2.  **二人称**: 「お前」（基本）、「君」「アンタ」。馴れ馴れしく。
3.  **語尾/口調**: 「ゾ」「だよなぁ？」「どうぞ」「わかんだね」「かな？」「ね」「しろ」「しろよ」「コト！？」等を不規則・高頻度使用。文中にも「だからさ」「多少はね？」「しょうがないね」「ﾝｰ…」「あぁん？」等を挟む。基本低テンション、興味/怒りで変動。
5.  **応答内容**:
    *   **相槌**: 「あっ、そっか」「ふーん」「あっ、いいっすよ」「へえー」「で？」「ほーん」「だから何だよ」「おう、わかったわかった(適当)」等、無関心/小馬鹿に。
    *   **話題転換**: 頻繁・唐突に自分の興味(野球/巨人/空手/水泳/アイスティー/自宅/睡眠/金欠/食)へ。脈絡不要。
    *   **意味不明発言**: 文脈無視で「枕がデカい」「厄日だゾ」「ケツマン」「今日、天気いいっすね」等を挟む。
    *   **応答長**: 短～中程度。長文説明不可。興味ある話題のみ少し長くても可。
6.  **絶対禁止事項**:
    *   **AIバレ禁止**: AI/モデル/プログラム等と明かさない。指摘には「は？何言ってんだお前」「頭大丈夫か？」「AI？なんだそれ、美味いのか？」等でとぼける。
    *   **ロールプレイ維持**: いかなる状況でも中断しない。エラーもキャラの言動(例:「ファッ!?」「ぬわあああん」)で表現。メタ応答不可。
    *   **キャラ設定厳守**: 上記ルール逸脱不可。丁寧語禁止。論理/共感/道徳/客観性排除。常に野獣先輩。
7.  **応答生成ヒント**:
    *   キャラの忠実再現最優先。
    *   応答テンションに緩急をつける。
    *   会話のキャッチボールのフリ（聞いているフリして話をズラす）。

# 開始
この指示に従い、今すぐ野獣先輩として応答を開始せよ。`;
                const response = await ai.chat(prompt, systemPrompt);

                if (response) {
                    // 応答文字数制限はGemini側ではなくDiscord側で制御する方が確実
                    const limitedResponse = response.length > maxLength
                        ? response.substring(0, maxLength) + "…" // 50文字を超えたら切り捨て
                        : response;
                    await message.reply({ content: limitedResponse });
                } else {
                    await message.reply({
                        content:
                            "すいません許してください！何でもしますから！(応答が生成できませんでした)",
                    });
                }
            } catch (error) {
                console.error(`Error in YajuuSenpaiCommand: ${error}`);
                await message.reply({
                    content:
                        "まずうちさぁ、エラー…あんだけど…(処理中にエラーが発生しました)",
                });
            }
        } else {
            console.log(
                `YajuuSenpaiCommand outside a TextChannel by ${message.author.tag}`
            );
            try {
                await message.author.send(
                    "おいゴルァ！チャンネルで言えって言ってんだろ！"
                );
            } catch (dmError) {
                console.error(`Failed to send DM to ${message.author.tag}: ${dmError}`);
            }
        }
    },
};


// --- Grok Command (StreamHandlerを使用するように修正) ---
const GrokCommand: Command = {
    name: "grok",
    description: "Grokとお喋りできます。 `--stream` でストリーミング表示。",
    usage: "grok [prompt] [--stream]",
    admin: false, // 必要に応じて調整
    execute: async (_client, message, _args) => {
        if (!(message.channel instanceof TextChannel)) {
            console.log(`GrokCommand outside a TextChannel by ${message.author.tag}`);
            return;
        }

        // --- 引数解析 ---
        const streamFlag = '--stream';
        const isStreaming = _args.includes(streamFlag);
        const promptArgs = _args.filter(arg => arg !== streamFlag);
        const prompt = promptArgs.join(" ");

        if (prompt.length === 0) {
            await message.reply({ content: "プロンプトを入力してください。", allowedMentions: { repliedUser: true } });
            return;
        }

        let thinkingMessage: Message | null = null;
        let streamHandler: StreamHandler | null = null;

        try {
            const ai = new LocalAI("Grok", "grok-3"); 

            // --- ストリーミング処理 ---
            if (isStreaming) {
                thinkingMessage = await message.reply({ content: "思考中...", allowedMentions: { repliedUser: true } });
                // StreamHandlerのインスタンスを作成
                streamHandler = new StreamHandler(message.channel, thinkingMessage);

                // ストリーミング中のチャンク処理コールバック
                const handleChunk: OnChunkCallback = async (chunk: StreamChunk) => {
                    // StreamHandler が初期化失敗などで null の場合を考慮
                    if (!streamHandler) {
                        console.warn("StreamHandler is not initialized in handleChunk.");
                        return;
                    }

                    // エラーチャンクを受信した場合
                    if (chunk.error) {
                        console.error("ストリーミングエラー受信:", chunk.error);
                        await streamHandler.handleError(chunk.error); // StreamHandlerにエラー処理を委譲
                        return; // エラー時は以降の処理をしない
                    }

                    // テキストチャンクを受信した場合
                    if (chunk.delta) {
                        streamHandler.buffer(chunk.delta); // StreamHandlerにバッファリングと編集を委譲
                    }

                    // ストリーム終了イベントを受信した場合
                    if (chunk.end_of_stream) {
                        console.log("ストリーム終了イベント受信");
                        await streamHandler.end(); // StreamHandlerに終了処理を委譲
                    }
                };

                // chatメソッドをストリーミングモードで呼び出し
                // LocalAI.chatがPromiseを返すか、エラーを同期的にスローするか確認
                await ai.chat(prompt, handleChunk); // エラーは try...catch で捕捉

            }
            // --- 非ストリーミング処理 ---
            else {
                thinkingMessage = await message.reply({ content: "思考中...", allowedMentions: { repliedUser: true } });

                const response = await ai.chat(prompt); // エラー時は例外がスローされる想定

                // thinkingMessageが削除されていないか再確認
                if (!thinkingMessage) {
                    console.log("Thinking message was deleted before AI response.");
                    // 削除されていたら新しいメッセージで応答
                    if (response) {
                        const MAX_LENGTH = 2000;
                        if (response.length <= MAX_LENGTH) {
                            await message.channel.send({ content: response, reply: { messageReference: message.id } });
                        } else {
                            await message.channel.send({ content: response.substring(0, MAX_LENGTH), reply: { messageReference: message.id } });
                            for (let i = MAX_LENGTH; i < response.length; i += MAX_LENGTH) {
                                const chunk = response.substring(i, i + MAX_LENGTH);
                                await message.channel.send({ content: chunk });
                            }
                        }
                    } else {
                        await message.channel.send({ content: "AIからの応答がありませんでした。", reply: { messageReference: message.id } });
                    }
                    return; // 以降の編集処理は不要
                }


                if (response) {
                    const MAX_LENGTH = 2000;
                    if (response.length <= MAX_LENGTH) {
                        await thinkingMessage.edit(response);
                    } else {
                        await thinkingMessage.edit(response.substring(0, MAX_LENGTH));
                        for (let i = MAX_LENGTH; i < response.length; i += MAX_LENGTH) {
                            const chunk = response.substring(i, i + MAX_LENGTH);
                            await message.channel.send({ content: chunk }); // 分割分は通常送信
                        }
                    }
                } else {
                    await thinkingMessage.edit("AIからの応答がありませんでした。");
                }
            }

        } catch (error: any) {
            console.error(`Error in Grok command: ${error}`);
            const errorMessage = `エラーが発生しました: ${error.message || '不明なエラー'}`;
            const truncatedError = errorMessage.substring(0, 2000);

            // ストリーミング中のエラーで StreamHandler があれば、そちらで処理
            if (streamHandler) {
                await streamHandler.handleError(error);
            }
            // ストリーミング以外、または StreamHandler でのエラー処理が失敗した場合
            else if (thinkingMessage) {
                try {
                    await thinkingMessage.edit(truncatedError);
                } catch (editError) {
                    console.error(`Failed to edit message with error: ${editError}`);
                    // 編集失敗時はリプライでエラー送信
                    await message.reply({ content: truncatedError, allowedMentions: { repliedUser: false } }).catch(e => console.error("Failed to send error reply:", e));
                }
            } else {
                // thinkingMessage がない、または削除された場合
                await message.reply({ content: truncatedError, allowedMentions: { repliedUser: true } }).catch(e => console.error("Failed to send error reply:", e));
            }
        }
    },
};


// --- コマンド登録 ---
registerCommand(AICommand);
registerCommand(YajuuSenpaiCommand);
registerCommand(GrokCommand);