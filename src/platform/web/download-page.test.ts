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

  it('walks the unsigned Windows installer past the browser hold, then SmartScreen (U1-P2-2)', () => {
    const page = downloadPage();
    const steps = page.slice(
      page.indexOf('id="commercial-steps"'),
      page.indexOf('</ol>', page.indexOf('id="commercial-steps"')),
    );
    const titles = [...steps.matchAll(/<h3>([^<]+)<\/h3>/g)].map((match) => match[1]);

    expect(page).toContain('Install in four steps');
    expect(titles).toEqual([
      'Keep the download',
      'Open the installer',
      'Allow it in SmartScreen',
      'Start using KerfDesk',
    ]);
    // Microsoft's documented Edge path for an unknown file (Learn, "Microsoft
    // Edge support for Microsoft Defender SmartScreen").
    expect(steps).toMatch(
      /<strong>Keep<\/strong>,\s+<strong>Show more<\/strong> and\s+<strong>Keep anyway<\/strong>/,
    );
    expect(steps).toContain("isn't code-signed yet");
    expect(steps).toContain('<strong>More info</strong>');
    expect(steps).toContain('<strong>Run anyway</strong>');
    expect(steps).toContain('<strong>Make your first project</strong>');
  });

  it('keeps the licensed Windows trial separate from the free Preview', () => {
    const page = downloadPage();
    const commercial = page.slice(
      page.indexOf('aria-labelledby="commercial-heading"'),
      page.indexOf('aria-labelledby="preview-heading"'),
    );

    expect(commercial).toContain('Free, with a 30-day Pro trial');
    // ADR-540: the app always runs Free; only the Pro tools need the trial or a licence.
    expect(commercial).toContain('KerfDesk Free has no time limit.');
    expect(commercial).not.toContain('Every feature is included for 30 days');
    expect(commercial).toContain('id="commercial-status" role="status"');
    expect(commercial).toMatch(/<a class="download" id="commercial-download" hidden>/);
    expect(commercial).not.toContain('data-preview-suffix');
    // Only the verified script may give the installer link an href; static links
    // in this section may open checkout or jump within the page, never download.
    expect(commercial).not.toMatch(/<a class="download"[^>]*\shref=/);
    const hrefs = [...commercial.matchAll(/\shref="([^"]*)"/g)].map((match) => match[1] ?? '');
    expect(hrefs.every((href) => href === '/buy.html' || href.startsWith('#'))).toBe(true);
    // Visitors on a phone cannot install Windows software, so the page must offer checkout.
    expect(hrefs).toContain('/buy.html');
    expect(page).toContain('Free · unsigned · manual updates');
    expect(page.indexOf('commercial-heading')).toBeLessThan(page.indexOf('preview-heading'));
  });

  it('offers Mac and Linux editions only through verified links, with honest install steps (ADR-613)', () => {
    const page = downloadPage();
    const platforms = page.slice(
      page.indexOf('aria-labelledby="platforms-heading"'),
      page.indexOf('aria-labelledby="preview-heading"'),
    );
    expect(page.indexOf('commercial-heading')).toBeLessThan(page.indexOf('platforms-heading'));
    expect(
      [...platforms.matchAll(/data-platform-file="([^"]+)"/g)].map((match) => match[1]),
    ).toEqual(['macos-arm64.dmg', 'macos-x64.dmg', 'linux-amd64.deb', 'linux-x86_64.AppImage']);
    // Every download and manifest link starts hidden with no address until the script verifies it.
    expect(platforms).not.toMatch(/<a class="download[^"]*"[^>]*\shref=/);
    expect(platforms).not.toMatch(/data-platform-manifest[^>]*\shref=/);
    expect(platforms.match(/data-platform-file="[^"]+"\s+hidden/g)).toHaveLength(4);
    // Pro is mentioned only once a release is verified.
    expect(platforms.match(/data-platform-edition hidden/g)).toHaveLength(2);
    expect(platforms.match(/data-platform-pro hidden/g)).toHaveLength(2);
    expect(platforms.match(/role="status" data-platform-status/g)).toHaveLength(2);
    expect(platforms).toContain('id="macos"');
    expect(platforms).toContain('id="linux"');
    expect(platforms).toContain('<strong>Open Anyway</strong>');
    expect(platforms).toContain('<strong>Always Allow</strong>');
    expect(platforms).toContain('sudo apt install ./KerfDesk-&lt;version&gt;-linux-amd64.deb');
    expect(platforms).toContain('recommended on Ubuntu 24.04 and newer');
    expect(platforms).toContain('sudo usermod -aG dialout $USER');
    expect(platforms).toContain('<code>uucp</code>');
    expect(platforms).toMatch(/never downloads or installs a Mac or Linux update by\s+itself/);
  });

  it('keeps Linux users on the web app', () => {
    const page = downloadPage();

    expect(page).toContain('<strong>Linux:</strong>');
    expect(page).toContain('there is no Linux desktop Preview yet');
    expect(page).toContain('href="https://kerfdesk.com"');
  });
});
