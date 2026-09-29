// Operator CLI: issue the two private developer licences (ADR-523) through the
// deployed licensing service's admin API. It never prints a licence key or the
// administration token; the keys go to a private file outside the repository.
//
// usage: node scripts/issue-developer-licences.mjs --admin-token-file <file> --output <file>
//        [--service https://license.kerfdesk.com]
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVICE = 'https://license.kerfdesk.com';
// Identifiers, not activation codes: each grant yields its own random licence key.
export const DEVELOPER_GRANTS = Object.freeze([
  Object.freeze({ grantId: 'johann', displayName: 'Johann' }),
  Object.freeze({ grantId: 'father', displayName: 'Father' }),
]);
const KEY = /^KD1\.[A-Za-z0-9_-]{1,100}\.[A-Za-z0-9_-]{43}$/u;

export class IssuanceError extends Error {}
const requireInput = (condition, message) => {
  if (!condition) throw new IssuanceError(message);
};

function within(parent, child) {
  const difference = relative(parent, child);
  return difference === '' || (difference.split(/[\\/]/u)[0] !== '..' && !isAbsolute(difference));
}

async function outsideRepository(path, root) {
  const target = resolve(path);
  const realRoot = await realpath(root);
  // The output's parent must already exist; resolve it physically so a junction
  // or symlink cannot place the keys back inside the checkout.
  const parent = await realpath(dirname(target)).catch(() => {
    throw new IssuanceError('The output folder must already exist.');
  });
  const physical = resolve(parent, relative(dirname(target), target));
  requireInput(
    !within(realRoot, target) && !within(realRoot, physical),
    'Write developer licence keys outside the repository.',
  );
  return physical;
}

function adminToken(text) {
  const token = text.trim();
  requireInput(/^[A-Za-z0-9_-]{43,256}$/u.test(token), 'The admin token file is not valid.');
  return token;
}

export function validGrant(value, grant) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).sort().join(',') === 'displayName,licenseId,licenseKey' &&
    value.displayName === grant.displayName &&
    typeof value.licenseId === 'string' &&
    /^[A-Za-z0-9_-]{1,100}$/u.test(value.licenseId) &&
    typeof value.licenseKey === 'string' &&
    KEY.test(value.licenseKey) &&
    value.licenseKey.split('.')[1] === value.licenseId
  );
}

async function requestGrant(service, token, grant, fetcher) {
  let response;
  try {
    response = await fetcher(`${service}/v1/admin/developer-grants`, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(grant),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new IssuanceError('The licensing service could not be reached.');
  }
  if (!response.ok) {
    const code = await response
      .json()
      .then((body) => body?.error?.code)
      .catch(() => undefined);
    throw new IssuanceError(
      `The licensing service refused the ${grant.displayName} grant (${typeof code === 'string' && /^[a-z_]{1,64}$/u.test(code) ? code : `HTTP ${response.status}`}).`,
    );
  }
  const value = await response.json().catch(() => null);
  requireInput(validGrant(value, grant), 'The licensing service returned an invalid grant.');
  return { grantId: grant.grantId, ...value };
}

export async function issueDeveloperLicences(
  { service = SERVICE, tokenText, output },
  fetcher = fetch,
  root = ROOT,
) {
  requireInput(
    typeof service === 'string' && /^https:\/\/[a-z0-9.-]+$/u.test(service),
    'Use the HTTPS origin of the licensing service, without a path.',
  );
  const token = adminToken(tokenText);
  const path = await outsideRepository(output, root);
  const grants = [];
  // Sequential on purpose: the service's grants are idempotent, and a retry
  // after a partial failure returns the same licences.
  for (const grant of DEVELOPER_GRANTS)
    grants.push(await requestGrant(service, token, grant, fetcher));
  const bytes = `${JSON.stringify({ schemaVersion: 1, service, grants }, null, 2)}\n`;
  try {
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    requireInput(
      (await readFile(path, 'utf8')) === bytes,
      'The output file already exists with different licences; nothing was overwritten.',
    );
  }
  return { path, names: grants.map((grant) => grant.displayName) };
}

export async function runIssuance(args, fetcher = fetch, root = ROOT) {
  const names = { '--admin-token-file': 'tokenFile', '--output': 'output', '--service': 'service' };
  const input = {};
  for (let index = 0; index < args.length; index += 2) {
    const field = names[args[index]];
    requireInput(
      field !== undefined && typeof args[index + 1] === 'string' && !Object.hasOwn(input, field),
      'Usage: issue-developer-licences.mjs --admin-token-file <file> --output <file> [--service <https-origin>]',
    );
    input[field] = args[index + 1];
  }
  requireInput(
    input.tokenFile && input.output,
    'Both --admin-token-file and --output are required.',
  );
  const tokenText = await readFile(input.tokenFile, 'utf8').catch(() => {
    throw new IssuanceError('The admin token file could not be read.');
  });
  return issueDeveloperLicences(
    {
      ...(input.service === undefined ? {} : { service: input.service }),
      tokenText,
      output: input.output,
    },
    fetcher,
    root,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runIssuance(process.argv.slice(2))
    .then(({ path, names }) => {
      console.log(
        `Issued developer licences for ${names.join(' and ')}. Keys saved privately to ${path}.`,
      );
    })
    .catch((error) => {
      // Never echo request bodies, tokens or keys.
      console.error(
        error instanceof IssuanceError ? error.message : 'Developer licence issuance failed.',
      );
      process.exitCode = 1;
    });
}
