import type { CommandId } from './command-types';

// The Tools menu's Vector group, kept here so AppMenuBar.tsx stays under the
// file-size cap. Warp and Deform (LBG-T06) follow the path edits; Cut Shapes
// and Trim Shapes (LBG-T08, LBG-T04) follow the boolean operations.
export const TOOLS_VECTOR_IDS: ReadonlyArray<CommandId> = [
  'tools.convert-to-path',
  'tools.weld',
  'tools.union-silhouette',
  'tools.join-paths',
  'tools.offset-shapes',
  'tools.rubber-band-outline',
  'tools.close-paths',
  'tools.reverse-paths',
  'tools.warp',
  'tools.deform',
  'tools.subtract',
  'tools.intersect',
  'tools.exclude',
  'tools.cut-shapes',
  'tools.trim-shapes',
];
