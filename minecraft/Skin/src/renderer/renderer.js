// Minecraft Skin Injector - シンプル版
class SkinInjectorApp {
    constructor() {
        this.currentStep = 1;
        this.selectedTarget = null;
        this.selectedSource = null;
        this.tempDirs = [];
        
        // 初期化
        this.initializeEventListeners();
        this.updateUI();
        this.initializeAccessibility();
    }

    // アクセシビリティ初期化
    initializeAccessibility() {
        // キーボードナビゲーション
        this.setupKeyboardNavigation('.card');
        this.setupKeyboardNavigation('.step-item');
        
        // ボタンアクセシビリティ
        document.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    btn.click();
                }
            });
        });
    }

    // キーボードナビゲーション設定
    setupKeyboardNavigation(selector) {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el, index) => {
            if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
            
            el.addEventListener('keydown', e => {
                switch (e.key) {
                    case 'Enter':
                    case ' ':
                        e.preventDefault();
                        el.click();
                        break;
                    case 'ArrowRight':
                    case 'ArrowDown':
                        e.preventDefault();
                        this.focusNext(elements, index);
                        break;
                    case 'ArrowLeft':
                    case 'ArrowUp':
                        e.preventDefault();
                        this.focusPrev(elements, index);
                        break;
                }
            });
            
            el.addEventListener('focus', () => el.classList.add('keyboard-focus'));
            el.addEventListener('blur', () => el.classList.remove('keyboard-focus'));
        });
    }

    // 次の要素にフォーカス
    focusNext(elements, currentIndex) {
        const nextIndex = (currentIndex + 1) % elements.length;
        elements[nextIndex].focus();
    }

    // 前の要素にフォーカス
    focusPrev(elements, currentIndex) {
        const prevIndex = currentIndex === 0 ? elements.length - 1 : currentIndex - 1;
        elements[prevIndex].focus();
    }

    // イベントリスナー初期化
    initializeEventListeners() {
        // 対象選択
        document.querySelectorAll('[data-target]').forEach(card => {
            card.addEventListener('click', () => {
                this.selectTargetType(card.dataset.target);
                this.addSelectionEffect(card);
            });
        });

        // ソース選択
        document.querySelectorAll('[data-source]').forEach(card => {
            card.addEventListener('click', () => {
                this.selectSourceType(card.dataset.source);
                this.addSelectionEffect(card);
            });
        });

        // ナビゲーション
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        
        if (prevBtn) prevBtn.addEventListener('click', () => this.previousStep());
        if (nextBtn) nextBtn.addEventListener('click', () => this.nextStep());

        // パック更新
        const refreshBtn = document.getElementById('refreshPacksBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.addButtonLoadingState(refreshBtn);
                this.loadInstalledPacks();
            });
        }

        // 処理開始
        const startBtn = document.getElementById('startProcessBtn');
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                this.addButtonLoadingState(startBtn);
                this.startProcess();
            });
        }

        // 新規処理
        const newProcessBtn = document.getElementById('newProcessBtn');
        if (newProcessBtn) {
            newProcessBtn.addEventListener('click', () => this.resetApp());
        }
          
        // ステップナビゲーション
        document.querySelectorAll('.step-item').forEach(step => {
            step.addEventListener('click', () => {
                const stepNumber = parseInt(step.dataset.step);
                if (this.isStepAccessible(stepNumber)) {
                    this.showStep(stepNumber);
                    this.announceStepChange(stepNumber);
                }
            });
        });

        // Escapeキー処理
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.handleEscape();
            }
        });
    }

    // 選択エフェクト追加
    addSelectionEffect(card) {
        // 親要素内の兄弟から選択状態を削除
        const selector = card.hasAttribute('data-target') ? '[data-target]' : '[data-source]';
        card.parentElement.querySelectorAll(selector).forEach(c => {
            c.classList.remove('selected');
        });
        
        // 選択エフェクトを追加
        card.classList.add('selected');
    }

    // ボタンローディング状態追加
    addButtonLoadingState(button) {
        const originalText = button.innerHTML;
        button.innerHTML = '<div class="spinner"></div> 処理中...';
        button.disabled = true;
        
        // 元の状態を保存して復元
        button.dataset.originalText = originalText;
        
        setTimeout(() => {
            button.innerHTML = originalText;
            button.disabled = false;
        }, 2000);
    }

    // Escapeキー処理
    handleEscape() {
        console.log('Escape key pressed');
    }

    // UI更新
    updateUI() {
        this.showStep(this.currentStep);
        this.updateStepProgress();
        this.updateNavigation();
        this.updateContentHeader();
    }

    // ステップ進行状況更新
    updateStepProgress() {
        document.querySelectorAll('.step-item').forEach((step, index) => {
            const stepNumber = index + 1;
            step.classList.remove('active', 'completed');
            
            if (stepNumber < this.currentStep) {
                step.classList.add('completed');
            } else if (stepNumber === this.currentStep) {
                step.classList.add('active');
            }
        });
    }

    // コンテンツヘッダー更新
    updateContentHeader() {
        const titles = {
            1: '対象の選択',
            2: 'ソースの選択', 
            3: '処理の実行'
        };
        
        const descriptions = {
            1: '置き換えたいスキンパックを選択してください',
            2: '新しいリソースパックを選択してください',
            3: '設定を確認して処理を開始してください'
        };
        
        const titleElement = document.getElementById('contentTitle');
        const descElement = document.getElementById('contentDescription');
        
        if (titleElement) titleElement.textContent = titles[this.currentStep] || '';
        if (descElement) descElement.textContent = descriptions[this.currentStep] || '';
    }

    // ステータス更新
    updateStatus(text, type = 'ready') {
        const statusText = document.getElementById('statusText');
        const statusIcon = document.querySelector('.status-icon');
        
        if (statusText) statusText.textContent = text;
        
        if (statusIcon) {
            // ステータスアイコンを更新
            switch (type) {
                case 'processing':
                    statusIcon.textContent = '🔄';
                    break;
                case 'success':
                    statusIcon.textContent = '✅';
                    break;
                case 'error':
                    statusIcon.textContent = '❌';
                    break;
                default:
                    statusIcon.textContent = '🟢';
            }
        }
    }

    // ステップ表示
    showStep(stepNumber) {
        // ステップ番号の検証
        if (stepNumber < 1 || stepNumber > 3) return;
        
        this.currentStep = stepNumber;
        
        // 全てのステップを非表示
        document.querySelectorAll('.step-content').forEach(step => {
            step.style.display = 'none';
        });
        
        // 現在のステップを表示
        const currentStepElement = document.getElementById(`step${stepNumber}`);
        if (currentStepElement) {
            currentStepElement.style.display = 'block';
        }
        
        this.updateStepProgress();
        this.updateNavigation();
        this.updateContentHeader();
        this.announceStepChange(stepNumber);
    }

    // ステップ変更アナウンス
    announceStepChange(stepNumber) {
        const titles = {
            1: '対象の選択',
            2: 'ソースの選択', 
            3: '処理の実行'
        };
        
        this.announceToScreenReader(`ステップ ${stepNumber}: ${titles[stepNumber]} に移動しました`);
    }

    // 対象タイプ選択
    async selectTargetType(type) {
        try {
            // ステータス更新
            this.updateStatus('対象を処理中...', 'processing');
            
            // 選択表示を非表示
            this.hideTargetDisplays();

            // ローディング表示
            this.showProgress('対象を準備中...');

            switch (type) {
                case 'installed':
                    await this.handleInstalledPacks();
                    break;
                case 'mcpack':
                    await this.handleMcpackFile();
                    break;
                case 'folder':
                    await this.handleFolderSelection();
                    break;
                default:
                    throw new Error(`未知の対象タイプ: ${type}`);
            }
            
            this.hideProgress();
            this.updateStatus('対象が選択されました', 'success');
            this.showSuccess('対象が正常に選択されました');
            
        } catch (error) {
            this.hideProgress();
            console.error('Error selecting target:', error);
            this.updateStatus('対象の選択に失敗しました', 'error');
            this.showError(`対象の選択中にエラーが発生しました: ${error.message}`, '選択エラー');
        }
    }

    // インストール済みパック処理
    async handleInstalledPacks() {
        document.getElementById('installedPacksList').style.display = 'block';
        await this.loadInstalledPacks();
    }

    // インストール済みパック読み込み
    async loadInstalledPacks() {
        const packItemsContainer = document.getElementById('packItems');
        packItemsContainer.innerHTML = '<div class="loading">スキンパックを検索中...</div>';

        try {
            const packs = await window.electronAPI.getSkinPacks();
            packItemsContainer.innerHTML = '';

            if (packs.length === 0) {
                packItemsContainer.innerHTML = '<div class="pack-item"><p>インストール済みのスキンパックが見つかりませんでした。</p></div>';
                return;
            }

            packs.forEach(pack => {
                const packElement = document.createElement('div');
                packElement.className = 'pack-item';
                packElement.innerHTML = `
                    <h4>${this.escapeHtml(pack.name)}</h4>
                    <p>${this.escapeHtml(pack.path)}</p>
                `;
                
                packElement.addEventListener('click', () => {
                    document.querySelectorAll('.pack-item').forEach(item => item.classList.remove('selected'));
                    packElement.classList.add('selected');
                    this.selectTarget(pack);
                });

                packItemsContainer.appendChild(packElement);
            });

        } catch (error) {
            packItemsContainer.innerHTML = '<div class="pack-item error"><p>エラー: スキンパックの読み込みに失敗しました。</p></div>';
            console.error('Error loading skin packs:', error);
        }
    }

    // MCPACKファイル処理
    async handleMcpackFile() {
        try {
            const filePath = await window.electronAPI.selectMcpackFile();
            if (!filePath) return;

            this.showProgress('MCPACKファイルを解凍中...');
            const packInfo = await window.electronAPI.unpackMcpack(filePath);
            this.hideProgress();

            if (packInfo) {
                this.tempDirs.push(packInfo.path);
                this.selectTarget(packInfo);
            } else {
                this.showError('MCPACKファイルの解凍に失敗しました。');
            }
        } catch (error) {
            this.hideProgress();
            this.showError('ファイル選択中にエラーが発生しました: ' + error.message);
        }
    }

    // フォルダ選択処理
    async handleFolderSelection() {
        try {
            const folderPath = await window.electronAPI.selectFolder();
            if (!folderPath) return;

            const isValid = await window.electronAPI.validateSourcePack(folderPath);
            if (!isValid) {
                this.showError('選択されたフォルダに manifest.json が見つかりません。');
                return;
            }

            const packName = folderPath.split('\\').pop() || folderPath.split('/').pop() || 'Unknown';
            this.selectTarget({ name: packName, path: folderPath, isTemp: false });
        } catch (error) {
            this.showError('フォルダ選択中にエラーが発生しました: ' + error.message);
        }
    }

    // 対象選択
    selectTarget(target) {
        this.selectedTarget = target;
        
        document.getElementById('selectedTarget').style.display = 'block';
        document.getElementById('targetName').textContent = target.name;
        document.getElementById('targetPath').textContent = target.path;
        
        this.updateNavigation();
    }

    // ソースタイプ選択
    async selectSourceType(type) {
        // 既存の選択をクリア
        document.querySelectorAll('[data-source]').forEach(card => card.classList.remove('selected'));
        document.querySelector(`[data-source="${type}"]`).classList.add('selected');

        document.getElementById('selectedSource').style.display = 'none';

        switch (type) {
            case 'folder':
                await this.handleSourceFolder();
                break;
            case 'web':
                await this.handleWebGenerated();
                break;
        }
    }

    // ソースフォルダ処理
    async handleSourceFolder() {
        try {
            const folderPath = await window.electronAPI.selectFolder();
            if (!folderPath) return;

            const isValid = await window.electronAPI.validateSourcePack(folderPath);
            if (!isValid) {
                this.showError('選択されたフォルダに manifest.json が見つかりません。');
                return;
            }

            const packName = folderPath.split('\\').pop() || folderPath.split('/').pop() || 'Unknown';
            this.selectSource({ name: packName, path: folderPath, isTemp: false });
        } catch (error) {
            this.showError('フォルダ選択中にエラーが発生しました: ' + error.message);
        }
    }

    // Web生成ソース処理
    async handleWebGenerated() {
        try {
            const url = await window.electronAPI.getSampleCapeUrl();
            
            // URLを開く確認
            if (confirm(`Webツールを開きます。\n\n${url}\n\nOKを押すとブラウザで開きます。ツールでスキンパックを生成・ダウンロードした後、「OK」を押してファイルを選択してください。`)) {
                await window.electronAPI.openExternalUrl(url);
                
                // 少し待ってからファイル選択を表示
                setTimeout(async () => {
                    const filePath = await window.electronAPI.selectMcpackFile();
                    if (!filePath) return;

                    this.showProgress('MCPACKファイルを解凍中...');
                    const packInfo = await window.electronAPI.unpackMcpack(filePath);
                    this.hideProgress();

                    if (packInfo) {
                        this.tempDirs.push(packInfo.path);
                        this.selectSource(packInfo);
                    } else {
                        this.showError('MCPACKファイルの解凍に失敗しました。');
                    }
                }, 1000);
            }
        } catch (error) {
            this.hideProgress();
            this.showError('処理中にエラーが発生しました: ' + error.message);
        }
    }

    // ソース選択
    selectSource(source) {
        this.selectedSource = source;
        
        document.getElementById('selectedSource').style.display = 'block';
        document.getElementById('sourceName').textContent = source.name;
        document.getElementById('sourcePath').textContent = source.path;
        
        this.updateNavigation();
    }

    // 処理開始
    async startProcess() {
        if (!this.selectedTarget || !this.selectedSource) {
            this.showError('対象とソースが両方選択されている必要があります。');
            return;
        }

        // サマリー更新
        document.getElementById('summaryTarget').textContent = this.selectedTarget.name;
        document.getElementById('summarySource').textContent = this.selectedSource.name;

        // 進行状況セクション表示
        document.getElementById('progressSection').style.display = 'block';
        document.getElementById('startProcessBtn').style.display = 'none';

        try {
            // ステップ1: ソース検証
            this.updateProgress(20, 'ソースパックを検証中...');
            this.addLog('ソースパックの検証を開始...');
            
            const isValid = await window.electronAPI.validateSourcePack(this.selectedSource.path);
            if (!isValid) {
                throw new Error('ソースパックの検証に失敗しました');
            }
            this.addLog('✅ ソースパック検証完了');

            // ステップ2: 内容置き換え
            this.updateProgress(40, 'スキンパックの内容を置き換え中...');
            this.addLog('スキンパックの置き換えを開始...');
            
            const replaceSuccess = await window.electronAPI.replaceSkinPack(
                this.selectedTarget.path, 
                this.selectedSource.path
            );
            
            if (!replaceSuccess) {
                throw new Error('スキンパックの置き換えに失敗しました');
            }
            this.addLog('✅ スキンパック置き換え完了');

            // ステップ3: McEncryptor実行
            this.updateProgress(60, 'McEncryptorを実行中...');
            this.addLog('McEncryptorの実行を開始...');
            
            const encryptSuccess = await window.electronAPI.runMcEncryptor(this.selectedTarget.path);
            if (encryptSuccess) {
                this.addLog('✅ McEncryptor実行完了');
            } else {
                this.addLog('⚠️ McEncryptorでエラーが発生しましたが、処理を続行します');
            }

            // ステップ4: 必要に応じて再パック
            if (this.selectedTarget.isTemp && this.selectedTarget.originalMcpackPath) {
                this.updateProgress(80, 'MCPACKファイルを再作成中...');
                this.addLog('MCPACKファイルの再作成を開始...');
                
                const defaultPath = this.selectedTarget.originalMcpackPath.replace(
                    /(\.[^.]+)$/, '_modified$1'
                );
                
                const savePath = await window.electronAPI.saveMcpackAs(defaultPath);
                if (savePath) {
                    const repackSuccess = await window.electronAPI.repackMcpack(
                        this.selectedTarget.path, 
                        savePath
                    );
                    
                    if (repackSuccess) {
                        this.addLog(`✅ MCPACKファイル保存完了: ${savePath}`);
                    } else {
                        throw new Error('MCPACKファイルの再作成に失敗しました');
                    }
                } else {
                    this.addLog('MCPACKファイルの保存がキャンセルされました');
                }
            }

            // ステップ5: クリーンアップ
            this.updateProgress(100, '処理完了');
            this.addLog('一時ファイルをクリーンアップ中...');
            
            for (const tempDir of this.tempDirs) {
                await window.electronAPI.cleanupTempDir(tempDir);
            }
            this.addLog('✅ クリーンアップ完了');

            this.showResult(true, '処理が正常に完了しました！', '🎉');

        } catch (error) {
            this.addLog(`❌ エラー: ${error.message}`);
            this.showResult(false, 'エラーが発生しました', '❌');
            console.error('Process error:', error);
        }
    }

    // 進行状況更新
    updateProgress(percentage, text) {
        document.getElementById('progressFill').style.width = `${percentage}%`;
        document.getElementById('progressText').textContent = text;
    }

    // ログ追加
    addLog(message) {
        const logContainer = document.getElementById('progressLog');
        const timestamp = new Date().toLocaleTimeString();
        logContainer.innerHTML += `<div>[${timestamp}] ${message}</div>`;
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    // 結果表示
    showResult(success, message, icon) {
        document.getElementById('progressSection').style.display = 'none';
        document.getElementById('resultSection').style.display = 'block';
        
        document.getElementById('resultIcon').textContent = icon;
        document.getElementById('resultTitle').textContent = success ? '成功' : 'エラー';
        document.getElementById('resultMessage').textContent = message;
    }

    // ナビゲーション更新
    updateNavigation() {
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        
        // 前へボタン
        if (this.currentStep > 1) {
            prevBtn.style.display = 'inline-flex';
            prevBtn.disabled = false;
        } else {
            prevBtn.style.display = 'none';
        }
        
        // 次へボタン
        if (this.currentStep < 3) {
            const canProceed = this.canProceedToNextStep();
            nextBtn.style.display = 'inline-flex';
            nextBtn.disabled = !canProceed;
            
            // ステップに基づいてボタンテキスト更新
            if (this.currentStep === 2 && canProceed) {
                nextBtn.innerHTML = `実行へ <i class="fas fa-rocket"></i>`;
            } else {
                nextBtn.innerHTML = `次へ <i class="fas fa-arrow-right"></i>`;
            }
        } else {
            nextBtn.style.display = 'none';
        }
    }

    // ステップアクセス可能か
    isStepAccessible(stepNumber) {
        switch (stepNumber) {
            case 1:
                return true; // 常にアクセス可能
            case 2:
                return this.selectedTarget !== null;
            case 3:
                return this.selectedTarget !== null && this.selectedSource !== null;
            default:
                return false;
        }
    }

    // 次のステップに進めるか
    canProceedToNextStep() {
        switch (this.currentStep) {
            case 1:
                return this.selectedTarget !== null;
            case 2:
                return this.selectedSource !== null;
            default:
                return false;
        }
    }

    // 次のステップへ
    nextStep() {
        if (this.canProceedToNextStep() && this.currentStep < 3) {
            this.showStep(this.currentStep + 1);
        }
    }

    // 前のステップへ
    previousStep() {
        if (this.currentStep > 1) {
            this.showStep(this.currentStep - 1);
        }
    }

    // アプリリセット
    resetApp() {
        // 初期状態にリセット
        this.currentStep = 1;
        this.selectedTarget = null;
        this.selectedSource = null;
        this.tempDirs = [];
        
        // 選択をクリア
        document.querySelectorAll('.card').forEach(card => {
            card.classList.remove('selected');
        });
        
        // 表示を非表示に
        this.hideTargetDisplays();
        this.hideSourceDisplays();
        
        // 結果と進行状況セクションを非表示に
        document.getElementById('resultSection').style.display = 'none';
        document.getElementById('progressSection').style.display = 'none';
        
        // 最初のステップを表示
        this.showStep(1);
        this.updateStatus('準備完了', 'ready');
        
        this.announceToScreenReader('アプリケーションがリセットされました');
    }

    // 進行状況表示
    showProgress(message) {
        // モーダルオーバーレイを作成
        const overlay = document.createElement('div');
        overlay.className = 'progress-overlay';
        overlay.setAttribute('aria-label', 'Processing');
        overlay.setAttribute('role', 'progressbar');
        overlay.setAttribute('aria-live', 'polite');
        
        overlay.innerHTML = `
            <div class="progress-modal">
                <div class="spinner"></div>
                <div class="progress-message">${this.escapeHtml(message)}</div>
                <div class="progress-subtitle">しばらくお待ちください...</div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // スクリーンリーダーにアナウンス
        this.announceToScreenReader(message);
    }

    // 進行状況非表示
    hideProgress() {
        // ローディングインジケータを削除
        const overlays = document.querySelectorAll('.progress-overlay');
        overlays.forEach(overlay => {
            overlay.remove();
        });
    }

    // エラー表示
    showError(message, title = 'エラー') {
        this.hideProgress();
        
        alert(`${title}: ${message}`);
        
        // スクリーンリーダーにアナウンス
        this.announceToScreenReader(`エラー: ${message}`);
    }

    // 成功表示
    showSuccess(message, title = '成功') {
        // シンプルに通知
        this.updateStatus(message, 'success');
        
        // スクリーンリーダーにアナウンス
        this.announceToScreenReader(`${title}: ${message}`);
    }

    // 対象表示を非表示に
    hideTargetDisplays() {
        const installedList = document.getElementById('installedPacksList');
        const selectedTarget = document.getElementById('selectedTarget');
        
        if (installedList) installedList.style.display = 'none';
        if (selectedTarget) selectedTarget.style.display = 'none';
    }

    // ソース表示を非表示に
    hideSourceDisplays() {
        const selectedSource = document.getElementById('selectedSource');
        if (selectedSource) selectedSource.style.display = 'none';
    }

    // スクリーンリーダーアナウンス
    announceToScreenReader(message) {
        const announcer = document.getElementById('screenReaderAnnouncer') || this.createScreenReaderAnnouncer();
        announcer.textContent = message;
    }

    // スクリーンリーダーアナウンサー作成
    createScreenReaderAnnouncer() {
        const announcer = document.createElement('div');
        announcer.id = 'screenReaderAnnouncer';
        announcer.setAttribute('aria-live', 'assertive');
        announcer.setAttribute('aria-atomic', 'true');
        announcer.className = 'sr-only';
        document.body.appendChild(announcer);
        return announcer;
    }

    // HTML特殊文字をエスケープ
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// DOMが読み込まれたらアプリを初期化
document.addEventListener('DOMContentLoaded', () => {
    new SkinInjectorApp();
});
