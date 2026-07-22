import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

// Structural gate for the desktop release pipeline (ADR-024). Green CI can't
// prove the installer runs, but it CAN pin the invariants that keep the release
// correct: tag-gated, verified before packaging, version-pinned, signed before
// publishing, and targeting the exact origin electron-updater reads from.
describe('Desktop release workflow gate (ADR-024/135/142/248)', () => {
  const workflow = repoFile('.github/workflows/release-desktop-stable.yml');
  const dryRunWorkflow = repoFile('.github/workflows/release-desktop-dry-run.yml');
  const deployWorkflow = repoFile('.github/workflows/deploy.yml');
  const tagPushPredicate = "if: github.event_name == 'push' && github.ref_type == 'tag'";

  it('production listens only to version-tag pushes on Windows', () => {
    expect(existsSync(join(process.cwd(), '.github/workflows/release-desktop.yml'))).toBe(false);
    expect(workflow).toContain("tags: ['v*', '!v*-*']");
    expect(workflow).not.toMatch(/^\s{2}workflow_dispatch:/m);
    expect(workflow).toContain('runs-on: windows-latest');
    expect(workflow).toContain('environment: desktop-production');
  });

  it('puts manual packaging in a credential-free dispatch-only workflow', () => {
    expect(dryRunWorkflow).toMatch(/^\s{2}workflow_dispatch:/m);
    expect(dryRunWorkflow).not.toContain('tags:');
    expect(dryRunWorkflow).not.toContain('${{ secrets.');
    expect(dryRunWorkflow).not.toContain('WIN_CSC_LINK');
    expect(dryRunWorkflow).not.toContain('WIN_CSC_KEY_PASSWORD');
    expect(dryRunWorkflow).not.toContain('wrangler r2 object put');
    expect(dryRunWorkflow).not.toContain('gh release');
    expect(dryRunWorkflow).toContain('actions/upload-artifact@v7');
    expect(dryRunWorkflow).toContain('VERSION="0.0.0-dispatch.${GITHUB_RUN_NUMBER}"');
    expect(dryRunWorkflow).toContain('--config.extraMetadata.kerfdeskUpdateChannelTrusted=false');
    expect(dryRunWorkflow).toContain('--config.forceCodeSigning=false');
    expect(dryRunWorkflow).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'");
    expect(dryRunWorkflow.indexOf('run: pnpm release:check')).toBeLessThan(
      dryRunWorkflow.indexOf('electron-builder --win --x64'),
    );
  });

  it('checks text out as LF on Windows so the Prettier release gate is stable', () => {
    expect(repoFile('.gitattributes')).toContain('* text=auto eol=lf');
  });

  it('rejects the tag before requesting the production environment', () => {
    const validationJob = workflow.indexOf('validate-stable-tag:');
    const validator = workflow.indexOf('node scripts/validate-release-tag.mjs stable');
    const buildJob = workflow.indexOf('build-windows:');
    const environment = workflow.indexOf('environment: desktop-production');
    expect(validationJob).toBeGreaterThanOrEqual(0);
    expect(validator).toBeGreaterThan(validationJob);
    expect(buildJob).toBeGreaterThan(validator);
    expect(workflow.slice(buildJob, environment)).toContain('needs: validate-stable-tag');
    expect(environment).toBeGreaterThan(buildJob);
  });

  it('rejects non-stable or lightweight tags before signing and R2 publication', () => {
    const validatorIndex = workflow.indexOf(
      'node scripts/validate-release-tag.mjs stable "${GITHUB_REF_NAME}"',
    );
    const signingIndex = workflow.indexOf('Require tag-release signing credentials');
    const publishIndex = workflow.indexOf('Publish installer + update feed to Cloudflare R2');
    expect(validatorIndex).toBeGreaterThanOrEqual(0);
    expect(workflow.slice(0, validatorIndex)).toContain(tagPushPredicate);
    expect(validatorIndex).toBeLessThan(signingIndex);
    expect(validatorIndex).toBeLessThan(publishIndex);
  });

  it('runs the full release:check gate before packaging the installer', () => {
    const repoGuardIndex = workflow.indexOf('run: pnpm guard:repo');
    const gateIndex = workflow.indexOf('run: pnpm release:check');
    const buildIndex = workflow.indexOf('electron-builder --win --x64');
    expect(repoGuardIndex).toBeGreaterThanOrEqual(0);
    expect(gateIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(repoGuardIndex).toBeLessThan(gateIndex);
    expect(gateIndex).toBeLessThan(buildIndex);
  });

  it('pins the installer version to the tag and emits the update feed locally', () => {
    expect(workflow).toContain('--config.extraMetadata.version=');
    expect(workflow).toContain('--publish never');
  });

  it('uses public KerfDesk names for the stable installer and shortcuts', () => {
    const builder = repoFile('electron-builder.yml');

    expect(builder).toMatch(/^productName: KerfDesk$/m);
    expect(builder).toContain('artifactName: KerfDesk-${version}-windows-${arch}-setup.${ext}');
    expect(builder).toContain('shortcutName: KerfDesk');
    expect(builder).toContain('appId: dev.laserforge.app');
    expect(workflow).toContain('KerfDesk-$env:VERSION-windows-x64-setup.exe');
    expect(workflow).toContain('KerfDesk-${VERSION}-windows-x64-setup.exe');
    expect(workflow).not.toContain('LaserForge-2.0-${VERSION}-x64-setup.exe');
  });

  it('fails tag releases closed unless signing credentials and a valid signature exist', () => {
    const requireStart = workflow.indexOf('Require tag-release signing credentials');
    const signedStart = workflow.indexOf('Build signed Windows installer + update feed');
    const verifyStart = workflow.indexOf('Verify signed tag installer');
    const uploadStart = workflow.indexOf('Upload installer + update feed as workflow artifact');
    const signedBuild = workflow.slice(signedStart, verifyStart);
    expect(workflow.slice(requireStart, signedStart)).toContain(tagPushPredicate);
    expect(signedBuild).toContain(tagPushPredicate);
    expect(signedBuild).toContain('WIN_CSC_LINK: ${{ secrets.STABLE_WINDOWS_CSC_LINK }}');
    expect(signedBuild).not.toContain('secrets.CSC_LINK');
    expect(signedBuild).toContain('--config.forceCodeSigning=true');
    expect(workflow.slice(verifyStart, uploadStart)).toContain(tagPushPredicate);
    expect(workflow).toContain("$signature.Status -ne 'Valid'");
  });

  it('uses the actual tag-push predicate on every production-sensitive step', () => {
    expect(workflow.split(tagPushPredicate)).toHaveLength(6);
  });

  it('embeds update trust only in signed tag-push builds and reads it fail-closed', () => {
    const signedStart = workflow.indexOf('Build signed Windows installer + update feed');
    const verifyStart = workflow.indexOf('Verify signed tag installer');
    const signedBuild = workflow.slice(signedStart, verifyStart);
    expect(signedBuild).toContain('--config.extraMetadata.kerfdeskUpdateChannelTrusted=true');
    expect(repoFile('electron/main.ts')).toContain(
      'readDesktopUpdateChannelTrust(app.getAppPath())',
    );
    expect(repoFile('electron-builder.yml')).toContain('verifyUpdateCodeSignature: true');
  });

  it('publishes to R2 only for tag pushes, never a manual dry run', () => {
    const publishIndex = workflow.indexOf('Publish installer + update feed to Cloudflare R2');
    const publishBlock = workflow.slice(publishIndex);
    expect(publishBlock).toContain(tagPushPredicate);
    expect(publishBlock).toContain('secrets.STABLE_R2_API_TOKEN');
    expect(publishBlock).not.toContain('secrets.CLOUDFLARE_API_TOKEN');
    expect(workflow).toContain('wrangler r2 object put');
    expect(workflow.indexOf('Verify signed tag installer')).toBeLessThan(publishIndex);
  });

  it('keeps web deployment on newly named Pages-only credentials', () => {
    expect(deployWorkflow).toContain('secrets.PAGES_CLOUDFLARE_API_TOKEN');
    expect(deployWorkflow).toContain('secrets.PAGES_CLOUDFLARE_ACCOUNT_ID');
    expect(deployWorkflow).not.toContain('${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(deployWorkflow).not.toContain('${{ secrets.CLOUDFLARE_ACCOUNT_ID }}');
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
