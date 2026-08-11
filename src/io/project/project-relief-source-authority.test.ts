import { describe, expect, it } from 'vitest';
import { validateSingleReliefSource } from './project-relief-source-authority';

describe('validateSingleReliefSource schema-v5 authority', () => {
  it.each(['targetHeightMm', 'widthAspect'] as const)(
    'rejects heightfields carrying legacy object field %s',
    (field) => {
      expect(
        validateSingleReliefSource(
          { [field]: field === 'targetHeightMm' ? 10 : 'preserve' },
          { kind: 'heightfield-v1' },
          'scene.objects[0]',
        ),
      ).toBe('invalid `scene.objects[0]`: relief must contain exactly one source arm');
    },
  );

  it('accepts the legacy object geometry fields on a legacy source', () => {
    expect(
      validateSingleReliefSource(
        { targetHeightMm: 10, widthAspect: 'preserve' },
        { kind: 'legacy-mesh' },
        'scene.objects[0]',
      ),
    ).toBeNull();
  });
});
