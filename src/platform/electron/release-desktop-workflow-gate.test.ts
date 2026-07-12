import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

// Structural gate for the desktop release pipeline (ADR-024). Green CI can't
// prove the installer runs, but it CAN pin the invariants that keep the release
// correct: tag-gated, verified before packaging, version-pinned, unsigned until
// a cert exists, and publishing to the exact origin electron-updater reads from.
describe('Desktop release workflow gate (ADR-024/135)', () => {
  const workflow = repoFile('.github/workflows/release-desktop.yml');

  it('builds only on version tags, on a Windows runner', () => {
    expect(workflow).toContain("tags: ['v*']");
    expect(workflow).toContain('runs-on: windows-latest');
  });

  it('checks text out as LF on Windows so the Prettier release gate is stable', () => {
    expect(repoFile('.gitattributes')).toContain('* text=auto eol=lf');
  });

  it('runs the full release:check gate before packaging the installer', () => {
    const gateIndex = workflow.indexOf('run: pnpm release:check');
    const buildIndex = workflow.indexOf('electron-builder --win --x64');
    expect(gateIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(gateIndex).toBeLessThan(buildIndex);
  });

  it('pins the installer version to the tag and emits the update feed locally', () => {
    expect(workflow).toContain('-c.extraMetadata.version=');
    expect(workflow).toContain('--publish never');
  });

  it('keeps signing opt-in — unsigned until CSC secrets exist (ADR-024 §5)', () => {
    expect(workflow).toContain('CSC_LINK: ${{ secrets.CSC_LINK }}');
    expect(workflow).toContain('CSC_IDENTITY_AUTO_DISCOVERY');
  });

  it('keeps automatic updates disabled while releases may be unsigned', () => {
    expect(repoFile('electron/main.ts')).toContain(
      'const IS_DESKTOP_UPDATE_CHANNEL_TRUSTED = false',
    );
  });

  it('publishes to R2 only for tag pushes, never a manual dry run', () => {
    expect(workflow).toContain("if: github.ref_type == 'tag'");
    expect(workflow).toContain('wrangler r2 object put');
  });

  it('uploads the feed to the same origin electron-updater reads from', () => {
    // electron-updater reads latest.yml from electron-builder.yml's publish.url;
    // the CI upload must target a bucket served at that same origin, or a
    // released app's auto-update check 404s.
    expect(repoFile('electron-builder.yml')).toContain('url: https://dl.kerfdesk.com/desktop');
    expect(workflow).toContain('kerfdesk-downloads');
    expect(workflow).toContain('desktop/latest.yml');
  });
});
