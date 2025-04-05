import cv2
from ultralytics import YOLO
import time
import numpy as np # 利用可能なカメラ検索用

# --- 設定 ---
# OBS仮想カメラのIDを指定してください。
# 0, 1, 2... と試して、OBSの映像が表示されるIDを見つけてください。
CAMERA_ID = 1 # <<--- 環境に合わせて変更してください！

# 使用するYOLOモデル名 (Ultralyticsがサポートするモデル名)
# 'yolov10n.pt', 'yolov10s.pt', 'yolov10m.pt', 'yolov10b.pt', 'yolov10l.pt', 'yolov10x.pt' など
# '.pt' ファイルは初回実行時に自動でダウンロードされます。
MODEL_NAME = "yolo11s.pt"

# 検出の信頼度(confidence)の閾値
CONFIDENCE_THRESHOLD = 0.5

# 推論に使用するデバイス ('cpu', 'cuda', 'cuda:0' など)
# 'cuda' が利用可能なら自動で使われることが多いですが、明示的に指定も可能
DEVICE = 'cpu' # or 'cuda' if you have a compatible GPU and CUDA installed
# --- 設定終わり ---

# 利用可能なカメラデバイスを検索する関数 (オプション)
def find_available_cameras(max_test=10):
    available_cameras = []
    print("Searching for available cameras...")
    for i in range(max_test):
        cap_test = cv2.VideoCapture(i, cv2.CAP_DSHOW) # WindowsではCAP_DSHOWが安定することがある
        if cap_test.isOpened():
            ret, frame = cap_test.read()
            if ret and frame is not None:
                 print(f"  Camera ID {i}: Found, resolution {frame.shape[1]}x{frame.shape[0]}")
                 available_cameras.append(i)
            else:
                 print(f"  Camera ID {i}: Opened but failed to grab frame.")
            cap_test.release()
        # else:
        #    print(f"  Camera ID {i}: Failed to open.")
    if not available_cameras:
        print("No available cameras found.")
    else:
        print(f"Found available camera IDs: {available_cameras}")
    return available_cameras

# --- メイン処理 ---
if __name__ == "__main__":
    # 利用可能なカメラをリストアップ (不要ならコメントアウト)
    find_available_cameras()
    print("-" * 30)

    # YOLOモデルのロード
    try:
        print(f"[INFO] Loading YOLO model: {MODEL_NAME} for device: {DEVICE}")
        model = YOLO(MODEL_NAME)
        model.to(DEVICE) # 使用デバイスを設定
        print(f"[INFO] Model loaded successfully. Class names: {list(model.names.values())}")
    except Exception as e:
        print(f"[ERROR] Failed to load model: {e}")
        print("[INFO] Please ensure 'ultralytics' is installed (`pip install ultralytics`)")
        print("[INFO] The model file might be downloaded on the first run if internet is available.")
        exit()

    # OBS仮想カメラ (または指定したIDのカメラ) の開始
    print(f"[INFO] Attempting to open camera ID: {CAMERA_ID}")
    # Windowsの場合、cv2.CAP_DSHOW をバックエンドとして試すとOBS仮想カメラを認識しやすい
    cap = cv2.VideoCapture(CAMERA_ID, cv2.CAP_DSHOW)

    if not cap.isOpened():
        print(f"[ERROR] Failed to open camera ID: {CAMERA_ID}.")
        print("Please check:")
        print("  1. If OBS Studio is running and the Virtual Camera is started.")
        print(f"  2. If the CAMERA_ID ({CAMERA_ID}) is correct. Try other IDs listed above.")
        print("  3. If another application is using the camera.")
        exit()
    else:
        # カメラのプロパティを取得・表示 (オプション)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps_cam = cap.get(cv2.CAP_PROP_FPS)
        print(f"[INFO] Camera {CAMERA_ID} opened successfully.")
        print(f"    Resolution: {width}x{height}, Target FPS: {fps_cam:.2f}")

    frame_count = 0
    start_time = time.time()
    print("[INFO] Starting real-time detection loop... Press 'q' to quit.")

    # フレーム処理ループ
    while True:
        # フレームを1枚読み込む
        ret, frame = cap.read()
        if not ret or frame is None:
            print("[WARNING] Failed to grab frame. Check camera connection or OBS status.")
            # 少し待って再試行するか、ループを抜ける
            time.sleep(0.1)
            continue
            # break

        frame_count += 1

        # YOLOv10で推論を実行
        # stream=True はメモリ効率が良いが、ここではシンプルにFalseで
        # verbose=False でコンソールへの詳細ログ出力を抑制
        try:
            results = model.predict(frame, conf=CONFIDENCE_THRESHOLD, device=DEVICE, verbose=False)
        except Exception as e:
            print(f"[ERROR] Prediction failed: {e}")
            continue # エラーが発生したら次のフレームへ

        # results はリスト (通常は要素1つ)
        if results and len(results) > 0:
            result = results[0] # 最初の結果を取得

            # 結果をフレームに描画 (Ultralytics の plot() 機能)
            # バウンディングボックス、クラス名、信頼度を描画してくれる
            annotated_frame = result.plot()

            # 手動で描画したい場合の参考 (resultオブジェクトから情報を取得)
            # boxes = result.boxes
            # for box in boxes:
            #     xyxy = box.xyxy[0].cpu().numpy().astype(int)
            #     conf = box.conf[0].cpu().numpy()
            #     cls_id = int(box.cls[0].cpu().numpy())
            #     class_name = model.names[cls_id]
            #     label = f"{class_name}: {conf:.2f}"
            #     color = (0, 255, 0) # 例: 緑
            #     cv2.rectangle(annotated_frame, (xyxy[0], xyxy[1]), (xyxy[2], xyxy[3]), color, 2)
            #     cv2.putText(annotated_frame, label, (xyxy[0], xyxy[1] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        else:
            # 検出結果がない場合も元のフレームを表示
            annotated_frame = frame

        # 処理速度(FPS)の計算と表示
        elapsed_time = time.time() - start_time
        if elapsed_time > 0:
            fps = frame_count / elapsed_time
            cv2.putText(annotated_frame, f"FPS: {fps:.2f}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

        # 結果のフレームを表示
        cv2.imshow("YOLOv10s Object Detection (OBS Virtual Cam)", annotated_frame)

        # 'q' キーが押されたらループを抜ける
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            print("[INFO] 'q' pressed, exiting loop.")
            break

    # 終了処理
    print("[INFO] Cleaning up...")
    cap.release()
    cv2.destroyAllWindows()
    print("[INFO] Application finished.")