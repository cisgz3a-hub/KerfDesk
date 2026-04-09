import { useState, useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject } from '../../core/scene/SceneObject';

interface ContextMenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  separator?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export interface ContextMenuActions {
  handleSceneCommit: (scene: Scene) => void;
  setSelectedIds: (ids: Set<string>) => void;
  setActiveTool: (tool: string) => void;
  handleCopy: () => void;
  handlePaste: () => void;
  handleDuplicate: () => void;
  handleDelete: () => void;
  setShowTextDialog: (show: boolean) => void;
  setEditingTextId: (id: string | null) => void;
  setTextInput: (text: string) => void;
  setTextFont: (font: string) => void;
  setTextSize: (size: number) => void;
  setTextBold: (bold: boolean) => void;
  setTextItalic: (italic: boolean) => void;
  setTextPlacementPt: (pt: { x: number; y: number } | null) => void;
  setShowVariableText: (show: boolean) => void;
  setVariableTextSource: (obj: SceneObject | null) => void;
}

export function useContextMenu(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
  actions: ContextMenuActions,
) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const showContextMenu = useCallback(
    (x: number, y: number) => {
      const hasSelection = selectedIds.size > 0;
      const selectedObjs = scene.objects.filter(o => selectedIds.has(o.id));
      const hasText = selectedObjs.some(o => o.geometry.type === 'text');
      const hasSingle = selectedObjs.length === 1;

      const items: ContextMenuItem[] = [];

      items.push({ label: 'Copy', action: actions.handleCopy, disabled: !hasSelection });
      items.push({ label: 'Paste', action: actions.handlePaste });
      items.push({ label: 'Duplicate', action: actions.handleDuplicate, disabled: !hasSelection });
      items.push({ label: 'Delete', action: actions.handleDelete, disabled: !hasSelection });
      items.push({ label: '', action: () => {}, separator: true });

      items.push({
        label: 'Select All',
        action: () =>
          actions.setSelectedIds(
            new Set(scene.objects.filter(o => o.visible && !o.locked).map(o => o.id)),
          ),
      });

      items.push({ label: '', action: () => {}, separator: true });

      if (hasText && hasSingle) {
        items.push({
          label: 'Edit Text',
          action: () => {
            const obj = selectedObjs[0];
            const geom = obj.geometry as { text?: string; fontFamily?: string; fontSize?: number; bold?: boolean; italic?: boolean };
            actions.setTextInput(geom.text || '');
            actions.setTextFont(geom.fontFamily || 'Arial');
            actions.setTextSize(geom.fontSize || 20);
            actions.setTextBold(geom.bold || false);
            actions.setTextItalic(geom.italic || false);
            actions.setEditingTextId(obj.id);
            actions.setTextPlacementPt(null);
            actions.setSelectedIds(new Set([obj.id]));
            actions.setShowTextDialog(true);
          },
        });
        items.push({
          label: 'Text to Path',
          action: () => {
            const textObjs = selectedObjs.filter(o => o.geometry.type === 'text');
            if (textObjs.length === 0) return;
            window.dispatchEvent(
              new CustomEvent('laserforge:textToPath', { detail: { objectIds: textObjs.map(o => o.id) } }),
            );
          },
        });
        items.push({
          label: 'Variable Text / Serial Numbers',
          action: () => {
            const textObj = selectedObjs.find(o => o.geometry.type === 'text');
            if (textObj) {
              actions.setVariableTextSource(textObj);
              actions.setShowVariableText(true);
            }
          },
        });
        items.push({ label: '', action: () => {}, separator: true });
      }

      if (selectedObjs.length >= 2) {
        items.push({
          label: 'Union',
          action: () =>
            window.dispatchEvent(new CustomEvent('laserforge:boolean', { detail: { op: 'union' } })),
        });
        items.push({
          label: 'Subtract',
          action: () =>
            window.dispatchEvent(new CustomEvent('laserforge:boolean', { detail: { op: 'subtract' } })),
        });
        items.push({
          label: 'Intersect',
          action: () =>
            window.dispatchEvent(new CustomEvent('laserforge:boolean', { detail: { op: 'intersect' } })),
        });
        items.push({ label: '', action: () => {}, separator: true });
      }

      if (hasSelection) {
        for (const layer of scene.layers) {
          items.push({
            label: `Move to: ${layer.name}`,
            action: () => {
              const newScene = {
                ...scene,
                objects: scene.objects.map(o =>
                  selectedIds.has(o.id) ? { ...o, layerId: layer.id } : o,
                ),
              };
              actions.handleSceneCommit(newScene);
            },
          });
        }
      }

      const menuWidth = 220;
      const menuHeight =
        items.filter(i => !i.separator).length * 32 + items.filter(i => i.separator).length * 8 + 16;
      const clampedX = Math.max(4, Math.min(x, window.innerWidth - menuWidth - 8));
      const clampedY = Math.max(4, Math.min(y, window.innerHeight - menuHeight - 8));

      setContextMenu({ x: clampedX, y: clampedY, items });
    },
    [scene, selectedIds, actions],
  );

  const hideContextMenu = useCallback(() => setContextMenu(null), []);

  return { contextMenu, showContextMenu, hideContextMenu };
}
