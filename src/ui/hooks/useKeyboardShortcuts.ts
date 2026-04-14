import { useEffect, useRef } from 'react';

export interface KeyboardActions {
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onOpen: () => void;
  onNew: () => void;
  onSelectAll: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onEscape: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onToolSelect: () => void;
  onToolRect: () => void;
  onToolEllipse: () => void;
  onToolLine: () => void;
  onToolText: () => void;
  onToolNode: () => void;
  onToolPan: () => void;
  /** Optional — no default chord in this hook yet */
  onToggleConnection?: () => void;
  onToggleToolpath: () => void;
  onToggleShortcuts: () => void;
  onNudge: (dx: number, dy: number, commit: boolean) => void;
  /** For copy / duplicate / nudge / boolean guards */
  selectionCount: number;
  /** For paste guard */
  clipboardItemCount: number;
  onBooleanUnion: () => void;
  onBooleanSubtract: () => void;
  onBooleanIntersect: () => void;
  onAlignSelectionCenter: () => void;
  onGridArray: () => void;
}

export function useKeyboardShortcuts(actions: KeyboardActions) {
  const ref = useRef(actions);
  ref.current = actions;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const a = ref.current;
      const target = e.target as HTMLElement;
      const tag = target?.tagName?.toLowerCase();
      const isTextInput =
        tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;

      if (isTextInput) {
        if (e.key === 'Escape') {
          target.blur();
          return;
        }
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.shiftKey) {
        if (a.selectionCount === 2) {
          const bk = e.key.toLowerCase();
          if (bk === 'u') {
            e.preventDefault();
            a.onBooleanUnion();
            return;
          }
          if (bk === 's') {
            e.preventDefault();
            a.onBooleanSubtract();
            return;
          }
          if (bk === 'i') {
            e.preventDefault();
            a.onBooleanIntersect();
            return;
          }
        }
        if (a.selectionCount > 0 && e.key === 'C') {
          e.preventDefault();
          a.onAlignSelectionCenter();
          return;
        }
        if (a.selectionCount > 0 && e.key === 'A') {
          e.preventDefault();
          a.onGridArray();
          return;
        }
      }

      if (ctrl) {
        const k = e.key.toLowerCase();
        switch (k) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) a.onRedo();
            else a.onUndo();
            return;
          case 'y':
            e.preventDefault();
            a.onRedo();
            return;
          case 's':
            e.preventDefault();
            a.onSave();
            return;
          case 'o':
            e.preventDefault();
            a.onOpen();
            return;
          case 'n':
            e.preventDefault();
            a.onNew();
            return;
          case 'a':
            e.preventDefault();
            a.onSelectAll();
            return;
          case 'c':
            if (a.selectionCount === 0) return;
            e.preventDefault();
            a.onCopy();
            return;
          case 'v':
            if (a.clipboardItemCount === 0) return;
            e.preventDefault();
            a.onPaste();
            return;
          case 'd':
            if (a.selectionCount === 0) return;
            e.preventDefault();
            a.onDuplicate();
            return;
          case '=':
          case '+':
            e.preventDefault();
            a.onZoomIn();
            return;
          case '-':
            e.preventDefault();
            a.onZoomOut();
            return;
          case '0':
            e.preventDefault();
            a.onZoomFit();
            return;
          case 'p':
            e.preventDefault();
            a.onToggleToolpath();
            return;
        }
        return;
      }

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        a.onToggleShortcuts();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        a.onDelete();
        return;
      }
      if (e.key === 'Escape') {
        a.onEscape();
        return;
      }

      switch (e.key) {
        case 'v':
        case 'V':
          a.onToolSelect();
          return;
        case 'r':
        case 'R':
          a.onToolRect();
          return;
        case 'e':
        case 'E':
          a.onToolEllipse();
          return;
        case 'l':
        case 'L':
          a.onToolLine();
          return;
        case 't':
        case 'T':
          e.preventDefault();
          a.onToolText();
          return;
        case 'h':
        case 'H':
          a.onToolPan();
          return;
        case 'n':
        case 'N':
          e.preventDefault();
          a.onToolNode();
          return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (a.selectionCount === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 0.1 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        a.onNudge(dx, dy, false);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        ref.current.onNudge(0, 0, true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
}
