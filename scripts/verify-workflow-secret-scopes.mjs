import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { JSON_SCHEMA, load } from 'js-yaml';

// ADR-651: GitHub gives a repository secret to every workflow on every pushed
// branch, but gives an environment secret only to a job that names that
// environment, and only on the refs the environment's deployment policy allows.
// So every secret a workflow reads must be read by a job that names the
// environment holding it. Each reviewed secret and its environment:
export const SECRET_ENVIRONMENTS = new Map([
  // kerfdesk.com (deploy.yml); main only.
  ['PAGES_CLOUDFLARE_API_TOKEN', 'production'],
  ['PAGES_CLOUDFLARE_ACCOUNT_ID', 'production'],
  // Unsigned and commercial desktop releases, checkout operations and the
  // native licence qualification; main only.
  ['DESKTOP_STABLE_MANIFEST_PRIVATE_KEY', 'desktop-commercial'],
  ['COMMERCIAL_R2_API_TOKEN', 'desktop-commercial'],
  ['COMMERCIAL_CLOUDFLARE_ACCOUNT_ID', 'desktop-commercial'],
  ['COMMERCIAL_ESIGNER_USERNAME', 'desktop-commercial'],
  ['COMMERCIAL_ESIGNER_PASSWORD', 'desktop-commercial'],
  ['COMMERCIAL_ESIGNER_TOTP_SECRET', 'desktop-commercial'],
  ['KERFDESK_PAYMENT_LAUNCH_CF_TOKEN', 'desktop-commercial'],
  ['KERFDESK_PAYMENT_SANDBOX_ATTESTED_BUNDLE', 'desktop-commercial'],
  ['KERFDESK_NATIVE_QUALIFICATION_LICENCE', 'desktop-commercial'],
  // Desktop Preview publication; v*-preview.* tags only.
  ['PREVIEW_R2_API_TOKEN', 'desktop-preview'],
  ['DESKTOP_PREVIEW_MANIFEST_PRIVATE_KEY', 'desktop-preview'],
  // The historical signed stable lane; v* stable tags only.
  ['STABLE_ESIGNER_USERNAME', 'desktop-production'],
  ['STABLE_ESIGNER_PASSWORD', 'desktop-production'],
  ['STABLE_ESIGNER_TOTP_SECRET', 'desktop-production'],
  ['STABLE_R2_API_TOKEN', 'desktop-production'],
  ['STABLE_CLOUDFLARE_ACCOUNT_ID', 'desktop-production'],
]);

// GitHub creates this token for each run and scopes it with `permissions:`.
const RUN_TOKEN = 'GITHUB_TOKEN';
// GitHub reads context and secret names without regard to case.
const SECRETS_CONTEXT = /(?<![\w.-])secrets\b(?:\s*\.\s*([A-Za-z_][A-Za-z0-9_]*))?/giu;
// A single-quoted expression string; '' is an escaped quote.
const STRING_LITERAL = /'(?:[^']|'')*'/gu;

// The body of each ${{ }} in a value. A `}}` inside a string, as in
// format('{{{0}}}', …), does not end the expression; an unclosed one runs to
// the end of the value.
function expressionsIn(value) {
  const expressions = [];
  let start = value.indexOf('${{');
  while (start >= 0) {
    let index = start + 3;
    let quoted = false;
    while (index < value.length) {
      if (value[index] === "'") {
        if (quoted && value[index + 1] === "'") index += 1;
        else quoted = !quoted;
      } else if (!quoted && value.startsWith('}}', index)) {
        break;
      }
      index += 1;
    }
    expressions.push(value.slice(start + 3, index));
    start = value.indexOf('${{', index + 2);
  }
  return expressions;
}

// Every secrets-context reference in a parsed YAML value, with its YAML path.
// `if:` conditions are expressions even without ${{ }}. Text inside a string
// literal is not a reference.
function secretReferences(value, where, key) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => secretReferences(item, `${where}[${index}]`, key));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([child, item]) =>
      secretReferences(item, where === '' ? child : `${where}.${child}`, child),
    );
  }
  if (typeof value !== 'string') return [];
  const expressions = key === 'if' && !value.includes('${{') ? [value] : expressionsIn(value);
  return expressions.flatMap((expression) =>
    [...expression.replace(STRING_LITERAL, "''").matchAll(SECRETS_CONTEXT)].map((match) => ({
      where,
      name: match[1]?.toUpperCase() ?? null,
    })),
  );
}

function environmentOf(job) {
  const environment = job.environment;
  if (environment !== null && typeof environment === 'object') return environment.name;
  return environment;
}

function verifyJob(file, id, job) {
  const failures = [];
  const at = `${file} jobs.${id}`;
  // A job that calls a reusable workflow cannot name an environment, so it
  // must not hand the called workflow any secret.
  if (job.uses !== undefined && job.secrets !== undefined) {
    failures.push(`${at}: passes secrets to a reusable workflow, which has no environment here`);
  }
  const environment = environmentOf(job);
  const references = secretReferences(job, `jobs.${id}`, null).filter(
    (reference) => reference.name !== RUN_TOKEN,
  );
  if (references.length === 0) return failures;
  if (typeof environment === 'string' && environment.includes('${{')) {
    failures.push(`${at}: reads secrets, so its environment must be a literal name`);
    return failures;
  }
  for (const { where, name } of references) {
    if (name === null) {
      failures.push(`${file} ${where}: reads the secrets context by index or as a whole`);
      continue;
    }
    const expected = SECRET_ENVIRONMENTS.get(name);
    if (expected === undefined) {
      failures.push(`${file} ${where}: secrets.${name} is not a reviewed secret`);
    } else if (environment === undefined || environment === null) {
      failures.push(
        `${file} ${where}: reads secrets.${name} in a job with no environment (needs ${expected})`,
      );
    } else if (environment !== expected) {
      failures.push(
        `${file} ${where}: reads secrets.${name} in environment ${environment}; it belongs to ${expected}`,
      );
    }
  }
  return failures;
}

export function verifyWorkflowSecretText(file, source) {
  const workflow = load(source, { schema: JSON_SCHEMA });
  if (workflow === null || typeof workflow !== 'object') return [];
  const { jobs = {}, ...outside } = workflow;
  // Workflow-level env, run-name and the like reach every job, so no secret
  // may appear outside a job.
  const failures = secretReferences(outside, '', null)
    .filter((reference) => reference.name !== RUN_TOKEN)
    .map(({ where }) => `${file} ${where}: reads secrets outside a job`);
  for (const [id, job] of Object.entries(jobs ?? {})) {
    if (job !== null && typeof job === 'object') failures.push(...verifyJob(file, id, job));
  }
  return failures;
}

export function verifyWorkflowSecretDirectory(root) {
  const directory = path.join(root, '.github', 'workflows');
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => /\.ya?ml$/u.test(name))
    .sort()
    .flatMap((name) =>
      verifyWorkflowSecretText(
        path.posix.join('.github/workflows', name),
        fs.readFileSync(path.join(directory, name), 'utf8'),
      ),
    );
}

const invoked = process.argv[1] === fileURLToPath(import.meta.url);
if (invoked) {
  const failures = verifyWorkflowSecretDirectory(process.cwd());
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    console.error(
      'Read each secret in a job that names its environment (ADR-651). A new secret goes in SECRET_ENVIRONMENTS with the environment that holds it.',
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Workflow secret scopes verified (${SECRET_ENVIRONMENTS.size} reviewed secrets, each read only in its environment).`,
    );
  }
}
