export type { SanitizeResult, SvgStripCounts } from './sanitize';
export { sanitizeSvg } from './sanitize';
export type { SubPath } from './parse-path-d';
export { parsePathD } from './parse-path-d';
export { elementToSubPaths } from './shape-to-polylines';
export type { ParseSvgResult } from './parse-svg';
export { parseSvg, SVG_EMPTY_FILE_MESSAGE } from './parse-svg';
export { readSvgDocumentFromBlob } from './parse-svg-blob';
export { parseSvgWorkerDocument } from './parse-svg-worker';
