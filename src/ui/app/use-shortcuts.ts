// useShortcuts — window-level keyboard handlers covering F-A15's File, Edit,
// Transform, and View categories. Each category's matchers live in
// ./shortcuts.ts; ./shortcut-contexts.ts reads the store state they act on.
//
// Deliberately subscription-free: the handlers read the stores when a key is
// pressed. The hook used to select ~40 store values, and the status report and
// the per-hover output scope among them re-rendered its host (App) and with it
// the whole tree four times a second during a job and on every mousemove.
//
// Two window keydown listeners (file+edit / transform+view), as before; order
// doesn't matter because the matchers guard themselves (modifier checks,
// isEditableTarget, kind-of-event).

import { useEffect, useRef } from 'react';
import { canvasKeysOwnedByJig, keyboardOwnedElsewhere } from '../common/keyboard-owner';
import { toolPageOpen } from '../state/tool-page';
import { usePlatform } from './platform-context';
import { editingToolShortcutContext, handleEditingToolShortcut } from './editing-tool-shortcuts';
import { arrangeShortcutContext, handleArrangeShortcut } from './arrange-shortcuts';
import { handleSettingsShortcut } from './settings-shortcut';
import { openSettings } from '../settings/settings-dialog-store';
import { handleCommandSearchShortcut } from './command-search-shortcut';
import { openCommandSearch } from '../commands/command-search-store';
import {
  editShortcutContext,
  fileShortcutContext,
  TOOL_SHORTCUT_CONTEXT,
  transformShortcutContext,
  VIEW_SHORTCUT_CONTEXT,
} from './shortcut-contexts';
import {
  handleEditShortcut,
  handleFileShortcut,
  handleHistoryShortcut,
  handleToolShortcut,
  handleTransformShortcut,
  handleViewShortcut,
} from './shortcuts';

export function useShortcuts(): void {
  const platform = usePlatform();
  const platformRef = useRef(platform);
  platformRef.current = platform;

  useEffect(() => {
    const onFileEditKey = (e: KeyboardEvent): void => {
      if (keyboardOwnedElsewhere()) return;
      if (handleSettingsShortcut(e, openSettings)) return;
      // A full page (ADR-641, ADR-636) hides the menus, the tools and the main
      // canvas, so command search, tool and view keys have nothing on screen.
      const pageOpen = toolPageOpen();
      if (!pageOpen && handleCommandSearchShortcut(e, openCommandSearch)) return;
      if (handleFileShortcut(e, fileShortcutContext(platformRef.current))) return;
      if (canvasKeysOwnedByJig()) {
        handleHistoryShortcut(e, editShortcutContext());
        return;
      }
      if (!pageOpen && handleToolShortcut(e, TOOL_SHORTCUT_CONTEXT)) return;
      handleEditShortcut(e, editShortcutContext());
    };
    const onTransformViewKey = (e: KeyboardEvent): void => {
      if (keyboardOwnedElsewhere() || canvasKeysOwnedByJig()) return;
      const pageOpen = toolPageOpen();
      if (handleArrangeShortcut(e, arrangeShortcutContext)) return;
      if (!pageOpen && handleEditingToolShortcut(e, editingToolShortcutContext())) return;
      if (handleTransformShortcut(e, transformShortcutContext())) return;
      if (!pageOpen) handleViewShortcut(e, VIEW_SHORTCUT_CONTEXT);
    };
    window.addEventListener('keydown', onFileEditKey);
    window.addEventListener('keydown', onTransformViewKey);
    return () => {
      window.removeEventListener('keydown', onFileEditKey);
      window.removeEventListener('keydown', onTransformViewKey);
    };
  }, []);
}
