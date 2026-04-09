import React, { useEffect, useRef, useState } from 'react';

export interface ModalButton {
  label: string;
  action: () => void;
  color?: string;
  primary?: boolean;
}

interface AppModalProps {
  title: string;
  message: string;
  details?: string;
  buttons: ModalButton[];
  onClose: () => void;
  /** When set, shows a text field (prompt mode). */
  prompt?: {
    defaultValue?: string;
    placeholder?: string;
  };
  onPromptSubmit?: (value: string) => void;
}

export function AppModal({ title, message, details, buttons, onClose, prompt, onPromptSubmit }: AppModalProps) {
  const font = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
  const [inputValue, setInputValue] = useState(prompt?.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputValue(prompt?.defaultValue ?? '');
  }, [prompt?.defaultValue, title, message]);

  useEffect(() => {
    if (prompt && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [prompt, title]);

  const rgb = (c?: string) => c || '45,212,160';

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 3000, fontFamily: font,
    },
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
  },
    React.createElement('div', {
      style: {
        background: '#12121e', border: '1px solid #252540', borderRadius: 12,
        width: 380, boxShadow: '0 16px 48px rgba(0,0,0,0.5)', overflow: 'hidden',
      },
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); },
    },
      React.createElement('div', {
        style: { padding: '16px 20px', borderBottom: '1px solid #1a1a2e' },
      },
        React.createElement('div', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, title),
      ),
      React.createElement('div', {
        style: { padding: '16px 20px' },
      },
        React.createElement('div', { style: { color: '#8888aa', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' as const } }, message),
        details && React.createElement('div', {
          style: {
            marginTop: 10, padding: '8px 10px', background: '#0a0a14', borderRadius: 6,
            border: '1px solid #1a1a2e', fontSize: 10, color: '#555570', lineHeight: 1.5,
            maxHeight: 120, overflowY: 'auto' as const, whiteSpace: 'pre-wrap' as const,
            fontFamily: "'JetBrains Mono', monospace",
          },
        }, details),
        prompt && React.createElement('input', {
          ref: inputRef,
          type: 'text',
          value: inputValue,
          placeholder: prompt.placeholder || '',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && onPromptSubmit) {
              e.preventDefault();
              onPromptSubmit(inputValue);
            }
          },
          style: {
            width: '100%', marginTop: 12, padding: '8px 10px', boxSizing: 'border-box' as const,
            background: '#0a0a14', border: '1px solid #252540', borderRadius: 6,
            color: '#e0e0ec', fontSize: 13, fontFamily: font, outline: 'none',
          },
        }),
      ),
      React.createElement('div', {
        style: { padding: '12px 20px', borderTop: '1px solid #1a1a2e', display: 'flex', justifyContent: 'flex-end', gap: 8 },
      },
        ...buttons.map((btn, i) =>
          React.createElement('button', {
            key: i,
            type: 'button',
            onClick: () => {
              if (prompt && btn.primary && onPromptSubmit) {
                onPromptSubmit(inputValue);
              } else {
                btn.action();
              }
            },
            style: {
              padding: '7px 18px', fontSize: 12, fontWeight: btn.primary ? 600 : 400,
              cursor: 'pointer', fontFamily: font, borderRadius: 6,
              background: btn.primary ? `rgba(${rgb(btn.color)}, 0.1)` : 'transparent',
              border: btn.primary ? `1px solid rgba(${rgb(btn.color)}, 0.4)` : '1px solid #252540',
              color: btn.primary ? `rgb(${rgb(btn.color)})` : '#8888aa',
            },
          }, btn.label),
        ),
      ),
    ),
  );
}
