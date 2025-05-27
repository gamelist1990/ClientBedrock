/**
 * レンダラープロセスのメインスクリプト
 * UIのイベントハンドリングとElectronAPIの呼び出しを行います
 */

// DOM要素の取得
const elements = {
    btnAppInfo: document.getElementById('btn-app-info'),
    btnMessageBox: document.getElementById('btn-message-box'),
    btnFileDialog: document.getElementById('btn-file-dialog'),
    btnSaveDialog: document.getElementById('btn-save-dialog'),
    btnNotification: document.getElementById('btn-notification'),
    btnThemeToggle: document.getElementById('btn-theme-toggle'),
    resultArea: document.getElementById('result-area'),
    logArea: document.getElementById('log-area')
};

// テーマの状態
let isDarkTheme = false;

/**
 * ログエントリを追加する関数
 * @param {string} message - ログメッセージ
 * @param {string} type - ログタイプ (success, warning, error)
 */
function addLogEntry(message, type = 'info') {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type} slide-in`;
    
    const time = new Date().toLocaleTimeString('ja-JP', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
    
    logEntry.innerHTML = `
        <span class="log-time">[${time}]</span>
        <span class="log-message">${message}</span>
    `;
    
    elements.logArea.appendChild(logEntry);
    
    // ログが多くなりすぎた場合は古いものを削除
    const logEntries = elements.logArea.querySelectorAll('.log-entry');
    if (logEntries.length > 20) {
        logEntries[0].remove();
    }
    
    // 最新のログまでスクロール
    elements.logArea.scrollTop = elements.logArea.scrollHeight;
}

/**
 * 結果エリアに内容を表示する関数
 * @param {string} content - 表示する内容
 */
function displayResult(content) {
    elements.resultArea.innerHTML = content;
    elements.resultArea.classList.add('fade-in');
    
    // アニメーションクラスを後で削除
    setTimeout(() => {
        elements.resultArea.classList.remove('fade-in');
    }, 500);
}

/**
 * アプリケーション情報を表示する関数
 */
async function showAppInfo() {
    try {
        addLogEntry('アプリケーション情報を取得中...', 'info');
        
        const appInfo = await window.electronAPI.getAppInfo();
        
        const infoHtml = `
            <div class="app-info">
                <h4>📱 アプリケーション情報</h4>
                <div class="info-grid">
                    <div class="info-item">
                        <strong>アプリ名:</strong> ${appInfo.name}
                    </div>
                    <div class="info-item">
                        <strong>バージョン:</strong> ${appInfo.version}
                    </div>
                    <div class="info-item">
                        <strong>プラットフォーム:</strong> ${appInfo.platform}
                    </div>
                    <div class="info-item">
                        <strong>アーキテクチャ:</strong> ${appInfo.arch}
                    </div>
                    <div class="info-item">
                        <strong>Electronバージョン:</strong> ${appInfo.electronVersion}
                    </div>
                    <div class="info-item">
                        <strong>Node.jsバージョン:</strong> ${appInfo.nodeVersion}
                    </div>
                </div>
            </div>
            <style>
                .app-info { padding: 1rem; }
                .app-info h4 { margin-bottom: 1rem; color: var(--primary-color); }
                .info-grid { display: grid; gap: 0.5rem; }
                .info-item { padding: 0.5rem; background: var(--bg-secondary); border-radius: 4px; }
                .info-item strong { color: var(--primary-color); }
            </style>
        `;
        
        displayResult(infoHtml);
        addLogEntry('アプリケーション情報を表示しました', 'success');
        
    } catch (error) {
        console.error('アプリ情報取得エラー:', error);
        addLogEntry(`エラー: ${error.message}`, 'error');
    }
}

/**
 * メッセージボックスを表示する関数
 */
async function showMessageBox() {
    try {
        addLogEntry('メッセージボックスを表示中...', 'info');
        
        const result = await window.electronAPI.showMessageBox({
            type: 'question',
            buttons: ['はい', 'いいえ', 'キャンセル'],
            defaultId: 0,
            title: 'サンプルダイアログ',
            message: 'これはサンプルのメッセージボックスです。',
            detail: 'Electronでは様々なタイプのダイアログを表示できます。\n\nどのボタンを選択しますか？'
        });
        
        const buttonNames = ['はい', 'いいえ', 'キャンセル'];
        const selectedButton = buttonNames[result.response];
        
        const resultHtml = `
            <div class="message-result">
                <h4>💬 メッセージボックスの結果</h4>
                <p><strong>選択されたボタン:</strong> ${selectedButton}</p>
                <p><strong>ボタンインデックス:</strong> ${result.response}</p>
                <p><strong>チェックボックス:</strong> ${result.checkboxChecked ? 'チェック済み' : 'チェックなし'}</p>
            </div>
            <style>
                .message-result { padding: 1rem; }
                .message-result h4 { margin-bottom: 1rem; color: var(--primary-color); }
                .message-result p { margin: 0.5rem 0; }
                .message-result strong { color: var(--primary-color); }
            </style>
        `;
        
        displayResult(resultHtml);
        addLogEntry(`メッセージボックス: "${selectedButton}" が選択されました`, 'success');
        
    } catch (error) {
        console.error('メッセージボックス表示エラー:', error);
        addLogEntry(`エラー: ${error.message}`, 'error');
    }
}

/**
 * ファイル選択ダイアログを表示する関数
 */
async function showFileDialog() {
    try {
        addLogEntry('ファイル選択ダイアログを表示中...', 'info');
        
        const result = await window.electronAPI.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'テキストファイル', extensions: ['txt', 'md', 'json'] },
                { name: '画像ファイル', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] },
                { name: 'すべてのファイル', extensions: ['*'] }
            ],
            title: 'ファイルを選択してください'
        });
        
        if (!result.canceled && result.filePaths.length > 0) {
            const fileListHtml = result.filePaths.map((filePath, index) => {
                const fileName = filePath.split('\\').pop() || filePath.split('/').pop();
                return `
                    <div class="file-item">
                        <span class="file-index">${index + 1}.</span>
                        <div class="file-details">
                            <div class="file-name">${fileName}</div>
                            <div class="file-path">${filePath}</div>
                        </div>
                    </div>
                `;
            }).join('');
            
            const resultHtml = `
                <div class="file-result">
                    <h4>📁 選択されたファイル（${result.filePaths.length}件）</h4>
                    <div class="file-list">
                        ${fileListHtml}
                    </div>
                </div>
                <style>
                    .file-result { padding: 1rem; }
                    .file-result h4 { margin-bottom: 1rem; color: var(--primary-color); }
                    .file-list { max-height: 300px; overflow-y: auto; }
                    .file-item { 
                        display: flex; 
                        align-items: flex-start; 
                        padding: 0.75rem; 
                        margin: 0.5rem 0; 
                        background: var(--bg-secondary); 
                        border-radius: 6px; 
                        border-left: 3px solid var(--primary-color);
                    }
                    .file-index { 
                        font-weight: bold; 
                        color: var(--primary-color); 
                        margin-right: 0.75rem; 
                        min-width: 1.5rem;
                    }
                    .file-details { flex: 1; }
                    .file-name { 
                        font-weight: 500; 
                        color: var(--text-primary); 
                        margin-bottom: 0.25rem;
                    }
                    .file-path { 
                        font-size: 0.85rem; 
                        color: var(--text-secondary); 
                        word-break: break-all;
                    }
                </style>
            `;
            
            displayResult(resultHtml);
            addLogEntry(`${result.filePaths.length}個のファイルが選択されました`, 'success');
        } else {
            displayResult('<p class="placeholder">ファイルが選択されませんでした</p>');
            addLogEntry('ファイル選択がキャンセルされました', 'warning');
        }
        
    } catch (error) {
        console.error('ファイルダイアログ表示エラー:', error);
        addLogEntry(`エラー: ${error.message}`, 'error');
    }
}

/**
 * 保存ダイアログを表示する関数
 */
async function showSaveDialog() {
    try {
        addLogEntry('保存ダイアログを表示中...', 'info');
        
        const result = await window.electronAPI.showSaveDialog({
            filters: [
                { name: 'テキストファイル', extensions: ['txt'] },
                { name: 'JSONファイル', extensions: ['json'] },
                { name: 'すべてのファイル', extensions: ['*'] }
            ],
            defaultPath: 'sample.txt',
            title: '保存先を選択してください'
        });
        
        if (!result.canceled && result.filePath) {
            const fileName = result.filePath.split('\\').pop() || result.filePath.split('/').pop();
            
            const resultHtml = `
                <div class="save-result">
                    <h4>💾 保存先が選択されました</h4>
                    <div class="save-info">
                        <div class="save-item">
                            <strong>ファイル名:</strong> ${fileName}
                        </div>
                        <div class="save-item">
                            <strong>保存パス:</strong> ${result.filePath}
                        </div>
                    </div>
                    <p class="note">※実際のファイル保存は実装されていません（サンプルのため）</p>
                </div>
                <style>
                    .save-result { padding: 1rem; }
                    .save-result h4 { margin-bottom: 1rem; color: var(--primary-color); }
                    .save-info { margin: 1rem 0; }
                    .save-item { 
                        padding: 0.5rem; 
                        margin: 0.5rem 0; 
                        background: var(--bg-secondary); 
                        border-radius: 4px; 
                    }
                    .save-item strong { color: var(--primary-color); }
                    .note { 
                        font-size: 0.85rem; 
                        color: var(--text-secondary); 
                        font-style: italic; 
                        margin-top: 1rem;
                    }
                </style>
            `;
            
            displayResult(resultHtml);
            addLogEntry(`保存先が選択されました: ${fileName}`, 'success');
        } else {
            displayResult('<p class="placeholder">保存がキャンセルされました</p>');
            addLogEntry('保存がキャンセルされました', 'warning');
        }
        
    } catch (error) {
        console.error('保存ダイアログ表示エラー:', error);
        addLogEntry(`エラー: ${error.message}`, 'error');
    }
}

/**
 * ブラウザ通知を表示する関数
 */
function showNotification() {
    addLogEntry('通知を表示中...', 'info');
    
    if ('Notification' in window) {
        if (Notification.permission === 'granted') {
            createNotification();
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    createNotification();
                } else {
                    addLogEntry('通知の許可が拒否されました', 'warning');
                }
            });
        } else {
            addLogEntry('通知が無効になっています', 'warning');
        }
    } else {
        addLogEntry('このブラウザは通知をサポートしていません', 'error');
    }
    
    function createNotification() {
        const notification = new Notification('Simple Electron App', {
            body: 'これはサンプル通知です。Electronアプリから送信されました！',
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="%23007acc"/><text x="50" y="60" text-anchor="middle" fill="white" font-size="30">E</text></svg>',
            tag: 'electron-sample',
            requireInteraction: false
        });
        
        notification.onclick = () => {
            addLogEntry('通知がクリックされました', 'success');
            notification.close();
        };
        
        // 5秒後に自動で閉じる
        setTimeout(() => {
            notification.close();
        }, 5000);
        
        addLogEntry('通知が表示されました', 'success');
        
        const resultHtml = `
            <div class="notification-result">
                <h4>🔔 通知が表示されました</h4>
                <p>デスクトップに通知が表示されました。</p>
                <div class="notification-info">
                    <div><strong>タイトル:</strong> Simple Electron App</div>
                    <div><strong>内容:</strong> これはサンプル通知です。Electronアプリから送信されました！</div>
                    <div><strong>自動閉じ:</strong> 5秒後</div>
                </div>
            </div>
            <style>
                .notification-result { padding: 1rem; }
                .notification-result h4 { margin-bottom: 1rem; color: var(--primary-color); }
                .notification-info { 
                    margin-top: 1rem; 
                    padding: 1rem; 
                    background: var(--bg-secondary); 
                    border-radius: 6px; 
                }
                .notification-info div { margin: 0.5rem 0; }
                .notification-info strong { color: var(--primary-color); }
            </style>
        `;
        
        displayResult(resultHtml);
    }
}

/**
 * テーマを切り替える関数
 */
function toggleTheme() {
    isDarkTheme = !isDarkTheme;
    document.documentElement.setAttribute('data-theme', isDarkTheme ? 'dark' : 'light');
    
    const themeName = isDarkTheme ? 'ダーク' : 'ライト';
    addLogEntry(`テーマを${themeName}テーマに切り替えました`, 'success');
    
    const resultHtml = `
        <div class="theme-result">
            <h4>🎨 テーマが変更されました</h4>
            <p>現在のテーマ: <strong>${themeName}テーマ</strong></p>
            <div class="theme-preview">
                <div class="color-sample primary">プライマリカラー</div>
                <div class="color-sample secondary">セカンダリカラー</div>
                <div class="color-sample background">背景色</div>
                <div class="color-sample text">テキスト色</div>
            </div>
        </div>
        <style>
            .theme-result { padding: 1rem; }
            .theme-result h4 { margin-bottom: 1rem; color: var(--primary-color); }
            .theme-result strong { color: var(--primary-color); }
            .theme-preview { 
                display: grid; 
                grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); 
                gap: 0.5rem; 
                margin-top: 1rem; 
            }
            .color-sample { 
                padding: 0.75rem; 
                border-radius: 6px; 
                text-align: center; 
                font-size: 0.85rem; 
                font-weight: 500; 
            }
            .color-sample.primary { background: var(--primary-color); color: white; }
            .color-sample.secondary { background: var(--secondary-color); color: white; }
            .color-sample.background { background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); }
            .color-sample.text { background: var(--text-primary); color: var(--bg-primary); }
        </style>
    `;
    
    displayResult(resultHtml);
}

/**
 * イベントリスナーの設定
 */
function setupEventListeners() {
    elements.btnAppInfo?.addEventListener('click', showAppInfo);
    elements.btnMessageBox?.addEventListener('click', showMessageBox);
    elements.btnFileDialog?.addEventListener('click', showFileDialog);
    elements.btnSaveDialog?.addEventListener('click', showSaveDialog);
    elements.btnNotification?.addEventListener('click', showNotification);
    elements.btnThemeToggle?.addEventListener('click', toggleTheme);
    
    addLogEntry('イベントリスナーが設定されました', 'success');
}

/**
 * アプリケーションの初期化
 */
function initializeApp() {
    console.log('Renderer process started');
    
    // ElectronAPIが利用可能かチェック
    if (!window.electronAPI) {
        console.error('ElectronAPIが利用できません');
        addLogEntry('ElectronAPIが利用できません', 'error');
        return;
    }
    
    setupEventListeners();
    addLogEntry('Simple Electron Appが起動しました', 'success');
    
    // 初期状態でアプリ情報を表示
    setTimeout(showAppInfo, 1000);
}

// DOMが読み込まれたら初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

// キーボードショートカット
document.addEventListener('keydown', (event) => {
    // Ctrl+R で再読み込み
    if (event.ctrlKey && event.key === 'r') {
        event.preventDefault();
        location.reload();
    }
    
    // F12 で開発者ツール（メニューから）
    if (event.key === 'F12') {
        addLogEntry('F12キーが押されました（開発者ツールの切り替え）', 'info');
    }
    
    // Ctrl+Shift+I で開発者ツール
    if (event.ctrlKey && event.shiftKey && event.key === 'I') {
        addLogEntry('Ctrl+Shift+Iが押されました（開発者ツールの切り替え）', 'info');
    }
});

// エラーハンドリング
window.addEventListener('error', (event) => {
    console.error('エラーが発生しました:', event.error);
    addLogEntry(`JavaScript エラー: ${event.error.message}`, 'error');
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('未処理のPromise拒否:', event.reason);
    addLogEntry(`未処理のPromise拒否: ${event.reason}`, 'error');
});
