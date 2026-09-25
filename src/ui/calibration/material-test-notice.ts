// What the operator is told after a Material Test joins the open design
// (ADR-381): where it went, and — when it could not go in free space — why,
// so a test sitting on top of their artwork is never a surprise.

import type { MaterialTestInsertion } from '../../core/job/material-test-insertion';

type Inserted = Extract<MaterialTestInsertion, { readonly kind: 'inserted' }>;

export type MaterialTestNotice = {
  readonly message: string;
  readonly variant: 'success' | 'warning';
};

export function materialTestInsertionNotice(result: Inserted): MaterialTestNotice {
  const what = `${result.name} (${result.grid.cells.length} cells)`;
  switch (result.placement.reason) {
    case 'free-space':
      return {
        message:
          `Added ${what} in free space on the bed and selected it. ` +
          'Turn on Selected artwork only to burn just the test.',
        variant: 'success',
      };
    case 'no-free-space':
      return {
        message:
          `Added ${what} at the origin corner: no free space on the bed was large enough, ` +
          'so it may overlap your artwork. Move it before burning.',
        variant: 'warning',
      };
    case 'larger-than-bed':
      return {
        message:
          `Added ${what} at the origin corner, but it is larger than the bed. ` +
          'Use fewer or smaller cells before burning.',
        variant: 'warning',
      };
    default:
      return result.placement.reason satisfies never;
  }
}
