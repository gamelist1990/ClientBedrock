import { Message, Attachment, EmbedBuilder } from 'discord.js';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { PREFIX, registerCommand } from '../..'; // Adjust paths as needed
import { Command } from '../../types/command'; // Adjust paths as needed

const OUTPUT_DIR = path.join(__dirname, '../../../temp_generated'); // Adjust path if needed

const CAPE_OUTPUT_WIDTH = 64;
const CAPE_OUTPUT_HEIGHT = 32;

// --- ケープ/エリトラの貼り付け領域定義 (標準UVとジオメトリ情報を参考に調整) ---
// ケープ背面 (UV: [12, 0] size: [10, 16]) -> 左上(12, 1)を基準とする
const CAPE_BACK_TARGET_X = 12;
const CAPE_BACK_TARGET_Y = 1;
const CAPE_BACK_TARGET_WIDTH = 10;
const CAPE_BACK_TARGET_HEIGHT = 16;

// エリトラ右翼 (UV: [22, 0] size: [10, 16]) -> 左上(22, 1)を基準とする
const ELYTRA_RIGHT_TARGET_X = 22;
const ELYTRA_RIGHT_TARGET_Y = 1;
const ELYTRA_WING_WIDTH = 10;
const ELYTRA_WING_HEIGHT = 16;

// エリトラ左翼 (UV: [32, 0] size: [10, 16]) -> 左上(32, 1)を基準とする
const ELYTRA_LEFT_TARGET_X = 32;
const ELYTRA_LEFT_TARGET_Y = 1;
// 幅と高さは右翼と同じ

// --- 色置き換え設定 ---
// !!! 使用するテンプレート画像の置き換えたい色に合わせて正確に設定 !!!
const TARGET_COLOR_R = 0;   // 例: 青のR値
const TARGET_COLOR_G = 0;   // 例: 青のG値
const TARGET_COLOR_B = 170; // 例: 青のB値
const COLOR_TOLERANCE = 35; // 色の類似許容誤差 (0に近いほど厳密)

// --- テンプレートファイルのパス ---
const TEMPLATE_PATH = path.join(__dirname, './assets/cape.png'); // パスを確認・修正

// --- ヘルパー関数 ---
async function ensureOutputDir(): Promise<void> {
    try {
        await fs.access(OUTPUT_DIR);
    } catch (error) {
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
        console.log(`Created temporary directory: ${OUTPUT_DIR}`);
    }
}

function areColorsSimilar(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number, tolerance: number): boolean {
    const diffR = Math.abs(r1 - r2);
    const diffG = Math.abs(g1 - g2);
    const diffB = Math.abs(b1 - b2);
    return diffR <= tolerance && diffG <= tolerance && diffB <= tolerance;
}

