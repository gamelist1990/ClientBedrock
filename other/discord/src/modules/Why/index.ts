import { EmbedBuilder, TextChannel, AttachmentBuilder, Message } from "discord.js";
import { PREFIX, registerCommand } from "../..";
import { Command } from "../../types/command";
import { createCanvas, loadImage } from 'canvas';

const YOLO_API_URL = process.env.YOLO_API_URL || 'http://192.168.128.107:9001/predict';
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '').split(',').filter(id => id && /^\d+$/.test(id));
const NOTIFICATION_CHANNEL_ID = process.env.NOTIFICATION_CHANNEL_ID;

// --- ★ 解像度制限の設定 ★ ---
const MAX_IMAGE_WIDTH = 4000;  // 許容する最大幅
const MAX_IMAGE_HEIGHT = 4000; // 許容する最大高さ
const MAX_IMAGE_PIXELS = MAX_IMAGE_WIDTH * MAX_IMAGE_HEIGHT; // 許容する最大総ピクセル数 (約16MP)
// 必要に応じて調整してください (例: 4K相当なら 3840*2160 = 8294400)

const BOX_COLOR = '#FF0000';
const LABEL_BACKGROUND_COLOR = '#FF0000';
const LABEL_TEXT_COLOR = '#FFFFFF';
const FONT_SIZE = 16;
const FONT_FAMILY = 'sans-serif';

const classNameMap: { [key: string]: string } = {
    '810': '野獣先輩',
    'person': '人', 'bicycle': '自転車', 'car': '車', 'motorcycle': 'バイク', 'airplane': '飛行機',
    'bus': 'バス', 'train': '電車', 'truck': 'トラック', 'boat': 'ボート', 'traffic light': '信号機',
    'fire hydrant': '消火栓', 'stop sign': '一時停止標識', 'parking meter': 'パーキングメーター', 'bench': 'ベンチ',
    'bird': '鳥', 'cat': '猫', 'dog': '犬', 'horse': '馬', 'sheep': '羊', 'cow': '牛',
    'elephant': '象', 'bear': '熊', 'zebra': 'シマウマ', 'giraffe': 'キリン', 'backpack': 'バックパック',
    'umbrella': '傘', 'handbag': 'ハンドバッグ', 'tie': 'ネクタイ', 'suitcase': 'スーツケース',
    'frisbee': 'フリスビー', 'skis': 'スキー板', 'snowboard': 'スノーボード', 'sports ball': 'ボール',
    'kite': '凧', 'baseball bat': '野球バット', 'baseball glove': '野球グローブ', 'skateboard': 'スケートボード',
    'surfboard': 'サーフボード', 'tennis racket': 'テニスラケット', 'bottle': 'ボトル', 'wine glass': 'ワイングラス',
    'cup': 'カップ', 'fork': 'フォーク', 'knife': 'ナイフ', 'spoon': 'スプーン', 'bowl': 'ボウル',
    'banana': 'バナナ', 'apple': 'リンゴ', 'sandwich': 'サンドイッチ', 'orange': 'オレンジ',
    'broccoli': 'ブロッコリー', 'carrot': 'ニンジン', 'hot dog': 'ホットドッグ', 'pizza': 'ピザ',
    'donut': 'ドーナツ', 'cake': 'ケーキ', 'chair': '椅子', 'couch': 'ソファ', 'potted plant': '植木鉢',
    'bed': 'ベッド', 'dining table': 'ダイニングテーブル', 'toilet': 'トイレ', 'tv': 'テレビ',
    'laptop': 'ラップトップ', 'mouse': 'マウス', 'remote': 'リモコン', 'keyboard': 'キーボード',
    'cell phone': '携帯電話', 'microwave': '電子レンジ', 'oven': 'オーブン', 'toaster': 'トースター',
    'sink': 'シンク', 'refrigerator': '冷蔵庫', 'book': '本', 'clock': '時計', 'vase': '花瓶',
    'scissors': 'ハサミ', 'teddy bear': 'テディベア', 'hair drier': 'ヘアドライヤー', 'toothbrush': '歯ブラシ',
};

