import os
import io
import logging
import numpy as np
from PIL import Image
from flask import Flask, request, jsonify
from ultralytics import YOLO
import cv2
import time
import errno

# --- 設定値 ---
CONFIDENCE_THRESHOLD = 0.1 # 個々の検出の信頼度閾値
IMAGE_SIZE = 648           # 推論時の画像サイズ
SERVER_PORT = 9001          # サーバーポート
DEBUG_IMAGE_DIR = './debug_images' # デバッグ画像保存ディレクトリ

app = Flask(__name__)

# --- ロギング設定 ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s'
)

# --- デバッグディレクトリ作成 ---
try:
    os.makedirs(DEBUG_IMAGE_DIR, exist_ok=True)
    logging.info(f"Debug image directory set to: {os.path.abspath(DEBUG_IMAGE_DIR)}")
except OSError as e:
    if e.errno != errno.EEXIST:
        logging.error(f"Could not create debug image directory '{DEBUG_IMAGE_DIR}': {e}", exc_info=True)
        DEBUG_IMAGE_DIR = None # 保存しないように設定

# --- モデルロード ---
model = None
model_load_error = None
try:
    # スクリプト自身の場所を基準にモデルパスを決定
    script_path = os.path.abspath(__file__)
    script_dir = os.path.dirname(script_path)
    relative_model_path = './best.pt' # モデルファイルへの相対パス
    model_name = os.path.join(script_dir, relative_model_path)
    model_name = os.path.normpath(model_name) # パスを正規化

    logging.info(f"Attempting to load model from calculated path: {model_name}")
    logging.info(f"Using confidence threshold for predict: {CONFIDENCE_THRESHOLD}")
    logging.info(f"Using image size for predict: {IMAGE_SIZE}")
    # logging.info(f"Prediction iterations: {PREDICT_ITERATIONS}") # 削除
    # logging.info(f"NMS IoU threshold: {NMS_IOU_THRESHOLD}")      # 削除

    if not os.path.exists(model_name):
         raise FileNotFoundError(f"Model file not found at the calculated path: {model_name}")

    # モデルをロード
    model = YOLO(model_name)

    # モデルロード成功確認 (クラス名が取得できるかなど)
    if isinstance(model, YOLO) and hasattr(model, 'names'):
        logging.info(f"Successfully loaded YOLO model: {model_name}")
        logging.info(f"Model class names ({len(model.names)}): {model.names}")
    else:
        # 読み込めても期待するオブジェクトでない場合
        raise RuntimeError("Failed to initialize YOLO model object properly (e.g., missing 'names' attribute).")

except FileNotFoundError as fnf_error:
    model_load_error = str(fnf_error)
    logging.error(f"Critical Error: {fnf_error}", exc_info=False) # スタックトレースは不要
except Exception as e:
    model_load_error = str(e)
    logging.error(f"Critical Error: Failed to load YOLO model ({model_name}): {e}", exc_info=True)


