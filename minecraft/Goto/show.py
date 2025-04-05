import tkinter as tk
import mss
import cv2
import numpy as np
from ultralytics import YOLO
import time
import argparse
import os

# --- 設定 ---
DEFAULT_MODEL_NAME = 'yolov8s.pt' # --ptが指定されなかった場合のデフォルトモデル
DEFAULT_CONFIDENCE = 0.25       # デフォルトの信頼度閾値
AUTO_CONFIDENCE = 0.4           # --auto_conf が有効な場合の閾値
DEFAULT_IMG_SIZE = 640          # デフォルトの推論画像サイズ
FPS_UPDATE_INTERVAL = 1

# --- 色とフォント設定 ---
COLORS = {
    'box': (0, 255, 0), 'box_tk': '#32CD32',
    'text_cv': (0, 0, 0), 'text_tk': 'black',
    'text_bg_cv': (50, 205, 50, 200), 'text_bg_tk': '#ADFF2F',
    'fps_tk': 'black'
}
LINE_THICKNESS = 2
FONT = cv2.FONT_HERSHEY_SIMPLEX
FONT_SCALE = 0.7
FONT_THICKNESS = 2
TK_FONT = ("Arial", 14, "bold")
TK_FONT_FPS = ("Arial", 18, "bold")

# --- ★ コマンドライン引数の拡張 ★ ---
parser = argparse.ArgumentParser(description="Real-time screen object detection with YOLO and Tkinter overlay.")
parser.add_argument('--window', action='store_true', help="Use Tkinter overlay window instead of OpenCV window.")
parser.add_argument('--pt', type=str, default=None, help="Absolute path to the YOLO model .pt file.")
parser.add_argument('--conf', type=float, default=DEFAULT_CONFIDENCE, help=f"Confidence threshold for detection (default: {DEFAULT_CONFIDENCE}).")
parser.add_argument('--auto_conf', action='store_true', help=f"Use automatically determined confidence threshold (currently set to {AUTO_CONFIDENCE}), overrides --conf.")
parser.add_argument('--imgsz', type=int, default=DEFAULT_IMG_SIZE, help=f"Inference image size (e.g., 320, 640, 1280) (default: {DEFAULT_IMG_SIZE}).")
args = parser.parse_args()

# --- ★ 信頼度閾値の決定 ★ ---
confidence_to_use = AUTO_CONFIDENCE if args.auto_conf else args.conf
print(f"Using Confidence Threshold: {confidence_to_use}{' (Auto)' if args.auto_conf else ''}")
print(f"Using Inference Image Size: {args.imgsz}")

# --- モデル読み込みロジック ---
model_path_to_load = DEFAULT_MODEL_NAME
if args.pt:
    if os.path.exists(args.pt):
        print(f"Using model specified by --pt: {args.pt}")
        model_path_to_load = args.pt
    else:
        print(f"Error: Model file not found at path: {args.pt}")
        print(f"Falling back to default model: {DEFAULT_MODEL_NAME}")
else:
    print(f"No --pt specified, using default model: {DEFAULT_MODEL_NAME}")

model = None
model_names = {}
try:
    print(f"Loading YOLO model from: {model_path_to_load}...")
    model = YOLO(model_path_to_load)
    model_names = model.names
    if hasattr(model, 'task'):
        print(f"Model loaded successfully. Task type: {model.task}.")
    else:
        print(f"Model loaded successfully.")
    print(f"Detected classes ({len(model_names)}): {list(model_names.values())}")
except FileNotFoundError:
    print(f"Error: Failed to load model. File not found: '{model_path_to_load}'.")
    exit()
except Exception as e:
    print(f"Error loading YOLO model from '{model_path_to_load}': {e}")
    exit()

# --- 画面キャプチャの準備 ---
sct = mss.mss()
monitor_number = 1
try:
    monitor = sct.monitors[monitor_number]
except IndexError:
    print(f"Monitor {monitor_number} not found, trying monitor 0 (Full screen).")
    monitor_number = 0
    monitor = sct.monitors[monitor_number]
monitor_width = monitor["width"]
monitor_height = monitor["height"]
print(f"Using monitor {monitor_number}: {monitor_width}x{monitor_height}")

