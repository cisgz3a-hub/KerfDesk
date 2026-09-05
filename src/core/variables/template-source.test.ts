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

  it('preserves configured serial fields and CSV column names verbatim', () => {
    const template = {
      tokens: [
        { kind: 'serial' as const, prefix: 'LOT {{A}}: ', width: 6, offset: -3 },
        { kind: 'literal' as const, value: ' / ' },
        { kind: 'csv' as const, column: '  fixture {{name}} %  ' },
      ],
    };

    const result = parseVariableTemplateSource(variableTemplateToSource(template));

    expect(result).toEqual({ ok: true, template });
  });

  it('encodes generated non-NFC columns while preserving legacy raw tokens verbatim', () => {
    const column = 'Cafe\u0301';
    const template = { tokens: [{ kind: 'csv' as const, column }] };
    const source = variableTemplateToSource(template);

    expect(source).toMatch(/^\{\{csv-json:/);
    expect(parseVariableTemplateSource(source)).toEqual({ ok: true, template });
    expect(parseVariableTemplateSource(`{{csv:${column}}}`)).toEqual({ ok: true, template });
  });

  it.each(['Literal {{speed}}: ', '{{unknown}}', '{{serial:4}}', '{{', '}}', '{{literal-json:x}}'])(
    'round-trips literal delimiters without treating %s as a variable field',
    (value) => {
      const template = {
        tokens: [
          { kind: 'literal' as const, value },
          { kind: 'serial' as const, prefix: '', width: 4 },
        ],
      };
      expect(parseVariableTemplateSource(variableTemplateToSource(template))).toEqual({
        ok: true,
        template,
      });
    },
  );

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'rejects inherited tag %s as an unknown field',
    (tag) => {
      expect(parseVariableTemplateSource(`{{${tag}}}`)).toEqual({
        ok: false,
        message: `Unknown variable field "${tag}".`,
      });
    },
  );

  it.each(['%', 'null', '42', '%7B%7D'])(
    'rejects malformed encoded literal %s through a structured error',
    (value) => {
      expect(parseVariableTemplateSource(`{{literal-json:${value}}}{{serial:4}}`)).toEqual({
        ok: false,
        message: 'Choose valid literal text.',
      });
    },
  );

  it('preserves literal braces split across adjacent tokens', () => {
    const template = {
      tokens: [
        { kind: 'literal' as const, value: '{' },
        { kind: 'literal' as const, value: '{speed}}' },
        { kind: 'serial' as const, prefix: '', width: 4 },
      ],
    };
    expect(parseVariableTemplateSource(variableTemplateToSource(template))).toEqual({
      ok: true,
      template,
    });
  });
});