# --- /predict エンドポイント (修正済み) ---
@app.route('/predict', methods=['POST'])
def predict_endpoint():
    # モデルがロードされていない場合はエラーを返す
    if model is None:
        logging.error("Prediction attempt failed: Model is not loaded.")
        return jsonify({
            'error': 'Model not loaded or failed to load',
            'details': model_load_error
        }), 503 # Service Unavailable

    # リクエストに画像ファイルが含まれているかチェック
    if 'image' not in request.files:
        logging.warning("Request rejected: No 'image' file part found in the request.")
        return jsonify({'error': 'No image file provided in the request'}), 400

    file = request.files['image']

    # ファイル名が空でないかチェック
    if file.filename == '':
        logging.warning("Request rejected: No file selected (empty filename).")
        return jsonify({'error': 'No file selected'}), 400

    # 画像ファイルの読み込みと前処理
    try:
        img_bytes = file.read()
        # Pillowで開いてRGBに変換
        img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
        # Pillow(RGB) -> NumPy(RGB)
        img_np = np.array(img)
        # NumPy(RGB) -> OpenCV(BGR) - 描画用およびモデル入力用 (YOLOv8はBGR入力を想定)
        img_cv2 = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
        logging.info(f"Image received and loaded successfully: {file.filename} (Dimensions: {img.width}x{img.height})")
    except Exception as e:
        logging.error(f"Error processing image file '{file.filename}': {e}", exc_info=True)
        return jsonify({'error': f'Invalid or corrupted image file: {e}'}), 400

    # YOLO推論と結果処理
    try:
        # モデルのクラス名辞書を取得 (推論前に取得しておく)
        class_names_dict = model.names

        logging.info(f"Starting single prediction for '{file.filename}' with imgsz={IMAGE_SIZE}, conf={CONFIDENCE_THRESHOLD}...")
        start_time = time.time()

        # --- ★ 単一回の推論実行 ★ ---
        # OpenCV(BGR)形式のNumPy配列を入力として使用
        results = model.predict(
            img_cv2,                 # BGR画像を入力
            imgsz=IMAGE_SIZE,        # 推論サイズ指定
            conf=CONFIDENCE_THRESHOLD, # 信頼度閾値
            verbose=False            # コンソール出力を抑制
        )
        # model.predict は内部でNMSを実行します

        predict_time = time.time() - start_time
        logging.info(f"Single prediction completed in {predict_time:.4f} seconds.")

        # --- レスポンスデータの作成 ---
        output_data = []
        message = ""
        img_to_draw = img_cv2.copy() # デバッグ描画用に画像をコピー

        # 結果の処理 (resultsリストの最初の要素を使用)
        if results and len(results) > 0:
            result = results[0] # 単一画像入力なので結果は一つ

            # 検出結果 (Boxesオブジェクト) が存在するか確認
            if hasattr(result, 'boxes') and result.boxes is not None and len(result.boxes) > 0:
                # result.boxes にはNMS適用後の検出結果が含まれる
                boxes = result.boxes # Boxesオブジェクトを取得

                logging.info(f"Processing {len(boxes)} detections found in the result.")

                # 各検出結果を処理
                for box_data in boxes:
                    # 検出情報を抽出
                    xyxy = box_data.xyxy[0].tolist()        # 座標 [x1, y1, x2, y2]
                    confidence = box_data.conf[0].item()    # 信頼度
                    class_id = int(box_data.cls[0].item())  # クラスID
                    class_name = class_names_dict.get(class_id, f"UnknownID:{class_id}") # クラス名取得

                    # レスポンスデータに追加
                    output_data.append({
                        'class_id': class_id,
                        'class_name': class_name,
                        'confidence': confidence,
                        'box': {
                            'x1': xyxy[0],
                            'y1': xyxy[1],
                            'x2': xyxy[2],
                            'y2': xyxy[3]
                        }
                    })

                    # --- デバッグ画像への描画 ---
                    x1, y1, x2, y2 = map(int, xyxy)
                    label_text = f"{class_name}: {confidence:.2f}"
                    color = (0, 255, 0) # 緑色
                    thickness = 2
                    font_scale = 0.7
                    font = cv2.FONT_HERSHEY_SIMPLEX

                    # バウンディングボックスを描画
                    cv2.rectangle(img_to_draw, (x1, y1), (x2, y2), color, thickness)

                    # ラベルテキストを描画 (背景付き、枠外にはみ出さないように調整)
                    (w, h), _ = cv2.getTextSize(label_text, font, font_scale, thickness)
                    label_y = y1 - h - 10 if y1 - h - 10 > 0 else y1 + 10 + h # 上か下に表示
                    # テキスト背景の矩形
                    cv2.rectangle(img_to_draw, (x1, label_y - h - 5), (x1 + w, label_y + 5), color, -1)
                    # テキスト本体 (黒色)
                    cv2.putText(img_to_draw, label_text, (x1, label_y), font, font_scale, (0, 0, 0), thickness, cv2.LINE_AA)
                    # --- 描画終了 ---

                # 最終的な検出数をメッセージに設定
                final_count = len(output_data)
                if final_count > 0:
                    message = f"Detected {final_count} objects."
                else:
                    # このパスは通常、 predictのconfフィルタリングにより到達しないはず
                    message = f"Prediction ran, but no objects met the confidence threshold ({CONFIDENCE_THRESHOLD})."
                logging.info(f"Prediction result for '{file.filename}': {message}")

            else:
                 # result.boxes が空、または存在しない場合
                 message = "No objects detected (result.boxes is empty or None after internal processing)."
                 logging.info(f"Prediction result for '{file.filename}': {message}")
        else:
             # results リスト自体が空か、期待した形式でない場合
             message = "Prediction executed, but no valid results structure was returned."
             logging.warning(f"Prediction result for '{file.filename}': {message}")

        # --- デバッグ画像の保存 ---
        if DEBUG_IMAGE_DIR:
            try:
                timestamp = time.strftime("%Y%m%d_%H%M%S")
                # ファイル名を安全な文字のみにする
                safe_original_filename = "".join(c if c.isalnum() else "_" for c in os.path.splitext(file.filename)[0])

                if output_data: # 検出結果がある場合
                    save_filename = f"{timestamp}_{safe_original_filename}_result_simple.jpg" # 新しいファイル名
                    save_path = os.path.join(DEBUG_IMAGE_DIR, save_filename)
                    cv2.imwrite(save_path, img_to_draw) # 描画済み画像を保存
                    logging.info(f"Saved debug image with detections to: {save_path}")
                else: # 検出結果がない場合
                    save_filename = f"{timestamp}_{safe_original_filename}_no_detection_simple.jpg" # 新しいファイル名
                    save_path = os.path.join(DEBUG_IMAGE_DIR, save_filename)
                    cv2.imwrite(save_path, img_cv2) # 元画像(BGR)を保存
                    logging.info(f"Saved original image (no detection) to: {save_path}")
            except Exception as save_e:
                # 画像保存に失敗してもAPI自体はエラーにしない
                logging.error(f"Failed to save debug image to '{DEBUG_IMAGE_DIR}': {save_e}", exc_info=True)

        # 正常終了：検出結果を含むJSONを返す
        return jsonify({'message': message, 'predictions': output_data}), 200

    except Exception as e:
        # 推論・結果処理中の予期せぬエラー
        logging.error(f"Error during YOLO prediction or result processing for '{file.filename}': {e}", exc_info=True)
        return jsonify({'error': f'Prediction process failed internally: {e}'}), 500 # Internal Server Error