# --- Tkinterウィンドウの準備 ---
tk_root = None
tk_canvas = None
if args.window:
    try:
        print("Initializing Tkinter overlay...")
        tk_root = tk.Tk()
        tk_root.title("YOLO Screen Overlay")
        tk_root.overrideredirect(True)
        tk_root.wm_attributes("-topmost", True)
        transparent_color = "fuchsia"
        tk_root.wm_attributes("-transparentcolor", transparent_color)
        tk_root.geometry(f"{monitor_width}x{monitor_height}+{monitor['left']}+{monitor['top']}")
        tk_canvas = tk.Canvas(tk_root, width=monitor_width, height=monitor_height, bg=transparent_color, highlightthickness=0)
        tk_canvas.pack()
        print("Tkinter overlay initialized.")
        def quit_app(event=None): global running; print("Quitting..."); running = False
        tk_root.bind('<q>', quit_app)
        tk_root.bind('<Escape>', quit_app)
    except Exception as e:
        print(f"Error initializing Tkinter: {e}"); print("Falling back to OpenCV window display."); args.window = False

# --- メインループ ---
running = True
frame_count = 0
last_fps_time = time.time()
last_fps = 0.0
print("Starting detection loop... Press 'q' or 'Esc' to quit.")

try:
    while running:
        start_time = time.time()

        # 1. 画面キャプチャ
        sct_img = sct.grab(monitor)
        img_bgr = np.array(sct_img)
        img_bgr = cv2.cvtColor(img_bgr, cv2.COLOR_BGRA2BGR)
        # 推論用にRGBに変換する必要は predictメソッドが行うため、通常は不要
        # img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

        # 2. ★ YOLO推論 (解像度と信頼度を指定) ★
        results = model.predict(
            img_bgr,                 # BGR画像を入力
            imgsz=args.imgsz,        # 推論サイズ指定
            conf=confidence_to_use,  # 決定した信頼度閾値を使用
            verbose=False            # コンソール出力を抑制
        )
        result = results[0] # 最初の結果を取得

        # 3. 描画
        if args.window and tk_canvas:
            # --- Tkinter Overlay描画 ---
            tk_canvas.delete("all")

            if result.boxes is not None:
                # predict時にconfでフィルタリングされているはずだが、
                # boxesオブジェクトはフィルタリング前のものを含む場合があるので注意
                # ここでは result.boxes に含まれるものは閾値以上と仮定して描画する
                boxes = result.boxes.xyxy.cpu().numpy().astype(int)
                confs = result.boxes.conf.cpu().numpy() # 表示用に取得
                classes = result.boxes.cls.cpu().numpy().astype(int)

                for i in range(len(boxes)):
                    # 閾値チェックは predict で行われているので不要
                    x1, y1, x2, y2 = boxes[i]
                    class_id = classes[i]
                    conf = confs[i]
                    label = model_names.get(class_id, f"ID:{class_id}")
                    display_text = f"{label}: {conf:.2f}" # 信頼度も表示

                    box_color = COLORS['box_tk']
                    text_color = COLORS['text_tk']
                    text_bg_color = COLORS['text_bg_tk']

                    # テキスト描画
                    text_height_estimate = TK_FONT[1] + 6
                    estimated_text_width = len(display_text) * TK_FONT[1] * 0.7
                    text_x = x1
                    text_y_bg = y1 - text_height_estimate - 3
                    text_y_fg = text_y_bg + 3
                    if text_y_bg < 0:
                        text_y_bg = y1 + 3
                        text_y_fg = text_y_bg + 3
                    tk_canvas.create_rectangle(text_x, text_y_bg, text_x + estimated_text_width + 8, text_y_bg + text_height_estimate, fill=text_bg_color, outline="", tags="detection_text_bg")
                    tk_canvas.create_text(text_x + 4, text_y_fg, text=display_text, fill=text_color, anchor="nw", font=TK_FONT, tags="detection_text")

                    # ボックス描画
                    tk_canvas.create_rectangle(x1, y1, x2, y2, outline=box_color, width=LINE_THICKNESS, tags="detection_box")

            # FPS表示
            fps_text = f"FPS: {last_fps:.1f}"
            fps_text_width_estimate = len(fps_text) * TK_FONT_FPS[1] * 0.7
            fps_text_height_estimate = TK_FONT_FPS[1] + 8
            fps_x, fps_y = 15, 15
            tk_canvas.create_rectangle(fps_x - 5, fps_y - 5, fps_x + fps_text_width_estimate + 5, fps_y + fps_text_height_estimate, fill=COLORS['text_bg_tk'], outline="", tags="fps_bg")
            tk_canvas.create_text(fps_x, fps_y, text=fps_text, fill=COLORS['fps_tk'], anchor="nw", font=TK_FONT_FPS, tags="fps_text")

            tk_root.update_idletasks()
            tk_root.update()

        else:
            # --- OpenCVウィンドウ描画 ---
            img_display = img_bgr.copy()

            if result.boxes is not None:
                boxes = result.boxes.xyxy.cpu().numpy().astype(int)
                confs = result.boxes.conf.cpu().numpy()
                classes = result.boxes.cls.cpu().numpy().astype(int)

                for i in range(len(boxes)):
                    x1, y1, x2, y2 = boxes[i]
                    class_id = classes[i]
                    conf = confs[i]
                    label = model_names.get(class_id, f"ID:{class_id}")
                    display_text = f"{label}: {conf:.2f}"

                    box_color = COLORS['box']
                    text_color = COLORS['text_cv']
                    text_bg_color_cv = (COLORS['text_bg_cv'][0], COLORS['text_bg_cv'][1], COLORS['text_bg_cv'][2])

                    # テキスト描画
                    (text_width, text_height), baseline = cv2.getTextSize(display_text, FONT, FONT_SCALE, FONT_THICKNESS)
                    text_y_base = y1 - baseline - 8
                    if text_y_base - text_height < 0:
                       text_y_base = y1 + text_height + baseline + 8
                    cv2.rectangle(img_display, (x1, text_y_base - text_height - baseline - 4), (x1 + text_width + 4, text_y_base + baseline + 4), text_bg_color_cv, -1)
                    cv2.putText(img_display, display_text, (x1 + 2, text_y_base), FONT, FONT_SCALE, text_color, FONT_THICKNESS, lineType=cv2.LINE_AA)

                    # ボックス描画
                    cv2.rectangle(img_display, (x1, y1), (x2, y2), box_color, LINE_THICKNESS)

            # FPS表示
            fps_text = f"FPS: {last_fps:.1f}"
            fps_font_scale = FONT_SCALE * 1.3
            fps_font_thickness = FONT_THICKNESS
            (fps_w, fps_h), fps_b = cv2.getTextSize(fps_text, FONT, fps_font_scale, fps_font_thickness)
            fps_x, fps_y = 10, 10 + fps_h + fps_b
            fps_bg_color_cv = (COLORS['text_bg_cv'][0], COLORS['text_bg_cv'][1], COLORS['text_bg_cv'][2])
            cv2.rectangle(img_display, (fps_x - 5, fps_y - fps_h - fps_b - 5), (fps_x + fps_w + 5, fps_y + 5), fps_bg_color_cv, -1)
            cv2.putText(img_display, fps_text, (fps_x, fps_y - fps_b), FONT, fps_font_scale, COLORS['text_cv'], fps_font_thickness, lineType=cv2.LINE_AA)

            cv2.imshow("YOLO Screen Detection (Press 'q' or 'Esc' to quit)", img_display)

            key = cv2.waitKey(1) & 0xFF
            if key == ord('q') or key == 27:
                running = False

        # FPS計算
        frame_count += 1
        current_time = time.time()
        elapsed_time = current_time - last_fps_time
        if elapsed_time >= FPS_UPDATE_INTERVAL:
            if elapsed_time > 0: last_fps = frame_count / elapsed_time
            frame_count = 0
            last_fps_time = current_time

except KeyboardInterrupt: print("Interrupted by user.")
finally:
    print("Cleaning up...")
    if not args.window: cv2.destroyAllWindows()
    if tk_root:
        try: tk_root.destroy()
        except tk.TclError: pass
    sct.close()
    print("Exited.")