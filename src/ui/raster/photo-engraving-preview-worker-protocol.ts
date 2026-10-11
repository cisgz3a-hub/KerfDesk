import type {
  PhotoEngravingPreviewInput,
  PhotoEngravingPreviewResult,
} from './photo-engraving-preview-types';

export type PhotoEngravingPreviewWorkerRequest = {
  readonly id: number;
  readonly input: PhotoEngravingPreviewInput;
  readonly maxEdge: number;
};

export type PhotoEngravingPreviewWorkerResponse = {
  readonly id: number;
  readonly result: PhotoEngravingPreviewResult;
};
