import { describe, expect, it } from 'vitest';
import { expandUserMacroTemplate, parseUserMacroTemplate } from './user-macro-template';

describe('user macro template parsing', () => {
  it('discovers distinct placeholders in first-occurrence order', () => {
    expect(parseUserMacroTemplate('G1 X{{x}} Y{{y_2}} F{{feed}} X{{x}}')).toEqual({
      kind: 'ok',
      template: 'G1 X{{x}} Y{{y_2}} F{{feed}} X{{x}}',
      variables: ['x', 'y_2', 'feed'],
    });
    expect(parseUserMacroTemplate('$I')).toEqual({
      kind: 'ok',
      template: '$I',
      variables: [],
    });
  });

  it.each(['', '   '])('rejects an empty command template %#', (template) => {
    expect(parseUserMacroTemplate(template)).toMatchObject({ kind: 'empty-template' });
  });

  it.each(['G0 X1\nM3', 'G0 X1\rM3', 'G0 X1\u2028M3', 'G0 X1\u2029M3'])(
    'rejects multiline templates %#',
    (template) => {
      expect(parseUserMacroTemplate(template)).toMatchObject({ kind: 'multiline-template' });
    },
  );

  it.each(['G0\tX1', 'G0\u0000X1', 'G0\u007fX1', 'G0\u0085X1'])(
    'rejects C0, DEL, and C1 control characters %#',
    (template) => {
      expect(parseUserMacroTemplate(template)).toMatchObject({ kind: 'control-character' });
    },
  );

  it.each([
    'G0 X{value}',
    'G0 X{{value}',
    'G0 Xvalue}}',
    'G0 X{{}}',
    'G0 X{{2x}}',
    'G0 X{{x-y}}',
    'G0 X{{x}}}',
    'G0 X{{{x}}}',
  ])('reports malformed placeholders for %#', (template) => {
    expect(parseUserMacroTemplate(template)).toMatchObject({
      kind: 'malformed-placeholder',
      index: expect.any(Number),
    });
  });
});

describe('user macro template expansion', () => {
  it('reuses one signed decimal value for repeated placeholders', () => {
    expect(
      expandUserMacroTemplate('G1 X{{offset}} Y{{offset}} F{{feed}}', {
        offset: '-0.25',
        feed: '+1200',
      }),
    ).toEqual({ kind: 'ok', command: 'G1 X-0.25 Y-0.25 F+1200' });
  });

  it.each(['0', '-1', '+2', '1.25', '.5', '-.5', '1.'])(
    'accepts the ordinary finite decimal %s',
    (value) => {
      expect(expandUserMacroTemplate('G0 X{{x}}', { x: value })).toEqual({
        kind: 'ok',
        command: `G0 X${value}`,
      });
    },
  );

  it('reports the first missing variable without substituting a partial command', () => {
    expect(expandUserMacroTemplate('G0 X{{x}} Y{{y}}', { x: '1' })).toMatchObject({
      kind: 'missing-variable',
      variable: 'y',
    });
  });

  it('does not treat inherited object properties as supplied variable values', () => {
    expect(expandUserMacroTemplate('G0 X{{toString}}', {})).toMatchObject({
      kind: 'missing-variable',
      variable: 'toString',
    });
    expect(expandUserMacroTemplate('G0 X{{toString}}', { toString: '2.5' })).toEqual({
      kind: 'ok',
      command: 'G0 X2.5',
    });
  });

  it.each(['', ' 1', '1 ', '1e3', 'NaN', 'Infinity', '0x10', '1 M3', '1;M3', '1\nM3', '{{other}}'])(
    'rejects non-decimal or injectable value %#',
    (value) => {
      expect(expandUserMacroTemplate('G0 X{{x}}', { x: value })).toMatchObject({
        kind: 'invalid-variable',
        variable: 'x',
      });
    },
  );

  it('returns the structured template error before reading variable values', () => {
    expect(expandUserMacroTemplate('G0 X{{x}', { x: '1' })).toMatchObject({
      kind: 'invalid-template',
      error: { kind: 'malformed-placeholder' },
    });
  });
});
