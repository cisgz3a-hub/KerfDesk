export type ReliefMeshIntrinsicBounds =
  | {
      readonly kind: 'finite-float32-v1';
      readonly minX: number;
      readonly minY: number;
      readonly minZ: number;
      readonly maxX: number;
      readonly maxY: number;
      readonly maxZ: number;
    }
  | { readonly kind: 'non-finite-float32-v1' };

export type ReliefMeshWidthAspect = 'preserve' | 'stretch';