const getTranslatedClassName = (classNameOrId: string | number): string => {
    const key = String(classNameOrId).toLowerCase();
    return classNameMap[key] || String(classNameOrId);
};

const formatConfidence = (confidence: number): string => {
    return `${(confidence * 100).toFixed(1)}%`;
};

const whyCommand: Command = {
    name: 'why',
    description: '添付された画像を判定し、結果を描画して返します。',
    admin: false,
    usage: 'why <画像添付>',
    execute: async (client, message: Message, _args) => {

        if (message.attachments.size === 0) {
            await message.reply(`❌ 画像ファイルを添付してください。\n使い方: \`${PREFIX}why <画像ファイルを添付>\``);
            return;
        }
        const attachment = message.attachments.first();
        if (!attachment || !attachment.contentType?.startsWith('image/')) {
            await message.reply(`❌ 画像ファイルではないようです。画像ファイルを添付してください。`);
            return;
        }

        const imageUrl = attachment.url;
        const originalFileName = attachment.name;
        const contentType = attachment.contentType ?? 'application/octet-stream';
        let loadingMessage: Message | null = null;

        try {
            loadingMessage = await message.reply('🔍 画像を読み込み中です...'); // メッセージ変更

            const imageFetchResponse = await fetch(imageUrl);
            if (!imageFetchResponse.ok) {
                throw new Error(`画像のダウンロードに失敗しました: ${imageFetchResponse.status} ${imageFetchResponse.statusText}`);
            }
            const imageArrayBuffer = await imageFetchResponse.arrayBuffer();
            const imageBuffer = Buffer.from(imageArrayBuffer);

            // --- ★ 解像度チェックを追加 ★ ---
            let imageForCheck;
            try {
                imageForCheck = await loadImage(imageBuffer);
            } catch (loadErr) {
                console.error(`Error loading image buffer for size check: ${loadErr}`);
                await loadingMessage?.edit(`❌ 画像ファイルの読み込みに失敗しました。ファイルが破損している可能性があります。`) ??
                    message.reply(`❌ 画像ファイルの読み込みに失敗しました。ファイルが破損している可能性があります。`);
                return;
            }

            const imageWidth = imageForCheck.width;
            const imageHeight = imageForCheck.height;
            const imagePixels = imageWidth * imageHeight;

            console.log(`Image dimensions: ${imageWidth}x${imageHeight} (${imagePixels} pixels)`); // デバッグ用ログ

            if (imageWidth > MAX_IMAGE_WIDTH || imageHeight > MAX_IMAGE_HEIGHT || imagePixels > MAX_IMAGE_PIXELS) {
                const limitReason = imageWidth > MAX_IMAGE_WIDTH || imageHeight > MAX_IMAGE_HEIGHT
                    ? `幅または高さが上限 (${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT} px) を超えています`
                    : `総ピクセル数が上限 (${MAX_IMAGE_PIXELS.toLocaleString()} px) を超えています`;

                console.warn(`Image resolution too high: ${imageWidth}x${imageHeight}. ${limitReason}. Aborting.`);
                await loadingMessage?.edit(`❌ 画像の解像度 (${imageWidth}x${imageHeight}) が高すぎるため、処理できません。\n理由: ${limitReason}。`) ??
                    message.reply(`❌ 画像の解像度 (${imageWidth}x${imageHeight}) が高すぎるため、処理できません。\n理由: ${limitReason}。`);
                return; // 処理中断
            }
            // --- 解像度チェックここまで ---

            // 判定中メッセージに変更
            await loadingMessage?.edit('🔍 画像を判定中です...');


            const formData = new FormData();
            const imageBlob = new Blob([imageBuffer], { type: contentType });
            formData.append('image', imageBlob, originalFileName);

            const startTime = Date.now();
            let yoloResponseData: any;

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000);

                const yoloFetchResponse = await fetch(YOLO_API_URL, {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);

                if (!yoloFetchResponse.ok) {
                    let errorBody = '不明なサーバーエラー';
                    try {
                        const errorJson = await yoloFetchResponse.json();
                        errorBody = errorJson?.error || JSON.stringify(errorJson);
                    } catch (parseError) {
                        try { errorBody = await yoloFetchResponse.text(); }
                        catch (textError) { errorBody = `(エラーボディ読み取り失敗: ${textError})`; }
                    }
                    throw new Error(`画像判定サーバーエラー (${yoloFetchResponse.status}): ${errorBody}`);
                }
                yoloResponseData = await yoloFetchResponse.json();

            } catch (fetchError: any) {
                console.error(`❌ YOLO API Request Error (${YOLO_API_URL}):`, fetchError.message);
                let userErrorMessage: string;
                let shouldNotifyAdmin = false;
                let notifyMessage = '';
                const adminMentions = ADMIN_USER_IDS.map(id => `<@${id}>`).join(' ');

                if (fetchError.name === 'AbortError') {
                    userErrorMessage = `❌ 画像判定サーバーへの接続がタイムアウトしました。\n管理者に通知します...`;
                    console.error(`❌ YOLO API (${YOLO_API_URL}) timed out.`);
                    notifyMessage = `🚨 **警告:** 画像判定API (${YOLO_API_URL}) へのリクエストがタイムアウトしました。\nサーバーが応答不能または処理に時間がかかっている可能性があります。\n確認をお願いします。`;
                    shouldNotifyAdmin = true;
                } else if (fetchError.message.startsWith('画像判定サーバーエラー')) {
                    userErrorMessage = `❌ ${fetchError.message}`;
                } else {
                    userErrorMessage = `❌ 画像判定サーバーへの接続に失敗しました。\nサーバーが起動しているか、ネットワーク設定を確認してください。\n管理者に通知します...`;
                    console.error(`❌ YOLO API (${YOLO_API_URL}) connection failed: ${fetchError.message}`);
                    notifyMessage = `🚨 **警告:** 画像判定API (${YOLO_API_URL}) への接続に失敗しました。\nサーバーがオフラインまたは応答不能の可能性があります。\n確認と起動をお願いします。\nエラー詳細: ${fetchError.message}`;
                    shouldNotifyAdmin = true;
                }

                await loadingMessage?.edit(userErrorMessage) ?? message.reply(userErrorMessage);

                if (shouldNotifyAdmin && notifyMessage) {
                    if (NOTIFICATION_CHANNEL_ID) {
                        try {
                            const notifyChannel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
                            if (notifyChannel instanceof TextChannel) {
                                await notifyChannel.send(`${adminMentions} ${notifyMessage}`.trim());
                                console.log(`Sent notification to channel ${NOTIFICATION_CHANNEL_ID}`);
                            } else { console.warn(`Notification channel (${NOTIFICATION_CHANNEL_ID}) not found or is not a TextChannel.`); }
                        } catch (notifyError) { console.error(`Failed to send notification to channel ${NOTIFICATION_CHANNEL_ID}:`, notifyError); }
                    } else if (ADMIN_USER_IDS.length > 0) {
                        console.warn("Notification channel ID not set, attempting to DM admins.");
                        for (const adminId of ADMIN_USER_IDS) {
                            try {
                                const adminUser = await client.users.fetch(adminId);
                                await adminUser.send(notifyMessage);
                                console.log(`Sent DM notification to admin ${adminId}`);
                            } catch (dmError: any) { console.error(`Failed to send DM notification to admin ${adminId}:`, dmError.message); }
                        }
                    } else { console.warn("No admin IDs or notification channel configured for API offline alerts."); }
                }
                return;
            }

            const endTime = Date.now();
            const yoloResult = yoloResponseData;
            const predictions = yoloResult.predictions || [];
            const resultMessage = yoloResult.message || "判定完了";

            const image = await loadImage(imageBuffer); // 描画用に再度読み込み (チェック用とは別インスタンスが安全)
            const canvas = createCanvas(image.width, image.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
            ctx.textBaseline = 'top';

            predictions.forEach((pred: any) => {
                const box = pred.box;
                const className = getTranslatedClassName(pred.class_name);
                const confidence = formatConfidence(pred.confidence);
                const label = `${className} (${confidence})`;
                const x = box.x1;
                const y = box.y1;
                const width = box.x2 - box.x1;
                const height = box.y2 - box.y1;

                ctx.strokeStyle = BOX_COLOR;
                ctx.lineWidth = Math.max(2, Math.min(image.width, image.height) * 0.005);
                ctx.strokeRect(x, y, width, height);

                const textMetrics = ctx.measureText(label);
                const textWidth = textMetrics.width;
                const textHeight = FONT_SIZE * 1.2;
                let labelY = y - textHeight - ctx.lineWidth / 2;
                if (labelY < 0) { labelY = y + ctx.lineWidth / 2 + 1; }
                let labelX = x + ctx.lineWidth / 2;
                if (labelX < 0) { labelX = 1; }
                if (labelX + textWidth + 4 > canvas.width) { labelX = canvas.width - textWidth - 4; }

                ctx.fillStyle = LABEL_BACKGROUND_COLOR;
                ctx.fillRect(labelX, labelY, textWidth + 4, textHeight);
                ctx.fillStyle = LABEL_TEXT_COLOR;
                ctx.fillText(label, labelX + 2, labelY + FONT_SIZE * 0.1);
            });

            const outputBuffer = canvas.toBuffer('image/png');
            const outputAttachment = new AttachmentBuilder(outputBuffer, { name: `result_${originalFileName}.png` });

            const embed = new EmbedBuilder()
                .setColor(predictions.length > 0 ? 0x00FF00 : 0xFFCC00)
                .setTitle('🖼️ 画像判定結果')
                .setDescription(resultMessage)
                .setImage(`attachment://result_${originalFileName}.png`)
                .setTimestamp()
                .setFooter({ text: `処理時間: ${endTime - startTime}ms` });

            if (predictions.length > 0) {
                let details = '';
                predictions.forEach((pred: any, index: number) => {
                    const className = getTranslatedClassName(pred.class_name);
                    const confidence = formatConfidence(pred.confidence);
                    details += `**${index + 1}. ${className}** (${confidence})\n`;
                });
                if (details.length > 1024) { details = details.substring(0, 1020) + '...'; }
                embed.addFields({ name: `検出されたオブジェクト (${predictions.length}件)`, value: details });
            } else {
                embed.addFields({ name: '検出されたオブジェクト', value: 'なし' });
            }

            const replyOptions = { embeds: [embed], files: [outputAttachment] };
            if (loadingMessage) {
                await loadingMessage.edit({ content: ' ', ...replyOptions });
            } else {
                if (message.channel.isDMBased() || message.channel instanceof TextChannel) {
                    await message.reply(replyOptions);
                } else {
                    await message.channel.send(replyOptions);
                }
            }

        } catch (error: any) {
            console.error(`❌ whyコマンドで予期せぬエラー:`, error);
            const errorMessage = `❌ 画像の処理中に予期せぬエラーが発生しました。 (${error.message})`;
            if (loadingMessage) {
                await loadingMessage.edit(errorMessage).catch(editError => {
                    console.error("Failed to edit loading message with error:", editError);
                    message.reply(errorMessage).catch(replyError => {
                        console.error("Failed to send error reply:", replyError);
                    });
                });
            } else {
                await message.reply(errorMessage).catch(replyError => {
                    console.error("Failed to send error reply:", replyError);
                });
            }
        }
    }
};

registerCommand(whyCommand);