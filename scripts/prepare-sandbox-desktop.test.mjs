import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPackage } from '@electron/asar';
import { finished } from 'node:stream/promises';
import verifySandboxPackage, {
  prepareSandboxMetadata,
  runSandboxPreparation,
  verifySandboxMetadata,
  writeSandboxPreparation,
} from './prepare-sandbox-desktop.mjs';
import { verifyCommercialMetadata } from './prepare-commercial-desktop.mjs';
import { isSandboxMetadata, SANDBOX_ORIGIN } from '../public/desktop-sandbox-contract.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INPUT = {
  sandboxOnly: true,
  version: '0.0.1',
  sourceSha: 'a'.repeat(40),
  publishedAt: '2026-09-30T01:00:00.000Z',
};
const requireBuilder = createRequire(import.meta.resolve('electron-builder'));
const { getConfig } = await import(
  pathToFileURL(requireBuilder.resolve('app-builder-lib/out/util/config/config.js')).href
);

test('sandbox release uses fixed isolated pins and cannot pass production publication', async () => {
  const metadata = prepareSandboxMetadata(INPUT);
  assert.equal(isSandboxMetadata(metadata), true);
  assert.equal(verifySandboxMetadata(metadata).sourceSha, INPUT.sourceSha);
  assert.equal(metadata.kerfdeskCommercialLicense.apiOrigin, SANDBOX_ORIGIN);
  assert.equal(metadata.kerfdeskUpdateChannelTrusted, false);
  const productionEntitlements = JSON.parse(
    await readFile(join(ROOT, 'public/desktop-licence-keys.json')),
  );
  const productionReleases = JSON.parse(
    await readFile(join(ROOT, 'public/desktop-release-keys.json')),
  );
  assert.throws(
    () => verifyCommercialMetadata(metadata, productionEntitlements, productionReleases),
    /Sandbox/u,
  );
  for (const input of [
    { ...INPUT, sandboxOnly: false },
    { ...INPUT, version: '1.0.0' },
    { ...INPUT, version: '0.0.65536' },
  ])
    assert.throws(() => prepareSandboxMetadata(input));
  for (const mutate of [
    (value) => {
      value.kerfdeskUpdateChannelTrusted = true;
    },
    (value) => {
      value.kerfdeskCommercialLicense.apiOrigin = 'https://license.kerfdesk.com';
    },
    (value) => {
      value.kerfdeskCommercialLicense.entitlementKeys = { production: 'wrong' };
    },
    (value) => {
      value.kerfdeskCommercialLicense.release.signature = Buffer.alloc(64).toString('base64');
    },
    (value) => {
      delete value.kerfdeskSandbox;
    },
  ]) {
    const broken = structuredClone(metadata);
    mutate(broken);
    assert.throws(() => verifySandboxMetadata(broken));
  }
});

test('generated sandbox config and real ASAR keep installers, profiles, trust and associations separate', async (t) => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'kerfdesk-sandbox-package-test-')));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const outputDir = join(temporary, 'generated');
  const result = await writeSandboxPreparation({ ...INPUT, outputDir });
  assert.deepEqual(await writeSandboxPreparation({ ...INPUT, outputDir }), result);
  const config = await getConfig(ROOT, result.configPath, null);
  assert.equal(config.appId, 'dev.kerfdesk.sandbox');
  assert.equal(config.productName, 'KerfDesk Sandbox');
  assert.equal(config.executableName, 'KerfDesk-Sandbox');
  assert.equal(config.extraMetadata.name, 'kerfdesk-sandbox');
  assert.equal(config.forceCodeSigning, false);
  assert.equal(config.publish, null);
  assert.deepEqual(config.fileAssociations, []);
  assert.equal(config.nsis.include, 'scripts/nsis-sandbox.nsh');
  assert.equal(config.nsis.shortcutName, 'KerfDesk Sandbox');
  const production = await getConfig(ROOT, join(ROOT, 'electron-builder.yml'), null);
  assert.deepEqual(config.electronFuses, production.electronFuses);
  assert.deepEqual(config.files, production.files);
  const appOutDir = join(temporary, 'packed');
  const source = join(temporary, 'source');
  await mkdir(join(appOutDir, 'resources'), { recursive: true });
  // Use the builder's resolved copy rules so a dropped notice fails the package hook.
  for (const resource of config.extraResources) {
    const destination = join(appOutDir, 'resources', resource.to);
    await mkdir(join(appOutDir, 'resources/legal'), { recursive: true });
    await writeFile(destination, await readFile(join(ROOT, resource.from)));
  }
  await mkdir(source);
  await mkdir(join(source, 'dist/web'), { recursive: true });
  await mkdir(join(source, 'dist-electron'), { recursive: true });
  await writeFile(join(source, 'dist-electron/main.js'), '');
  await writeFile(
    join(source, 'dist/web/index.html'),
    '<meta name="kerfdesk-build-capabilities" content="desktop">',
  );
  await writeFile(join(source, 'package.json'), JSON.stringify(config.extraMetadata));
  await finished(await createPackage(source, join(appOutDir, 'resources/app.asar')));
  const context = {
    electronPlatformName: 'win32',
    appOutDir,
    packager: { config, appInfo: { version: INPUT.version } },
  };
  await verifySandboxPackage(context);
  const notice = join(appOutDir, 'resources/legal/THIRD_PARTY_NOTICES.md');
  const originalNotice = await readFile(notice);
  await writeFile(notice, 'incomplete notice');
  await assert.rejects(verifySandboxPackage(context), /notice differs/u);
  await rm(notice);
  await assert.rejects(verifySandboxPackage(context), /ENOENT/u);
  await writeFile(notice, originalNotice);
  for (const change of [
    { appId: 'dev.laserforge.app' },
    { publish: { provider: 'generic', url: 'https://dl.kerfdesk.com' } },
    { fileAssociations: [{ ext: 'lf2' }] },
    { nsis: { ...config.nsis, include: 'scripts/nsis-file-associations.nsh' } },
  ])
    await assert.rejects(
      verifySandboxPackage({
        ...context,
        packager: { ...context.packager, config: { ...config, ...change } },
      }),
      /separate/u,
    );
  await assert.rejects(
    writeSandboxPreparation({ ...INPUT, outputDir: join(ROOT, '.sandbox-output') }),
    /outside/u,
  );
  await assert.rejects(runSandboxPreparation([]), /sandbox-only/u);
  await assert.rejects(
    runSandboxPreparation(['--sandbox-only', '--api-origin', 'https://attacker.example']),
    /arguments/u,
  );
  for (const mode of ['browser-free', 'missing']) {
    const brokenOut = join(temporary, mode);
    await mkdir(join(brokenOut, 'resources'), { recursive: true });
    await writeFile(
      join(source, 'dist/web/index.html'),
      mode === 'missing'
        ? '<html></html>'
        : `<meta name="kerfdesk-build-capabilities" content="${mode}">`,
    );
    await finished(await createPackage(source, join(brokenOut, 'resources/app.asar')));
    await assert.rejects(
      verifySandboxPackage({ ...context, appOutDir: brokenOut }),
      /desktop renderer/u,
    );
  }
});
