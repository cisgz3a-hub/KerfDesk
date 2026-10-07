// Run only on a disposable hosted Windows machine, using an unchanged public installer.
// No signing/admin credential is needed. The one issued developer key stays private.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { preparePublishedUpgradeInstaller } from './published-upgrade-installers.mjs';
import { verifyHistoricalInstalledResources } from './verify-historical-installed.mjs';
import { collectNativeSmokeProcess } from './native-smoke-process.mjs';
import {
  LicenceQualificationError,
  nativeLicenceArguments,
  nativeQualificationEnvironment,
  privateNativeResult,
  privateQualificationDocument,
  publicNativePhase,
  retainedDeveloperSequence,
} from './native-licence-qualification.mjs';

const execute = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function qualificationInput(args, environment = process.env, platform = process.platform) {
  if (
    platform !== 'win32' ||
    environment.GITHUB_ACTIONS !== 'true' ||
    environment.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    !environment.RUNNER_TEMP ||
    !environment.GITHUB_WORKSPACE ||
    !environment.SystemRoot ||
    ![environment.RUNNER_TEMP, environment.GITHUB_WORKSPACE, environment.SystemRoot].every(
      isAbsolute,
    ) ||
    !/^\d+$/u.test(environment.GITHUB_RUN_ID ?? '') ||
    !/^\d+$/u.test(environment.GITHUB_RUN_ATTEMPT ?? '')
  )
    throw new LicenceQualificationError('requires-disposable-hosted-windows');
  const values = {};
  for (const argument of args) {
    const match = /^--(version|source|output)=(.+)$/u.exec(argument);
    if (!match || Object.hasOwn(values, match[1]))
      throw new LicenceQualificationError('invalid-arguments');
    values[match[1]] = match[2];
  }
  if (
    !/^\d+\.\d+\.\d+$/u.test(values.version ?? '') ||
    !/^[a-f0-9]{40}$/u.test(values.source ?? '') ||
    !isAbsolute(values.output ?? '')
  )
    throw new LicenceQualificationError('invalid-release-identity');
  const evidenceParent = join(environment.GITHUB_WORKSPACE, 'artifacts', 'installed-qualification');
  assertChild(values.output, evidenceParent);
  return {
    ...values,
    evidenceParent,
    ownedRoot: join(
      environment.RUNNER_TEMP,
      `kerfdesk-native-licence-${environment.GITHUB_RUN_ID}-${environment.GITHUB_RUN_ATTEMPT}`,
    ),
    powershell: join(
      environment.SystemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
  };
}

export function assertChild(target, parent) {
  const difference = relative(resolve(parent), resolve(target));
  if (!difference || isAbsolute(difference) || difference.split(/[\\/]/u)[0] === '..')
    throw new LicenceQualificationError('qualification-path-escaped-owned-root');
}

async function freshDirectories(input) {
  await mkdir(input.evidenceParent, { recursive: true });
  const physicalParent = await realpath(input.evidenceParent);
  assertChild(physicalParent, await realpath(process.env.GITHUB_WORKSPACE));
  await mkdir(input.output);
  const temp = await realpath(process.env.RUNNER_TEMP);
  assertChild(input.ownedRoot, temp);
  await mkdir(input.ownedRoot);
  const privateRoot = join(input.ownedRoot, 'private');
  await mkdir(privateRoot);
  return {
    privateRoot,
    installRoot: join(input.ownedRoot, 'KerfDesk Installed'),
    profile: join(privateRoot, 'profile'),
    keyFile: join(privateRoot, 'issued-key.json'),
  };
}

async function powershell(input, script, args, timeout = 200_000) {
  await execute(
    input.powershell,
    ['-NoProfile', '-NonInteractive', '-File', join(ROOT, 'scripts', script), ...args],
    {
      windowsHide: true,
      timeout,
      maxBuffer: 64 * 1024,
      env: nativeQualificationEnvironment(process.env),
    },
  );
}

async function installerAction(input, paths, installer, action) {
  await powershell(input, 'native-licence-installer.ps1', [
    '-Action',
    action,
    '-Installer',
    installer,
    '-InstallRoot',
    paths.installRoot,
    '-ExpectedVersion',
    input.version,
  ]);
}

async function verifyInstalled(input, paths, downloaded) {
  const compare = async (file) => {
    const installed = await readFile(join(paths.installRoot, file));
    const published = await readFile(join(downloaded.unpacked, file));
    if (hash(installed) !== hash(published))
      throw new LicenceQualificationError('installed-bytes-differ');
    return hash(installed);
  };
  const executableSHA256 = await compare('KerfDesk.exe');
  const asarSHA256 = await compare(join('resources', 'app.asar'));
  await powershell(input, 'verify-windows-package-identity.ps1', [
    '-Executable',
    join(paths.installRoot, 'KerfDesk.exe'),
  ]);
  const identity = await verifyHistoricalInstalledResources(
    join(paths.installRoot, 'resources'),
    input.version,
    input.source,
  );
  return { ...identity, executableSHA256, asarSHA256, byteIdenticalToPublicInstaller: true };
}

async function windowProof(input, paths, evidence, child, label, edition) {
  const png = join(evidence, 'screenshots', `${label}.png`);
  try {
    await powershell(
      input,
      'native-licence-window-proof.ps1',
      [
        '-AppProcessId',
        String(child.pid),
        '-ExpectedExecutable',
        join(paths.installRoot, 'KerfDesk.exe'),
        '-ExpectedEdition',
        edition,
        '-Output',
        png,
      ],
      20_000,
    );
    if (!(await stat(png)).isFile()) return false;
    return true;
  } catch {
    return false; // The fixed shipped helper can close before UIA takes its narrow crop.
  }
}

async function nativePhase(input, paths, phase, label, onSpawn) {
  const resultPath = privateNativeResult(paths.privateRoot, label);
  let proof = Promise.resolve(false);
  const processResult = await collectNativeSmokeProcess(
    join(paths.installRoot, 'KerfDesk.exe'),
    nativeLicenceArguments({
      profile: paths.profile,
      result: resultPath,
      phase,
      keyFile: paths.keyFile,
    }),
    {
      timeoutMs: 60_000,
      spawnProcess(executable, args, options) {
        const child = spawn(executable, args, {
          ...options,
          env: nativeQualificationEnvironment(process.env),
        });
        child.once('spawn', () => {
          onSpawn();
          proof = windowProof(
            input,
            paths,
            input.output,
            child,
            label,
            phase === 'deactivate' ? 'Free' : 'Pro',
          );
        });
        return child;
      },
    },
  );
  const result = await readFile(resultPath, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  const safe = publicNativePhase(result, processResult, paths.profile, phase, label);
  safe.editionScreenshotCaptured = await proof;
  await writeFile(join(input.output, `${label}.json`), JSON.stringify(safe, null, 2) + '\n', {
    flag: 'wx',
  });
  await rm(resultPath, { force: true });
  return safe;
}

async function erasePrivateInputs(paths, receipt) {
  await rm(paths.keyFile, { force: true });
  receipt.privateKeyFileRemoved = true;
  if (receipt.native?.cleanup?.passed === true) {
    assertChild(await realpath(paths.privateRoot), await realpath(dirname(paths.privateRoot)));
    await rm(paths.privateRoot, { recursive: true });
    receipt.privateProfileRemoved = true;
  } else receipt.privateProfileRemoved = false;
}

export async function qualifyDesktopLicence(input) {
  const receipt = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    passed: false,
    version: input.version,
    source: input.source,
    tierQualified: 'developer',
    realMoneyPurchase: false,
    packageModified: false,
    nativeAppExecuted: false,
    paidTierQualified: false,
    screenshotScope: 'Only the exact Free/Pro edition button, never the licence panel.',
    limitations: [
      'One real Windows machine identity; no three-seat or device-transfer qualification.',
      'Developer licence only; paid and trial lifecycle evidence remains separate.',
      'Native Pro-to-Free deactivation is observed; backend seat inventory is verified separately.',
      'The shipped smoke uses stubbed file pickers and an in-memory project save.',
      'A same-version reinstall is tested; no new-version credential migration is claimed.',
      'UIA screenshot crops are best effort; receipts assert the actual shipped native helper outcomes.',
    ],
  };
  let paths;
  let downloaded;
  let installAttempted = false;
  try {
    const privateDocument = privateQualificationDocument(process.env);
    process.env = nativeQualificationEnvironment(process.env);
    paths = await freshDirectories(input);
    await mkdir(join(input.output, 'screenshots'));
    await writeFile(paths.keyFile, privateDocument, { flag: 'wx', mode: 0o600 });
    downloaded = await preparePublishedUpgradeInstaller(
      input.version,
      join(input.output, 'public-download'),
    );
    if (downloaded.manifest.sourceSha !== input.source)
      throw new LicenceQualificationError('public-source-does-not-match');
    receipt.publicInstaller = {
      sha256: downloaded.manifest.artifacts[0].sha256,
      bytes: downloaded.manifest.artifacts[0].bytes,
      signatureVerified: downloaded.signatureVerified,
    };
    await installerAction(input, paths, downloaded.installer, 'Preflight');
    installAttempted = true;
    await installerAction(input, paths, downloaded.installer, 'Install');
    receipt.installed = await verifyInstalled(input, paths, downloaded);
    receipt.native = await retainedDeveloperSequence({
      phase: (phase, label) =>
        nativePhase(input, paths, phase, label, () => {
          receipt.nativeAppExecuted = true;
        }),
      credentialPresent: async () =>
        stat(join(paths.profile, 'commercial-licence.v1'))
          .then((file) => file.isFile() && file.size > 0)
          .catch(() => false),
      reinstall: async () => {
        await installerAction(input, paths, downloaded.installer, 'Reinstall');
        const reinstalled = await verifyInstalled(input, paths, downloaded);
        if (reinstalled.asarSHA256 !== receipt.installed.asarSHA256)
          throw new LicenceQualificationError('reinstall-bytes-differ');
      },
    });
    receipt.passed = receipt.native.passed;
  } catch (error) {
    receipt.failure =
      error instanceof LicenceQualificationError ? error.code : 'qualification-incomplete';
  } finally {
    delete process.env.KERFDESK_NATIVE_QUALIFICATION_LICENCE;
    if (paths) {
      if (
        installAttempted &&
        receipt.native?.cleanup?.failure !== 'owned-app-process-did-not-close'
      ) {
        try {
          await installerAction(input, paths, downloaded.installer, 'Uninstall');
          receipt.uninstalled = true;
        } catch {
          receipt.uninstalled = false;
          receipt.passed = false;
        }
      }
      await erasePrivateInputs(paths, receipt).catch(() => {
        receipt.privateKeyFileRemoved = false;
        receipt.passed = false;
      });
      receipt.finishedAt = new Date().toISOString();
      await writeFile(
        join(input.output, 'qualification.json'),
        JSON.stringify(receipt, null, 2) + '\n',
        { flag: 'wx' },
      );
    }
  }
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const input = qualificationInput(process.argv.slice(2));
    const receipt = await qualifyDesktopLicence(input);
    console.log(`NATIVE_DEVELOPER_QUALIFICATION_PASSED=${receipt.passed}`);
    process.exitCode = receipt.passed ? 0 : 1;
  } catch {
    delete process.env.KERFDESK_NATIVE_QUALIFICATION_LICENCE;
    console.error(
      'Native developer qualification refused its inputs or could not write safe evidence.',
    );
    process.exitCode = 1;
  }
}
