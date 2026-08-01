import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RELEASES_URL = 'https://github.com/cisgz3a-hub/KerfDesk/releases';

function downloadPage(): string {
  return readFileSync(join(process.cwd(), 'public', 'download.html'), 'utf8');
}

describe('desktop Preview download page', () => {
  it('routes every desktop choice to the public KerfDesk release list', () => {
    const releaseLinks = downloadPage().split(`class="download" href="${RELEASES_URL}"`).length - 1;

    expect(releaseLinks).toBe(3);
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

  it('uses no mutable update alias or executable page script', () => {
    const page = downloadPage();

    expect(page).not.toContain('dl.kerfdesk.com');
    expect(page).not.toContain('kerfdesk-latest');
    expect(page).not.toContain('/releases/latest');
    expect(page).not.toContain('latest.yml');
    expect(page).not.toMatch(/<script\b/i);
  });

  it('keeps Linux users on the web app', () => {
    const page = downloadPage();

    expect(page).toContain('<strong>Linux:</strong>');
    expect(page).toContain('there is no Linux desktop Preview yet');
    expect(page).toContain('href="https://kerfdesk.com"');
  });
});
