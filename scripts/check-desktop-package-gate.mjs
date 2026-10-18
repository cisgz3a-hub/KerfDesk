import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const mandatoryJobs = ['linux-package', 'linux-installers', 'commercial-linux'];
const nativeJobs = ['commercial-macos', 'windows-package', 'macos-package'];

export function validateDesktopPackageGate(needs, nativeRequired) {
  const failures = [];
  if (typeof nativeRequired !== 'boolean') {
    failures.push('The native packaging requirement must be an explicit boolean.');
  }
  if (needs === null || typeof needs !== 'object' || Array.isArray(needs)) {
    return { ok: false, failures: [...failures, 'Desktop job results must be an object.'] };
  }

  for (const id of [...mandatoryJobs, ...nativeJobs]) {
    if (!Object.hasOwn(needs, id)) failures.push(`${id}: missing job result`);
  }
  for (const [id, job] of Object.entries(needs)) {
    const result = job?.result;
    if (result === 'success') continue;
    // Only these three jobs have the workflow's explicit native-only condition.
    // Any future job is mandatory until its applicability is deliberately defined.
    if (nativeRequired === false && nativeJobs.includes(id) && result === 'skipped') continue;
    failures.push(`${id}: ${typeof result === 'string' ? result : 'missing result'}`);
  }
  return { ok: failures.length === 0, failures };
}

function main() {
  try {
    const native = process.env.NATIVE_REQUIRED;
    if (native !== 'true' && native !== 'false') {
      throw new Error('NATIVE_REQUIRED must be true or false.');
    }
    const verdict = validateDesktopPackageGate(
      JSON.parse(process.env.NEEDS ?? ''),
      native === 'true',
    );
    if (!verdict.ok) throw new Error(verdict.failures.join('\n'));
    console.log('All applicable desktop packaging checks passed.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
