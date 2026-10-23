import { expect, it } from 'vitest';
import { ciBudgetMs } from '../../__fixtures__/ci-budget';
import { redactSupportReportText } from './support-report-redaction';

it('bounds redaction work for a long hyphenated token that is not a secret key', () => {
  const input = 'a-'.repeat(60_000);
  const start = performance.now();
  expect(redactSupportReportText(input)).toBe(input);
  expect(performance.now() - start).toBeLessThan(ciBudgetMs(500, 1_500));
});

it('keeps URL sign-in masking when punctuation touches the scheme', () => {
  expect(redactSupportReportText('-rtsp://camera:SyntheticPassword@host/live')).toBe(
    '-rtsp://[sign-in removed]@host/live',
  );
});
