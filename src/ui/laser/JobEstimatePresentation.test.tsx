import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EstimateBadge, LARGE_JOB_TIME_TITLE, startJobTitle } from './JobEstimatePresentation';

describe('large-job estimate wording (UX audit U3-P3-5)', () => {
  it('says where the time is instead of "large job" and "traces"', () => {
    const html = renderToStaticMarkup(<EstimateBadge estimate={{ kind: 'too-large' }} />);
    expect(html).toContain('time: see Preview');
    expect(html).toContain('open Preview to calculate the time');
    expect(html).not.toContain('traces');
  });

  it('gives Start the same reason', () => {
    expect(startJobTitle({ kind: 'too-large' }, 'job')).toBe(LARGE_JOB_TIME_TITLE);
  });
});
