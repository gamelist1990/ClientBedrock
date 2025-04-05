import cv2
import os
import datetime
import yaml
import random
import shutil
from PIL import Image, ImageTk, ImageDraw
import tkinter as tk
from tkinter import messagebox, font, Listbox, Scrollbar, SINGLE, END, Checkbutton, BooleanVar
import threading
import queue
import argparse
import keyboard
import time
import numpy as np

try:
    import torch
    from ultralytics import YOLO
    auto_detect_available = True
except ImportError:
    auto_detect_available = False

try:
    import keyboard
    keyboard_available = True
except ImportError:
    keyboard_available = False
except Exception as e:
    keyboard_available = False

CAMERA_ID = 1
OUTPUT_DIR = "dataset"
IMAGE_DIR_BASE = os.path.join(OUTPUT_DIR, "images_base")
LABEL_DIR_BASE = os.path.join(OUTPUT_DIR, "labels_base")
TRAIN_IMG_SUBDIR, VAL_IMG_SUBDIR = "train", "val"
TRAIN_LBL_SUBDIR, VAL_LBL_SUBDIR = "train", "val"
VALIDATION_SPLIT = 0.2
RANDOM_SEED = 42
## CLASS_NAMES = ["human", "bot", "redstone", "emerald", "diamond", "iron", "entity", "hiveBlock"]
CLASS_NAMES = ["810"]
GLOBAL_PAUSE_HOTKEY = 'n'
GLOBAL_SAVE_RESUME_HOTKEY = 'm'
AUTO_DETECT_CONF_THRESHOLD = 0.40
BETA_MODE_SAVE_INTERVAL_SECONDS = 1

drawing = False
start_point_tk = (-1, -1)
end_point_tk = (-1, -1)
current_box_cv = None
pending_annotations = []
paused = False
paused_lock = threading.Lock()
current_frame_cv = None
latest_frame_cv = None
tk_photo = None
selected_class_id = -1
app_running = True
app = None
hook_thread = None
hotkey_queue = queue.Queue()
global_pause_key_pressed = False
global_save_resume_key_pressed = False
frame_counter = 0
last_beta_save_time = 0

auto_detect_available = False
keyboard_available = False
auto_detect_mode_enabled = False
beta_mode_enabled = False
none_mode_enabled = False
model_file_path = None
detection_model = None
auto_detections = None
auto_detect_interval = 1


last_saved_beta_annotations = []
BETA_IOU_THRESHOLD = 0.7 

try:
    import torch
    from ultralytics import YOLO
    auto_detect_available = True
except ImportError:
    print("[警告] PyTorch または Ultralytics が見つかりません。自動検知機能は無効になります。")
    print("インストールするには: pip install torch ultralytics")
    auto_detect_available = False

try:
    import keyboard
    keyboard_available = True
except ImportError:
    print("[警告] keyboard ライブラリが見つかりません。グローバルホットキーは無効になります。")
    print("インストールするには: pip install keyboard")
    keyboard_available = False
except Exception as e:
    print(f"[警告] keyboard ライブラリの初期化に失敗しました ({type(e).__name__})。グローバルホットキーは無効になります。")
    keyboard_available = False


def to_yolo_format(box_cv, class_id, img_width, img_height):
    if img_width <= 0 or img_height <= 0: return None
    x1, y1, x2, y2 = map(int, box_cv)
    x1 = max(0, x1); y1 = max(0, y1)
    x2 = min(img_width - 1, x2); y2 = min(img_height - 1, y2)
    if x2 <= x1 or y2 <= y1: return None

    dw = 1.0 / img_width; dh = 1.0 / img_height
    center_x = ((x1 + x2) / 2.0) * dw; center_y = ((y1 + y2) / 2.0) * dh
    width = abs(x2 - x1) * dw; height = abs(y2 - y1) * dh
    center_x = max(0.0, min(1.0, center_x)); center_y = max(0.0, min(1.0, center_y))
    width = max(0.0, min(1.0, width)); height = max(0.0, min(1.0, height))
    return f"{class_id} {center_x:.6f} {center_y:.6f} {width:.6f} {height:.6f}"



def calculate_iou(box1, box2):
    """2つのバウンディングボックス間の Intersection over Union (IoU) を計算する"""
    # box format: (x1, y1, x2, y2)
    x1_1, y1_1, x2_1, y2_1 = box1
    x1_2, y1_2, x2_2, y2_2 = box2

    # 交差領域の座標を計算
    xA = max(x1_1, x1_2)
    yA = max(y1_1, y1_2)
    xB = min(x2_1, x2_2)
    yB = min(y2_1, y2_2)

    # 交差領域の面積を計算
    interArea = max(0, xB - xA) * max(0, yB - yA)

    # 各ボックスの面積を計算
    box1Area = (x2_1 - x1_1) * (y2_1 - y1_1)
    box2Area = (x2_2 - x1_2) * (y2_2 - y1_2)

    # 結合領域の面積を計算
    unionArea = box1Area + box2Area - interArea

    # IoUを計算 (ゼロ除算を回避)
    iou = interArea / float(unionArea) if unionArea > 0 else 0.0

    return iou

