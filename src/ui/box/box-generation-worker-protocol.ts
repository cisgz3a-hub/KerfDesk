import type { BoxSpec, GenerateBoxResult } from '../../core/box';

export type BoxGenerationMetrics = {
  readonly panelCount: number;
  readonly ringCount: number;
  readonly pointCount: number;
};

export type BoxGenerationWorkerRequest = {
  readonly kind: 'generate';
  readonly id: number;
  readonly spec: BoxSpec;
};

export type BoxGenerationWorkerResponse =
  | {
      readonly kind: 'result';
      readonly id: number;
      readonly result: GenerateBoxResult;
      readonly metrics: BoxGenerationMetrics | null;
    }
  | {
      readonly kind: 'fatal';
      readonly id: number;
      readonly message: string;
    };
