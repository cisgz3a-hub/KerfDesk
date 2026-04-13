/**
 * === FILE: /src/io/index.ts ===
 *
 * Purpose:    Barrel export for file I/O module.
 * Dependencies: All io module files
 * Last updated: File Save/Load feature
 */

export { serializeScene, deserializeScene } from './SceneSerializer';
export { saveSceneToFile, loadSceneFromFile } from './FileIO';
export {
  type ImportOptions,
  computeImportTransform,
  applyTransformToObjects,
} from './SvgImportPlacement';
export { type SvgUnitMode } from '../import/svg/SvgParser';
