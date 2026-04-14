/**
 * === FILE: /src/import/svg/index.ts ===
 *
 * Purpose:    Barrel export for the SVG import module.
 *             The main entry point is `importSVG(svgString): Scene`.
 *
 * Dependencies: All svg import module files
 * Last updated: SVG Import feature
 */

export { importSvgToScene as importSVG, importSvgIntoScene } from './SvgToScene';
export { parsePathData } from './PathParser';
export { parseTransform, multiplyMatrix } from './TransformParser';
export {
  parseSvg,
  parseLength,
  parseLengthMm,
  detectSvgUnits,
  type SvgElement,
  type SvgParseResult,
  type ParsedLength,
  type ParseSvgOptions,
  type SvgUnitMode,
} from './SvgParser';
