import React, { useEffect, useRef, useState } from 'react';
import { BUNDLED_FONTS, type BundledFont } from '../../../fonts/fontRegistry';

interface FontPickerProps {
  value: string;
  onChange: (family: string) => void;
  systemFonts?: string[];
}

const font = "'DM Sans', system-ui, sans-serif";
const DEFAULT_SYSTEM = ['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana', 'Impact', 'Comic Sans MS', 'Trebuchet MS', 'Palatino', 'Garamond', 'Bookman', 'Avant Garde'];

export function FontPicker({ value, onChange, systemFonts = DEFAULT_SYSTEM }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDocDown);
    return () => document.removeEventListener('pointerdown', onDocDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const outlineFonts = BUNDLED_FONTS.filter(f => !f.hersheyFamily);
  const engravingFonts = BUNDLED_FONTS.filter(f => !!f.hersheyFamily);

  const pick = (family: string) => {
    onChange(family);
    setOpen(false);
  };

  const option = (key: string, label: string, family: string, isHershey: boolean) =>
    React.createElement('div', {
      key,
      onClick: () => pick(family),
      role: 'option',
      'aria-selected': value === family,
      style: {
        padding: '6px 12px',
        cursor: 'pointer',
        fontSize: 12,
        fontFamily: isHershey ? font : `"${family}", ${font}`,
        background: value === family ? 'rgba(0,212,255,0.12)' : 'transparent',
        color: value === family ? '#00d4ff' : '#e0e0ec',
      },
      onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
        if (value !== family) e.currentTarget.style.background = '#1a1a2e';
      },
      onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => {
        if (value !== family) e.currentTarget.style.background = 'transparent';
      },
    }, label.replace(/\s+\(single-line\)\s*$/i, ''));

  const groupHeader = (key: string, text: string) =>
    React.createElement('div', {
      key,
      style: {
        padding: '8px 12px 4px',
        fontSize: 9,
        textTransform: 'uppercase' as const,
        letterSpacing: 1,
        color: '#555570',
        fontFamily: font,
        fontWeight: 600,
      },
    }, text);

  const selectedLabel = BUNDLED_FONTS.find(f => f.family === value)?.label.replace(/\s+\(single-line\)\s*$/i, '') ?? value;

  return React.createElement('div', {
    ref: rootRef,
    style: { position: 'relative' as const, width: '100%' },
  },
    React.createElement('button', {
      type: 'button',
      onClick: () => setOpen(v => !v),
      style: {
        width: '100%',
        padding: '6px 28px 6px 12px',
        fontSize: 12,
        borderRadius: 6,
        background: '#0a0a14',
        border: '1px solid #252540',
        color: '#e0e0ec',
        fontFamily: `"${value}", ${font}`,
        textAlign: 'left' as const,
        cursor: 'pointer',
        position: 'relative' as const,
      },
    },
      selectedLabel,
      React.createElement('span', {
        style: { position: 'absolute' as const, right: 10, top: '50%', transform: 'translateY(-50%)', color: '#555570', fontSize: 10 },
      }, '▼'),
    ),

    open && React.createElement('div', {
      role: 'listbox',
      style: {
        position: 'absolute' as const,
        top: 'calc(100% + 4px)',
        left: 0,
        right: 0,
        maxHeight: 300,
        overflowY: 'auto' as const,
        background: '#0a0a14',
        border: '1px solid #252540',
        borderRadius: 6,
        boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
        zIndex: 10,
      },
    },
      outlineFonts.length > 0 && groupHeader('h-bundled', 'Bundled'),
      ...outlineFonts.map((bf: BundledFont) => option(`b-${bf.family}`, bf.label, bf.family, false)),
      engravingFonts.length > 0 && groupHeader('h-engraving', 'Engraving (single-line)'),
      ...engravingFonts.map((bf: BundledFont) => option(`e-${bf.family}`, bf.label, bf.family, true)),
      systemFonts.length > 0 && groupHeader('h-system', 'System fonts'),
      ...systemFonts.map(f => option(`s-${f}`, f, f, false)),
    ),
  );
}