// --- コマンド定義 ---
const genCapeCommand: Command = {
    name: 'gen_mine',
    description: '添付画像とテンプレートを基にケープ(エリトラ含)を生成。テンプレートの特定色を主要色で置換。',
    admin: false,
    usage: 'gen_mine (画像を添付)',
    execute: async (_client, message, _args) => {
        await ensureOutputDir();

        if (message.attachments.size === 0) {
            await message.reply('❌ 画像ファイルが添付されていません。ケープにしたい画像を添付してください。');
            return;
        }

        const attachment = message.attachments.first();
        if (!attachment || !attachment.contentType?.startsWith('image/')) {
            await message.reply('❌ 添付ファイルが画像形式ではありません。(png, jpg, gifなど)');
            return;
        }

        try {
            await fs.access(TEMPLATE_PATH);
        } catch (templateError) {
            console.error(`Template file not found at: ${TEMPLATE_PATH}`);
            await message.reply('❌ ケープ生成に必要なテンプレートファイルが見つかりません。管理者に連絡してください。');
            return;
        }

        const imageUrl = attachment.url;
        const timestamp = Date.now();
        const tempInputFilename = `input_${timestamp}_${attachment.id}.tmp`;
        const outputFilename = `cape_${timestamp}_${attachment.id}.png`;
        const tempInputPath = path.join(OUTPUT_DIR, tempInputFilename);
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        const outputAttachmentName = `cape_${timestamp}_${attachment.id}.png`;

        try {
            const response = await fetch(imageUrl);
            if (!response.ok || !response.body) {
                throw new Error(`画像のダウンロードに失敗しました (${response.status} ${response.statusText})`);
            }
            const imageBuffer = Buffer.from(await response.arrayBuffer());
            await fs.writeFile(tempInputPath, imageBuffer);

            let dominantColor = { r: 128, g: 128, b: 128 };
            try {
                const stats = await sharp(tempInputPath).stats();
                dominantColor = { ...stats.dominant };
            } catch (statsError) {
                console.warn(`Could not get dominant color for ${attachment.name}, defaulting to grey. Error:`, statsError);
            }

            const templateImage = sharp(TEMPLATE_PATH);
            const { data: templatePixels, info: templateInfo } = await templateImage
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });

            if (templateInfo.channels !== 4) {
                throw new Error('テンプレート画像はRGBA形式である必要があります。');
            }
            if (templateInfo.width !== CAPE_OUTPUT_WIDTH || templateInfo.height !== CAPE_OUTPUT_HEIGHT) {
                console.warn(`テンプレート画像のサイズが期待値(${CAPE_OUTPUT_WIDTH}x${CAPE_OUTPUT_HEIGHT})と異なります: ${templateInfo.width}x${templateInfo.height}`);
            }

            const newPixels = Buffer.from(templatePixels);
            const dominantR = dominantColor.r;
            const dominantG = dominantColor.g;
            const dominantB = dominantColor.b;

            for (let i = 0; i < newPixels.length; i += 4) {
                const r = newPixels[i];
                const g = newPixels[i + 1];
                const b = newPixels[i + 2];
                const a = newPixels[i + 3];

                if (a === 255 && areColorsSimilar(r, g, b, TARGET_COLOR_R, TARGET_COLOR_G, TARGET_COLOR_B, COLOR_TOLERANCE)) {
                    newPixels[i] = dominantR;
                    newPixels[i + 1] = dominantG;
                    newPixels[i + 2] = dominantB;
                }
            }

            const modifiedTemplateImage = sharp(newPixels, {
                raw: {
                    width: templateInfo.width,
                    height: templateInfo.height,
                    channels: 4
                }
            });

            // ケープ背中用にリサイズ (10x16)
            const resizedCapeBack = await sharp(tempInputPath)
                .resize(CAPE_BACK_TARGET_WIDTH, CAPE_BACK_TARGET_HEIGHT, {
                    kernel: sharp.kernel.nearest,
                    fit: 'cover' // サイズに合わせてトリミングまたは余白追加
                })
                .ensureAlpha()
                .png()
                .toBuffer();

            // エリトラ翼用にリサイズ (10x16)
            const resizedElytraWing = await sharp(tempInputPath)
                .resize(ELYTRA_WING_WIDTH, ELYTRA_WING_HEIGHT, {
                    kernel: sharp.kernel.nearest,
                    fit: 'cover' // サイズに合わせてトリミングまたは余白追加
                })
                .ensureAlpha()
                .png()
                .toBuffer();

            // 色置換後のテンプレートに各パーツを合成
            await modifiedTemplateImage
                .composite([
                    {
                        input: resizedCapeBack,
                        left: CAPE_BACK_TARGET_X,
                        top: CAPE_BACK_TARGET_Y
                    },
                    {
                        input: resizedElytraWing,
                        left: ELYTRA_RIGHT_TARGET_X,
                        top: ELYTRA_RIGHT_TARGET_Y
                    },
                    {
                        input: resizedElytraWing,
                        left: ELYTRA_LEFT_TARGET_X,
                        top: ELYTRA_LEFT_TARGET_Y
                    }
                ])
                .png() // 出力形式をPNGに指定
                .toFile(outputPath);

            const successEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ ケープ生成完了！')
                .setDescription('Minecraftケープ（エリトラ含む）の生成が完了しました。')
                .setImage(`attachment://${outputAttachmentName}`)
                .setTimestamp()
                .setFooter({ text: `Requested by ${message.author.tag}` });

            await message.reply({
                embeds: [successEmbed],
                files: [{
                    attachment: outputPath,
                    name: outputAttachmentName
                }]
            });

        } catch (error: any) {
            console.error(`❌ Cape generation error:`, error);
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ ケープ生成エラー')
                .setDescription(`ケープの生成中にエラーが発生しました。\n\`\`\`${error.message}\`\`\``)
                .setTimestamp();
            await message.reply({ embeds: [errorEmbed] });
        } finally {
            try {
                await fs.unlink(tempInputPath);
            } catch (e) {
                /* ignore */
            }
            /*
            try {
                 await fs.unlink(outputPath);
            } catch (e) {
                 // ignore
            }
            */
        }
    }
};

registerCommand(genCapeCommand);