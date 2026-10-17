import { describe, expect, it } from 'vitest';
import { isApplePlatform, isLinuxDesktop } from './operating-system';
import { shortcutLabel } from './shortcut-label';

const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const LINUX_CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

describe('shortcut labels on each keyboard (ADR-606)', () => {
  it('recognises a Mac by its platform or user agent, and nothing else', () => {
    expect(isApplePlatform({ platform: 'MacIntel', userAgent: MAC_CHROME })).toBe(true);
    expect(isApplePlatform({ platform: '', userAgent: MAC_CHROME })).toBe(true);
    expect(isApplePlatform({ platform: 'Win32', userAgent: WINDOWS_CHROME })).toBe(false);
    expect(isApplePlatform({ platform: 'Linux x86_64', userAgent: LINUX_CHROME })).toBe(false);
    expect(isApplePlatform(undefined)).toBe(false);
  });

  it('recognises desktop Linux, but not Android or ChromeOS', () => {
    const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0.0.0';
    const chromeOs = 'Mozilla/5.0 (X11; CrOS x86_64 16181.0.0) AppleWebKit/537.36 Chrome/140.0.0.0';
    expect(isLinuxDesktop({ platform: 'Linux x86_64', userAgent: LINUX_CHROME })).toBe(true);
    expect(isLinuxDesktop({ platform: 'Linux armv81', userAgent: android })).toBe(false);
    expect(isLinuxDesktop({ platform: 'Linux x86_64', userAgent: chromeOs })).toBe(false);
    expect(isLinuxDesktop({ platform: 'Win32', userAgent: WINDOWS_CHROME })).toBe(false);
    expect(isLinuxDesktop(undefined)).toBe(false);
  });

  it('keeps the Windows and Linux wording unchanged', () => {
    expect(shortcutLabel('Ctrl+Shift+V', false)).toBe('Ctrl+Shift+V');
    expect(shortcutLabel('Alt (hold while dragging)', false)).toBe('Alt (hold while dragging)');
  });

  it('writes Mac chords with symbols in Apple order: Option, Shift, Command', () => {
    expect(shortcutLabel('Ctrl+S', true)).toBe('⌘S');
    expect(shortcutLabel('Ctrl+Shift+V', true)).toBe('⇧⌘V');
    expect(shortcutLabel('Alt+Shift+H', true)).toBe('⌥⇧H');
    expect(shortcutLabel('Ctrl+Alt+Shift+[', true)).toBe('⌥⇧⌘[');
    expect(shortcutLabel('Ctrl+,', true)).toBe('⌘,');
    expect(shortcutLabel('Ctrl+.', true)).toBe('⌘.');
  });

  it('uses Mac key symbols for arrows, page keys and Return', () => {
    expect(shortcutLabel('Alt+Left / Alt+Right', true)).toBe('⌥← / ⌥→');
    expect(shortcutLabel('Alt+PgUp', true)).toBe('⌥⇞');
    expect(shortcutLabel('Ctrl+Enter', true)).toBe('⌘↩');
    expect(shortcutLabel('Shift+arrows', true)).toBe('⇧ arrows');
  });

  it('names a modifier held on its own, and leaves plain keys alone', () => {
    expect(shortcutLabel('Ctrl (hold while moving)', true)).toBe('⌘ (hold while moving)');
    expect(shortcutLabel('Alt (hold while dragging)', true)).toBe('⌥ (hold while dragging)');
    expect(shortcutLabel('Ctrl+Shift+] / Ctrl+Shift+[', true)).toBe('⇧⌘] / ⇧⌘[');
    expect(shortcutLabel('PageUp/PageDown', true)).toBe('PageUp/PageDown');
    expect(shortcutLabel('Delete/Backspace', true)).toBe('Delete/Backspace');
    expect(shortcutLabel('+/-', true)).toBe('+/-');
    expect(shortcutLabel('Esc', true)).toBe('Esc');
  });
});
