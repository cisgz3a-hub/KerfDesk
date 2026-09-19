import type { VectorOpError } from '../../core/geometry/vector-path-tools';
import type { Result } from '../../core/result';
import type { TextRenderResult } from '../../core/text/text-to-polylines';

export type TextWeldWorkerResponse = Result<TextRenderResult, VectorOpError>;
