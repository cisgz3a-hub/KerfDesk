import { describe, expect, it } from 'vitest';
import { formatDatePattern } from './date-pattern';
import { parseVariableTemplateSource, variableTemplateToSource } from './template-source';

const DATE = new globalThis.Date(2026, 9, 3, 14, 5, 9); // Saturday 3 October 2026, 14:05:09 local

describe('custom date formats', () => {
  it('formats the strftime codes in local time and keeps unknown codes as typed', () => {
    expect(formatDatePattern(DATE, '%Y-%m-%d %H:%M:%S')).toBe('2026-10-03 14:05:09');
    expect(formatDatePattern(DATE, '%e %b %y, %A %B, %I %p, day %j, 100%%')).toBe(
      '3 Oct 26, Saturday October, 02 PM, day 276, 100%',
    );
    expect(formatDatePattern(DATE, 'lot %Q')).toBe('lot %Q');
  });

  it('round-trips a {{date:...}} field through the template source', () => {
    const parsed = parseVariableTemplateSource('Made {{date:%d/%m/%Y}}');
    expect(parsed.ok && parsed.template.tokens[1]).toEqual({
      kind: 'date-time',
      format: 'custom',
      pattern: '%d/%m/%Y',
    });
    expect(parsed.ok && variableTemplateToSource(parsed.template)).toBe('Made {{date:%d/%m/%Y}}');
    expect(parseVariableTemplateSource('{{date: }}').ok).toBe(false);
  });
});
