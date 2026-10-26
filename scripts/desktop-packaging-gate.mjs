import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCOPE_JOB = 'packaging-scope';
export const ORDINARY_PACKAGING_JOBS = ['linux-package', 'linux-installers', 'commercial-linux'];
// A pull request that changes only renderer, test or documentation source
// skips these two (ADR-647); every other run needs them.
export const INSTALLER_PACKAGING_JOBS = ['linux-installers', 'commercial-linux'];
export const NATIVE_PACKAGING_JOBS = ['commercial-macos', 'windows-package', 'macos-package'];

export function verifyPackagingResults(needs, nativeSelected, installersSelected) {
  if (typeof nativeSelected !== 'boolean')
    throw new Error('Native packaging selection is required.');
  if (typeof installersSelected !== 'boolean')
    throw new Error('Installer packaging selection is required.');
  const jobs = [SCOPE_JOB, ...ORDINARY_PACKAGING_JOBS, ...NATIVE_PACKAGING_JOBS];
  if (
    needs === null ||
    typeof needs !== 'object' ||
    Array.isArray(needs) ||
    Object.keys(needs).sort().join(',') !== [...jobs].sort().join(',')
  ) {
    throw new Error('Packaging gate needs the complete workflow job results.');
  }
  for (const job of jobs) {
    let selected = true;
    if (NATIVE_PACKAGING_JOBS.includes(job)) selected = nativeSelected;
    else if (INSTALLER_PACKAGING_JOBS.includes(job)) selected = installersSelected;
    const expected = selected ? 'success' : 'skipped';
    if (needs[job]?.result !== expected) {
      throw new Error(
        `Packaging job ${job} must be ${expected}; received ${needs[job]?.result ?? 'missing'}.`,
      );
    }
  }
  return { status: 'passed', nativeSelected, installersSelected };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!['true', 'false'].includes(process.env.NATIVE_PACKAGING)) {
      throw new Error('Native packaging selection must be true or false.');
    }
    if (!['true', 'false'].includes(process.env.INSTALLER_PACKAGING)) {
      throw new Error('Installer packaging selection must be true or false.');
    }
    const result = verifyPackagingResults(
      JSON.parse(process.env.NEEDS ?? ''),
      process.env.NATIVE_PACKAGING === 'true',
      process.env.INSTALLER_PACKAGING === 'true',
    );
    console.log(
      `Desktop packaging gate passed (native packaging selected: ${result.nativeSelected}; ` +
        `Linux installers selected: ${result.installersSelected}).`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
