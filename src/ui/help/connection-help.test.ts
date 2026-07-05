import { describe, expect, it } from 'vitest';
import { CONNECTION_HELP_TEXT } from './connection-help';

describe('CONNECTION_HELP_TEXT', () => {
  // The text is the in-app answer to "why can't I connect?" — these are the
  // facts a stuck customer most needs, so a well-meaning trim can't silently
  // drop them. Grounded in the real transport (Web Serial → Chromium only)
  // and the real driver friction (CH340 needs a manual install on Windows).
  it('names the browsers that can connect and excludes the ones that cannot', () => {
    expect(CONNECTION_HELP_TEXT).toMatch(/Chrome/);
    expect(CONNECTION_HELP_TEXT).toMatch(/Edge/);
    expect(CONNECTION_HELP_TEXT).toMatch(/Firefox|Safari/);
  });

  it('covers the CH340 USB-to-serial driver, the top Windows connection fix', () => {
    expect(CONNECTION_HELP_TEXT).toMatch(/CH340/);
    expect(CONNECTION_HELP_TEXT).toMatch(/driver/i);
  });

  it('explains the connects-but-silent cases (alarm unlock, port already in use)', () => {
    expect(CONNECTION_HELP_TEXT).toMatch(/\$X/);
    expect(CONNECTION_HELP_TEXT).toMatch(/LightBurn|holding the port|another app/i);
  });

  it('notes RTSP cameras need ffmpeg but USB webcams do not', () => {
    expect(CONNECTION_HELP_TEXT).toMatch(/ffmpeg/);
    expect(CONNECTION_HELP_TEXT).toMatch(/USB webcam/i);
  });

  it('points to the full guide', () => {
    expect(CONNECTION_HELP_TEXT).toContain('docs/connection-troubleshooting.md');
  });
});
