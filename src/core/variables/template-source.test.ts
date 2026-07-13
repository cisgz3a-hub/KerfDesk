import { describe, expect, it } from 'vitest';
import { parseVariableTemplateSource, variableTemplateToSource } from './template-source';

describe('variable template source', () => {
  it('parses and roundtrips every typed field', () => {
    const source =
      'ID-{{serial:4}} {{csv:name}} {{date}} {{time}} {{datetime}} {{power}}/{{speed}}/{{passes}}/{{air}}';
    const result = parseVariableTemplateSource(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(variableTemplateToSource(result.template)).toBe(source);
    expect(result.template.tokens.some((token) => token.kind === 'csv')).toBe(true);
    expect(result.template.tokens.some((token) => token.kind === 'cut-setting')).toBe(true);
  });

  it('rejects unknown fields and unsafe serial widths', () => {
    expect(parseVariableTemplateSource('{{unknown}}')).toMatchObject({ ok: false });
    expect(parseVariableTemplateSource('{{serial:0}}')).toMatchObject({ ok: false });
    expect(parseVariableTemplateSource('plain text')).toMatchObject({ ok: false });
  });
});
