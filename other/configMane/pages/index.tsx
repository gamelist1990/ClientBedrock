import React, { useState, useEffect } from "react";
import Head from "next/head";
import { invoke } from "@tauri-apps/api/core";

interface ModConfig {
  name: string;
  mod_type: string;
  config_path: string;
  has_config: boolean;
  config_files: string[];
  icon_data?: string; // Base64エンコードされた画像データ
  icon_url?: string;  // 元のアイコンURL
}

interface ConfigScanResult {
  success: boolean;
  mods: ModConfig[];
  total_mods: number;
  error?: string;
}

interface BackupResult {
  success: boolean;
  backup_path?: string;
  error?: string;
}

interface ImportResult {
  success: boolean;
  imported_configs: string[];
  error?: string;
}

interface BackupFileInfo {
  filename: string;
  mod_name?: string;
  backup_name?: string;
  version?: string;
}

interface NotificationState {
  show: boolean;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  details?: string[];
}

interface ShareResult {
  success: boolean;
  shared_path?: string;
  error?: string;
}

interface ExternalImportResult {
  success: boolean;
  imported_configs: string[];
  mod_name_mismatch?: boolean;
  original_mod_name?: string;
  target_mod_name?: string;
  preview_files: string[];
  error?: string;
}

interface PreviewResult {
  success: boolean;
  backup_info?: {
    name: string;
    version: string;
    mod_name: string;
    author?: string;
    description?: string;
    created_at?: string;
    shared?: boolean;
  };
  config_files: string[];
  error?: string;
}

interface IconUpdateResult {
  success: boolean;
  icon_data?: string;
  error?: string;
}

interface ModIconConfig {
  mod_name: string;
  icon_url?: string;
  icon_data?: string;
}

