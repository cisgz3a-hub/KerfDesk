import { useState, useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject } from '../../core/scene/SceneObject';
import { gatedFeature } from '../utils/proGate';

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
  alignObjects: (mode: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY') => void;
  centerOnCanvas: () => void;
  performBoolean: (op: 'union' | 'subtract' | 'intersect') => void;
  offsetSelected: (distance: number) => void;
  convertTextToPath: () => void;
  showAlert: (title: string, msg: string) => Promise<void>;
  showPrompt?: (title: string, message: string, defaultValue?: string) => Promise<string | null>;
  distributeObjects?: (direction: 'horizontal' | 'vertical') => void;
  openGridArray?: () => void;
  openMaterialTest?: () => void;
  openKerfWizard?: () => void;
  moveToCorner?: (corner: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight') => void;
  moveToMaterialOrigin?: () => void;
  rotateSelected?: (degrees: number) => void;
  flipSelected?: (axis: 'horizontal' | 'vertical') => void;
  toggleLock?: () => void;
  toggleVisibility?: () => void;
}

export function useContextMenu(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
  productionMode: boolean,
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
            if (gatedFeature('text_to_path')) void actions.convertTextToPath();
          },
        });
        items.push({
          label: 'Variable Text / Serial Numbers',
          action: () => {
            if (!gatedFeature('variable_text')) return;
            const textObj = selectedObjs.find(o => o.geometry.type === 'text');
            if (textObj) {
              actions.setVariableTextSource(textObj);
              actions.setShowVariableText(true);
            }
          },
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

      if (selectedObjs.length >= 2) {
        items.push({ label: '', action: () => {}, separator: true });
        items.push({ label: '─ Align ─', action: () => {}, disabled: true });
        items.push({ label: 'Align Left', action: () => actions.alignObjects('left') });
        items.push({ label: 'Align Right', action: () => actions.alignObjects('right') });
        items.push({ label: 'Align Top', action: () => actions.alignObjects('top') });
        items.push({ label: 'Align Bottom', action: () => actions.alignObjects('bottom') });
        items.push({ label: 'Align Center X', action: () => actions.alignObjects('centerX') });
        items.push({ label: 'Align Center Y', action: () => actions.alignObjects('centerY') });
      }

      if (hasSelection) {
        items.push({ label: '', action: () => {}, separator: true });
        items.push({ label: 'Center on Canvas', action: actions.centerOnCanvas });
      }

      if (selectedObjs.length >= 2) {
        items.push({ label: '', action: () => {}, separator: true });
        items.push({ label: '─ Combine ─', action: () => {}, disabled: true });
        items.push({ label: 'Union', action: () => { if (gatedFeature('boolean_ops')) actions.performBoolean('union'); } });
        items.push({ label: 'Subtract', action: () => { if (gatedFeature('boolean_ops')) actions.performBoolean('subtract'); } });
        items.push({ label: 'Intersect', action: () => { if (gatedFeature('boolean_ops')) actions.performBoolean('intersect'); } });
      }

      if (hasSelection) {
        items.push({ label: '', action: () => {}, separator: true });
        items.push({
          label: 'Offset Outward (+2mm)',
          action: () => void actions.offsetSelected(2),
        });
        items.push({
          label: 'Offset Inward (-2mm)',
          action: () => void actions.offsetSelected(-2),
        });
        items.push({
          label: 'Offset Custom...',
          action: () => {
            void (async () => {
              if (!actions.showPrompt) return;
              const input = await actions.showPrompt(
                'Custom Offset',
                'Offset distance in mm (negative for inward):',
                '5',
              );
              if (input === null) return;
              const distance = parseFloat(input);
              if (Number.isNaN(distance)) return;
              actions.offsetSelected(distance);
            })();
          },
        });
      }

      if (productionMode && hasSelection) {
        items.push({ label: '', action: () => {}, separator: true });
        items.push({ label: '─ Pro Tools ─', action: () => {}, disabled: true });

        if (selectedObjs.length >= 3 && actions.distributeObjects) {
          items.push({
            label: 'Distribute Horizontally',
            action: () => actions.distributeObjects!('horizontal'),
          });
          items.push({
            label: 'Distribute Vertically',
            action: () => actions.distributeObjects!('vertical'),
          });
        }

        if (actions.openGridArray) {
          items.push({
            label: 'Grid Array...',
            action: () => actions.openGridArray!(),
          });
        }

        if (actions.openMaterialTest) {
          items.push({
            label: 'Material Test Grid...',
            action: () => actions.openMaterialTest!(),
          });
        }

        if (actions.openKerfWizard) {
          items.push({
            label: 'Kerf & Fit Wizard...',
            action: () => actions.openKerfWizard!(),
          });
        }

        items.push({ label: '', action: () => {}, separator: true });
        items.push({
          label: 'Move to Home (top-left)',
          action: () => actions.moveToCorner?.('topLeft'),
        });
        items.push({
          label: 'Move to Bottom-Right',
          action: () => actions.moveToCorner?.('bottomRight'),
        });
        items.push({
          label: 'Move to Material Origin',
          action: () => actions.moveToMaterialOrigin?.(),
        });

        items.push({ label: '', action: () => {}, separator: true });
        items.push({
          label: 'Rotate 90° CW',
          action: () => actions.rotateSelected?.(90),
        });
        items.push({
          label: 'Rotate 90° CCW',
          action: () => actions.rotateSelected?.(-90),
        });
        items.push({
          label: 'Rotate 180°',
          action: () => actions.rotateSelected?.(180),
        });
        items.push({
          label: 'Flip Horizontal',
          action: () => actions.flipSelected?.('horizontal'),
        });
        items.push({
          label: 'Flip Vertical',
          action: () => actions.flipSelected?.('vertical'),
        });

        items.push({ label: '', action: () => {}, separator: true });
        const allLocked = selectedObjs.every(o => o.locked);
        items.push({
          label: allLocked ? 'Unlock' : 'Lock',
          action: () => actions.toggleLock?.(),
        });

        const allVisible = selectedObjs.every(o => o.visible);
        items.push({
          label: allVisible ? 'Hide' : 'Show',
          action: () => actions.toggleVisibility?.(),
        });
      }

      const menuWidth = 220;
      const menuHeight =
        items.filter(i => !i.separator).length * 28 + items.filter(i => i.separator).length * 8 + 16;
      const clampedX = Math.max(4, Math.min(x, window.innerWidth - menuWidth - 8));
      const clampedY = Math.max(4, Math.min(y, window.innerHeight - menuHeight - 8));

      setContextMenu({ x: clampedX, y: clampedY, items });
    },
    [scene, selectedIds, productionMode, actions],
  );

  const hideContextMenu = useCallback(() => setContextMenu(null), []);

  return { contextMenu, showContextMenu, hideContextMenu };
}
