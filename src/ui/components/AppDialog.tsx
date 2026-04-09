import React, { useState, useEffect, useRef } from 'react';

const font = "'DM Sans', system-ui, sans-serif";

interface DialogButton {
  label: string;
  action: () => void;
  primary?: boolean;
  danger?: boolean;
}

interface AppDialogProps {
  title: string;
  message: string;
  buttons: DialogButton[];
  input?: {
    placeholder?: string;
    defaultValue?: string;
    onSubmit: (value: string) => void;
  };
  onClose: () => void;
}

export function AppDialog({ title, message, buttons, input, onClose }: AppDialogProps) {
  const [inputValue, setInputValue] = useState(input?.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(input?.defaultValue ?? '');
  }, [input?.defaultValue, input]);

  useEffect(() => {
    if (input && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [input]);

  useEffect(() => {
    overlayRef.current?.focus();
  }, [title, message, input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && input) {
      e.preventDefault();
      input.onSubmit(inputValue);
    }
  };

  return React.createElement('div', {
    ref: overlayRef,
    tabIndex: -1,
    style: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 9999, fontFamily: font,
      outline: 'none',
    },
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
    onKeyDown: handleKeyDown,
  },
    React.createElement('div', {
      style: {
        background: '#12121e', border: '1px solid #252540', borderRadius: 12,
        padding: '20px 24px', minWidth: 340, maxWidth: 480,
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      React.createElement('div', {
        style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600, marginBottom: 8 },
      }, title),

      React.createElement('div', {
        style: { color: '#8888aa', fontSize: 12, lineHeight: 1.6, marginBottom: 16, whiteSpace: 'pre-wrap' as const },
      }, message),

      input && React.createElement('input', {
        ref: inputRef,
        type: 'text',
        value: inputValue,
        placeholder: input.placeholder || '',
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value),
        style: {
          width: '100%', padding: '8px 12px', marginBottom: 16,
          background: '#0a0a14', border: '1px solid #252540', borderRadius: 6,
          color: '#e0e0ec', fontSize: 13, fontFamily: font, outline: 'none',
          boxSizing: 'border-box' as const,
        },
      }),

      React.createElement('div', {
        style: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
      },
        ...buttons.map((btn, i) =>
          React.createElement('button', {
            key: i,
            type: 'button',
            onClick: () => {
              if (input && btn.primary) {
                input.onSubmit(inputValue);
              } else {
                btn.action();
              }
            },
            style: {
              padding: '7px 18px', borderRadius: 6, fontSize: 12, fontWeight: 500,
              fontFamily: font, cursor: 'pointer', border: 'none',
              background: btn.danger ? 'rgba(255,68,102,0.15)' :
                         btn.primary ? 'rgba(45,212,160,0.15)' : 'rgba(255,255,255,0.05)',
              color: btn.danger ? '#ff4466' :
                     btn.primary ? '#2dd4a0' : '#8888aa',
            },
          }, btn.label),
        ),
      ),
    ),
  );
}

export interface DialogState {
  type: 'alert' | 'confirm' | 'prompt';
  title: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  resolve: (value: string | boolean | null | void) => void;
}

export function useAppDialog() {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const showAlert = (title: string, message: string): Promise<void> => {
    return new Promise((resolve) => {
      setDialog({ type: 'alert', title, message, resolve: () => resolve() });
    });
  };

  const showConfirm = (title: string, message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialog({ type: 'confirm', title, message, resolve: (v) => resolve(!!v) });
    });
  };

  const showPrompt = (title: string, message: string, defaultValue?: string, placeholder?: string): Promise<string | null> => {
    return new Promise((resolve) => {
      setDialog({ type: 'prompt', title, message, defaultValue, placeholder, resolve: (v) => resolve(v as string | null) });
    });
  };

  const renderDialog = () => {
    if (!dialog) return null;

    const close = () => {
      if (dialog.type === 'confirm') {
        dialog.resolve(false);
      } else if (dialog.type === 'prompt') {
        dialog.resolve(null);
      } else {
        dialog.resolve();
      }
      setDialog(null);
    };

    if (dialog.type === 'alert') {
      return React.createElement(AppDialog, {
        title: dialog.title,
        message: dialog.message,
        buttons: [{ label: 'OK', action: () => { dialog.resolve(); setDialog(null); }, primary: true }],
        onClose: close,
      });
    }

    if (dialog.type === 'confirm') {
      return React.createElement(AppDialog, {
        title: dialog.title,
        message: dialog.message,
        buttons: [
          { label: 'Cancel', action: close },
          { label: 'Continue', action: () => { dialog.resolve(true); setDialog(null); }, primary: true },
        ],
        onClose: close,
      });
    }

    if (dialog.type === 'prompt') {
      return React.createElement(AppDialog, {
        title: dialog.title,
        message: dialog.message,
        input: {
          defaultValue: dialog.defaultValue,
          placeholder: dialog.placeholder,
          onSubmit: (val) => { dialog.resolve(val); setDialog(null); },
        },
        buttons: [
          { label: 'Cancel', action: close },
          { label: 'OK', action: () => {}, primary: true },
        ],
        onClose: close,
      });
    }

    return null;
  };

  return { showAlert, showConfirm, showPrompt, renderDialog };
}