const MaterialHomePage: React.FC = () => {
  const [scanResult, setScanResult] = useState<ConfigScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedMod, setSelectedMod] = useState<ModConfig | null>(null);
  const [filterType, setFilterType] = useState("all");
  const [backupName, setBackupName] = useState("");
  const [backupVersion, setBackupVersion] = useState("1.0.0");
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [backupFiles, setBackupFiles] = useState<BackupFileInfo[]>([]);
  const [selectedBackupFile, setSelectedBackupFile] = useState("");
  const [notification, setNotification] = useState<NotificationState>({
    show: false,
    type: 'info',
    title: '',
    message: ''
  });
  const [currentOperation, setCurrentOperation] = useState<string>("");
  const [showResultModal, setShowResultModal] = useState(false);
  const [resultData, setResultData] = useState<{
    type: 'backup' | 'import';
    success: boolean;
    data: BackupResult | ImportResult;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<'scan' | 'backup' | 'import'>('scan');

  // アイコン関連の状態
  const [showIconDialog, setShowIconDialog] = useState(false);
  const [selectedModForIcon, setSelectedModForIcon] = useState<ModConfig | null>(null);
  const [iconUrl, setIconUrl] = useState("");
  const [updatingIcon, setUpdatingIcon] = useState(false);

  // Scan Minecraft Configs
  const scanMinecraftConfigs = async () => {
    setLoading(true);
    setCurrentOperation("MOD configをスキャンしています...");
    try {
      const result: ConfigScanResult = await invoke("scan_minecraft_configs");
      if (result.success) {
        setScanResult(result);
        if (result.mods && result.mods.length > 0) {
          setSelectedMod(result.mods[0]);
        }
        showNotification('success', 'スキャン完了', `${result.total_mods}個のMODが検出されました`);
      } else {
        showNotification('error', 'スキャン失敗', result.error || "スキャンに失敗しました");
      }
    } catch (error) {
      console.error("Minecraft configスキャンに失敗しました:", error);
      showNotification('error', 'システムエラー', "Rustコマンドの実行に失敗しました");
    } finally {
      setLoading(false);
      setCurrentOperation("");
    }
  };

  // Load Backup Files
  const loadBackupFiles = async () => {
    try {
      const files: BackupFileInfo[] = await invoke("list_backup_files");
      setBackupFiles(files);
      console.log("利用可能なバックアップファイル:", files);
    } catch (error) {
      console.error("バックアップファイル一覧の取得に失敗しました:", error);
      showNotification('error', 'エラー', 'バックアップファイル一覧の取得に失敗しました');
    }
  };

  // Show Notification
  const showNotification = (
    type: 'success' | 'error' | 'info' | 'warning',
    title: string,
    message: string,
    details?: string[]
  ) => {
    setNotification({ show: true, type, title, message, details });
  };

  // Show Result Modal
  const showResult = (
    type: 'backup' | 'import',
    success: boolean,
    data: BackupResult | ImportResult
  ) => {
    setResultData({ type, success, data });
    setShowResultModal(true);
  };

  // Handle Backup Config
  const handleBackupConfig = async () => {
    if (!selectedMod || !backupName.trim()) {
      showNotification('warning', '入力不備', 'MODとバックアップ名を選択してください');
      return;
    }

    setLoading(true);
    setCurrentOperation(`${selectedMod.name}のバックアップを作成中...`);
    try {
      const result: BackupResult = await invoke("backup_mod_config", {
        modName: selectedMod.name,
        backupName: backupName.trim(),
        version: backupVersion,
      });

      if (result.success) {
        showNotification('success', 'バックアップ完了', `${selectedMod.name}のバックアップが正常に作成されました`);
        showResult('backup', true, result);
        setShowBackupDialog(false);
        setBackupName("");
        await loadBackupFiles();
      } else {
        showNotification('error', 'バックアップ失敗', result.error || 'バックアップの作成に失敗しました');
        showResult('backup', false, result);
      }
    } catch (error) {
      console.error("バックアップ処理に失敗しました:", error);
      showNotification('error', 'システムエラー', "バックアップの実行に失敗しました");
    } finally {
      setLoading(false);
      setCurrentOperation("");
    }
  };

  // Handle Import Config
  const handleImportConfig = async () => {
    if (!selectedBackupFile || !selectedMod) {
      showNotification('warning', '選択不備', 'インポートするバックアップファイルとMODを選択してください');
      return;
    }

    setLoading(true);
    setCurrentOperation(`${selectedBackupFile}をインポート中...`);
    try {
      const result: ImportResult = await invoke("import_config_backup", {
        backupPath: selectedBackupFile,
        targetModName: selectedMod.name,
      });

      if (result.success) {
        const importCount = result.imported_configs?.length || 0;
        showNotification('success', 'インポート完了', `${importCount}個のconfigファイルが正常にインポートされました`);
        showResult('import', true, result);
        setSelectedBackupFile("");
        await scanMinecraftConfigs();
      } else {
        showNotification('error', 'インポート失敗', result.error || 'configのインポートに失敗しました');
        showResult('import', false, result);
      }
    } catch (error) {
      console.error("インポート処理に失敗しました:", error);
      showNotification('error', 'システムエラー', "インポートの実行に失敗しました");
    } finally {
      setLoading(false);
      setCurrentOperation("");
    }
  };

  // MODアイコンを更新
  const updateModIcon = async (modName: string, iconUrl?: string) => {
    try {
      setUpdatingIcon(true);
      const result = await invoke<IconUpdateResult>("update_mod_icon", {
        modName: modName,
        iconUrl: iconUrl || null,
      });

      if (result.success) {
        // アイコンデータを保存
        if (result.icon_data) {
          await invoke("save_mod_icon", {
            modName: modName,
            iconUrl: iconUrl || null,
            iconData: result.icon_data,
          });
        }
        
        showNotification("success", "アイコン更新完了", `${modName}のアイコンが更新されました`);
          // MODリストを再読み込み
        await scanMinecraftConfigs();
      } else {
        showNotification("error", "アイコン更新失敗", result.error || "不明なエラー");
      }
    } catch (error) {
      showNotification("error", "アイコン更新エラー", `エラー: ${error}`);
    } finally {
      setUpdatingIcon(false);
    }
  };

  // アイコン設定ダイアログを開く
  const openIconDialog = (mod: ModConfig) => {
    setSelectedModForIcon(mod);
    setIconUrl(mod.icon_url || "");
    setShowIconDialog(true);
  };

  // アイコンを保存
  const saveIcon = async () => {
    if (!selectedModForIcon) return;

    await updateModIcon(selectedModForIcon.name, iconUrl || undefined);
    setShowIconDialog(false);
    setSelectedModForIcon(null);
    setIconUrl("");
  };

  // デフォルトアイコンを設定
  const setDefaultIcon = async () => {
    if (!selectedModForIcon) return;

    await updateModIcon(selectedModForIcon.name);
    setShowIconDialog(false);
    setSelectedModForIcon(null);
    setIconUrl("");
  };

  // Filter MODs
  const filteredMods = scanResult
    ? scanResult.mods.filter((mod) => {
        if (filterType === "with_config") return mod.has_config;
        else if (filterType === "without_config") return !mod.has_config;
        else if (filterType === "flarial") return mod.mod_type === "Flarial";
        else if (filterType === "oderso") return mod.mod_type === "OderSo";
        else return true;
      })
    : [];

  // Filter Backup Files for selected MOD
  const compatibleBackupFiles = backupFiles.filter(file => 
    !selectedMod || file.mod_name === selectedMod.name
  );

  // Auto-hide notifications
  useEffect(() => {
    if (notification.show) {
      const timer = setTimeout(() => {
        setNotification(prev => ({ ...prev, show: false }));
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [notification.show]);

  // Load backup files on mount
  useEffect(() => {
    loadBackupFiles();
  }, []);

  const getModTypeIcon = (modType: string) => {
    switch (modType) {
      case 'Flarial': return '🎯';
      case 'OderSo': return '🔧';
      default: return '📦';
    }
  };

  const getModStatusIcon = (hasConfig: boolean) => {
    return hasConfig ? '✅' : '❌';
  };

  return (
    <div className="material-app">
      <Head>
        <title>ConfigManager - Material Design</title>
        <meta name="description" content="Minecraft MOD Config Manager with Material Design" />
      </Head>

      {/* Snackbar Notification */}
      {notification.show && (
        <div className={`snackbar snackbar-${notification.type}`}>
          <div className="snackbar-content">
            <div className="snackbar-icon">
              {notification.type === 'success' && '✅'}
              {notification.type === 'error' && '❌'}
              {notification.type === 'warning' && '⚠️'}
              {notification.type === 'info' && 'ℹ️'}
            </div>
            <div className="snackbar-text">
              <div className="snackbar-title">{notification.title}</div>
              <div className="snackbar-message">{notification.message}</div>
            </div>
            <button
              className="snackbar-close"
              onClick={() => setNotification(prev => ({ ...prev, show: false }))}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div className="loading-backdrop">
          <div className="loading-container">
            <div className="circular-progress"></div>
            <div className="loading-text">{currentOperation}</div>
          </div>
        </div>
      )}

      {/* App Bar */}
      <div className="app-bar material-app-bar">
        <div className="app-bar-content">
          <div className="app-bar-title">
            <span className="app-icon">⚙️</span>
            ConfigManager
          </div>
          <div className="app-bar-subtitle">
            Minecraft MOD Configuration Manager
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="tab-container material-tabs">
        <div className="tab-list">
          <button
            className={`tab material-tab ${activeTab === 'scan' ? 'tab-active material-tab-active' : ''}`}
            onClick={() => setActiveTab('scan')}
          >
            <span className="tab-icon">🔍</span>
            MODスキャン
          </button>
          <button
            className={`tab material-tab ${activeTab === 'backup' ? 'tab-active material-tab-active' : ''}`}
            onClick={() => setActiveTab('backup')}
            disabled={!selectedMod}
          >
            <span className="tab-icon">💾</span>
            バックアップ
          </button>
          <button
            className={`tab material-tab ${activeTab === 'import' ? 'tab-active material-tab-active' : ''}`}
            onClick={() => setActiveTab('import')}
            disabled={!selectedMod}
          >
            <span className="tab-icon">📥</span>
            インポート
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-container material-main-container">
        {/* Scan Tab */}
        {activeTab === 'scan' && (
          <div className="tab-content material-tab-content">            <div className="scan-section-card">
              <div className="scan-section-header">
                <h2 className="scan-section-title">MOD検索とスキャン</h2>
                <p className="scan-section-subtitle">MinecraftにインストールされているMODを検索します</p>
              </div>              <div className="scan-section-actions">
                <button
                  onClick={scanMinecraftConfigs}
                  disabled={loading}
                  className={`btn-base btn-primary btn-lg scan-fab-fixed ${loading ? 'btn-loading' : ''}`}
                >
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 160 }}>
                    <span style={{ width: 20, height: 20, display: 'inline-block', marginRight: 8 }}>
                      {!loading && <span className="button-icon">🔍</span>}
                    </span>
                    <span style={{ minWidth: 120, textAlign: 'left' }}>
                      {loading ? 'スキャン中...' : 'MOD Configスキャン'}
                    </span>
                  </span>
                </button>

                {scanResult && (
                  <div className="scan-stats-grid">
                    <div className="scan-stats-card scan-stats-total">
                      <div className="scan-stats-number">{scanResult.total_mods}</div>
                      <div className="scan-stats-label">検出MOD</div>
                    </div>
                    <div className="scan-stats-card scan-stats-with-config">
                      <div className="scan-stats-number">
                        {scanResult.mods.filter(m => m.has_config).length}
                      </div>
                      <div className="scan-stats-label">Config有り</div>
                    </div>
                    <div className="scan-stats-card scan-stats-without-config">
                      <div className="scan-stats-number">
                        {scanResult.mods.filter(m => !m.has_config).length}
                      </div>
                      <div className="scan-stats-label">Config無し</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {scanResult && (
              <>
                {/* Filter Controls */}
                <div className="card material-card">
                  <div className="card-content material-card-content">
                    <div className="filter-section material-filter-section">
                      <label className="filter-label material-filter-label">フィルター:</label>
                      <div className="chip-group material-chip-group">
                        {[
                          { value: 'all', label: '🗂️ すべて', count: filteredMods.length },
                          { value: 'with_config', label: '⚙️ Config有り', count: scanResult.mods.filter(m => m.has_config).length },
                          { value: 'without_config', label: '❌ Config無し', count: scanResult.mods.filter(m => !m.has_config).length },
                          { value: 'flarial', label: '🎯 Flarial', count: scanResult.mods.filter(m => m.mod_type === 'Flarial').length },
                          { value: 'oderso', label: '🔧 OderSo', count: scanResult.mods.filter(m => m.mod_type === 'OderSo').length }
                        ].map(filter => (                          <button
                            key={filter.value}
                            className={`btn-base btn-sm chip material-chip ${filterType === filter.value ? 'btn-primary chip-selected material-chip-selected' : 'btn-ghost'}`}
                            onClick={() => setFilterType(filter.value)}
                          >
                            {filter.label} ({filter.count})
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* MOD List */}
                <div className="card material-card">
                  <div className="card-header material-card-header">
                    <h3 className="card-title material-card-title">MOD一覧</h3>
                    <p className="card-subtitle material-card-subtitle">{filteredMods.length}個のMODが表示されています</p>
                  </div>
                  <div className="card-content material-card-content">
                    <div className="mod-list material-mod-list">
                      {filteredMods.map((mod, index) => (
                        <div
                          key={index}
                          className={`mod-card material-mod-card ${selectedMod?.name === mod.name ? 'mod-card-selected material-mod-card-selected' : ''}`}
                          onClick={() => setSelectedMod(mod)}
                        >
                          <div className="mod-card-header material-mod-card-header">
                            <div className="mod-card-icon material-mod-card-icon">
                              {mod.icon_data ? (
                                <img 
                                  src={mod.icon_data} 
                                  alt={`${mod.name} アイコン`}
                                  className="mod-icon material-mod-icon"
                                  style={{ width: '32px', height: '32px', borderRadius: '4px' }}
                                />
                              ) : (
                                <div className="default-mod-icon material-default-mod-icon">
                                  {getModTypeIcon(mod.mod_type)}
                                </div>
                              )}
                            </div>
                            <div className="mod-card-info material-mod-card-info">
                              <h4 className="mod-card-title material-mod-card-title">{mod.name}</h4>
                              <p className="mod-card-type material-mod-card-type">{mod.mod_type}</p>
                            </div>                            <div className="mod-card-actions material-mod-card-actions">
                              <button
                                className="btn-base btn-icon btn-ghost material-icon-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openIconDialog(mod);
                                }}
                                title="アイコンを設定"
                              >
                                🎨
                              </button>
                            </div>
                            <div className="mod-card-status material-mod-card-status">
                              <span className={`status-badge material-status-badge ${mod.has_config ? 'status-success material-status-success' : 'status-error material-status-error'}`}>
                                {getModStatusIcon(mod.has_config)}
                                {mod.has_config ? 'Config有り' : 'Config無し'}
                              </span>
                            </div>
                          </div>
                          <div className="mod-card-details material-mod-card-details">
                            <div className="mod-card-path material-mod-card-path">📁 {mod.config_path}</div>
                            {mod.has_config && mod.config_files.length > 0 && (
                              <div className="mod-card-files material-mod-card-files">
                                <span className="files-count material-files-count">📄 {mod.config_files.length}個のファイル</span>
                                <div className="files-preview material-files-preview">
                                  {mod.config_files.slice(0, 3).map((file, idx) => (
                                    <span key={idx} className="file-chip material-file-chip">{file}</span>
                                  ))}
                                  {mod.config_files.length > 3 && (
                                    <span className="file-chip file-chip-more material-file-chip-more">
                                      +{mod.config_files.length - 3}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Backup Tab */}
        {activeTab === 'backup' && selectedMod && (
          <div className="tab-content material-tab-content">
            <div className="card material-card">
              <div className="card-header material-card-header">
                <h2 className="card-title material-card-title">バックアップ作成</h2>
                <p className="card-subtitle material-card-subtitle">選択されたMODの設定をバックアップします</p>
              </div>
              <div className="card-content material-card-content">
                <div className="selected-mod-info material-selected-mod-info">
                  <div className="selected-mod-card material-selected-mod-card">
                    <div className="selected-mod-icon material-selected-mod-icon">{getModTypeIcon(selectedMod.mod_type)}</div>
                    <div className="selected-mod-details material-selected-mod-details">
                      <h3 className="selected-mod-name material-selected-mod-name">{selectedMod.name}</h3>
                      <p className="selected-mod-type material-selected-mod-type">{selectedMod.mod_type}</p>
                      <span className={`status-badge material-status-badge ${selectedMod.has_config ? 'status-success material-status-success' : 'status-error material-status-error'}`}>
                        {getModStatusIcon(selectedMod.has_config)}
                        {selectedMod.has_config ? 'Config利用可能' : 'Config未検出'}
                      </span>
                    </div>
                  </div>
                </div>

                {selectedMod.has_config ? (
                  <div className="backup-form">
                    <div className="form-field">
                      <label className="form-label">バックアップ名 *</label>
                      <input
                        type="text"
                        value={backupName}
                        onChange={(e) => setBackupName(e.target.value)}
                        placeholder="例: MyConfig_v1"
                        className="form-input"
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">バージョン</label>
                      <input
                        type="text"
                        value={backupVersion}
                        onChange={(e) => setBackupVersion(e.target.value)}
                        placeholder="1.0.0"
                        className="form-input"
                      />
                    </div>                    <button
                      onClick={handleBackupConfig}
                      disabled={!backupName.trim() || loading}
                      className={`btn-base btn-primary btn-md btn-with-icon ${loading ? 'btn-loading' : ''}`}
                    >
                      {!loading && <span className="button-icon btn-icon-left">💾</span>}
                      {loading ? 'バックアップ作成中...' : 'バックアップ作成'}
                    </button>
                  </div>
                ) : (
                  <div className="warning-message">
                    <div className="warning-icon">⚠️</div>
                    <div className="warning-text">
                      <h4>Configが見つかりません</h4>
                      <p>このMODにはバックアップ可能な設定ファイルがありません。</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Import Tab */}
        {activeTab === 'import' && selectedMod && (
          <div className="tab-content material-tab-content">
            <div className="card material-card">
              <div className="card-header material-card-header">
                <h2 className="card-title material-card-title">Configインポート</h2>
                <p className="card-subtitle material-card-subtitle">バックアップからMOD設定を復元します</p>
              </div>
              <div className="card-content material-card-content">
                <div className="selected-mod-info material-selected-mod-info">
                  <div className="selected-mod-card material-selected-mod-card">
                    <div className="selected-mod-icon material-selected-mod-icon">{getModTypeIcon(selectedMod.mod_type)}</div>
                    <div className="selected-mod-details material-selected-mod-details">
                      <h3 className="selected-mod-name material-selected-mod-name">{selectedMod.name}</h3>
                      <p className="selected-mod-type material-selected-mod-type">{selectedMod.mod_type}</p>
                    </div>
                  </div>
                </div>

                <div className="import-section">
                  <div className="form-field">
                    <label className="form-label">バックアップファイル</label>
                    <select
                      value={selectedBackupFile}
                      onChange={(e) => setSelectedBackupFile(e.target.value)}
                      className="form-select"
                    >
                      <option value="">バックアップファイルを選択...</option>
                      {compatibleBackupFiles.length === 0 ? (
                        <option disabled>このMODの互換バックアップがありません</option>
                      ) : (
                        compatibleBackupFiles.map((file) => (
                          <option key={file.filename} value={file.filename}>
                            📦 {file.backup_name || file.filename}
                            {file.version && ` v${file.version}`}
                          </option>
                        ))
                      )}
                    </select>
                  </div>                  <button
                    onClick={handleImportConfig}
                    disabled={!selectedBackupFile || loading}
                    className={`btn-base btn-primary btn-md btn-with-icon ${loading ? 'btn-loading' : ''}`}
                  >
                    {!loading && <span className="button-icon btn-icon-left">📥</span>}
                    {loading ? 'インポート中...' : 'インポート実行'}
                  </button>

                  {compatibleBackupFiles.length === 0 && (
                    <div className="info-message">
                      <div className="info-icon">ℹ️</div>
                      <div className="info-text">
                        <h4>互換バックアップがありません</h4>
                        <p>このMOD({selectedMod.name})の互換バックアップファイルが見つかりません。<br/>
                        先にバックアップを作成するか、対応するバックアップファイルを配置してください。</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Result Modal */}
      {showResultModal && resultData && (
        <div className="modal-backdrop material-modal-backdrop">
          <div className="modal-container material-modal-container">
            <div className="modal-header material-modal-header">
              <div className={`modal-icon material-modal-icon ${resultData.success ? 'icon-success material-icon-success' : 'icon-error material-icon-error'}`}>
                {resultData.success ? '✅' : '❌'}
              </div>
              <h3 className="modal-title material-modal-title">
                {resultData.type === 'backup' ? 'バックアップ' : 'インポート'}
                {resultData.success ? '完了' : '失敗'}
              </h3>
              <button
                className="modal-close material-modal-close"
                onClick={() => setShowResultModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-content">
              {resultData.success ? (
                <div className="result-success">
                  {resultData.type === 'backup' ? (
                    <div>
                      <p>🎉 バックアップが正常に作成されました！</p>
                      {(resultData.data as BackupResult).backup_path && (
                        <div className="result-details">
                          <strong>保存場所:</strong>
                          <code>{(resultData.data as BackupResult).backup_path}</code>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <p>🎉 インポートが正常に完了しました！</p>
                      {(resultData.data as ImportResult).imported_configs && (
                        <div className="result-details">
                          <strong>インポートされたファイル ({(resultData.data as ImportResult).imported_configs.length}個):</strong>
                          <ul className="imported-files-list">
                            {(resultData.data as ImportResult).imported_configs.map((file, index) => (
                              <li key={index} className="imported-file-item">
                                📄 {file}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="result-error">
                  <p>❌ 操作に失敗しました</p>
                  <div className="error-details">
                    <strong>エラー詳細:</strong>
                    <code>{resultData.data.error || '不明なエラーが発生しました'}</code>
                  </div>
                </div>
              )}
            </div>            <div className="modal-actions">
              <button
                className="btn-base btn-primary btn-md"
                onClick={() => setShowResultModal(false)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Icon Setting Dialog */}
      {showIconDialog && selectedModForIcon && (
        <div className="modal-overlay material-modal-overlay" onClick={() => setShowIconDialog(false)}>
          <div className="modal-content material-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header material-modal-header">
              <h3 className="modal-title material-modal-title">🎨 MODアイコン設定</h3>
              <button
                className="modal-close material-modal-close"
                onClick={() => setShowIconDialog(false)}
              >
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="icon-preview-section">
                <h4>現在のアイコン</h4>
                <div className="current-icon-display material-current-icon-display">
                  {selectedModForIcon.icon_data ? (
                    <img 
                      src={selectedModForIcon.icon_data} 
                      alt={`${selectedModForIcon.name} アイコン`}
                      className="preview-icon material-preview-icon"
                      style={{ width: '64px', height: '64px', borderRadius: '8px' }}
                    />
                  ) : (
                    <div className="preview-icon-placeholder material-preview-icon-placeholder">
                      <span style={{ fontSize: '32px' }}>
                        {getModTypeIcon(selectedModForIcon.mod_type)}
                      </span>
                    </div>
                  )}
                  <p className="icon-mod-name material-icon-mod-name">{selectedModForIcon.name}</p>
                </div>
              </div>

              <div className="icon-input-section">
                <h4>新しいアイコンURL</h4>
                <input
                  type="url"
                  className="text-input material-text-input"
                  placeholder="https://example.com/icon.png"
                  value={iconUrl}
                  onChange={(e) => setIconUrl(e.target.value)}
                />
                <p className="input-help">
                  PNGまたはJPEG画像のURLを入力してください。32x32pxにリサイズされます。
                </p>
              </div>
            </div>            <div className="modal-actions">
              <button
                className="btn-base btn-secondary btn-md"
                onClick={setDefaultIcon}
                disabled={updatingIcon}
              >
                {updatingIcon ? (
                  <>
                    <div className="button-spinner"></div>
                    処理中...
                  </>
                ) : (
                  'デフォルトアイコン'
                )}
              </button>
              <button
                className="btn-base btn-primary btn-md"
                onClick={saveIcon}
                disabled={updatingIcon || !iconUrl.trim()}
              >
                {updatingIcon ? (
                  <>
                    <div className="button-spinner"></div>
                    更新中...
                  </>
                ) : (
                  'アイコン設定'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MaterialHomePage;
