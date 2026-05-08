import React from 'react';
import { FontPicker } from './common/FontPicker';
import { NumberInput } from './NumberInput';
import { type TextOperationMode } from '../scene/TextOperationLayer';

export interface AddTextDialogProps {
  showTextDialog: boolean;
  editingTextId: string | null;
  textInput: string;
  textFont: string;
  textSize: number;
  textBold: boolean;
  textItalic: boolean;
  textOperationMode: TextOperationMode;
  textPreviewFontReady: boolean;

  setTextInput: (v: string) => void;
  setTextFont: (v: string) => void;
  setTextSize: (v: number) => void;
  setTextBold: (v: boolean) => void;
  setTextItalic: (v: boolean) => void;
  setTextOperationMode: (v: TextOperationMode) => void;

  onClose: () => void;
  onSubmit: () => void;
  onShowFontCredits: () => void;
}

export function AddTextDialog(props: AddTextDialogProps) {
  if (!props.showTextDialog) return null;

  const {
    editingTextId,
    textInput,
    textFont,
    textSize,
    textBold,
    textItalic,
    textOperationMode,
    textPreviewFontReady,
    setTextInput,
    setTextFont,
    setTextSize,
    setTextBold,
    setTextItalic,
    setTextOperationMode,
    onClose,
    onSubmit,
    onShowFontCredits,
  } = props;
  const operationNote = textOperationMode === 'engrave'
    ? 'Safer default: marks the surface without cutting through.'
    : 'Cuts through material. Use only when you want separated letters or outlines.';
  const submitLabel = editingTextId
    ? 'Update Text'
    : textOperationMode === 'engrave'
      ? 'Add Engrave Text'
      : 'Add Cut Text';

  const renderOperationButton = (mode: TextOperationMode, label: string) => {
    const selected = textOperationMode === mode;
    return React.createElement('button', {
      type: 'button',
      onClick: () => setTextOperationMode(mode),
      style: {
        flex: 1,
        padding: '9px 10px',
        background: selected ? 'rgba(0,212,255,0.12)' : '#0a0a14',
        border: selected ? '1px solid #00d4ff' : '1px solid #252540',
        borderRadius: 8,
        color: selected ? '#00d4ff' : '#9a9ab8',
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: "'DM Sans', system-ui, sans-serif",
      },
      'aria-pressed': selected,
    }, label);
  };

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 2000, fontFamily: "'DM Sans', system-ui, sans-serif",
      overflowY: 'auto', padding: '20px 0',
    },
    onClick: (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
  },
    React.createElement('div', {
      style: {
        background: '#12121e', border: '1px solid #252540', borderRadius: 14,
        width: 420, padding: 0, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        overflow: 'hidden',
        maxHeight: '90vh',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column' as const,
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      React.createElement('div', {
        style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      },
        React.createElement('span', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, editingTextId ? 'Edit Text' : 'Add Text'),
        React.createElement('button', {
          type: 'button',
          onClick: onClose,
          style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' },
        }, '×'),
      ),

      React.createElement('div', { style: { padding: '16px 18px' } },
        React.createElement('textarea', {
          value: textInput,
          onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setTextInput(e.target.value),
          placeholder: 'Type your text here...',
          autoFocus: true,
          rows: 3,
          style: {
            width: '100%', padding: '10px 12px',
            background: '#0a0a14', border: '1px solid #252540', borderRadius: 8,
            color: '#e0e0ec', fontSize: 14, fontFamily: textFont,
            fontWeight: textBold ? 'bold' : 'normal',
            fontStyle: textItalic ? 'italic' : 'normal',
            outline: 'none', resize: 'vertical' as const,
          },
        }),
      ),

      React.createElement('div', { style: { padding: '0 18px 12px' } },
        React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 5 } }, 'How should this name run?'),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          renderOperationButton('engrave', 'Engrave name'),
          renderOperationButton('cut', 'Cut name'),
        ),
        React.createElement('div', { style: { fontSize: 10, color: '#777796', marginTop: 6 } }, operationNote),
      ),

      React.createElement('div', { style: { padding: '0 18px 12px', display: 'flex', gap: 8 } },
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 4 } }, 'Font'),
          React.createElement(FontPicker, {
            value: textFont,
            onChange: (family: string) => setTextFont(family),
          }),
          React.createElement('button', {
            type: 'button',
            onClick: onShowFontCredits,
            style: {
              background: 'none',
              border: 'none',
              fontSize: 10,
              color: '#555570',
              textDecoration: 'underline',
              cursor: 'pointer',
              padding: 0,
              marginTop: 4,
            },
          }, 'Font credits'),
        ),
        React.createElement('div', { style: { width: 80 } },
          React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 4 } }, 'Size (mm)'),
          React.createElement(NumberInput, {
            value: textSize,
            min: 3,
            max: 200,
            integer: true,
            inputMode: 'numeric',
            defaultValue: 20,
            onChange: (v: number) => setTextSize(v),
            onCommit: (v: number) => setTextSize(v),
            style: {
              width: '100%', padding: '6px 8px',
              background: '#0a0a14', border: '1px solid #252540', borderRadius: 6,
              color: '#e0e0ec', fontSize: 12, outline: 'none',
              fontFamily: "'JetBrains Mono', monospace",
            },
          }),
        ),
      ),

      React.createElement('div', { style: { padding: '0 18px 12px', display: 'flex', gap: 8 } },
        React.createElement('button', {
          type: 'button',
          onClick: () => setTextBold(!textBold),
          style: {
            padding: '6px 16px', fontSize: 13, fontWeight: 700,
            background: textBold ? 'rgba(0,212,255,0.1)' : '#0a0a14',
            border: textBold ? '1px solid #00d4ff' : '1px solid #252540',
            borderRadius: 6, color: textBold ? '#00d4ff' : '#555570',
            cursor: 'pointer', fontFamily: "'DM Sans', system-ui, sans-serif",
          },
        }, 'B'),
        React.createElement('button', {
          type: 'button',
          onClick: () => setTextItalic(!textItalic),
          style: {
            padding: '6px 16px', fontSize: 13, fontStyle: 'italic',
            background: textItalic ? 'rgba(0,212,255,0.1)' : '#0a0a14',
            border: textItalic ? '1px solid #00d4ff' : '1px solid #252540',
            borderRadius: 6, color: textItalic ? '#00d4ff' : '#555570',
            cursor: 'pointer', fontFamily: "'DM Sans', system-ui, sans-serif",
          },
        }, 'I'),
      ),

      React.createElement('div', {
        style: {
          margin: '0 18px 12px', padding: '16px',
          background: '#08080f', borderRadius: 8, border: '1px solid #1a1a2e',
          minHeight: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
      },
        React.createElement('span', {
          style: {
            fontFamily: textFont, fontSize: Math.min(textSize * 2, 48),
            fontWeight: textBold ? 'bold' : 'normal',
            fontStyle: textItalic ? 'italic' : 'normal',
            color: '#e0e0ec',
            opacity: textPreviewFontReady ? 1 : 0.2,
            transition: 'opacity 120ms ease',
          },
        }, textPreviewFontReady ? (textInput || 'Preview') : 'Loading preview...'),
      ),

      React.createElement('div', { style: { padding: '0 18px 16px' } },
        React.createElement('button', {
          type: 'button',
          onClick: onSubmit,
          disabled: !textInput.trim(),
          style: {
            width: '100%', padding: '10px',
            background: textInput.trim() ? 'rgba(45,212,160,0.1)' : '#1a1a2e',
            border: textInput.trim() ? '1px solid #2dd4a0' : '1px solid #252540',
            borderRadius: 8, color: textInput.trim() ? '#2dd4a0' : '#333355',
            fontSize: 13, fontWeight: 600, cursor: textInput.trim() ? 'pointer' : 'default',
            fontFamily: "'DM Sans', system-ui, sans-serif",
          },
        }, submitLabel),

        React.createElement('div', {
          style: { fontSize: 10, color: '#555570', marginTop: 8, textAlign: 'center' as const },
        }, textOperationMode === 'cut'
          ? 'Cut text follows the outline. Convert to Path later if you need node editing.'
          : 'Text will be placed on an Engrave layer by default.'),
      ),
    ),
  );
}