def split_dataset(image_base_dir, label_base_dir, output_root_dir, train_img_subdir, val_img_subdir, train_lbl_subdir, val_lbl_subdir, val_split, random_seed=None):
    print("-" * 30 + "\n[情報] データセット分割を開始します...")
    print(f"[デバッグ] 読み込み元: 画像='{image_base_dir}', ラベル='{label_base_dir}'")
    print(f"[デバッグ] 書き込み先ルート: '{output_root_dir}'")
    if not os.path.isdir(image_base_dir): print(f"[エラー] 画像ベースディレクトリが見つかりません: {image_base_dir}"); return False
    if not os.path.isdir(label_base_dir): print(f"[エラー] ラベルベースディレクトリが見つかりません: {label_base_dir}"); return False
    try: all_image_files = [f for f in os.listdir(image_base_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
    except Exception as e: print(f"[エラー] {image_base_dir} のファイルリスト取得に失敗: {e}"); return False
    if not all_image_files: print("[情報] 分割する画像が見つかりません。"); return True
    print(f"[情報] {len(all_image_files)} 件の画像ファイル候補が見つかりました。")
    if random_seed is not None: random.seed(random_seed)
    random.shuffle(all_image_files)
    num_val = int(len(all_image_files) * val_split); num_train = len(all_image_files) - num_val
    train_files, val_files = all_image_files[num_val:], all_image_files[:num_val]
    print(f"[情報] {num_train} 件の訓練データと {num_val} 件の検証データに分割を試みます。")
    train_img_path = os.path.join(output_root_dir, "images", train_img_subdir); val_img_path = os.path.join(output_root_dir, "images", val_img_subdir)
    train_lbl_path = os.path.join(output_root_dir, "labels", train_lbl_subdir); val_lbl_path = os.path.join(output_root_dir, "labels", val_lbl_subdir)
    print(f"[デバッグ] 出力先ディレクトリ: TrainImg='{train_img_path}', ValImg='{val_img_path}', TrainLbl='{train_lbl_path}', ValLbl='{val_lbl_path}'")
    try: os.makedirs(train_img_path, exist_ok=True); os.makedirs(val_img_path, exist_ok=True); os.makedirs(train_lbl_path, exist_ok=True); os.makedirs(val_lbl_path, exist_ok=True)
    except Exception as e: print(f"[エラー] 出力先ディレクトリの作成に失敗: {e}"); return False

    def move_files_inner(file_list, src_img_dir, src_lbl_dir, target_img_dir, target_lbl_dir):
        m, sk, co, ml = 0, 0, 0, 0
        print(f"[デバッグ] {len(file_list)} 件のファイルを処理中: {target_img_dir}")
        for filename in file_list:
            base_name, img_ext = os.path.splitext(filename); label_filename = f"{base_name}.txt"
            src_img = os.path.join(src_img_dir, filename); src_lbl = os.path.join(src_lbl_dir, label_filename)
            dst_img = os.path.join(target_img_dir, filename); dst_lbl = os.path.join(target_lbl_dir, label_filename)
            if not os.path.isfile(src_img): print(f"[警告] スキップ: 元画像が見つかりません: {src_img}"); sk+=1; continue
            if not os.path.isfile(src_lbl): print(f"[警告] スキップ: 元ラベルが見つかりません: {src_lbl}"); ml+=1; sk+=1; continue
            try:
                with Image.open(src_img) as img:
                    img.verify()
                with Image.open(src_img) as img:
                    img.load()
            except (IOError, SyntaxError, Image.UnidentifiedImageError, TypeError, AttributeError) as e:
                print(f"[警告] スキップ: 画像破損の可能性 '{filename}' ({type(e).__name__}: {e})")
                co += 1; sk += 1
                continue
            except Exception as e:
                print(f"[警告] スキップ: 画像破損チェック中に予期せぬエラー '{filename}' ({type(e).__name__}: {e})")
                co += 1; sk += 1
                continue

            try: shutil.move(src_img, dst_img); shutil.move(src_lbl, dst_lbl); m+=1
            except Exception as e: print(f"[エラー] '{filename}' の移動に失敗: {e}"); sk+=1
        return m, sk, co, ml

    print(f"[情報] 訓練データを移動中..."); train_stats = move_files_inner(train_files, image_base_dir, label_base_dir, train_img_path, train_lbl_path)
    print(f"[情報] 検証データを移動中..."); val_stats = move_files_inner(val_files, image_base_dir, label_base_dir, val_img_path, val_lbl_path)
    print("-" * 30 + "\n[情報] データセット分割結果:")
    print(f"  訓練: 移動 {train_stats[0]}, スキップ {train_stats[1]} (破損疑い: {train_stats[2]}, ラベル欠損: {train_stats[3]})")
    print(f"  検証: 移動 {val_stats[0]}, スキップ {val_stats[1]} (破損疑い: {val_stats[2]}, ラベル欠損: {val_stats[3]})")
    total_moved = train_stats[0]+val_stats[0]; total_skipped = train_stats[1]+val_stats[1]
    print(f"  合計: 移動 {total_moved}, スキップ {total_skipped}")
    if total_skipped > 0: print(f"[警告] {total_skipped} 個のペアがスキップされました。ベースディレクトリにファイルが残っている可能性があります。ログを確認してください。");
    else: print("[情報] 全てのファイルが正常に移動されました。")
    print("[情報] データセット分割完了。\n" + "-" * 30); return True

def generate_data_yaml(output_dir, train_img_subdir, val_img_subdir, class_names):
    data_yaml_path = os.path.join(output_dir, "data.yaml")
    dataset_root_abs_path = os.path.abspath(output_dir)
    dataset_root_abs_path_unix = dataset_root_abs_path.replace('\\', '/')

    yaml_content = {
        'path': dataset_root_abs_path_unix,
        'train': f'images/{train_img_subdir}',
        'val': f'images/{val_img_subdir}',
        'nc': len(class_names),
        'names': {i: name for i, name in enumerate(class_names)}
    }
    try:
        with open(data_yaml_path, 'w', encoding='utf-8') as f:
            yaml.dump(yaml_content, f, default_flow_style=False, sort_keys=False, allow_unicode=True)
        print(f"[情報] data.yaml を正常に生成しました: {data_yaml_path}")
    except Exception as e:
        print(f"[エラー] data.yaml の生成に失敗しました: {e}")

def global_key_event_handler(event):
    global hotkey_queue, global_pause_key_pressed, global_save_resume_key_pressed, app_running
    if not app_running: return

    try:
        key_name = event.name.lower()
        event_type = event.event_type
    except AttributeError:
        return

    if key_name == GLOBAL_PAUSE_HOTKEY:
        if event_type == keyboard.KEY_DOWN and not global_pause_key_pressed:
            global_pause_key_pressed = True
            hotkey_queue.put("TOGGLE_PAUSE")
        elif event_type == keyboard.KEY_UP:
            global_pause_key_pressed = False

    elif key_name == GLOBAL_SAVE_RESUME_HOTKEY:
         if event_type == keyboard.KEY_DOWN and not global_save_resume_key_pressed:
             global_save_resume_key_pressed = True
             hotkey_queue.put("SAVE_AND_RESUME")
         elif event_type == keyboard.KEY_UP:
             global_save_resume_key_pressed = False

def start_keyboard_hook():
    global hook_thread, keyboard_available
    if keyboard_available:
        try:
            hook_thread = threading.Thread(target=keyboard.hook, args=(global_key_event_handler,), daemon=True)
            hook_thread.start()
            print(f"[情報] グローバルキーボードフックを正常に開始しました: '{GLOBAL_PAUSE_HOTKEY.upper()}' (一時停止/再開), '{GLOBAL_SAVE_RESUME_HOTKEY.upper()}' (手動保存/再開).")
            return True
        except Exception as e:
            print(f"[エラー] キーボードフックの開始に失敗しました: {e}")
            print("[情報] グローバルホットキーは利用できません。ウィンドウがアクティブな時のみ操作可能です。")
            keyboard_available = False
            return False
    return False

class AnnotationAppIntegratedUI:
    def __init__(self, root, args):
        global app, auto_detect_mode_enabled, beta_mode_enabled, none_mode_enabled
        global model_file_path, detection_model, CLASS_NAMES, auto_detect_interval, auto_detect_available
        app = self
        self.root = root
        self.initialized_successfully = False

        auto_detect_mode_enabled = args.auto
        beta_mode_enabled = args.beta
        none_mode_enabled = args.none
        model_file_path = args.pt
        auto_detect_interval = args.detect_interval

        if beta_mode_enabled and not auto_detect_mode_enabled:
            messagebox.showerror("引数エラー", "--beta は --auto と共に使用する必要があります。")
            self.root.destroy(); return
        if none_mode_enabled and not auto_detect_mode_enabled:
            messagebox.showerror("引数エラー", "--none は --auto と共に使用する必要があります。")
            self.root.destroy(); return
        if auto_detect_mode_enabled and not model_file_path:
             messagebox.showerror("引数エラー", "--auto を使用するには --pt <モデルパス> が必要です。")
             self.root.destroy(); return
        if auto_detect_mode_enabled and not auto_detect_available:
             messagebox.showerror("依存関係エラー", "自動検知が指定されましたが、PyTorch/Ultralytics が利用できません。")
             auto_detect_mode_enabled = False
             beta_mode_enabled = False
             none_mode_enabled = False


        self.root.title("YOLO アノテーションツール")
        self.root.geometry("1100x750")

        self.default_font = font.nametofont("TkDefaultFont"); self.default_font.configure(size=10)
        self.bold_font = font.Font(family=self.default_font['family'], size=10, weight='bold')
        self.status_font = font.Font(family=self.default_font['family'], size=9)

        main_frame = tk.Frame(root); main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        self.video_label = tk.Label(main_frame, bg="black")
        self.video_label.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.video_label.bind("<Button-1>", self.on_mouse_press)
        self.video_label.bind("<B1-Motion>", self.on_mouse_drag)
        self.video_label.bind("<ButtonRelease-1>", self.on_mouse_release)

        control_panel = tk.Frame(main_frame, width=280, bd=1, relief=tk.SUNKEN)
        control_panel.pack(side=tk.RIGHT, fill=tk.Y, padx=(10, 0))
        control_panel.pack_propagate(False)

        button_frame = tk.Frame(control_panel, pady=5); button_frame.pack(fill=tk.X)

        self.pause_resume_button = tk.Button(button_frame, text="一時停止", command=self.toggle_pause_gui, width=18)
        self.pause_resume_button.pack(pady=(5, 2))

        self.auto_save_mode = BooleanVar(value=False);
        self.auto_save_check = Checkbutton(button_frame, text="手動オートセーブ", variable=self.auto_save_mode, command=self.on_auto_save_toggle, width=15)
        self.auto_save_check.pack(pady=2)

        self.save_button = tk.Button(button_frame, text="手動保存", command=self.save_annotation_manual, state=tk.DISABLED, width=18)
        self.save_button.pack(pady=2)

        if auto_detect_mode_enabled:
            if not beta_mode_enabled:
                self.approve_detection_button = tk.Button(button_frame, text="自動検知を承認して保存", command=self.approve_and_save_auto_detection, state=tk.DISABLED, width=18)
                self.approve_detection_button.pack(pady=2)
            else:
                self.approve_detection_button = None

            self.clear_detection_button = tk.Button(button_frame, text="自動検知結果をクリア", command=self.clear_auto_detection, state=tk.DISABLED, width=18)
            self.clear_detection_button.pack(pady=2)
        else:
             self.approve_detection_button = None
             self.clear_detection_button = None

        self.clear_button = tk.Button(button_frame, text="現在の赤枠をクリア", command=self.clear_current_box, state=tk.DISABLED, width=18)
        self.clear_button.pack(pady=2)
        self.clear_all_pending_button = tk.Button(button_frame, text="ペンディング全クリア", command=self.clear_all_pending, state=tk.DISABLED, width=18)
        self.clear_all_pending_button.pack(pady=2)

        self.quit_button = tk.Button(button_frame, text="終了してデータ処理", command=self.quit_app_button, width=18)
        self.quit_button.pack(pady=(15, 5))

        class_frame = tk.LabelFrame(control_panel, text="クラス選択", padx=5, pady=5, font=self.bold_font)
        class_frame.pack(fill=tk.BOTH, expand=True, pady=5)
        listbox_frame = tk.Frame(class_frame); listbox_frame.pack(fill=tk.BOTH, expand=True)

        self.class_listbox = Listbox(listbox_frame, selectmode=SINGLE, exportselection=False, height=10)
        self.class_listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar = Scrollbar(listbox_frame, orient=tk.VERTICAL, command=self.class_listbox.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y); self.class_listbox.config(yscrollcommand=scrollbar.set)

        if auto_detect_mode_enabled and auto_detect_available:
            try:
                print(f"[情報] 自動検知モデルを読み込み中: {model_file_path}")
                detection_model = YOLO(model_file_path)
                if hasattr(detection_model, 'names') and isinstance(detection_model.names, dict):
                    loaded_class_names = list(detection_model.names.values())
                    if loaded_class_names:
                        CLASS_NAMES = loaded_class_names
                        print(f"[情報] モデルからクラス名を取得しました ({len(CLASS_NAMES)}件): {CLASS_NAMES}")
                    else:
                        print("[警告] モデルからクラス名を取得しましたが、リストが空です。コード内のリストを使用します。")
                else:
                    print("[警告] モデルからクラス名を取得できませんでした。コード内のクラス名リストを使用します。")
            except Exception as e:
                messagebox.showerror("モデル読込エラー", f"モデルファイルの読み込みに失敗しました: {e}\n自動検知は無効になります。")
                print(f"[エラー] モデルファイルの読み込みに失敗: {e}")
                auto_detect_mode_enabled = False
                beta_mode_enabled = False
                none_mode_enabled = False
                detection_model = None
                if self.approve_detection_button: self.approve_detection_button.pack_forget()
                if self.clear_detection_button: self.clear_detection_button.pack_forget()
                self.approve_detection_button = None
                self.clear_detection_button = None

        elif auto_detect_mode_enabled and not auto_detect_available:
             messagebox.showwarning("依存関係不足", "PyTorch/Ultralytics がインストールされていないため、自動検知は無効です。")
             auto_detect_mode_enabled = False
             beta_mode_enabled = False
             none_mode_enabled = False
             if self.approve_detection_button: self.approve_detection_button.pack_forget()
             if self.clear_detection_button: self.clear_detection_button.pack_forget()
             self.approve_detection_button = None
             self.clear_detection_button = None

        self.class_listbox.delete(0, END)
        for i, name in enumerate(CLASS_NAMES):
            self.class_listbox.insert(END, f"{i}: {name}")
        self.class_listbox.bind('<<ListboxSelect>>', self.on_class_select)

        status_frame = tk.Frame(control_panel, pady=5)
        status_frame.pack(fill=tk.X, side=tk.BOTTOM)
        self.status_label = tk.Label(status_frame, text="状態: 初期化中...", anchor="nw", justify=tk.LEFT, font=self.status_font, wraplength=260)
        self.status_label.pack(fill=tk.X, pady=(0,2))
        self.selected_class_label = tk.Label(status_frame, text="選択クラス: なし", anchor="nw", justify=tk.LEFT, font=self.status_font)
        self.selected_class_label.pack(fill=tk.X, pady=2)

        mode_texts = []
        if auto_detect_mode_enabled: mode_texts.append("自動検知")
        if beta_mode_enabled: mode_texts.append("Beta")
        if none_mode_enabled: mode_texts.append("個別保存")
        mode_str = f"モード: {' / '.join(mode_texts)}" if mode_texts else "モード: 手動"
        self.mode_label = tk.Label(status_frame, text=mode_str, anchor="nw", justify=tk.LEFT, font=self.status_font, fg="blue")
        self.mode_label.pack(fill=tk.X, pady=2)

        self.hotkey_label = tk.Label(status_frame, text="", anchor="nw", justify=tk.LEFT, font=self.status_font, fg="gray")
        self.hotkey_label.pack(fill=tk.X, pady=2)

        self.cap = None; self.frame_width = 0; self.frame_height = 0
        if not self.init_opencv():
            print("[エラー] カメラの初期化に失敗したため、アプリケーションを終了します。")
            try:
                if self.root and self.root.winfo_exists(): self.root.destroy()
            except tk.TclError: pass
            return

        self.initialized_successfully = True
        print("[デバッグ] OpenCV 初期化成功。追加の初期化を続行します。")

        hook_started = start_keyboard_hook()
        hotkey_status_text = f"ホットキー: '{GLOBAL_PAUSE_HOTKEY.upper()}'=一時停止/再開" if hook_started else "(グローバルホットキー無効/失敗)"
        if hook_started: hotkey_status_text += f", '{GLOBAL_SAVE_RESUME_HOTKEY.upper()}'=手動保存/再開"
        if hasattr(self, 'hotkey_label') and self.hotkey_label.winfo_exists():
             self.hotkey_label.config(text=hotkey_status_text, fg="darkgreen" if hook_started else "red")
        else: print("[警告] hotkey_label ウィジェットが設定できませんでした。")

        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)

        self.update_tk_frame()

    def init_opencv(self):
        try:
            os.makedirs(IMAGE_DIR_BASE, exist_ok=True)
            os.makedirs(LABEL_DIR_BASE, exist_ok=True)
            print(f"[情報] ベースディレクトリを確認/作成しました: 画像='{IMAGE_DIR_BASE}', ラベル='{LABEL_DIR_BASE}'")
        except Exception as e:
            error_message = f"ベースディレクトリの作成に失敗しました: {e}"
            print(f"[エラー] {error_message}")
            if self.root and self.root.winfo_exists():
                 self.root.after(10, lambda: messagebox.showerror("初期化エラー", error_message))
            return False
        try:
            print(f"[情報] カメラID {CAMERA_ID} を開いています...")
            self.cap = cv2.VideoCapture(CAMERA_ID, cv2.CAP_DSHOW)
            if not self.cap.isOpened():
                print(f"[警告] カメラID {CAMERA_ID} を DSHOW バックエンドで開けませんでした。MSMF を試します...")
                self.cap.release()
                self.cap = cv2.VideoCapture(CAMERA_ID, cv2.CAP_MSMF)
                if not self.cap.isOpened():
                    print(f"[警告] カメラID {CAMERA_ID} を MSMF バックエンドでも開けませんでした。デフォルトを試します...")
                    self.cap.release()
                    self.cap = cv2.VideoCapture(CAMERA_ID)
                    if not self.cap.isOpened():
                        raise ValueError(f"カメラID {CAMERA_ID} をどのバックエンドでも開けません。接続/ドライバ/権限を確認してください。")

            if not self.cap.isOpened():
                 raise ValueError(f"カメラ {CAMERA_ID} のオープンに最終的に失敗しました。")

            ret, frame = self.cap.read()
            if not ret or frame is None:
                self.cap.release()
                raise ValueError("カメラから初期フレームを読み取れませんでした。カメラが映像を送信しているか確認してください。")

            self.frame_height, self.frame_width = frame.shape[:2]
            if self.frame_width <= 0 or self.frame_height <= 0:
                self.cap.release()
                raise ValueError(f"カメラから無効なフレームサイズが取得されました: {self.frame_width}x{self.frame_height}")

            print(f"[情報] カメラ {CAMERA_ID} を正常に開きました。解像度: {self.frame_width}x{self.frame_height}")
            update_status(f"初期化完了。'{self.pause_resume_button['text']}' または '{GLOBAL_PAUSE_HOTKEY.upper()}' で開始。")
            self.update_button_states()
            return True

        except Exception as e:
            error_message = f"カメラの初期化中にエラーが発生しました: {e}"
            print(f"[エラー] {error_message}")
            if self.root and self.root.winfo_exists():
                 self.root.after(10, lambda: messagebox.showerror("カメラエラー", error_message))
            if self.cap is not None: self.cap.release()
            return False

    def process_hotkey_queue(self):
        global hotkey_queue, paused, paused_lock, current_box_cv, selected_class_id
        try:
            while not hotkey_queue.empty():
                event = hotkey_queue.get_nowait()
                if event == "TOGGLE_PAUSE":
                    self.toggle_pause_gui()
                elif event == "SAVE_AND_RESUME":
                    with paused_lock: current_paused_state = paused
                    is_manual_auto_save = self.auto_save_mode.get()

                    if not is_manual_auto_save and current_paused_state:
                        if current_box_cv and selected_class_id != -1:
                            print(f"[情報] ホットキー '{GLOBAL_SAVE_RESUME_HOTKEY.upper()}': 現在のアノテーションを保存して再開 (手動モード)...")
                            if self.save_annotation_manual():
                                if paused: self.toggle_pause_gui()
                        elif current_box_cv is None:
                            update_status(f"ホットキー '{GLOBAL_SAVE_RESUME_HOTKEY.upper()}' 無視: ボックス未描画")
                        elif selected_class_id == -1:
                            update_status(f"ホットキー '{GLOBAL_SAVE_RESUME_HOTKEY.upper()}' 無視: クラス未選択")
                    elif is_manual_auto_save:
                         update_status(f"ホットキー '{GLOBAL_SAVE_RESUME_HOTKEY.upper()}' 無視: 手動オートセーブモードです。")
                    elif not current_paused_state:
                         update_status(f"ホットキー '{GLOBAL_SAVE_RESUME_HOTKEY.upper()}' 無視: 一時停止中ではありません。")

                hotkey_queue.task_done()
        except queue.Empty:
            pass
        except Exception as e:
            print(f"[エラー] ホットキーキューの処理中にエラー: {e}")

    def run_auto_detection(self, frame):
        global detection_model, auto_detections, CLASS_NAMES, AUTO_DETECT_CONF_THRESHOLD, beta_mode_enabled, none_mode_enabled, last_beta_save_time

        if detection_model is None or frame is None or not auto_detect_mode_enabled:
            auto_detections = None
            return

        new_detections = []
        try:
            results = detection_model(frame, conf=AUTO_DETECT_CONF_THRESHOLD, verbose=False)

            if results and results[0].boxes is not None:
                 boxes = results[0].boxes.xyxy.cpu().numpy()
                 confs = results[0].boxes.conf.cpu().numpy()
                 cls_ids = results[0].boxes.cls.cpu().numpy()

                 for box, conf, cls_id_float in zip(boxes, confs, cls_ids):
                     cls_id = int(cls_id_float)
                     new_detections.append({'box': tuple(box), 'class_id': cls_id, 'confidence': conf})

            auto_detections = new_detections if new_detections else None

            if beta_mode_enabled and auto_detections:
                current_time = time.time()
                if current_time - last_beta_save_time >= BETA_MODE_SAVE_INTERVAL_SECONDS:
                    self.save_auto_detection_beta(frame.copy(), auto_detections)
                    last_beta_save_time = current_time

        except Exception as e:
            print(f"[エラー] 自動検知の実行中にエラー: {e}")
            auto_detections = None

        finally:
             if self.root and self.root.winfo_exists():
                self.update_button_states()

    def save_auto_detection_beta(self, frame_to_save, detections_to_save):
        """Betaモードで自動検知結果を保存する（重複回避機能付き）"""
        global none_mode_enabled, last_saved_beta_annotations, BETA_IOU_THRESHOLD

        if not detections_to_save or frame_to_save is None:
            return

        source_tag = "Beta自動"

        # --- 重複チェック ---
        annotations_to_actually_save = []
        current_detections_for_next_frame = [] # 次のフレーム用に今回保存対象となったものを保持

        for new_detection in detections_to_save:
            is_duplicate = False
            new_box = new_detection.get('box')
            new_class_id = new_detection.get('class_id')

            if new_box is None or new_class_id is None:
                continue # 不正なデータはスキップ

            for last_detection in last_saved_beta_annotations:
                last_box = last_detection.get('box')
                last_class_id = last_detection.get('class_id')

                if last_box is None or last_class_id is None:
                    continue

                # 同じクラスIDのボックスとのみ比較
                if new_class_id == last_class_id:
                    iou = calculate_iou(new_box, last_box)
                    if iou > BETA_IOU_THRESHOLD:
                        # print(f"[デバッグ Beta重複回避] IoU: {iou:.2f} > {BETA_IOU_THRESHOLD}. スキップ: {new_detection}")
                        is_duplicate = True
                        # 重複していても、次のフレームの比較対象としては残す場合があるかもしれないが、
                        # シンプルにするため、重複したら完全に無視する。
                        # 必要なら、重複したボックスも current_detections_for_next_frame に追加するロジックを考える
                        break # 一つでも重複が見つかれば比較終了

            if not is_duplicate:
                annotations_to_actually_save.append(new_detection)
                # 次のフレームでの重複チェックのために、今回保存「する」アノテーション情報を保持
                current_detections_for_next_frame.append({'box': new_box, 'class_id': new_class_id}) # confidenceは不要

        # --- 保存処理 ---
        if not annotations_to_actually_save:
            # 重複チェックの結果、保存するものがなければ終了
            # print("[デバッグ Beta重複回避] 保存対象なし")
            # この場合でも、次のフレーム用に最後に検知したものを保持すべきか？→一旦、保存したものだけを次回の比較対象とする
            # last_saved_beta_annotations = [] # or keep previous ones? -> keep previous is better
            return

        num_actually_saved = 0
        save_successful_flag = False # いずれか一つでも保存成功したか

        if none_mode_enabled:
            # --- 個別保存モード ---
            print(f"[デバッグ Beta重複回避] 個別保存試行 ({len(annotations_to_actually_save)} 件)")
            for detection in annotations_to_actually_save:
                box = detection.get('box')
                class_id = detection.get('class_id')
                if box is not None and class_id is not None:
                    if self._save_annotation_single(frame_to_save, box, class_id, source_tag=f"{source_tag}(個別)"):
                        num_actually_saved += 1
                        save_successful_flag = True # 1件でも成功すればTrue
            if num_actually_saved > 0:
                 update_status(f"{source_tag}: {num_actually_saved} 件を個別保存 (重複回避後)。")

        else:
            # --- 一括保存モード ---
            print(f"[デバッグ Beta重複回避] 一括保存試行 ({len(annotations_to_actually_save)} 件)")
            save_successful = self._save_annotations_generic(frame_to_save, annotations_to_actually_save, source_tag=source_tag)
            if save_successful:
                 update_status(f"{source_tag}: {len(annotations_to_actually_save)} 件を一括保存 (重複回避後)。")
                 num_actually_saved = len(annotations_to_actually_save)
                 save_successful_flag = True

        # --- 最後に保存したアノテーション情報を更新 ---
        # 保存が成功した場合のみ、今回「実際に保存した」アノテーションで更新する
        if save_successful_flag:
            last_saved_beta_annotations = current_detections_for_next_frame
            # print(f"[デバッグ Beta重複回避] last_saved_beta_annotations 更新 ({len(last_saved_beta_annotations)} 件)")
        # else: 保存失敗時は last_saved_beta_annotations を更新しない（再試行できるようにするため）

    def update_tk_frame(self):
        global latest_frame_cv, paused, app_running, paused_lock, tk_photo, current_frame_cv
        global pending_annotations, drawing, start_point_tk, end_point_tk, current_box_cv
        global frame_counter, auto_detect_mode_enabled, auto_detect_interval, auto_detections

        if not app_running: return

        self.process_hotkey_queue()

        ret = False; frame_to_render = None
        with paused_lock: is_paused = paused

        if self.cap is not None and self.cap.isOpened():
            if not is_paused:
                ret, frame_cv = self.cap.read()
                if ret and frame_cv is not None:
                    latest_frame_cv = frame_cv
                    frame_counter += 1

                    if auto_detect_mode_enabled and frame_counter % auto_detect_interval == 0:
                         self.run_auto_detection(latest_frame_cv)

                else:
                    pass

            frame_source = current_frame_cv if is_paused else latest_frame_cv
            if frame_source is not None:
                frame_to_render = frame_source.copy()
                ret = True
            else:
                 if not is_paused: update_status("カメラフレーム待機中...")
                 else: update_status("一時停止中 (フレームなし)")
                 ret = False
        else:
            update_status("カメラが利用できません。")
            ret = False

        if ret and frame_to_render is not None:
            try:
                frame_rgb = cv2.cvtColor(frame_to_render, cv2.COLOR_BGR2RGB)
                pil_image = Image.fromarray(frame_rgb)
                draw = ImageDraw.Draw(pil_image)

                label_w = self.video_label.winfo_width(); label_h = self.video_label.winfo_height()
                display_w, display_h = self.frame_width, self.frame_height

                if label_w > 1 and label_h > 1 and self.frame_width > 0 and self.frame_height > 0:
                    img_aspect = self.frame_width / self.frame_height
                    label_aspect = label_w / label_h

                    if img_aspect > label_aspect:
                        display_w = label_w
                        display_h = int(label_w / img_aspect)
                    else:
                        display_h = label_h
                        display_w = int(label_h * img_aspect)

                    if display_w > 0 and display_h > 0 and (display_w != self.frame_width or display_h != self.frame_height):
                         try:
                             pil_image_resized = pil_image.resize((display_w, display_h), Image.Resampling.LANCZOS)
                         except AttributeError:
                             pil_image_resized = pil_image.resize((display_w, display_h), Image.LANCZOS)
                         draw = ImageDraw.Draw(pil_image_resized); pil_image = pil_image_resized

                offset_x = (label_w - display_w) // 2; offset_y = (label_h - display_h) // 2

                scale_x = display_w / self.frame_width if self.frame_width > 0 else 1
                scale_y = display_h / self.frame_height if self.frame_height > 0 else 1

                if auto_detect_mode_enabled and auto_detections:
                    for detection in auto_detections:
                        x1_cv, y1_cv, x2_cv, y2_cv = detection['box']
                        class_id = detection['class_id']
                        conf = detection['confidence']
                        if display_w > 0 and display_h > 0:
                            draw_x1 = int(x1_cv * scale_x); draw_y1 = int(y1_cv * scale_y)
                            draw_x2 = int(x2_cv * scale_x); draw_y2 = int(y2_cv * scale_y)
                            draw.rectangle([draw_x1, draw_y1, draw_x2, draw_y2], outline="yellow", width=2)
                            label_text = f"{CLASS_NAMES[class_id]}: {conf:.2f}" if 0 <= class_id < len(CLASS_NAMES) else f"ID {class_id}: {conf:.2f}"
                            text_y = draw_y1 - 12 if draw_y1 > 12 else draw_y1 + 2
                            draw.text((draw_x1 + 2, text_y), label_text, fill="yellow")

                if is_paused and self.auto_save_mode.get() and pending_annotations:
                    for anno in pending_annotations:
                        x1_cv, y1_cv, x2_cv, y2_cv = anno['box']
                        if display_w > 0 and display_h > 0:
                            draw_x1 = int(x1_cv * scale_x); draw_y1 = int(y1_cv * scale_y)
                            draw_x2 = int(x2_cv * scale_x); draw_y2 = int(y2_cv * scale_y)
                            draw.rectangle([draw_x1, draw_y1, draw_x2, draw_y2], outline="cyan", width=2)
                            label_text = anno.get('class_name', f"ID:{anno['class_id']}")
                            draw.text((draw_x1 + 2, draw_y1 + 2), label_text, fill="cyan")

                if is_paused and current_box_cv is not None:
                     x1_cv, y1_cv, x2_cv, y2_cv = current_box_cv
                     if display_w > 0 and display_h > 0:
                         draw_x1 = int(x1_cv * scale_x); draw_y1 = int(y1_cv * scale_y)
                         draw_x2 = int(x2_cv * scale_x); draw_y2 = int(y2_cv * scale_y)
                         draw.rectangle([draw_x1, draw_y1, draw_x2, draw_y2], outline="red", width=2)

                if is_paused and drawing and start_point_tk != (-1, -1):
                     draw_x1_tk = min(start_point_tk[0], end_point_tk[0])
                     draw_y1_tk = min(start_point_tk[1], end_point_tk[1])
                     draw_x2_tk = max(start_point_tk[0], end_point_tk[0])
                     draw_y2_tk = max(start_point_tk[1], end_point_tk[1])
                     img_x1 = max(0, draw_x1_tk - offset_x)
                     img_y1 = max(0, draw_y1_tk - offset_y)
                     img_x2 = min(display_w - 1, draw_x2_tk - offset_x)
                     img_y2 = min(display_h - 1, draw_y2_tk - offset_y)
                     if img_x2 > img_x1 and img_y2 > img_y1:
                         draw.rectangle([img_x1, img_y1, img_x2, img_y2], outline="lime", width=2)

                tk_photo = ImageTk.PhotoImage(image=pil_image)
                self.video_label.config(image=tk_photo)
                self.video_label.image = tk_photo
            except Exception as e:
                print(f"[エラー] フレーム描画中にエラー: {e}")
                self.video_label.config(text=f"描画エラー:\n{e}", image='', compound=tk.CENTER, fg="red", bg="black")
                self.video_label.image = None

        elif not ret and app_running:
             try:
                  current_text = self.video_label.cget("text")
                  if "カメラが利用できません" not in current_text and "描画エラー" not in current_text:
                      self.video_label.config(image='', text="カメラが利用できません。", compound=tk.CENTER, fg="white", bg="black")
                      self.video_label.image = None
             except tk.TclError: pass

        if app_running:
            delay = 30 if is_paused else 15
            self.root.after(delay, self.update_tk_frame)

    def on_mouse_press(self, event):
        global drawing, start_point_tk, end_point_tk, current_box_cv, paused, paused_lock, auto_detections
        with paused_lock: is_paused = paused
        if not is_paused:
            update_status("描画するにはまず一時停止してください。")
            return
        if beta_mode_enabled:
             update_status("Betaモード中は手動アノテーションはできません。")
             return

        if auto_detect_mode_enabled and auto_detections:
            print("[情報] 手動描画を開始したため、自動検知結果をクリアします。")
            auto_detections = None
            self.update_button_states()

        drawing = True
        start_point_tk = (event.x, event.y)
        end_point_tk = (event.x, event.y)
        if current_box_cv:
            current_box_cv = None
            print("[デバッグ] 新しいマウスプレスで前の current_box_cv をクリアしました。")

        update_status("新しいボックスを描画中...")
        self.update_button_states()

    def on_mouse_drag(self, event):
        global drawing, end_point_tk
        if not drawing: return
        end_point_tk = (event.x, event.y)

    def on_mouse_release(self, event):
        global drawing, start_point_tk, end_point_tk, current_box_cv, selected_class_id
        if not drawing: return

        drawing = False
        end_point_tk = (event.x, event.y)

        x1_tk = min(start_point_tk[0], end_point_tk[0])
        y1_tk = min(start_point_tk[1], end_point_tk[1])
        x2_tk = max(start_point_tk[0], end_point_tk[0])
        y2_tk = max(start_point_tk[1], end_point_tk[1])

        label_w = self.video_label.winfo_width()
        label_h = self.video_label.winfo_height()

        if label_w <= 1 or label_h <= 1 or self.frame_width <= 0 or self.frame_height <= 0:
            current_box_cv = None
            update_status("エラー: ボックス座標を計算できません（無効なウィンドウ/フレームサイズ）。")
            start_point_tk, end_point_tk = (-1, -1), (-1, -1)
            self.update_button_states()
            return

        img_aspect = self.frame_width / self.frame_height
        label_aspect = label_w / label_h
        if img_aspect > label_aspect:
            display_w = label_w; display_h = int(label_w / img_aspect)
        else:
            display_h = label_h; display_w = int(label_h * img_aspect)

        if display_w <= 0 or display_h <= 0:
             current_box_cv = None
             update_status("エラー: ボックス座標を計算できません（無効な表示サイズ）。")
             start_point_tk, end_point_tk = (-1, -1), (-1, -1)
             self.update_button_states()
             return

        offset_x = (label_w - display_w) // 2
        offset_y = (label_h - display_h) // 2

        x1_img = max(0, x1_tk - offset_x)
        y1_img = max(0, y1_tk - offset_y)
        x2_img = min(display_w - 1, x2_tk - offset_x)
        y2_img = min(display_h - 1, y2_tk - offset_y)

        if x2_img <= x1_img or y2_img <= y1_img:
            current_box_cv = None
            update_status("ボックスサイズが小さすぎるか、画像領域外です。")
            start_point_tk, end_point_tk = (-1, -1), (-1, -1)
            self.update_button_states()
            return

        scale_x = self.frame_width / display_w if display_w > 0 else 1
        scale_y = self.frame_height / display_h if display_h > 0 else 1
        x1_cv = int(x1_img * scale_x); y1_cv = int(y1_img * scale_y)
        x2_cv = int(x2_img * scale_x); y2_cv = int(y2_img * scale_y)

        x1_cv = max(0, x1_cv); y1_cv = max(0, y1_cv)
        x2_cv = min(self.frame_width - 1, x2_cv); y2_cv = min(self.frame_height - 1, y2_cv)

        min_box_size = 5
        if (x2_cv - x1_cv) >= min_box_size and (y2_cv - y1_cv) >= min_box_size:
            current_box_cv = (x1_cv, y1_cv, x2_cv, y2_cv)
            print(f"[デバッグ] ボックス描画完了 (CV座標): {current_box_cv}")
            update_status("ボックス描画完了。クラスを選択してください。")

            if self.auto_save_mode.get() and selected_class_id != -1:
                print("[デバッグ] 手動オートセーブ: クラス選択済みのためペンディングに追加します。")
                self.add_to_pending()
            else:
                pass
        else:
            current_box_cv = None
            update_status(f"ボックスが小さすぎます (最小 {min_box_size}x{min_box_size} ピクセル必要)。")

        start_point_tk = (-1, -1); end_point_tk = (-1, -1)
        self.update_button_states()

    def toggle_pause_logic(self):
        global paused, paused_lock, drawing, current_box_cv, start_point_tk, end_point_tk
        global current_frame_cv, latest_frame_cv, pending_annotations, selected_class_id, auto_detections

        with paused_lock:
            was_paused = paused
            paused = not paused
            new_paused_state = paused
            print(f"[情報] 一時停止状態を切り替え。新しい状態: {'一時停止中' if new_paused_state else '再開'}")

            drawing = False
            start_point_tk = (-1, -1); end_point_tk = (-1, -1)

            if new_paused_state:
                if latest_frame_cv is not None:
                    current_frame_cv = latest_frame_cv.copy()
                    print("[デバッグ] アノテーション用にフレームをキャプチャしました。")
                else:
                    current_frame_cv = None
                    print("[警告] 一時停止しましたが、有効なフレームがまだキャプチャされていません。")
                current_box_cv = None
                pending_annotations = []
                selected_class_id = -1
                if hasattr(self, 'class_listbox') and self.class_listbox.winfo_exists():
                    self.class_listbox.selection_clear(0, END)
                if hasattr(self, 'selected_class_label') and self.selected_class_label.winfo_exists():
                    self.selected_class_label.config(text="選択クラス: なし")

            else:
                current_frame_cv = None
                current_box_cv = None
                auto_detections = None

        return new_paused_state, was_paused

    def toggle_pause_gui(self):
        global app_running
        if not app_running: return

        new_state_is_paused, was_paused = self.toggle_pause_logic()

        if self.root.winfo_exists():
            button_text = "再開" if new_state_is_paused else "一時停止"
            self.pause_resume_button.config(text=button_text)

            if new_state_is_paused:
                status_text = f"一時停止中。{'ボックスを描画してください。' if not beta_mode_enabled else 'Betaモード有効。'}"
            else:
                status_text = "再開。実行中..."
            update_status(status_text)

            self.update_button_states()


    def save_annotation_manual(self):
        global current_box_cv, selected_class_id, current_frame_cv
        if self.auto_save_mode.get():
            messagebox.showwarning("モード情報", "手動オートセーブモードがオンです。保存は自動で行われます。")
            return False
        if beta_mode_enabled:
             messagebox.showwarning("モード情報", "Betaモードがオンです。保存は自動で行われます。")
             return False

        if current_box_cv is None:
            update_status("エラー: 保存するボックスが描画されていません。")
            return False
        if selected_class_id == -1:
            update_status("エラー: クラスが選択されていません。")
            return False
        if current_frame_cv is None:
            update_status("エラー: 保存対象のフレームがありません（一時停止中である必要があります）。")
            return False

        save_successful = self._save_annotation_single(current_frame_cv, current_box_cv, selected_class_id, source_tag="手動")

        if save_successful:
            current_box_cv = None
            selected_class_id = -1
            if self.root.winfo_exists():
                self.class_listbox.selection_clear(0, END)
            if hasattr(self, 'selected_class_label') and self.selected_class_label.winfo_exists():
                self.selected_class_label.config(text="選択クラス: なし")
            update_status("保存完了 (手動)。次のボックスを描画してください。")
            self.update_button_states()
            return True
        else:
            update_status("手動保存に失敗しました。")
            self.update_button_states()
            return False

    def _save_annotation_single(self, frame_to_save, box_to_save, class_id_to_save, source_tag=""):
        if frame_to_save is None or box_to_save is None or class_id_to_save == -1:
            print(f"[エラー] {source_tag} 単一保存失敗: 無効な入力データ。")
            return False

        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        img_filename = f"{timestamp}.jpg"; label_filename = f"{timestamp}.txt"
        img_path = os.path.join(IMAGE_DIR_BASE, img_filename)
        label_path = os.path.join(LABEL_DIR_BASE, label_filename)

        try:
            success = cv2.imwrite(img_path, frame_to_save)
            if not success: raise IOError(f"cv2.imwrite が失敗しました ({img_path})")

            h, w = frame_to_save.shape[:2]
            yolo_str = to_yolo_format(box_to_save, class_id_to_save, w, h)
            if yolo_str is None:
                raise ValueError(f"YOLO形式文字列の生成に失敗しました (Box: {box_to_save}, W: {w}, H: {h})")

            with open(label_path, 'w') as f:
                f.write(yolo_str + '\n')

            print(f"[情報] 保存完了 ({source_tag}): {img_path}, {label_path}")
            return True

        except Exception as e:
            error_msg = f"{source_tag} 単一アノテーションの保存に失敗しました: {e}"
            messagebox.showerror(f"{source_tag} 保存エラー", error_msg)
            print(f"[エラー] {error_msg}")
            if os.path.exists(img_path):
                try: os.remove(img_path)
                except OSError: pass
            if os.path.exists(label_path):
                try: os.remove(label_path)
                except OSError: pass
            return False

    def _save_annotations_generic(self, frame_to_save, annotations_list, source_tag=""):
        if not annotations_list:
            print(f"[警告] {source_tag} 保存試行: アノテーションリストが空です。")
            return False
        if frame_to_save is None:
            print(f"[エラー] {source_tag} 保存試行: 保存するフレームがありません。")
            return False

        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        img_filename = f"{timestamp}.jpg"; label_filename = f"{timestamp}.txt"
        img_path = os.path.join(IMAGE_DIR_BASE, img_filename)
        label_path = os.path.join(LABEL_DIR_BASE, label_filename)

        try:
            success = cv2.imwrite(img_path, frame_to_save)
            if not success: raise IOError(f"cv2.imwrite が失敗しました ({img_path})")

            h, w = frame_to_save.shape[:2]
            yolo_lines = []
            valid_annotations_count = 0
            for anno in annotations_list:
                box = anno.get('box')
                cls_id = anno.get('class_id')
                if box is not None and cls_id is not None:
                    yolo_str = to_yolo_format(box, cls_id, w, h)
                    if yolo_str:
                        yolo_lines.append(yolo_str)
                        valid_annotations_count += 1
                    else:
                        print(f"[警告] {source_tag}: ボックス {box} のYOLO形式変換に失敗。スキップします。")
                else:
                    print(f"[警告] {source_tag}: アノテーションデータ形式が無効です: {anno}")

            if not yolo_lines:
                 print(f"[エラー] {source_tag}: 有効なYOLO文字列が生成されませんでした。画像ファイルを削除します: {img_filename}")
                 try: os.remove(img_path)
                 except OSError: pass
                 return False

            with open(label_path, 'w') as f:
                f.write('\n'.join(yolo_lines) + '\n')

            print(f"[情報] 保存完了 ({source_tag}): {img_path}, {label_path} ({valid_annotations_count}/{len(annotations_list)} 件)")
            return True

        except Exception as e:
            error_msg = f"{source_tag} アノテーションの保存に失敗しました: {e}"
            messagebox.showerror(f"{source_tag} 保存エラー", error_msg)
            print(f"[エラー] {error_msg}")
            if os.path.exists(img_path):
                try: os.remove(img_path)
                except OSError: pass
            if os.path.exists(label_path):
                try: os.remove(label_path)
                except OSError: pass
            return False


    def approve_and_save_auto_detection(self):
        global auto_detections, latest_frame_cv, none_mode_enabled

        if beta_mode_enabled: return
        if not auto_detect_mode_enabled: return

        if not auto_detections:
            update_status("エラー: 承認する自動検知結果がありません。")
            return

        frame_to_save = latest_frame_cv
        if frame_to_save is None:
            update_status("エラー: 保存対象の最新フレームが見つかりません。")
            return

        frame_copy = frame_to_save.copy()
        detections_copy = list(auto_detections)
        source_tag = "自動検知承認"

        save_successful = False
        if none_mode_enabled:
            num_saved = 0
            for detection in detections_copy:
                box = detection.get('box')
                class_id = detection.get('class_id')
                if box is not None and class_id is not None:
                    if self._save_annotation_single(frame_copy, box, class_id, source_tag=f"{source_tag}(個別)"):
                        num_saved += 1
            if num_saved > 0:
                update_status(f"{source_tag}: {num_saved} 件を個別保存しました。")
                save_successful = True
            else:
                 update_status(f"{source_tag}: 個別保存に失敗しました。")

        else:
            save_successful = self._save_annotations_generic(frame_copy, detections_copy, source_tag=source_tag)
            if save_successful:
                 update_status(f"{source_tag}: {len(detections_copy)} 件を一括保存しました。")
            else:
                 update_status(f"{source_tag}: 一括保存に失敗しました。")


        if save_successful:
            auto_detections = None
            self.update_button_states()
        else:
            pass

    def clear_auto_detection(self):
        global auto_detections
        if not auto_detect_mode_enabled: return

        if auto_detections:
            auto_detections = None
            update_status("自動検知結果 (黄枠) をクリアしました。")
            print("[情報] ユーザー操作により自動検知結果がクリアされました。")
            self.update_button_states()
        else:
            update_status("クリアする自動検知結果はありません。")

    def clear_current_box(self):
        global current_box_cv, drawing, start_point_tk, end_point_tk
        with paused_lock: is_paused = paused
        if not is_paused: return

        if drawing or current_box_cv:
            was_drawing = drawing
            drawing = False
            start_point_tk = (-1,-1); end_point_tk = (-1,-1)
            current_box_cv = None
            update_status("現在の描画/ボックスをクリアしました。" if was_drawing else "現在の赤枠をクリアしました。")
            self.update_button_states()
        else:
            update_status("クリアする現在の描画/ボックスはありません。")

    def clear_all_pending(self):
        global pending_annotations
        with paused_lock: is_paused = paused
        if not self.auto_save_mode.get():
            update_status("'ペンディング全クリア' は手動オートセーブモードでのみ使用します。"); return
        if not is_paused:
             update_status("'ペンディング全クリア' は一時停止中に使用します。"); return

        if pending_annotations:
            if messagebox.askyesno("クリア確認", f"このフレームのペンディング中のアノテーション {len(pending_annotations)} 件全てをクリアしますか？\n(保存はされません)", icon='warning'):
                pending_annotations = []
                update_status("ペンディング中の全アノテーションをクリアしました。");
                print("[情報] ユーザーによりペンディング中の全アノテーションがクリアされました。")
                self.update_button_states()
        else:
            update_status("クリアするペンディング中のアノテーションはありません。")

    def on_class_select(self, event=None):
        global selected_class_id, current_box_cv, pending_annotations
        selection = self.class_listbox.curselection()
        with paused_lock: is_paused = paused

        if selection:
            selected_index = selection[0]
            selected_class_id = selected_index

            class_name = CLASS_NAMES[selected_class_id] if 0 <= selected_class_id < len(CLASS_NAMES) else f"不明ID:{selected_class_id}"

            if hasattr(self, 'selected_class_label') and self.selected_class_label.winfo_exists():
                self.selected_class_label.config(text=f"選択クラス: {class_name} (ID:{selected_class_id})")
            update_status(f"クラス '{class_name}' (ID: {selected_class_id}) が選択されました。")

            if is_paused and self.auto_save_mode.get() and current_box_cv:
                 print("[デバッグ] 手動オートセーブ: クラス選択によりペンディングに追加します。")
                 self.add_to_pending()
            else:
                 pass

            self.update_button_states()
        else:
            selected_class_id = -1
            if hasattr(self, 'selected_class_label') and self.selected_class_label.winfo_exists():
                self.selected_class_label.config(text="選択クラス: なし")
            self.update_button_states()

    def add_to_pending(self):
        global current_box_cv, selected_class_id, pending_annotations, CLASS_NAMES, current_frame_cv

        if not self.auto_save_mode.get(): return
        with paused_lock: is_paused = paused
        if not is_paused:
            print("[警告] add_to_pending は一時停止中に呼び出されるべきです。")
            return

        if current_box_cv and selected_class_id != -1:
             class_name = CLASS_NAMES[selected_class_id] if 0 <= selected_class_id < len(CLASS_NAMES) else f"ID:{selected_class_id}"
             anno_data = {'box': current_box_cv, 'class_id': selected_class_id, 'class_name': class_name}
             pending_annotations.append(anno_data)
             print(f"[情報] 手動オートセーブ: ペンディングに追加: {class_name} @ {current_box_cv}. 合計: {len(pending_annotations)}")

             if current_frame_cv is not None:
                 print(f"[情報] 手動オートセーブ: 保存実行中 ({len(pending_annotations)} 件)...")
                 save_successful = self._save_annotations_generic(current_frame_cv, pending_annotations, source_tag="手動オートセーブ")
                 if save_successful:
                     update_status(f"オートセーブ完了 ({len(pending_annotations)} 件)。次のボックスを描画してください。")
                 else:
                     update_status(f"オートセーブ失敗。ペンディングリストは保持 ({len(pending_annotations)} 件)。")
             else:
                 print("[警告] 手動オートセーブ試行: 保存対象フレームが見つかりません。ペンディングリストに追加のみ行いました。")
                 update_status(f"エラー: 保存フレームなし。{len(pending_annotations)} 件ペンディング中。")

             current_box_cv = None
             selected_class_id = -1
             if self.root.winfo_exists():
                 try:
                     self.class_listbox.selection_clear(0, END)
                     if hasattr(self, 'selected_class_label'):
                         self.selected_class_label.config(text="選択クラス: なし")
                 except tk.TclError: pass

             self.update_button_states()
        else:
             if not current_box_cv:
                 update_status("ペンディング追加エラー: ボックスが描画されていません。")
             elif selected_class_id == -1:
                 update_status("ペンディング追加エラー: クラスが選択されていません。")

    def on_auto_save_toggle(self):
        global current_box_cv, pending_annotations, selected_class_id
        is_auto = self.auto_save_mode.get(); mode = "オン" if is_auto else "オフ"
        print(f"[情報] 手動オートセーブモードを {mode} にしました。")
        update_status(f"手動オートセーブモード {mode}。{'一時停止して使用します。' if is_auto else ''}")

        with paused_lock: is_paused = paused
        if is_paused:
            print("[情報] 一時停止中に手動オートセーブモードが切り替わりました。状態をリセットします。")
            current_box_cv = None
            pending_annotations = []
            selected_class_id = -1
            if self.root.winfo_exists():
                try:
                    self.class_listbox.selection_clear(0, END)
                    if hasattr(self, 'selected_class_label'):
                        self.selected_class_label.config(text="選択クラス: なし")
                except tk.TclError: pass

        self.update_button_states()

    def update_button_states(self):
        if not self.root.winfo_exists(): return

        is_manual_auto_save = self.auto_save_mode.get()
        with paused_lock: is_paused = paused
        has_current_box = current_box_cv is not None
        has_selected_class = selected_class_id != -1
        has_pending = bool(pending_annotations)
        has_auto_detections = bool(auto_detections)

        _update_button_state(self.save_button,
                             not is_manual_auto_save and is_paused and has_current_box and has_selected_class and not beta_mode_enabled)

        _update_button_state(self.clear_button,
                             is_paused and (has_current_box or drawing) and not beta_mode_enabled)

        _update_button_state(self.clear_all_pending_button,
                             is_manual_auto_save and is_paused and has_pending)

        if auto_detect_mode_enabled:
            if self.approve_detection_button:
                _update_button_state(self.approve_detection_button, has_auto_detections and not beta_mode_enabled)

            if self.clear_detection_button:
                _update_button_state(self.clear_detection_button, has_auto_detections)

    def on_closing(self):
        if messagebox.askokcancel("終了確認", "本当に終了しますか？\nこの方法で終了するとデータセット処理は実行されません。", icon='warning'):
            self.quit_app(process_dataset=False)

    def quit_app_button(self):
        with paused_lock: is_paused_now = paused

        if self.auto_save_mode.get() and pending_annotations and is_paused_now:
             if not messagebox.askyesno("未保存のアノテーション",
                                        f"手動オートセーブモードで {len(pending_annotations)} 件のペンディング中のアノテーションがあります。\nこれらは保存されません。\n\n終了しますか？",
                                        icon='warning'):
                  return

        self.quit_app(process_dataset=True)

    def quit_app(self, process_dataset=True):
        global app_running, hook_thread, keyboard_available, keyboard

        if not app_running: return
        print("[情報] アプリケーションのシャットダウンを開始します...")
        app_running = False

        if keyboard_available and hook_thread is not None:
            print("[情報] キーボードフックを解除しようとしています...")
            try:
                print("[情報] キーボードフックスレッド (デーモン) はアプリケーションと共に終了します。")
            except Exception as e:
                print(f"[警告] キーボードフックの解除中にエラー: {e}")

        if self.cap is not None and self.cap.isOpened():
            print("[情報] カメラを解放中...")
            self.cap.release()
            print("[情報] カメラ解放完了。")
        self.cap = None

        should_process = False
        if process_dataset:
             base_images_exist = False
             if os.path.isdir(IMAGE_DIR_BASE):
                 try: base_images_exist = any(f.lower().endswith(('.png', '.jpg', '.jpeg')) for f in os.listdir(IMAGE_DIR_BASE))
                 except Exception as e: print(f"[警告] 画像ベースディレクトリの確認中にエラー: {e}")
             base_labels_exist = False
             if os.path.isdir(LABEL_DIR_BASE):
                 try: base_labels_exist = any(f.lower().endswith('.txt') for f in os.listdir(LABEL_DIR_BASE))
                 except Exception as e: print(f"[警告] ラベルベースディレクトリの確認中にエラー: {e}")

             if base_images_exist and base_labels_exist:
                 process_ok = False
                 if self.root and self.root.winfo_exists():
                     process_ok = messagebox.askyesno("データセット処理", f"収集したデータを '{OUTPUT_DIR}' 内に訓練/検証セットとして分割し、data.yaml を生成しますか？\n(ベースディレクトリ '{IMAGE_DIR_BASE}', '{LABEL_DIR_BASE}' の内容が移動されます)", icon='question')
                 else:
                     try:
                         response = input(f"収集したデータを '{OUTPUT_DIR}' に処理しますか？ (y/n): ").strip().lower()
                         process_ok = response == 'y'
                     except EOFError:
                         print("[警告] データセット処理の確認ができませんでした。スキップします。")
                         process_ok = False
                 if process_ok:
                     should_process = True
                 else:
                     print("[情報] ユーザー確認によりデータセット処理はスキップされました。")
             else:
                 print("[情報] ベースディレクトリに処理対象のデータが見つかりません。データセット処理をスキップします。")
        else:
             print("[情報] 終了方法によりデータセット処理はスキップされました。")

        if should_process:
            print("[情報] 最終的なデータセット処理を開始します...")
            split_success = split_dataset(IMAGE_DIR_BASE, LABEL_DIR_BASE, OUTPUT_DIR,
                                          TRAIN_IMG_SUBDIR, VAL_IMG_SUBDIR, TRAIN_LBL_SUBDIR, VAL_LBL_SUBDIR,
                                          VALIDATION_SPLIT, RANDOM_SEED)
            if split_success:
                generate_data_yaml(OUTPUT_DIR, TRAIN_IMG_SUBDIR, VAL_IMG_SUBDIR, CLASS_NAMES)

                cleanup_ok = False
                base_dirs_exist = os.path.isdir(IMAGE_DIR_BASE) or os.path.isdir(LABEL_DIR_BASE)
                if base_dirs_exist:
                    if self.root and self.root.winfo_exists():
                        cleanup_ok = messagebox.askyesno("クリーンアップ確認", f"処理元のベースディレクトリを削除しますか？\n(空になっているはずですが、念のため確認)\n'{IMAGE_DIR_BASE}'\n'{LABEL_DIR_BASE}'", icon='question')
                    else:
                         try:
                             response = input(f"処理元のベースディレクトリを削除しますか？ (y/n): ").strip().lower()
                             cleanup_ok = response == 'y'
                         except EOFError:
                             print("[警告] クリーンアップの確認ができませんでした。スキップします。")
                             cleanup_ok = False

                    if cleanup_ok:
                        print("[情報] ベースディレクトリを削除中...");
                        try:
                            if os.path.isdir(IMAGE_DIR_BASE): shutil.rmtree(IMAGE_DIR_BASE)
                            if os.path.isdir(LABEL_DIR_BASE): shutil.rmtree(LABEL_DIR_BASE)
                            print("[情報] ベースディレクトリを正常に削除しました。")
                        except Exception as e:
                            err_msg = f"ベースディレクトリの削除に失敗しました: {e}"
                            print(f"[エラー] {err_msg}")
                            if self.root and self.root.winfo_exists():
                                messagebox.showerror("クリーンアップエラー", err_msg)
                    else:
                        print("[情報] ベースディレクトリは削除されませんでした。手動で確認・削除してください。")
            else:
                err_msg = "データセットの分割に失敗しました。data.yaml は生成されません。ベースディレクトリのファイルはそのまま残っています。"
                print(f"[エラー] {err_msg}")
                if self.root and self.root.winfo_exists():
                     messagebox.showerror("処理エラー", err_msg)

        try:
            if self.root and self.root.winfo_exists():
                print("[情報] Tkinterウィンドウを閉じています...")
                self.root.destroy()
                print("[情報] Tkinterウィンドウを閉じました。")
        except Exception as e:
            print(f"[警告] Tkinterウィンドウを閉じる際にエラー: {e}")

        print("[情報] アプリケーションのシャットダウン完了。")


def update_status(message):
    if app is not None and hasattr(app, 'root') and app.root and app.root.winfo_exists():
        try:
            app.root.after(0, lambda msg=message: _update_status_label(msg))
        except tk.TclError:
            pass
    else:
        print(f"状態更新 (UI利用不可): {message}")

def _update_status_label(message):
    if app is not None and hasattr(app, 'status_label') and app.status_label and app.status_label.winfo_exists():
        app.status_label.config(text=f"状態: {message}")

def _update_button_state(button, enable):
     if app is not None and hasattr(app, 'root') and app.root and app.root.winfo_exists():
         try:
             app.root.after(0, lambda b=button, e=enable: _set_button_state(b, e))
         except tk.TclError:
             pass

def _set_button_state(button, enable):
    if button and button.winfo_exists():
          try:
               current_state = button.cget('state')
               new_state = tk.NORMAL if enable else tk.DISABLED
               if current_state != new_state:
                   button.config(state=new_state)
          except tk.TclError:
              pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="YOLO アノテーションツール")
    parser.add_argument("--auto", action="store_true",
                        help="自動検知モードを有効にする (--pt が必須)")
    parser.add_argument("--pt", type=str,
                        help="自動検知に使用するYOLOモデルファイル (.pt) の絶対パス")
    parser.add_argument("--detect-interval", type=int, default=1, metavar='N',
                        help=f"自動検知を実行するフレーム間隔 (デフォルト: 1)")
    parser.add_argument("--conf", type=float, default=AUTO_DETECT_CONF_THRESHOLD, metavar='THRESHOLD',
                        help=f"自動検知の信頼度閾値 (デフォルト: {AUTO_DETECT_CONF_THRESHOLD})")
    parser.add_argument("--beta", action="store_true",
                        help="Betaモード: 自動検知結果を承認なしで自動保存する (--auto が必須)")
    parser.add_argument("--none", action="store_true",
                        help="個別保存モード: 自動検知時(--auto)に、検出された各オブジェクトを個別のファイルとして保存する")
    parser.add_argument("--camera-id", type=int, default=CAMERA_ID, metavar='ID',
                        help=f"使用するカメラのID (デフォルト: {CAMERA_ID})")
    parser.add_argument("--output-dir", type=str, default=OUTPUT_DIR, metavar='PATH',
                        help=f"データセットの出力先ディレクトリ (デフォルト: {OUTPUT_DIR})")


    args = parser.parse_args()

    print("[情報] コマンドライン引数を解析しています...")
    CAMERA_ID = args.camera_id
    OUTPUT_DIR = args.output_dir
    IMAGE_DIR_BASE = os.path.join(OUTPUT_DIR, "images_base")
    LABEL_DIR_BASE = os.path.join(OUTPUT_DIR, "labels_base")
    AUTO_DETECT_CONF_THRESHOLD = args.conf
    auto_detect_interval = max(1, args.detect_interval)

    if args.auto:
        if not args.pt:
            print("[エラー] --auto モードを使用するには --pt <モデルファイルのパス> を指定する必要があります。")
            exit(1)
        if not auto_detect_available:
             print("[エラー] --auto モードが指定されましたが、PyTorch/Ultralytics が利用できません。インストールしてください。")
             exit(1)
        if not os.path.isabs(args.pt):
             print("[エラー] --pt で指定するパスは絶対パスである必要があります。")
             print(f"指定されたパス: {args.pt}")
             exit(1)
        if not os.path.exists(args.pt):
             print(f"[エラー] 指定されたモデルファイルが見つかりません: {args.pt}")
             exit(1)
        print(f"[情報] 自動検知モード有効。モデル: {args.pt}, 検知間隔: {auto_detect_interval} フレーム, 信頼度閾値: {AUTO_DETECT_CONF_THRESHOLD}")
    else:
        if args.beta: print("[警告] --auto が指定されていないため、--beta は無視されます。")
        if args.none: print("[警告] --auto が指定されていないため、--none は無視されます。")
        args.beta = False
        args.none = False

    if args.beta:
        print("[情報] Betaモード有効。自動検知結果は承認なしで保存されます。")
    if args.none:
        print("[情報] 個別保存モード有効。自動検知されたオブジェクトは個別に保存されます。")


    print("[情報] アノテーションアプリケーションを開始します...")
    root = tk.Tk()
    app_instance = AnnotationAppIntegratedUI(root, args)

    if hasattr(app_instance, 'initialized_successfully') and app_instance.initialized_successfully:
        print("[情報] UI初期化成功。メインループを開始します。")
        try:
            root.mainloop()
        except KeyboardInterrupt:
            print("\n[情報] Ctrl+C が検出されました。アプリケーションを終了します。")
            app_instance.quit_app(process_dataset=False)
        print("[情報] アプリケーションのメインループが終了しました。")
    else:
        print("[致命的エラー] アプリケーションの初期化に失敗しました。メインループを開始せずに終了します。")
        try:
            if root and root.winfo_exists(): root.destroy()
        except tk.TclError: pass

    print("[情報] プログラム終了。")