// core/barcode — offline barcode and 2D-code generation (ADR-372): QR Code,
// Data Matrix ECC 200, Code 128, Code 39, EAN-13, UPC-A and EAN-8, laid out
// as module-aligned outlines. Pure: no I/O; captions come through a renderer
// the caller supplies.

export type { BarcodeShape, BarcodeSymbology } from '../scene/scene-object';
export { isBarcodeObject, type BarcodeObject } from './barcode-object';
export {
  BARCODE_LIMITS,
  MIN_QUIET_ZONE,
  defaultBarcodeSpec,
  isMatrixSymbology,
} from './barcode-spec';
export { BARCODE_SYMBOLOGY_LABELS } from './barcode-symbol';
export { layoutBarcode, layoutPolylines, type BarcodeLayout } from './barcode-layout';
export {
  BARCODE_CAPTION_FONT_KEY,
  createBarcodeObject,
  materializeBarcode,
  type BarcodeCaptionRenderer,
  type RenderedCaption,
} from './materialize-barcode';
