// PEX Uninstall Tool - Material Design Renderer
document.addEventListener('DOMContentLoaded', async () => {
    // State variables
    let allTools = [];
    let filteredTools = [];
    let currentUninstallTool = null;
    
    // Get DOM elements
    const installedToolsContainer = document.getElementById('installed-tools-container');
    const searchInput = document.getElementById('search-input');    const clearSearchBtn = document.getElementById('clear-search');
    const toolsCount = document.getElementById('tools-count');
    const refreshHeaderBtn = document.getElementById('refresh-header');
    
    // Modal elements
    const modalOverlay = document.getElementById('modal-overlay');
    const modalMessage = document.getElementById('modal-message');
    const modalCancel = document.getElementById('modal-cancel');
    const modalConfirm = document.getElementById('modal-confirm');
    
    // Success modal elements
    const successModalOverlay = document.getElementById('success-modal-overlay');
    const successModalMessage = document.getElementById('success-modal-message');
    const successModalOk = document.getElementById('success-modal-ok');
    
    // Initialize event listeners
    initializeEventListeners();
    
    // Load installed tools
    await loadInstalledTools();
    
    // Initialize event listeners
    function initializeEventListeners() {
        // Search functionality
        searchInput.addEventListener('input', handleSearch);
        clearSearchBtn.addEventListener('click', clearSearch);
          // Refresh buttons
        refreshHeaderBtn.addEventListener('click', handleRefresh);
        
        // Modal events
        modalCancel.addEventListener('click', hideConfirmationModal);
        modalConfirm.addEventListener('click', confirmUninstall);
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) hideConfirmationModal();
        });
        
        // Success modal events
        successModalOk.addEventListener('click', hideSuccessModal);
        successModalOverlay.addEventListener('click', (e) => {
            if (e.target === successModalOverlay) hideSuccessModal();
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideConfirmationModal();
                hideSuccessModal();
            }
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                searchInput.focus();
            }
            if (e.key === 'F5') {
                e.preventDefault();
                handleRefresh();
            }
        });
    }
    
    // Load installed tools
    async function loadInstalledTools() {
        try {
            showLoading();
            const tools = await window.api.getInstalledTools();
            
            allTools = tools.sort((a, b) => {
                const nameA = (a.productName || a.name).toLowerCase();
                const nameB = (b.productName || b.name).toLowerCase();
                return nameA.localeCompare(nameB, 'ja');
            });
            
            filteredTools = [...allTools];
            renderTools();
            updateToolsCount();
            
        } catch (error) {
            console.error('Error loading installed tools:', error);
            showError('ツールの読み込み中にエラーが発生しました。');
        }
    }
    
    // Render tools
    function renderTools() {
        installedToolsContainer.innerHTML = '';
        
        if (filteredTools.length === 0) {
            if (allTools.length === 0) {
                showEmptyState();
            } else {
                showNoSearchResults();
            }
            return;
        }
        
        const toolsList = document.createElement('div');
        toolsList.className = 'tools-list';
        
        filteredTools.forEach((tool, index) => {
            const toolCard = createToolCard(tool, index);
            toolsList.appendChild(toolCard);
        });
        
        installedToolsContainer.appendChild(toolsList);
        
        // Add staggered animation
        const cards = installedToolsContainer.querySelectorAll('.card');
        cards.forEach((card, index) => {
            card.style.animationDelay = `${index * 50}ms`;
            card.classList.add('slide-in');
        });
    }
    
    // Create tool card with Material Design styling
    function createToolCard(tool, index) {
        const toolCard = document.createElement('div');
        toolCard.className = 'card';
        
        const displayName = tool.productName || tool.name;
        const hasDescription = tool.description && tool.description.trim() !== '';
        
        toolCard.innerHTML = `
            <div class="card-header">
                <div class="card-title">${escapeHtml(displayName)}</div>
                <div class="card-subtitle">${escapeHtml(tool.diskUsage)}</div>
            </div>
            <div class="card-body">
                ${hasDescription ? `
                    <div class="tool-description">
                        ${escapeHtml(tool.description)}
                    </div>
                ` : ''}
                <div class="tool-path">
                    <span class="material-icons" style="font-size: 14px; margin-right: 4px; color: var(--on-surface-variant);">folder</span>
                    <span style="font-size: 12px; color: var(--on-surface-variant); word-break: break-all;">
                        ${escapeHtml(tool.path)}
                    </span>
                </div>
                ${tool.productName && tool.productName !== tool.name ? `
                    <div style="font-size: 12px; color: var(--on-surface-variant); margin-top: 4px;">
                        <span class="material-icons" style="font-size: 12px; margin-right: 4px;">info</span>
                        フォルダ名: ${escapeHtml(tool.name)}
                    </div>
                ` : ''}
            </div>
            <div class="card-footer">
                <div class="tool-actions">
                    <button class="btn btn-danger uninstall-btn ripple" data-tool-index="${index}">
                        <span class="material-icons" style="font-size: 18px; margin-right: 8px;">delete</span>
                        アンインストール
                    </button>
                </div>
            </div>
        `;
        
        // Add event listener to uninstall button
        const uninstallBtn = toolCard.querySelector('.uninstall-btn');
        uninstallBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showConfirmationModal(tool);
        });
        
        return toolCard;
    }
    
    // Search functionality
    function handleSearch() {
        const query = searchInput.value.toLowerCase().trim();
        
        if (query === '') {
            clearSearchBtn.style.display = 'none';
            filteredTools = [...allTools];
        } else {
            clearSearchBtn.style.display = 'block';
            filteredTools = allTools.filter(tool => {
                const name = (tool.productName || tool.name).toLowerCase();
                const description = (tool.description || '').toLowerCase();
                const path = tool.path.toLowerCase();
                return name.includes(query) || description.includes(query) || path.includes(query);
            });
        }
        
        renderTools();
        updateToolsCount();
    }
    
    function clearSearch() {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        filteredTools = [...allTools];
        renderTools();
        updateToolsCount();
        searchInput.focus();
    }
    
    // Update tools count
    function updateToolsCount() {
    const count = filteredTools.length;
        toolsCount.textContent = `${count}個のツール`;
    }
    
    // Refresh functionality
    async function handleRefresh() {
        refreshHeaderBtn.classList.add('spinning');
        await loadInstalledTools();
        
        setTimeout(() => {
            refreshHeaderBtn.classList.remove('spinning');
        }, 500);
        
        showNotification('ツール一覧を更新しました', 'success');
    }
    
    // Confirmation modal
    function showConfirmationModal(tool) {
        currentUninstallTool = tool;
        const displayName = tool.productName || tool.name;
        modalMessage.textContent = `「${displayName}」をアンインストールしますか？\n\nこの操作は取り消せません。`;
        modalOverlay.classList.add('show');
        modalConfirm.focus();
    }
    
    function hideConfirmationModal() {
        modalOverlay.classList.remove('show');
        currentUninstallTool = null;
    }
    
    async function confirmUninstall() {
        if (!currentUninstallTool) return;
        
        const tool = currentUninstallTool;
        const displayName = tool.productName || tool.name;
        
        hideConfirmationModal();
        
        try {
            // Show processing notification
            showNotification(`${displayName}のアンインストーラーを起動しています...`, 'info');
            
            const success = await window.api.launchUninstaller(tool.uninstallerPath);
            
            if (success) {
                // Show success modal with auto-confirmation
                showSuccessModal(displayName);
            } else {
                showNotification('アンインストーラーの起動に失敗しました。', 'error');
            }
            
        } catch (error) {
            console.error('Error launching uninstaller:', error);
            showNotification('アンインストーラーの起動中にエラーが発生しました。', 'error');
        }
    }
    
    // Success modal with auto-refresh
    function showSuccessModal(displayName) {
        successModalMessage.textContent = `「${displayName}」のアンインストーラーを起動しました。アンインストールが完了したら、自動的にツール一覧を更新します。`;
        successModalOverlay.classList.add('show');
        successModalOk.focus();
        
        // Auto-refresh after 5 seconds
        let countdown = 5;
        const originalText = successModalOk.textContent;
        
        const countdownInterval = setInterval(() => {
            successModalOk.textContent = `OK (${countdown}秒後に自動更新)`;
            countdown--;
            
            if (countdown < 0) {
                clearInterval(countdownInterval);
                successModalOk.textContent = originalText;
                hideSuccessModal();
                handleRefresh();
            }
        }, 1000);
        
        // Clear countdown if user clicks OK
        successModalOk.addEventListener('click', () => {
            clearInterval(countdownInterval);
            successModalOk.textContent = originalText;
        });
    }
    
    function hideSuccessModal() {
        successModalOverlay.classList.remove('show');
    }
    
    // Loading state
    function showLoading() {
        installedToolsContainer.innerHTML = `
            <div class="material-loading">
                <div class="loading-spinner-container">
                    <div class="material-spinner">
                        <svg class="circular" viewBox="25 25 50 50">
                            <circle class="path" cx="50" cy="50" r="20" fill="none" stroke="#4285f4" stroke-width="2" stroke-miterlimit="10"/>
                        </svg>
                    </div>
                </div>
                <p>PEXツールを検索中...</p>
            </div>
        `;
    }
    
    // Empty state
    function showEmptyState() {
        installedToolsContainer.innerHTML = `
            <div class="empty-state">
                <span class="empty-state-icon material-icons">inventory_2</span>
                <h3>PEXツールが見つかりません</h3>
                <p>C:\\Program Files\\PEXtool フォルダにインストール済みのツールが見つかりませんでした。</p>
            </div>
        `;
    }
    
    // No search results state
    function showNoSearchResults() {
        installedToolsContainer.innerHTML = `
            <div class="empty-state">
                <span class="empty-state-icon material-icons">search_off</span>
                <h3>検索結果が見つかりません</h3>
                <p>「${escapeHtml(searchInput.value)}」に一致するツールが見つかりませんでした。</p>
            </div>
        `;
    }
    
    // Error state
    function showError(message) {
        installedToolsContainer.innerHTML = `
            <div class="empty-state">
                <span class="empty-state-icon material-icons">error</span>
                <h3>エラー</h3>
                <p>${escapeHtml(message)}</p>
            </div>
        `;
    }
    
    // Show notification with Material Design styling
    function showNotification(message, type = 'info') {
        // Remove existing notifications
        const existingNotifications = document.querySelectorAll('.notification');
        existingNotifications.forEach(n => n.remove());
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Auto remove after 4 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }, 4000);
        
        // Click to dismiss
        notification.addEventListener('click', () => {
            notification.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        });
    }
    
    // Helper function to escape HTML
    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
});

// Add CSS animations dynamically
const style = document.createElement('style');
style.textContent = `
    .slide-in {
        animation: slideIn 0.3s ease forwards;
        opacity: 0;
        transform: translateY(20px);
    }
    
    @keyframes slideIn {
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    .tool-path {
        display: flex;
        align-items: center;
        margin-top: 8px;
        padding: 4px 0;
    }
    
    .tool-actions {
        display: flex;
        gap: 8px;
        align-items: center;
    }
`;
document.head.appendChild(style);