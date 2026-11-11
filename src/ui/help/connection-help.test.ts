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

  it('covers Windows switching the USB port off and restarting mid-job (ADR-548)', () => {
    expect(CONNECTION_HELP_TEXT).toContain('USB selective suspend');
    expect(CONNECTION_HELP_TEXT).toContain('Active hours');
  });

  it('explains the WinUSB driver swap and its undo for USB K40 and galvo boards (ADR-702)', () => {
    expect(CONNECTION_HELP_TEXT).toContain('WinUSB');
    expect(CONNECTION_HELP_TEXT).toContain('Zadig');
    expect(CONNECTION_HELP_TEXT).toMatch(/go back\s+to LaserDRW or EZCad/);
    expect(CONNECTION_HELP_TEXT).toContain('udev');
    expect(CONNECTION_HELP_TEXT).toMatch(/simulators only/);
  });

  it('points to the full guide', () => {
    // The app ships without docs/, so the guide is the published page (S12-F1).
    expect(CONNECTION_HELP_TEXT).toContain('https://kerfdesk.com/docs/#troubleshooting');
    expect(CONNECTION_HELP_TEXT).not.toContain('docs/connection-troubleshooting.md');
  });
});
