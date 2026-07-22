import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Desktop Preview release workflow gate (ADR-248/249)', () => {
  const workflow = repoFile('.github/workflows/release-desktop-preview.yml');
  const builder = repoFile('electron-builder.preview.yml');
  const macVerifier = repoFile('scripts/verify-macos-preview-package.sh');

  it('accepts only Preview tag pushes and validates the annotated tag first', () => {
    expect(workflow).toContain("tags: ['v*-preview.*']");
    expect(repoFile('.github/workflows/release-desktop-stable.yml')).toContain(
      "tags: ['v*', '!v*-*']",
    );
    expect(workflow).not.toMatch(/^\s{2}workflow_dispatch:/m);
    expect(workflow).toContain(
      'node scripts/validate-release-tag.mjs preview "${GITHUB_REF_NAME}"',
    );
    expect(workflow.indexOf('validate-preview-tag:')).toBeLessThan(
      workflow.indexOf('build-windows:'),
    );
    expect(workflow).toContain('needs: validate-preview-tag');
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(5);
    expect(workflow).toContain('git merge-base --is-ancestor');
  });

  it('builds only Windows x64 and separate macOS x64/arm64 assets', () => {
    expect(workflow).toContain('runs-on: windows-latest');
    expect(workflow).toContain('electron-builder --win --x64');
    expect(workflow).toContain('runs-on: macos-15-intel');
    expect(workflow).toContain('electron-builder --mac --x64');
    expect(workflow).toContain('runs-on: macos-15');
    expect(workflow).toContain('electron-builder --mac --arm64');
    expect(workflow).toContain('needs: [build-windows, build-macos-x64, build-macos-arm64]');
    expect(builder).toMatch(/win:\s[\s\S]*target: nsis[\s\S]*- x64/);
    expect(builder).toMatch(/mac:\s[\s\S]*target:\s*\n\s*- dmg/);
    expect(builder).not.toMatch(/mac:\s[\s\S]*arch:\s*\n\s*- x64[\s\S]*- arm64/);
    expect(builder).not.toMatch(/^linux:/m);
  });

  it('uses canonical exact-version KerfDesk artifact names', () => {
    expect(builder).toContain('artifactName: KerfDesk-${version}-windows-${arch}-setup.${ext}');
    expect(builder).toContain('artifactName: KerfDesk-${version}-macos-${arch}.${ext}');
    expect(workflow).toContain('KerfDesk-${VERSION}-windows-x64-setup.exe');
    expect(workflow).toContain('KerfDesk-${VERSION}-macos-x64.dmg');
    expect(workflow).toContain('KerfDesk-${VERSION}-macos-arm64.dmg');
  });

  it('preserves Windows upgrade identity and sets the Mac bundle identity', () => {
    expect(builder).toMatch(/^appId: dev\.laserforge\.app$/m);
    expect(builder).toMatch(/mac:\s[\s\S]*appId: com\.kerfdesk\.app/);
    expect(builder).toMatch(/^productName: KerfDesk$/m);
    expect(builder).toContain('shortcutName: KerfDesk');
  });

  it('keeps Preview unsigned, unnotarized, and outside updater trust', () => {
    expect(builder).toMatch(/^forceCodeSigning: false$/m);
    expect(builder).toContain('kerfdeskUpdateChannelTrusted: false');
    expect(builder).toContain('kerfdeskDesktopReleaseChannel: preview');
    expect(builder).toMatch(/mac:\s[\s\S]*identity: null/);
    expect(builder).toContain('hardenedRuntime: false');
    expect(builder).toContain('notarize: false');
    expect(builder).toMatch(/dmg:\s[\s\S]*sign: false/);
    expect(builder).toContain('differentialPackage: false');
    expect(workflow).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'");
    expect(workflow).toContain('--config.forceCodeSigning=false');
    expect(workflow).toContain("$signature.Status -ne 'NotSigned'");
    expect(workflow).toContain('$machine -ne 0x8664');
    expect(macVerifier).toContain('lipo -archs');
    expect(`${workflow}\n${macVerifier}`).toContain(
      'node scripts/verify-packaged-preview-metadata.mjs',
    );
    expect(macVerifier).toContain('xcrun stapler validate');
  });

  it('ships legal material and pins required macOS permission metadata', () => {
    expect(builder).toContain('from: LICENSE');
    expect(builder).toContain('from: THIRD_PARTY_NOTICES.md');
    expect(builder).toContain('from: public/third-party-notices.txt');
    expect(builder).toContain("minimumSystemVersion: '12.0'");
    expect(builder).toContain('NSCameraUsageDescription:');
    expect(builder).toContain('NSLocalNetworkUsageDescription:');
    expect(`${workflow}\n${macVerifier}`).toContain('LICENSE.electron.txt');
    expect(`${workflow}\n${macVerifier}`).toContain('LICENSES.chromium.html');
    expect(macVerifier).toContain('Contents/Resources');
    expect(macVerifier).toContain('${electron_resources}/LICENSE');
    expect(workflow).toContain('Release verification and legal-closure gate');
  });

  it('cannot publish Preview updater metadata, R2 objects, or secret-backed output', () => {
    expect(builder).not.toMatch(/^publish:/m);
    expect(workflow).toContain('--publish never');
    expect(builder).toContain('writeUpdateInfo: false');
    expect(`${workflow}\n${macVerifier}`).toContain("-name 'latest*.yml'");
    expect(`${workflow}\n${macVerifier}`).toContain("-name '*.blockmap'");
    expect(workflow).not.toContain('wrangler r2');
    expect(workflow).not.toContain('dl.kerfdesk.com');
    expect(workflow).not.toContain('${{ secrets.');
    expect(workflow).not.toContain('environment:');
  });

  it('generates all integrity companions from the three built binaries', () => {
    const generation = workflow.indexOf('node scripts/generate-release-integrity.mjs');
    const draft = workflow.indexOf('gh release create');
    expect(generation).toBeGreaterThanOrEqual(0);
    expect(generation).toBeLessThan(draft);
    expect(workflow).toContain('SOURCE_SHA="$(git rev-parse HEAD)"');
    expect(workflow).toContain('PEELED_SHA="$(git rev-list -n 1 "${GITHUB_REF_NAME}")"');
    expect(workflow.slice(generation, draft)).toContain(
      '--source-repository "${GITHUB_REPOSITORY}"',
    );
    expect(workflow.slice(generation, draft)).toContain('--source-sha "${SOURCE_SHA}"');
    expect(workflow.slice(generation, draft)).toContain('--source-ref "${GITHUB_REF}"');
    expect(workflow.slice(generation, draft)).toContain('--signer-workflow "${SIGNER_WORKFLOW}"');
    expect(workflow.slice(generation, draft)).toContain('--artifact "${WIN_EXE}"');
    expect(workflow.slice(generation, draft)).toContain('--artifact "${MAC_X64_DMG}"');
    expect(workflow.slice(generation, draft)).toContain('--artifact "${MAC_ARM64_DMG}"');
    expect(workflow).toContain('KerfDesk-${VERSION}-SHA256SUMS.txt');
    expect(workflow).toContain('KerfDesk-${VERSION}-release-manifest.json');
    expect(workflow).toContain('KerfDesk-${VERSION}-sbom.cdx.json');
    expect(workflow).toContain('sha256sum --check');
  });

  it('attests native binaries at build time, then companions at publication', () => {
    expect(workflow.match(/uses: actions\/attest@[0-9a-f]{40} # v4/g)).toHaveLength(4);
    expect(workflow).toContain('Attest Windows binary on its native builder');
    expect(workflow).toContain('Attest macOS x64 binary on its native builder');
    expect(workflow).toContain('Attest macOS arm64 binary on its native builder');
    expect(workflow).toContain('release-assets/KerfDesk-*-SHA256SUMS.txt');
    expect(workflow).toContain('release-assets/KerfDesk-*-release-manifest.json');
    expect(workflow).toContain('release-assets/KerfDesk-*-sbom.cdx.json');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('attestations: write');
    expect(workflow).toContain('artifact-metadata: write');
    expect(workflow).toContain('gh attestation verify');
    expect(workflow).toContain('--source-digest "${SOURCE_SHA}"');
    expect(workflow).toContain('--source-ref "${GITHUB_REF}"');
    expect(workflow).toContain('--signer-workflow "${SIGNER_WORKFLOW}"');
    expect(workflow).toContain('--deny-self-hosted-runners');
    expect(workflow).not.toMatch(/uses: [^\s]+@v[0-9]+/);
  });

  it('publishes atomically from a verified draft as immutable prerelease, never latest', () => {
    const draft = workflow.indexOf('gh release create');
    const upload = workflow.indexOf('gh release upload');
    const compare = workflow.indexOf('diff -u expected-assets.txt actual-assets.txt');
    const publish = workflow.indexOf('gh release edit');
    expect(draft).toBeGreaterThanOrEqual(0);
    expect(draft).toBeLessThan(upload);
    expect(upload).toBeLessThan(compare);
    expect(compare).toBeLessThan(publish);
    expect(workflow.slice(draft, upload)).toContain('--verify-tag');
    expect(workflow.slice(draft, upload)).toContain('--draft');
    expect(workflow.slice(draft, upload)).toContain('--prerelease');
    expect(workflow.slice(draft, upload)).toContain('--latest=false');
    expect(workflow.slice(publish)).toContain('--draft=false');
    expect(workflow.slice(publish)).toContain('gh release verify');
    expect(workflow.slice(publish)).toContain('gh release verify-asset');
    expect(workflow.slice(publish)).toContain("--jq '.immutable'");
    expect(workflow.slice(publish)).toContain('X-GitHub-Api-Version: 2026-03-10');
    expect(workflow).not.toContain('/immutable-releases');
    expect(workflow.match(/git\/ref\/tags\/\$\{GITHUB_REF_NAME\}/g)).toHaveLength(2);
    expect(workflow).toContain('test "${target_sha}" = "${SOURCE_SHA}"');
    expect(workflow).toContain("steps.draft.outputs.already_published != 'true'");
    expect(workflow).toContain('gh release delete "${GITHUB_REF_NAME}" --yes');
    expect(workflow).toContain('release_source_sha=');
    expect(workflow).toContain('test "${release_source_sha}" = "${SOURCE_SHA}"');
    expect(workflow).toContain('diff -u expected-published-assets.txt actual-published-assets.txt');
    expect(workflow).toContain('gh release download "${GITHUB_REF_NAME}"');
    expect(workflow).toContain('sha256sum --check "KerfDesk-${VERSION}-SHA256SUMS.txt"');
    expect(workflow).toContain("jq -r '.sourceSha'");
    expect(workflow).not.toMatch(/\bgit tag\b|\bgit push\b/);
  });
});