# --- /status エンドポイント (変更なし) ---
@app.route('/status', methods=['GET'])
def status_endpoint():
    """サービスの稼働状態とモデルのロード状態を返す"""
    if model is not None and model_load_error is None:
        # モデルが正常にロードされている場合
        logging.info("Status check: OK - Model is loaded.")
        return jsonify({'status': 'ok', 'message': 'Service is running and model is loaded.'}), 200
    else:
        # モデルのロードに失敗しているか、ロードされていない場合
        logging.warning(f"Status check: ERROR - Model not ready. Load Error: {model_load_error}")
        return jsonify({
            'status': 'error',
            'message': 'Service is not fully operational: Model failed to load or is not available.',
            'details': model_load_error # エラーの詳細を含める
            }), 403 # Forbidden または 503 Service Unavailable が適切


# --- メイン実行ブロック (変更なし) ---
if __name__ == '__main__':
    # サーバー起動前のモデルロード状態ログ
    if model is None:
        # model_name が定義されているか確認してから表示
        model_path_display = model_name if 'model_name' in locals() else "N/A"
        logging.warning(f"--- Flask server starting BUT YOLO model ({model_path_display}) failed to load. The /predict endpoint will return errors. ---")
        logging.warning(f"--- Load Error Details: {model_load_error} ---")
    else:
        logging.info(f"--- Flask server starting with YOLO model ({model_name}) loaded successfully. Ready to accept requests. ---")

    # Flaskサーバー起動
    logging.info(f"Starting Flask server on host 0.0.0.0, port {SERVER_PORT}...")
    try:
        # 開発環境での実行設定:
        # debug=False: 本番環境ではFalse推奨
        # threaded=True: 複数のリクエストをある程度並行処理できる（本番環境ではGunicorn等推奨）
        app.run(host='0.0.0.0', port=SERVER_PORT, debug=False, threaded=True)
    except Exception as run_error:
        # サーバー起動自体に失敗した場合
        logging.critical(f"Failed to start Flask server: {run_error}", exc_info=True)