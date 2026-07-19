import { describe, expect, it } from 'vitest';
import { normalizeCncFeedSource } from './normalize-cnc-feed-source';

describe('normalizeCncFeedSource', () => {
  it('accepts valid machine-starter provenance', () => {
    expect(
      normalizeCncFeedSource(
        {
          kind: 'machine-starter',
          starterId: 'neotronics-4040-shallow-wood-mdf',
          revision: 1,
        },
        undefined,
      ),
    ).toEqual({
      kind: 'machine-starter',
      starterId: 'neotronics-4040-shallow-wood-mdf',
      revision: 1,
    });
  });

  it('accepts material provenance only when it matches the layer material', () => {
    expect(
      normalizeCncFeedSource(
        {
          kind: 'material-recipe',
          materialKey: 'plywood-mdf',
          fluteCount: 2,
        },
        'plywood-mdf',
      ),
    ).toEqual({
      kind: 'material-recipe',
      materialKey: 'plywood-mdf',
      fluteCount: 2,
    });
  });

  it.each([
    null,
    [],
    { kind: 'machine-starter', starterId: '', revision: 1 },
    { kind: 'machine-starter', starterId: 'starter', revision: 0 },
    { kind: 'machine-starter', starterId: 'starter', revision: 1.5 },
    { kind: 'material-recipe', materialKey: 'unobtainium', fluteCount: 2 },
    { kind: 'material-recipe', materialKey: 'plywood-mdf', fluteCount: 0 },
    { kind: 'material-recipe', materialKey: 'plywood-mdf', fluteCount: 1.5 },
  ])('rejects malformed provenance %#', (value) => {
    expect(normalizeCncFeedSource(value, 'plywood-mdf')).toBeUndefined();
  });

  it('rejects a material recipe that disagrees with the layer material', () => {
    expect(
      normalizeCncFeedSource(
        {
          kind: 'material-recipe',
          materialKey: 'plywood-mdf',
          fluteCount: 2,
        },
        'hardwood',
      ),
    ).toBeUndefined();
  });
});
