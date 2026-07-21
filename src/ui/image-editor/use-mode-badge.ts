// The +/−/× selection-mode cursor badge (ADR-242 PP-C, Top-20 item 5):
// follows the pointer for selection tools, showing the EFFECTIVE boolean
// mode — held Shift/Alt (with a selection) win over the sticky buttons.
// Driven imperatively like the brush cursor so moves never re-render React.

import { useCallback, useRef } from 'react';
import type { SelectionCombineMode } from '../../core/image-select';
import type { EditorTool } from './editor-session';
import { useImageEditorStore } from './image-editor-store';

const STICKY_GLYPHS: Readonly<Partial<Record<SelectionCombineMode, string>>> = {
  add: '+',
  subtract: '−',
  intersect: '×',
};

function badgeGlyph(
  toolKind: EditorTool['kind'],
  hasSelection: boolean,
  shift: boolean,
  alt: boolean,
  sticky: SelectionCombineMode,
): string {
  const isSelectionTool = toolKind === 'marquee' || toolKind === 'lasso' || toolKind === 'wand';
  if (!isSelectionTool) return '';
  if (hasSelection && shift && alt) return '×';
  if (hasSelection && shift) return '+';
  if (hasSelection && alt) return '−';
  return STICKY_GLYPHS[sticky] ?? '';
}

type ModeBadge = {
  readonly badgeRef: React.RefObject<HTMLDivElement>;
  readonly updateBadge: (e: React.PointerEvent<HTMLElement>, host: HTMLElement | null) => void;
  readonly hideBadge: () => void;
};

export function useModeBadge(): ModeBadge {
  const badgeRef = useRef<HTMLDivElement>(null);

  const hideBadge = useCallback((): void => {
    const badge = badgeRef.current;
    if (badge !== null) badge.style.display = 'none';
  }, []);

  const updateBadge = useCallback(
    (e: React.PointerEvent<HTMLElement>, host: HTMLElement | null): void => {
      const badge = badgeRef.current;
      if (badge === null || host === null) return;
      const state = useImageEditorStore.getState();
      const glyph = badgeGlyph(
        state.tool.kind,
        (state.session?.selection ?? null) !== null,
        e.shiftKey,
        e.altKey,
        state.selectionMode,
      );
      if (glyph === '') {
        badge.style.display = 'none';
        return;
      }
      badge.textContent = glyph;
      badge.style.display = 'block';
      const rect = host.getBoundingClientRect();
      badge.style.transform = `translate(${e.clientX - rect.left + 12}px, ${
        e.clientY - rect.top + 12
      }px)`;
    },
    [],
  );

  return { badgeRef, updateBadge, hideBadge };
}

export const MODE_BADGE_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  display: 'none',
  pointerEvents: 'none',
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1,
  padding: '1px 3px',
  borderRadius: 3,
  background: 'var(--lf-bg-1)',
  border: '1px solid var(--lf-border-strong)',
  color: 'var(--lf-text)',
};
