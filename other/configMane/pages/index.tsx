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


interface IconUpdateResult {
  success: boolean;
  icon_data?: string;
  error?: string;
}

interface SmartImportResult {
  success: boolean;
  detected_mod_type?: string;
  imported_configs: string[];
  target_mod_path?: string;
  error?: string;
}

interface ExportSelectResult {
  success: boolean;
  selected_path?: string;
  error?: string;
}

const MaterialHomePage: React.FC = () => {
  const [resultData, setResultData] = useState<{
    type: "backup" | "import" | "share" | "external";
    success: boolean;
    data: any;
  } | null>(null);
  const [scanResult, setScanResult] = useState<ConfigScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedMod, setSelectedMod] = useState<ModConfig | null>(null);
  const [filterType, setFilterType] = useState("all");
  const [backupName, setBackupName] = useState("");
  const [backupVersion, setBackupVersion] = useState("1.1.0");
  const [, setShowBackupDialog] = useState(false);
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
  const [activeTab, setActiveTab] = useState<'scan' | 'backup' | 'import' | 'share' | 'external'>('scan');
  // アイコン関連の状態
  const [showIconDialog, setShowIconDialog] = useState(false);
  const [selectedModForIcon, setSelectedModForIcon] = useState<ModConfig | null>(null);
  const [iconUrl, setIconUrl] = useState("");
  const [updatingIcon, setUpdatingIcon] = useState(false);

  // シェア機能の状態
  const [sharing, setSharing] = useState(false);

  // 外部パックインポート機能の状態
  const [importing, setImporting] = useState(false);
  const [externalImporting, setExternalImporting] = useState(false);

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
    type: 'backup' | 'import' | 'share' | 'external',
    success: boolean,
    data: BackupResult | ImportResult | ShareResult | ExternalImportResult | { error?: string }
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

  // シェア機能: MOD設定をエクスポート
  const handleShare = async () => {
    const shareFileName = "test.pexPack";
    setSharing(true);
    setCurrentOperation(`${selectedMod?.name}の設定をエクスポート中...`);
    try {
      const targetPath =
        "C:/Users/PC_User/Desktop/GItMatrix/ClientBedrock/other/configMane/src-tauri/target/debug/test.pexPack";
      const result: any = await invoke("share_config_backup", {
        backupFilename: shareFileName,
        targetPath: targetPath,
      });
      if (result.success && result.shared_path) {
        showResult("share", true, result);
      } else {
        showResult("share", false, result);
      }
    } catch (error) {
      showResult("share", false, { error: error?.toString?.() || "シェア失敗" });
    } finally {
      setSharing(false);
      setCurrentOperation("");
    }
  };
  // 外部パックインポート機能
  const handleExternalImport = async () => {
    if (!selectedMod) {
      showNotification('warning', '選択不備', 'インポート先のMODを選択してください');
      return;
    }

    setExternalImporting(true);
    setCurrentOperation("外部パックファイルを選択中...");
    
    try {
      // ファイル選択ダイアログを開く
      const fileSelectResult: any = await invoke("select_external_pack_file");
      
      if (!fileSelectResult.success || !fileSelectResult.file_path) {
        showNotification('info', 'キャンセル', 'ファイルが選択されませんでした');
        return;
      }

      setCurrentOperation("外部パックをインポート中...");
      
      // 選択されたファイルをインポート
      const result: any = await invoke("import_external_backup", {
        filePath: fileSelectResult.file_path,
        targetModName: selectedMod.name,
        forceImport: true,
      });
      
      if (result.success) {
        showResult("external", true, result);
        // MODリストを再読み込み
        await scanMinecraftConfigs();
      } else {
        showResult("external", false, result);
      }
    } catch (error) {
      showResult("external", false, { error: error?.toString?.() || "外部パックインポート失敗" });
    } finally {
      setExternalImporting(false);
      setCurrentOperation("");
    }
  };

  // スマートインポート機能：パックタイプを自動検知してMODにインポート
  const handleSmartImport = async () => {
    setExternalImporting(true);
    setCurrentOperation("外部パックファイルを選択中...");
    
    try {
      // ファイル選択ダイアログを開く
      const fileSelectResult: any = await invoke("select_external_pack_file");
      
      if (!fileSelectResult.success || !fileSelectResult.file_path) {
        showNotification('info', 'キャンセル', 'ファイルが選択されませんでした');
        return;
      }

      setCurrentOperation("パックタイプを検知してインポート中...");
      
      // スマートインポートを実行
      const result: SmartImportResult = await invoke("smart_import_pack", {
        filePath: fileSelectResult.file_path,
      });
        if (result.success) {
        // 成功メッセージを含む結果オブジェクトを作成
        const resultWithMessage = {
          ...result,
          success_message: `${result.detected_mod_type}として自動検知し、${result.imported_configs.length}個の設定ファイルをインポートしました`
        };
        showResult("external", true, resultWithMessage);
        // MODリストを再読み込み
        await scanMinecraftConfigs();
      } else {
        showResult("external", false, result);
      }
    } catch (error) {
      showResult("external", false, { error: error?.toString?.() || "スマートインポート失敗" });
    } finally {
      setExternalImporting(false);
      setCurrentOperation("");
    }
  };

  // カスタムエクスポート機能：ユーザー指定の場所にpexPackを出力
  const handleCustomExport = async () => {
    if (!selectedMod) {
      showNotification('warning', '選択不備', 'エクスポートするMODを選択してください');
      return;
    }

    if (!selectedMod.has_config) {
      showNotification('warning', '設定なし', 'このMODにはエクスポート可能な設定がありません');
      return;
    }

    setSharing(true);
    setCurrentOperation("エクスポート場所を選択中...");
    
    try {
      // ファイル保存ダイアログを開く
      const exportSelectResult: ExportSelectResult = await invoke("select_export_location", {
        defaultFilename: `${selectedMod.name}_config_${new Date().toISOString().split('T')[0]}.pexPack`
      });
      
      if (!exportSelectResult.success || !exportSelectResult.selected_path) {
        showNotification('info', 'キャンセル', 'エクスポート場所が選択されませんでした');
        return;
      }

      setCurrentOperation(`${selectedMod.name}の設定をエクスポート中...`);
      
      // カスタムエクスポートを実行
      const result: BackupResult = await invoke("export_config_to_custom_location", {
        modName: selectedMod.name,
        backupName: `${selectedMod.name}_shared`,
        version: "1.1.0",
        author: "User",
        description: `${selectedMod.name}の設定エクスポート`,
        exportPath: exportSelectResult.selected_path,
      });
        if (result.success) {
        const resultWithMessage = {
          ...result,
          success_message: `設定が正常にエクスポートされました`,
          export_path: exportSelectResult.selected_path
        };
        showResult("share", true, resultWithMessage);
      } else {
        showResult("share", false, result);
      }
    } catch (error) {
      showResult("share", false, { error: error?.toString?.() || "カスタムエクスポート失敗" });
    } finally {
      setSharing(false);
      setCurrentOperation("");
    }
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
      </div>      {/* Navigation Tabs */}
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
          <button
            className={`tab material-tab ${activeTab === 'share' ? 'tab-active material-tab-active' : ''}`}
            onClick={() => setActiveTab('share')}
            disabled={!selectedMod}
          >
            <span className="tab-icon">📤</span>
            シェア
          </button>
          <button
            className={`tab material-tab ${activeTab === 'external' ? 'tab-active material-tab-active' : ''}`}
            onClick={() => setActiveTab('external')}
          >
            <span className="tab-icon">📦</span>
            外部パック
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-container material-main-container">        {/* Scan Tab */}
        {activeTab === 'scan' && (
          <div className="tab-content material-tab-content">
            <div className="scan-section-card">
              <div className="scan-section-header">
                <h2 className="scan-section-title">🔍 MOD検索とスキャン</h2>
                <p className="scan-section-subtitle">MinecraftにインストールされているMODを検索します</p>
              </div>
              <div className="scan-section-actions">
                <button
                  onClick={scanMinecraftConfigs}
                  disabled={loading}
                  className={`scan-fab-button ${loading ? 'btn-loading' : ''}`}
                >
                  {!loading && <span className="button-icon">🔍</span>}
                  {loading ? 'スキャン中...' : 'MOD Configスキャン'}
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
            </div>            {scanResult && (
              <>
                {/* Quick Filter Bar for Easy Access */}
                <div className="material-quick-filter-bar">
                  <div className="material-quick-filter-title">クイックフィルター</div>
                  <div className="material-quick-filter-buttons">
                    <button
                      className={`material-quick-filter-button ${filterType === 'all' ? 'active' : ''}`}
                      onClick={() => setFilterType('all')}
                    >
                      📁 すべて ({scanResult.total_mods})
                    </button>
                    <button
                      className={`material-quick-filter-button ${filterType === 'with_config' ? 'active' : ''}`}
                      onClick={() => setFilterType('with_config')}
                    >
                      🟢 Config有り ({scanResult.mods.filter(m => m.has_config).length})
                    </button>
                    <button
                      className={`material-quick-filter-button ${filterType === 'without_config' ? 'active' : ''}`}
                      onClick={() => setFilterType('without_config')}
                    >
                      🔴 Config無し ({scanResult.mods.filter(m => !m.has_config).length})
                    </button>
                    <button
                      className={`material-quick-filter-button ${filterType === 'flarial' ? 'active' : ''}`}
                      onClick={() => setFilterType('flarial')}
                    >
                      🎯 Flarial ({scanResult.mods.filter(m => m.mod_type === 'Flarial').length})
                    </button>
                    <button
                      className={`material-quick-filter-button ${filterType === 'oderso' ? 'active' : ''}`}
                      onClick={() => setFilterType('oderso')}
                    >
                      ⚙️ OderSo ({scanResult.mods.filter(m => m.mod_type === 'OderSo').length})
                    </button>
                  </div>
                </div>{/* MOD List */}
                <div className="material-card">
                  <div className="material-card-header">
                    <h3 className="material-card-title">📋 MOD一覧</h3>
                    <p className="material-card-subtitle">{filteredMods.length}個のMODが表示されています</p>
                  </div>
                  <div className="material-card-content">
                    <div className="material-mod-list">
                      {filteredMods.map((mod, index) => (
                        <div
                          key={index}
                          className={`material-mod-card ${selectedMod?.name === mod.name ? 'material-mod-card-selected' : ''}`}
                          onClick={() => setSelectedMod(mod)}
                        >
                          <div className="material-mod-card-header">
                            <div className="material-mod-card-icon">
                              {mod.icon_data ? (
                                <img 
                                  src={mod.icon_data} 
                                  alt={`${mod.name} アイコン`}
                                  className="material-mod-icon"
                                />
                              ) : (
                                <div className="material-default-mod-icon">
                                  {getModTypeIcon(mod.mod_type)}
                                </div>
                              )}
                            </div>
                            <div className="material-mod-card-info">
                              <h4 className="material-mod-card-title">{mod.name}</h4>
                              <p className="material-mod-card-type">{mod.mod_type}</p>
                            </div>
                            <div className="material-mod-card-actions">
                              <button
                                className="material-icon-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openIconDialog(mod);
                                }}
                                title="アイコンを設定"
                              >
                                🎨
                              </button>
                            </div>                            <div className="material-mod-card-status">
                              <span className={`material-status-badge ${mod.has_config ? 'material-status-available' : 'material-status-unavailable'}`}>
                                <span className="status-indicator">{mod.has_config ? '🟢' : '🔴'}</span>
                                <span className="status-text">{mod.has_config ? 'Config利用可能' : 'Config無し'}</span>
                              </span>
                            </div>
                          </div>
                          <div className="material-mod-card-details">
                            <div className="material-mod-card-path">📁 {mod.config_path}</div>
                            {mod.has_config && mod.config_files.length > 0 && (
                              <div className="material-mod-card-files">
                                <span className="material-files-count">📄 {mod.config_files.length}個のファイル</span>
                                <div className="material-files-preview">
                                  {mod.config_files.slice(0, 3).map((file, idx) => (
                                    <span key={idx} className="material-file-chip">{file}</span>
                                  ))}
                                  {mod.config_files.length > 3 && (
                                    <span className="material-file-chip material-file-chip-more">
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
        )}        {/* Backup Tab */}
        {activeTab === 'backup' && selectedMod && (
          <div className="tab-content material-tab-content">
            <div className="material-card">
              <div className="material-card-header">
                <h2 className="material-card-title">💾 バックアップ作成</h2>
                <p className="material-card-subtitle">選択されたMODの設定をバックアップします</p>
              </div>
              <div className="material-card-content">
                <div className="material-selected-mod-info">
                  <div className="material-selected-mod-card">
                    <div className="material-selected-mod-icon">
                      {selectedMod.icon_data ? (
                        <img 
                          src={selectedMod.icon_data} 
                          alt={`${selectedMod.name} アイコン`}
                          className="material-mod-icon"
                        />
                      ) : (
                        <div className="material-default-mod-icon">
                          {getModTypeIcon(selectedMod.mod_type)}
                        </div>
                      )}
                    </div>
                    <div className="material-selected-mod-details">
                      <h3 className="material-selected-mod-name">{selectedMod.name}</h3>
                      <p className="material-selected-mod-type">{selectedMod.mod_type}</p>
                      {selectedMod.config_files && selectedMod.config_files.length > 0 && (
                        <p className="material-config-file-count">
                          📁 {selectedMod.config_files.length}個の設定ファイル
                        </p>
                      )}
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
                        placeholder="1.1.0"
                        className="form-input"
                      />
                    </div>
                    <button
                      onClick={handleBackupConfig}
                      disabled={!backupName.trim() || loading}
                      className={`btn-base btn-primary btn-md btn-with-icon ${loading ? 'btn-loading' : ''}`}
                    >
                      {!loading && <span className="btn-icon-left">💾</span>}
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
        )}        {/* Import Tab */}
        {activeTab === 'import' && selectedMod && (
          <div className="tab-content material-tab-content">
            <div className="material-card">
              <div className="material-card-header">
                <h2 className="material-card-title">📥 Configインポート</h2>
                <p className="material-card-subtitle">バックアップからMOD設定を復元します</p>
              </div>
              <div className="material-card-content">
                <div className="material-selected-mod-info">
                  <div className="material-selected-mod-card">
                    <div className="material-selected-mod-icon">
                      {selectedMod.icon_data ? (
                        <img 
                          src={selectedMod.icon_data} 
                          alt={`${selectedMod.name} アイコン`}
                          className="material-mod-icon"
                        />
                      ) : (
                        <div className="material-default-mod-icon">
                          {getModTypeIcon(selectedMod.mod_type)}
                        </div>
                      )}
                    </div>
                    <div className="material-selected-mod-details">
                      <h3 className="material-selected-mod-name">{selectedMod.name}</h3>
                      <p className="material-selected-mod-type">{selectedMod.mod_type}</p>
                      {selectedMod.config_files && selectedMod.config_files.length > 0 && (
                        <p className="material-config-file-count">
                          📁 {selectedMod.config_files.length}個の設定ファイル
                        </p>
                      )}
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
                  </div>
                  <button
                    onClick={handleImportConfig}
                    disabled={!selectedBackupFile || loading}
                    className={`btn-base btn-primary btn-md btn-with-icon ${loading ? 'btn-loading' : ''}`}
                  >
                    {!loading && <span className="btn-icon-left">📥</span>}
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
        )}        {/* Share Tab */}
        {activeTab === 'share' && selectedMod && (
          <div className="tab-content material-tab-content">
            <div className="material-card">
              <div className="material-card-header">
                <h2 className="material-card-title">
                  📤 MOD設定をシェア
                </h2>
                <p className="material-card-subtitle">
                  現在のMOD設定をエクスポートして他のユーザーと共有できるファイルを作成します
                </p>
              </div>
              <div className="material-card-content">                <div className="material-selected-mod-info">
                  <div className="material-selected-mod-card">
                    <div className="material-selected-mod-icon">
                      {selectedMod.icon_data ? (
                        <img 
                          src={selectedMod.icon_data} 
                          alt={`${selectedMod.name} アイコン`}
                          className="material-mod-icon"
                        />
                      ) : (
                        <div className="material-default-mod-icon">
                          {getModTypeIcon(selectedMod.mod_type)}
                        </div>
                      )}
                    </div>
                    <div className="material-selected-mod-details">
                      <h3 className="material-selected-mod-name">{selectedMod.name}</h3>
                      <p className="material-selected-mod-type">{selectedMod.mod_type}</p>
                      {selectedMod.config_files && selectedMod.config_files.length > 0 && (
                        <p className="material-config-file-count">
                          📁 {selectedMod.config_files.length}個の設定ファイル
                        </p>
                      )}
                    </div>
                  </div>
                </div>{selectedMod.has_config ? (
                  <div className="material-share-section">
                    <div className="material-info-grid">
                      <div className="material-info-card">
                        <div className="material-info-card-header">
                          <span className="material-info-card-icon">📊</span>
                          <h4 className="material-info-card-title">エクスポート内容</h4>
                        </div>
                        <div className="material-info-card-content">
                          <div className="material-info-item">
                            <span className="material-info-label">設定ファイル数:</span>
                            <span className="material-info-value">{selectedMod.config_files?.length || 0}個</span>
                          </div>
                          <div className="material-info-item">
                            <span className="material-info-label">MODタイプ:</span>
                            <span className="material-info-value">{selectedMod.mod_type}</span>
                          </div>
                          <div className="material-info-item">
                            <span className="material-info-label">出力形式:</span>
                            <span className="material-info-value">ZIP アーカイブ</span>
                          </div>
                        </div>
                      </div>

                      <div className="material-info-card">
                        <div className="material-info-card-header">
                          <span className="material-info-card-icon">📋</span>
                          <h4 className="material-info-card-title">含まれるファイル</h4>
                        </div>
                        <div className="material-info-card-content">
                          <div className="material-config-files-preview">
                            {selectedMod.config_files.slice(0, 5).map((file, idx) => (
                              <div key={idx} className="material-config-file-item">
                                <span className="material-file-icon">📄</span>
                                <span className="material-file-name">{file}</span>
                              </div>
                            ))}
                            {selectedMod.config_files.length > 5 && (
                              <div className="material-config-file-item material-more-files">
                                <span className="material-file-icon">📂</span>
                                <span className="material-file-name">
                                  +{selectedMod.config_files.length - 5}個のファイル
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>                    <div className="material-share-actions">
                      <div className="material-export-button-grid">
                        <button
                          onClick={handleShare}
                          disabled={sharing}
                          className={`btn-base btn-secondary btn-lg btn-with-icon ${sharing ? 'btn-loading' : ''}`}
                        >
                          {sharing ? (
                            <>
                              <span className="btn-loading-spinner"></span>
                              <span>エクスポート中...</span>
                            </>
                          ) : (
                            <>
                              <span className="btn-icon-left">🏠</span>
                              <span>アプリフォルダにエクスポート</span>
                            </>
                          )}
                        </button>

                        <button
                          onClick={handleCustomExport}
                          disabled={sharing}
                          className={`btn-base btn-primary btn-lg btn-with-icon ${sharing ? 'btn-loading' : ''}`}
                        >
                          {sharing ? (
                            <>
                              <span className="btn-loading-spinner"></span>
                              <span>エクスポート中...</span>
                            </>
                          ) : (
                            <>
                              <span className="btn-icon-left">📁</span>
                              <span>保存場所を選択してエクスポート</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="warning-message">
                    <div className="warning-icon">⚠️</div>
                    <div className="warning-text">
                      <h4>Configが見つかりません</h4>
                      <p>このMODにはエクスポート可能な設定ファイルがありません。</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}        {/* External Pack Import Tab */}
        {activeTab === 'external' && (
          <div className="tab-content material-tab-content">
            <div className="material-card">
              <div className="material-card-header">
                <h2 className="material-card-title">
                  📦 外部パックインポート
                </h2>
                <p className="material-card-subtitle">
                  外部ソースからMOD設定パックをインポートします
                </p>
              </div>              <div className="material-card-content">
                {selectedMod && (
                  <div className="material-selected-mod-info">
                    <div className="material-selected-mod-card">
                      <div className="material-selected-mod-icon">
                        {selectedMod.icon_data ? (
                          <img 
                            src={selectedMod.icon_data} 
                            alt={`${selectedMod.name} アイコン`}
                            className="material-mod-icon"
                          />
                        ) : (
                          <div className="material-default-mod-icon">
                            {getModTypeIcon(selectedMod.mod_type)}
                          </div>
                        )}
                      </div>
                      <div className="material-selected-mod-details">
                        <h3 className="material-selected-mod-name">{selectedMod.name}</h3>
                        <p className="material-selected-mod-type">
                          📌 インポート先: {selectedMod.mod_type}
                        </p>
                        <p className="material-config-file-count">
                          📁 現在: {selectedMod.config_files?.length || 0}個の設定ファイル
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="material-external-import-section">
                  <div className="material-info-grid">
                    <div className="material-info-card">
                      <div className="material-info-card-header">
                        <span className="material-info-card-icon">📥</span>
                        <h4 className="material-info-card-title">サポート形式</h4>
                      </div>
                      <div className="material-info-card-content">
                        <div className="material-supported-formats">
                          <div className="material-format-item">
                            <span className="material-format-icon">📄</span>
                            <span className="material-format-name">ZIP アーカイブ</span>
                          </div>
                          <div className="material-format-item">
                            <span className="material-format-icon">📂</span>
                            <span className="material-format-name">フォルダ形式</span>
                          </div>
                          <div className="material-format-item">
                            <span className="material-format-icon">⚙️</span>
                            <span className="material-format-name">ConfigManager形式</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="material-info-card">
                      <div className="material-info-card-header">
                        <span className="material-info-card-icon">🔄</span>
                        <h4 className="material-info-card-title">インポート処理</h4>
                      </div>
                      <div className="material-info-card-content">
                        <div className="material-process-steps">
                          <div className="material-step-item">
                            <span className="material-step-number">1</span>
                            <span className="material-step-text">パック選択</span>
                          </div>
                          <div className="material-step-item">
                            <span className="material-step-number">2</span>
                            <span className="material-step-text">内容検証</span>
                          </div>
                          <div className="material-step-item">
                            <span className="material-step-number">3</span>
                            <span className="material-step-text">設定適用</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>                  <div className="material-external-import-actions">
                    <div className="material-import-button-grid">
                      <button
                        onClick={handleExternalImport}
                        disabled={externalImporting || !selectedMod}
                        className={`material-external-import-button ${externalImporting ? 'btn-loading' : ''} ${!selectedMod ? 'btn-disabled' : ''}`}
                      >
                        {externalImporting ? (
                          <>
                            <span className="btn-loading-spinner"></span>
                            <span>インポート中...</span>
                          </>
                        ) : (
                          <>
                            <span className="btn-icon-left">📁</span>
                            <span>手動インポート（MOD指定）</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={handleSmartImport}
                        disabled={externalImporting}
                        className={`material-smart-import-button ${externalImporting ? 'btn-loading' : ''}`}
                      >
                        {externalImporting ? (
                          <>
                            <span className="btn-loading-spinner"></span>
                            <span>検知中...</span>
                          </>
                        ) : (
                          <>
                            <span className="btn-icon-left">🧠</span>
                            <span>スマートインポート（自動検知）</span>
                          </>
                        )}
                      </button>                    </div>
                    
                    <div className="material-import-methods-info">
                      <div className="material-method-card">
                        <div className="material-method-header">
                          <span className="material-method-icon">📁</span>
                          <h4>手動インポート</h4>
                        </div>
                        <p>選択したMODに設定をインポートします。MODタイプが異なる場合でも強制的にインポートできます。</p>
                      </div>
                      
                      <div className="material-method-card">
                        <div className="material-method-header">
                          <span className="material-method-icon">🧠</span>
                          <h4>スマートインポート</h4>
                        </div>
                        <p>pexPackの内容を自動的に分析してMODタイプを検知し、適切なMODフォルダにインポートします。</p>
                      </div>
                    </div>
                    
                    {!selectedMod && (
                      <div className="material-import-warning">
                        <span className="warning-icon">⚠️</span>
                        <span className="warning-text">
                          MODスキャンタブでインポート先のMODを選択してください
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="material-hint-section">
                    <div className="material-hint-title">
                      💡 ヒント
                    </div>
                    <div className="material-hint-content">
                      pexPack形式のファイルを選択すると、自動的に選択されたMODに設定が適用されます。
                      ファイルダイアログでは .pexPack 拡張子のファイルのみが表示されます。
                    </div>
                  </div>

                  <div className="material-warning-section">
                    <div className="material-warning-title">
                      ⚠️ 注意
                    </div>
                    <div className="material-warning-content">
                      インポート前に重要な設定のバックアップを作成することをお勧めします。
                      外部パックのインポートは既存の設定を上書きする可能性があります。
                    </div>
                  </div>
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
              <div
                className={`modal-icon material-modal-icon ${resultData.success ? "icon-success material-icon-success" : "icon-error material-icon-error"}`}
              >
                {resultData.success ? "✅" : "❌"}
              </div>
              <h3 className="modal-title material-modal-title">
                {resultData.type === "backup"
                  ? "バックアップ"
                  : resultData.type === "share"
                  ? "シェア"
                  : resultData.type === "external"
                  ? "外部パック"
                  : "インポート"}
                {resultData.success ? "完了" : "失敗"}
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
                  {resultData.type === "backup" && resultData.data.backup_path && (
                    <div>
                      <p>🎉 バックアップが正常に作成されました！</p>
                      <div className="result-details">
                        <strong>保存場所:</strong>
                        <code>{resultData.data.backup_path}</code>
                      </div>
                    </div>
                  )}
                  {resultData.type === "share" && resultData.data.shared_path && (
                    <div>
                      <p>🎉 シェアが正常に完了しました！</p>
                      <div className="result-details">
                        <strong>保存場所:</strong>
                        <code>{resultData.data.shared_path}</code>
                      </div>
                    </div>
                  )}                  {resultData.type === "external" && resultData.data.imported_configs && (
                    <div>
                      <p>🎉 外部パックのインポートが正常に完了しました！</p>
                      <div className="result-details">
                        <strong>インポートされたファイル ({resultData.data.imported_configs.length}個):</strong>
                        <ul className="imported-files-list">
                          {resultData.data.imported_configs.slice(0, 5).map((file: string, index: number) => (
                            <li key={index} className="imported-file-item">
                              📄 {file}
                            </li>
                          ))}
                          {resultData.data.imported_configs.length > 5 && (
                            <li className="imported-file-item more-files">
                              ... その他 {resultData.data.imported_configs.length - 5}個のファイル
                            </li>
                          )}
                        </ul>
                        {resultData.data.preview_files && resultData.data.preview_files.length > 0 && (
                          <div className="preview-info">
                            <strong>プレビューファイル (最大5個表示):</strong>
                            <ul className="preview-files-list">
                              {resultData.data.preview_files.map((file: string, index: number) => (
                                <li key={index} className="preview-file-item">
                                  👁️ {file}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {resultData.type === "import" && resultData.data.imported_configs && (
                    <div>
                      <p>🎉 インポートが正常に完了しました！</p>
                      <div className="result-details">
                        <strong>インポートされたファイル ({resultData.data.imported_configs.length}個):</strong>
                        <ul className="imported-files-list">
                          {resultData.data.imported_configs.map((file: string, index: number) => (
                            <li key={index} className="imported-file-item">
                              📄 {file}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="result-error">
                  <p>❌ 操作に失敗しました</p>
                  <div className="error-details">
                    <strong>エラー詳細:</strong>
                    <code>{resultData.data.error || "不明なエラーが発生しました"}</code>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="btn-base btn-primary btn-md"
                onClick={() => setShowResultModal(false)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}      {/* Enhanced Icon Setting Modal */}
      {showIconDialog && selectedModForIcon && (
        <div className="material-modal-overlay" onClick={() => setShowIconDialog(false)}>
          <div className="material-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="material-modal-header">
              <h3 className="material-modal-title">
                🎨 MODアイコン設定
              </h3>
              <button
                className="material-modal-close"
                onClick={() => setShowIconDialog(false)}
                title="閉じる"
              >
                ×
              </button>
            </div>

            <div className="material-modal-body">
              <div className="material-icon-preview-section">
                <h4 className="material-section-title">📱 現在のアイコン</h4>
                <div className="material-current-icon-display">
                  {selectedModForIcon.icon_data ? (
                    <img 
                      src={selectedModForIcon.icon_data} 
                      alt={`${selectedModForIcon.name} アイコン`}
                      className="material-preview-icon"
                    />
                  ) : (
                    <div className="material-preview-icon-placeholder">
                      <span style={{ fontSize: '40px' }}>
                        {getModTypeIcon(selectedModForIcon.mod_type)}
                      </span>
                    </div>
                  )}
                  <p className="material-icon-mod-name">{selectedModForIcon.name}</p>
                  <small style={{ color: '#6c757d', fontSize: '12px' }}>
                    {selectedModForIcon.mod_type} MOD
                  </small>
                </div>
              </div>

              <div className="material-icon-input-section">
                <h4 className="material-section-title">🔗 新しいアイコンURL</h4>
                <input
                  type="url"
                  className="material-text-input"
                  placeholder="https://example.com/icon.png"
                  value={iconUrl}
                  onChange={(e) => setIconUrl(e.target.value)}
                />
                <p className="material-input-help">
                  💡 PNG、JPEG、GIF形式の画像URLを入力してください。推奨サイズ: 64x64px以上
                </p>
                
                {/* URL Preview */}
                {iconUrl && (
                  <div style={{ 
                    marginTop: '12px', 
                    padding: '12px', 
                    background: '#f8f9fa', 
                    borderRadius: '8px',
                    border: '1px solid #e9ecef'
                  }}>
                    <p style={{ 
                      margin: '0 0 8px 0', 
                      fontSize: '12px', 
                      fontWeight: '600', 
                      color: '#495057' 
                    }}>
                      🔍 プレビュー:
                    </p>
                    <img 
                      src={iconUrl}
                      alt="プレビュー"
                      style={{ 
                        width: '48px', 
                        height: '48px', 
                        borderRadius: '8px',
                        objectFit: 'cover',
                        border: '2px solid white',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="material-modal-actions">
              <button
                className="btn-base btn-secondary btn-md"
                onClick={setDefaultIcon}
                disabled={updatingIcon}
                title="デフォルトアイコンに戻す"
              >
                {updatingIcon ? (
                  <>
                    <div className="btn-loading-spinner"></div>
                    処理中...
                  </>
                ) : (
                  <>
                    🔄 デフォルト
                  </>
                )}
              </button>
              <button
                className="btn-base btn-primary btn-md"
                onClick={saveIcon}
                disabled={updatingIcon || !iconUrl.trim()}
                title="新しいアイコンを設定"
              >
                {updatingIcon ? (
                  <>
                    <div className="btn-loading-spinner"></div>
                    更新中...
                  </>
                ) : (
                  <>
                    💾 アイコン設定
                  </>
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
