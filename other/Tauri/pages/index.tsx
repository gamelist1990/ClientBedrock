import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { invoke } from '@tauri-apps/api/core';

interface PeInfo {
  architecture: string;
  subsystem: string;
  timestamp: string;
  has_debug_info: boolean;
}

interface AppInfo {
  name: string;
  path: string;
  size: number;
  file_type: string;
  is_pe_executable: boolean;
  pe_info?: PeInfo;
}

interface PEXToolInfo {
  name: string;
  version: string;
  description: string;
  path: string;
  tool_type: 'electron' | 'inno' | 'unknown';
  has_uninstaller: boolean;
  uninstaller_path?: string;
  apps: AppInfo[];
}

interface ScanResult {
  success: boolean;
  pextool_directories?: string[];
  tools?: PEXToolInfo[];
  total_tools?: number;
  total_apps?: number;
  error?: string;
  details?: string;
}

const HomePage: React.FC = () => {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedTool, setSelectedTool] = useState<PEXToolInfo | null>(null);
  const [filterType, setFilterType] = useState('all');  const [error, setError] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const scanPEXtool = async () => {
    setLoading(true);
    setError('');
    setShowSuccess(false);
    try {
      const result: ScanResult = await invoke('scan_pextool_command');
      
      if (result.success) {
        setScanResult(result);
        if (result.tools && result.tools.length > 0) {
          setSelectedTool(result.tools[0]);
        }
        setShowSuccess(true);
      } else {
        setError(result.error || 'スキャンに失敗しました');
      }
    } catch (error) {
      console.error('PEXtoolスキャンに失敗しました:', error);
      setError('Rustコマンドの実行に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // キーボードナビゲーション機能の追加
  const handleKeyPress = (event: React.KeyboardEvent, action: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  };

  // アクセシビリティ改善：スクリーンリーダー用の説明文
  const getAccessibilityDescription = (app: AppInfo): string => {
    const peInfo = app.pe_info ? 
      `PEX実行ファイル、アーキテクチャ: ${app.pe_info.architecture}, サブシステム: ${app.pe_info.subsystem}` : 
      '通常ファイル';
    return `${app.name}, ${app.file_type}ファイル, サイズ: ${formatFileSize(app.size)}, ${peInfo}`;
  };  const filteredApps = selectedTool ? selectedTool.apps.filter(app => {
    // フィルタリング条件をチェック
    if (filterType === 'pe') return app.is_pe_executable;
    else if (filterType === 'exe') return app.file_type === 'EXE';
    else if (filterType === 'dll') return app.file_type === 'DLL';
    else return true; // 'all'の場合
  }) : [];

  // 成功メッセージの自動非表示
  useEffect(() => {
    if (showSuccess) {
      const timer = setTimeout(() => {
        setShowSuccess(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [showSuccess]);

  return (
    <div className="app-container">
      <Head>
        <title>PEX Tool - アプリケーション解析ツール</title>
        <meta name="description" content="PEX Tool based Application Scanner" />
      </Head>

      <div className="main-content">
        {/* ヘッダー */}
        <div className="glass-card header-section">
          <h1 className="main-title">
            🛠️ PEXtool Application Scanner
          </h1>
          <p className="subtitle">
            PEX実行ファイル解析とアプリケーション一覧表示ツール
          </p>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="glass-card error-card">
            ❌ {error}
          </div>
        )}

        {/* 成功メッセージ表示 */}
        {showSuccess && (
          <div className="glass-card success-card">
            ✅ スキャンが完了しました！
          </div>
        )}

        {/* コントロールパネル */}
        <div className="glass-card control-panel">
          <div className="control-row">
            <button
              onClick={scanPEXtool}
              disabled={loading}
              className={`primary-button ${loading ? 'loading-state' : ''}`}
            >
              {loading ? '🔄 スキャン中...' : '🚀 PEXtool スキャン開始'}
            </button>

            {scanResult && (
              <>                <select
                  value={selectedTool?.name || ''}
                  onChange={(e) => {
                    const tool = scanResult.tools?.find(t => t.name === e.target.value);
                    setSelectedTool(tool || null);
                  }}
                  className="select-input"
                >
                  <option value="">ツールを選択...</option>
                  {scanResult.tools?.map((tool) => (
                    <option key={tool.name} value={tool.name}>
                      {tool.name} ({tool.apps.length} apps)
                    </option>
                  ))}
                </select>

                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="select-input"
                >
                  <option value="all">🗂️ すべて</option>
                  <option value="pe">⚙️ PEX実行ファイル</option>
                  <option value="exe">📋 EXEファイル</option>
                  <option value="dll">📚 DLLファイル</option>
                </select>

                <div className="stats-counter">
                  📊 合計: {filteredApps.length} ファイル
                </div>
              </>
            )}
          </div>

          {/* PEXtool ステータス */}
          {scanResult && (
            <div className="status-section">
              <h3 className="status-title">📋 スキャン結果</h3>              <div className="status-grid">
                <div className="status-item">📁 PEXtoolディレクトリ: {scanResult.pextool_directories?.length || 0}</div>
                <div className="status-item">🛠️ 検出ツール: {scanResult.total_tools || 0}</div>
                <div className="status-item">📱 総アプリ数: {scanResult.total_apps || 0}</div>
              </div></div>
          )}

          {/* プログレスバーの追加 */}
          {loading && (
            <div className="progress-container">
              <div 
                className="progress-bar" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          )}
        </div>

        {/* 選択されたツール情報 */}
        {selectedTool && (
          <div className="glass-card tool-info-section">
            <h2 className="tool-title">
              🔧 {selectedTool.name}
            </h2>
            <div className="tool-details-grid">
              <div className="tool-detail-item">
                <strong>バージョン:</strong> {selectedTool.version}
              </div>              <div className="tool-detail-item">
                <strong>タイプ:</strong> {selectedTool.tool_type.toUpperCase()}
              </div>
              <div className="tool-detail-item">
                <strong>パス:</strong> {selectedTool.path}
              </div>
              <div className={`tool-detail-item ${selectedTool.has_uninstaller ? 'uninstaller-info' : 'uninstaller-info no-uninstaller'}`}>
                <div>
                  <strong>アンインストーラー:</strong> {
                    selectedTool.has_uninstaller 
                      ? '✅ 検出済み' 
                      : '❌ なし'
                  }
                </div>
                {selectedTool.has_uninstaller && selectedTool.uninstaller_path && (
                  <div className="uninstaller-path">
                    📁 {selectedTool.uninstaller_path.split('\\').pop()}
                  </div>
                )}
              </div>
            </div>
            {selectedTool.description && (
              <div className="tool-description">
                <strong>説明:</strong> {selectedTool.description}
              </div>
            )}
          </div>
        )}

        {/* アプリケーション一覧 */}
        <div className="glass-card app-list-section">
          {!scanResult ? (
            <div className={`empty-state ${loading ? 'loading-state' : ''}`}>
              {loading ? '🔍 PEXtoolをスキャンしています...' : '📂 スキャンボタンを押してPEXtoolを検索'}
            </div>
          ) : filteredApps.length === 0 ? (
            <div className="empty-state">
              📂 選択したツールにファイルが見つかりませんでした
            </div>
          ) : (
            <div className="app-grid">
              {filteredApps.map((app, index) => (
                <div
                  key={index}
                  className={`app-item ${app.is_pe_executable ? 'pe-executable' : 'regular-file'}`}
                  tabIndex={0}
                  onKeyPress={(e) => handleKeyPress(e, () => {
                    // アプリケーションアイテムがキーボード操作可能に
                    console.log(`アプリケーション選択: ${app.name}`);
                  })}
                  aria-label={getAccessibilityDescription(app)}
                >
                  <div className="app-header">
                    <h3 className="app-name">
                      {app.is_pe_executable ? '⚙️' : '📄'} {app.name}
                    </h3>
                    <div className={`file-type-badge ${app.is_pe_executable ? 'pe-type' : 'regular-type'}`}>
                      {app.file_type}
                    </div>
                  </div>

                  <div className="app-path">
                    📁 {app.path}
                  </div>                  <div className="app-metadata">
                    <div 
                      className="metadata-item size"
                      data-tooltip={`ファイルサイズ: ${formatFileSize(app.size)}`}
                    >
                      💾 {formatFileSize(app.size)}
                    </div>

                    {app.pe_info && (
                      <>
                        <div 
                          className="metadata-item architecture"
                          data-tooltip={`アーキテクチャ: ${app.pe_info.architecture}`}
                        >
                          🏗️ {app.pe_info.architecture}
                        </div>
                        <div 
                          className="metadata-item subsystem"
                          data-tooltip={`サブシステム: ${app.pe_info.subsystem}`}
                        >
                          🖥️ {app.pe_info.subsystem}
                        </div>
                        {app.pe_info.has_debug_info && (
                          <div 
                            className="debug-badge"
                            data-tooltip="デバッグ情報が含まれています"
                          >
                            🐛 Debug Info
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HomePage;