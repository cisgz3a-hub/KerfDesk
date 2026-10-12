// The application menu's presentation-only grouping, split from AppMenuBar.tsx
// to keep that component inside the file-size cap.

import type { CommandFamily, CommandId } from './command-registry';
import { MOVE_LASER_TO_SELECTION_IDS } from './machine-move-commands';
import { ARRANGE_LAYOUT_IDS } from './arrange-command-family';
import {
  DOCK_IDS,
  DRAW_ORDER_IDS,
  FREE_TRANSFORM_IDS,
  MATCH_SIZE_IDS,
  MOVE_TOGETHER_IDS,
} from './layout-commands';
import { TOOLS_VECTOR_IDS } from './tools-vector-menu-ids';
// Presentation-only grouping: separators render between these blocks, in this
// order. Commands a family registers that are NOT listed here fall into a
// trailing block — grouping must never hide a command.
type MenuGroupLayout = { readonly label: string; readonly ids: ReadonlyArray<CommandId> };

export const MENU_GROUPS: Partial<Record<CommandFamily, ReadonlyArray<MenuGroupLayout>>> = {
  arrange: [
    {
      label: 'Align',
      ids: [
        'arrange.align-left',
        'arrange.align-center-x',
        'arrange.align-right',
        'arrange.align-top',
        'arrange.align-center-y',
        'arrange.align-bottom',
        'arrange.align-centers',
      ],
    },
    {
      label: 'Distribute',
      ids: [
        'arrange.distribute-horizontal-centers',
        'arrange.distribute-horizontal-spacing',
        'arrange.distribute-vertical-centers',
        'arrange.distribute-vertical-spacing',
        ...MOVE_TOGETHER_IDS,
      ],
    },
    { label: 'Size', ids: MATCH_SIZE_IDS },
    { label: 'Dock', ids: DOCK_IDS },
    { label: 'Draw order', ids: DRAW_ORDER_IDS },
    {
      label: 'Rotate & flip',
      ids: [
        'arrange.rotate-90-cw',
        'arrange.rotate-90-ccw',
        'arrange.flip-horizontal',
        'arrange.flip-vertical',
        ...FREE_TRANSFORM_IDS,
      ],
    },
    {
      label: 'Move to bed',
      ids: [
        'arrange.move-to-bed-center',
        'arrange.move-to-bed-nw',
        'arrange.move-to-bed-n',
        'arrange.move-to-bed-ne',
        'arrange.move-to-bed-w',
        'arrange.move-to-bed-e',
        'arrange.move-to-bed-sw',
        'arrange.move-to-bed-s',
        'arrange.move-to-bed-se',
      ],
    },
    { label: 'Move laser to selection', ids: MOVE_LASER_TO_SELECTION_IDS },
    { label: 'Layout', ids: ARRANGE_LAYOUT_IDS },
  ],
  window: [
    {
      label: 'Panels',
      ids: [
        'window.toggle-layers-panel',
        'window.toggle-machine-panel',
        'window.toggle-side-panels',
        'window.reset-layout',
      ],
    },
    {
      label: 'View',
      ids: [
        'window.toggle-preview',
        'window.save-preview-image',
        'window.toggle-wireframe',
        'window.fit-view',
        'window.project-notes',
        'window.undo-history',
      ],
    },
    {
      label: 'Appearance',
      ids: ['window.theme-light', 'window.theme-dark', 'window.theme-system'],
    },
  ],
  tools: [
    {
      label: 'Create & measure',
      ids: [
        'tools.constrained-sketch',
        'tools.parametric-part',
        'tools.editable-relief',
        'tools.measure',
        'tools.tangent-circle',
        'tools.add-text',
        'tools.registration-jig',
        'tools.camera',
        'tools.place-board',
        'tools.rotary-setup',
        'tools.print-and-cut',
        'tools.box-generator',
        'tools.barcode',
      ],
    },
    {
      label: 'Calibrate',
      ids: [
        'tools.material-test',
        'tools.interval-test',
        'tools.scan-offset-test',
        'tools.focus-test',
      ],
    },
    { label: 'Settings', ids: ['tools.optimization-settings', 'tools.labs'] },
    {
      label: 'Image',
      ids: [
        'tools.edit-image',
        'tools.adjust-image',
        'tools.photo-engraving',
        'tools.apply-image-mask',
        'tools.crop-image',
        'tools.flatten-image-mask',
        'tools.remove-image-mask',
        'tools.save-processed-bitmap',
        'tools.save-original-image',
      ],
    },
    { label: 'Variable data', ids: ['tools.bake-variable-text'] },
    {
      label: 'Trace',
      ids: ['tools.trace-image', 'tools.retrace-original', 'tools.multi-file-trace'],
    },
    { label: 'Vector', ids: TOOLS_VECTOR_IDS },
    {
      label: 'Fill repair',
      ids: [
        'tools.fill-selection',
        'tools.close-open-fill-contours',
        'tools.close-fill-contours-with-tolerance',
        'tools.close-paths-with-tolerance',
        'tools.radius-fillet',
      ],
    },
    { label: 'Bitmap', ids: ['tools.convert-to-bitmap'] },
  ],
};
