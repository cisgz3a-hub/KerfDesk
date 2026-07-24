import { describe, expect, it } from 'vitest';
import { cncPauseMessage, cncResumeAdvisoryNotice } from './cnc-pause-resume-policy';

describe('CNC pause/resume policy', () => {
  it('surfaces a spindle-check advisory for CNC Resume and nothing for laser', () => {
    expect(cncResumeAdvisoryNotice('cnc')).toMatch(/confirm the spindle/i);
    expect(cncResumeAdvisoryNotice('laser')).toBeNull();
    expect(cncResumeAdvisoryNotice(null)).toBeNull();
  });

  it('tells the operator a paused CNC job can be resumed', () => {
    expect(cncPauseMessage('cnc')).toMatch(/can be resumed/i);
    expect(cncPauseMessage('laser')).toBeNull();
  });
});
