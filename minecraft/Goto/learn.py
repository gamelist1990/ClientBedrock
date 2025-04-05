from ultralytics import YOLO

# ベースモデル (yolo11m.pt はUltralyticsが自動で処理してくれるのでこのままでOK)
model = YOLO('yolo11n.pt')

if __name__ == '__main__':
    try:
        results = model.train(
            data="./dataset/data.yaml", # data.yaml のパスを確認
            epochs=50,
            imgsz=640,
            batch=15,       # GPUメモリに応じて調整 (RTX 4070なら8でも大丈夫そう)
            name='mine',   # 出力フォルダ名
            device='cuda', # GPUを使用
            amp=True,     # ★★★ AMPを無効化 (NMSエラー回避のため重要) ★★★
            pretrained=True, # 事前学習済み重みを使用
        )
        print("Training completed successfully!")
        print(f"Best model saved at: {results.save_dir}/weights/best.pt")
    except Exception as e:
        import traceback
        print(f"An error occurred during training: {e}")
        traceback.print_exc() # 詳細なエラー情報を表示