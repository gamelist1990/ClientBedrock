import React, { useState, useEffect, ReactNode } from 'react';

// アラートのオプション
export interface AlertOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
}

// ダイアログの結果
export interface DialogResult {
  confirmed: boolean;
  value?: string;
}

// プロンプトのオプション
export interface PromptOptions {
  title?: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
}

// モーダルステート
let modalResolve: ((result: DialogResult) => void) | null = null;

// アラート関数
export const alert = async (options: AlertOptions): Promise<DialogResult> => {
  return new Promise((resolve) => {
    modalResolve = resolve;
    const event = new CustomEvent('showAlert', { detail: options });
    window.dispatchEvent(event);
  });
};

// プロンプト関数
export const prompt = async (options: PromptOptions): Promise<DialogResult> => {
  return new Promise((resolve) => {
    modalResolve = resolve;
    const event = new CustomEvent('showPrompt', { detail: options });
    window.dispatchEvent(event);
  });
};

// モーダルコンポーネント
export const ModalContainer: React.FC = () => {
  const [alertData, setAlertData] = useState<AlertOptions | null>(null);
  const [promptData, setPromptData] = useState<PromptOptions | null>(null);
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    const handleAlert = (event: CustomEvent<AlertOptions>) => {
      setAlertData(event.detail);
    };

    const handlePrompt = (event: CustomEvent<PromptOptions>) => {
      setPromptData(event.detail);
      setInputValue(event.detail.defaultValue || '');
    };

    window.addEventListener('showAlert', handleAlert as EventListener);
    window.addEventListener('showPrompt', handlePrompt as EventListener);

    return () => {
      window.removeEventListener('showAlert', handleAlert as EventListener);
      window.removeEventListener('showPrompt', handlePrompt as EventListener);
    };
  }, []);

  const closeModal = (result: DialogResult) => {
    setAlertData(null);
    setPromptData(null);
    if (modalResolve) {
      modalResolve(result);
      modalResolve = null;
    }
  };

  const modalStyle = {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  };

  const contentStyle = {
    backgroundColor: 'white',
    padding: '24px',
    borderRadius: '12px',
    minWidth: '320px',
    maxWidth: '480px',
    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
  };

  const buttonStyle = {
    padding: '8px 16px',
    margin: '0 4px',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
  };

  const primaryButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#3b82f6',
    color: 'white',
  };

  const secondaryButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#e5e7eb',
    color: '#374151',
  };

  if (alertData) {
    return (
      <div style={modalStyle}>
        <div style={contentStyle}>
          {alertData.title && (
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>
              {alertData.title}
            </h3>
          )}
          <p style={{ margin: '0 0 20px 0', lineHeight: '1.5' }}>
            {alertData.message}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {alertData.showCancel && (
              <button
                style={secondaryButtonStyle}
                onClick={() => closeModal({ confirmed: false })}
              >
                {alertData.cancelText || 'キャンセル'}
              </button>
            )}
            <button
              style={primaryButtonStyle}
              onClick={() => closeModal({ confirmed: true })}
            >
              {alertData.confirmText || 'OK'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (promptData) {
    return (
      <div style={modalStyle}>
        <div style={contentStyle}>
          {promptData.title && (
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>
              {promptData.title}
            </h3>
          )}
          <p style={{ margin: '0 0 16px 0', lineHeight: '1.5' }}>
            {promptData.message}
          </p>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={promptData.placeholder}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px',
              marginBottom: '20px',
              boxSizing: 'border-box' as const,
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                closeModal({ confirmed: true, value: inputValue });
              }
              if (e.key === 'Escape') {
                closeModal({ confirmed: false });
              }
            }}
            autoFocus
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              style={secondaryButtonStyle}
              onClick={() => closeModal({ confirmed: false })}
            >
              キャンセル
            </button>
            <button
              style={primaryButtonStyle}
              onClick={() => closeModal({ confirmed: true, value: inputValue })}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

// メインライブラリコンポーネント
export const LibProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <>
      {children}
      <ModalContainer />
    </>
  );
};

// デフォルトエクスポート
export default {
  alert,
  prompt,
  LibProvider,
  ModalContainer,
};
