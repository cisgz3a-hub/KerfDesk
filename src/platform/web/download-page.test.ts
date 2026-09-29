import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function downloadPage(): string {
  return readFileSync(join(process.cwd(), 'public', 'download.html'), 'utf8');
}

describe('desktop Preview download page', () => {
  it('enables versioned downloads only after signature verification', () => {
    const page = downloadPage();
    expect(page).toContain('src="/desktop-downloads.mjs"');
    expect(page).toContain('dl.kerfdesk.com');
    expect(page).toContain('id="release-status" role="status"');
    expect(page.match(/class="download" data-preview-suffix="[^"]+" hidden/g)).toHaveLength(3);
    expect(page).not.toContain('github.com/cisgz3a-hub/KerfDesk/releases');
  });
  it('names each exact-version Preview asset pattern', () => {
    const page = downloadPage();

    expect(page).toContain('KerfDesk-&lt;version&gt;-windows-x64-setup.exe');
    expect(page).toContain('KerfDesk-&lt;version&gt;-macos-x64.dmg');
    expect(page).toContain('KerfDesk-&lt;version&gt;-macos-arm64.dmg');
  });

  it('documents unsigned manual installation and updates', () => {
    const page = downloadPage();

    expect(page).toContain('Preview updates are manual.');
    expect(page).toMatch(/never downloads or installs an\s+unsigned update/);
    expect(page).toContain('Windows protected your PC');
    expect(page).toContain('More info');
    expect(page).toContain('Run anyway');
    expect(page).toContain('unsigned and unnotarized');
    expect(page).toContain('Control-click KerfDesk.app');
    expect(page).toContain('Privacy &amp; Security');
    expect(page).toContain('Open Anyway');
  });

  it('uses no executable update alias and isolates download-page network access', () => {
    const page = downloadPage();

    expect(page).toContain("connect-src 'self' https://dl.kerfdesk.com");
    expect(page).not.toContain('kerfdesk-latest');
    expect(page).not.toContain('/releases/latest');
    expect(page).not.toContain('latest.yml');
    expect(page).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  });

  it('keeps the licensed Windows trial separate from the free Preview', () => {
    const page = downloadPage();
    const commercial = page.slice(
      page.indexOf('aria-labelledby="commercial-heading"'),
      page.indexOf('aria-labelledby="preview-heading"'),
    );

    expect(commercial).toContain('Licensed edition · 30-day full trial');
    expect(commercial).toContain('id="commercial-status" role="status"');
    expect(commercial).toMatch(/<a class="download" id="commercial-download" hidden>/);
    expect(commercial).not.toContain('data-preview-suffix');
    expect(commercial).not.toMatch(/\shref=/);
    expect(page).toContain('Free · unsigned · manual updates');
    expect(page.indexOf('commercial-heading')).toBeLessThan(page.indexOf('preview-heading'));
  });

  it('keeps Linux users on the web app', () => {
    const page = downloadPage();

    expect(page).toContain('<strong>Linux:</strong>');
    expect(page).toContain('there is no Linux desktop Preview yet');
    expect(page).toContain('href="https://kerfdesk.com"');
  });
});
