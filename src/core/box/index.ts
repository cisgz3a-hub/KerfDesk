// Public API of the box generator module (ADR-105).

export { generateBox, type BoxPanel, type GenerateBoxResult } from './generate-box';
export {
  deriveBoxDims,
  validateBoxSpec,
  type BoxDimensionMode,
  type BoxDims,
  type BoxRelief,
  type BoxSpec,
  type BoxSpecIssue,
  type BoxSpecValidation,
  type BoxStyle,
} from './box-spec';
