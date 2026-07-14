import { describe, expect, it } from 'vitest';
import { cncPauseMessage, cncResumeBlockMessage } from './cnc-pause-resume-policy';

describe('CNC pause/resume policy', () => {
  it('blocks generic CNC Resume but leaves laser continuation unchanged', () => {
    expect(cncResumeBlockMessage('cnc')).toMatch(/cannot prove.*spindle/i);
    expect(cncResumeBlockMessage('laser')).toBeNull();
    expect(cncResumeBlockMessage(null)).toBeNull();
  });

  it('warns before CNC Pause that continuation requires manual recovery', () => {
    expect(cncPauseMessage('cnc')).toMatch(/cannot be resumed automatically/i);
    expect(cncPauseMessage('laser')).toBeNull();
  });
});
