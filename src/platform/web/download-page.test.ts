import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function downloadPage(): string {
  return readFileSync(join(process.cwd(), 'public', 'download.html'), 'utf8');
}

describe('Windows download page', () => {
  it('links to the stable R2 installer object', () => {
    expect(downloadPage()).toContain(
      'https://dl.kerfdesk.com/desktop/kerfdesk-latest-x64-setup.exe',
    );
  });

  it('describes manual updates truthfully while the unsigned channel is disabled', () => {
    const page = downloadPage();
    expect(page).toContain('Updates are installed manually until code signing is enabled.');
    expect(page).not.toContain('Auto-updating.');
    expect(page).not.toContain('keeps itself up to date automatically');
  });
});
