import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const REVIEWED_ACTIONS = new Map([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'],
  ['actions/setup-node', '249970729cb0ef3589644e2896645e5dc5ba9c38'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
  ['actions/download-artifact', '37930b1c2abaa49bbe596cd826c3c89aef350131'],
  ['actions/attest', '36051bcae73b7c2a8a6945a48cbf80953c6baa35'],
  ['pnpm/action-setup', '0ebf47130e4866e96fce0953f49152a61190b271'],
  ['cloudflare/wrangler-action', 'ebbaa1584979971c8614a24965b4405ff95890e0'],
]);

export function verifyWorkflowText(file, source) {
  const failures = [];
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const match = /^\s*-?\s*uses:\s*([^\s#]+)/u.exec(line);
    if (match === null) continue;
    const reference = match[1];
    if (
      reference === undefined ||
      reference.startsWith('./') ||
      reference.startsWith('docker://')
    ) {
      continue;
    }
    const separator = reference.lastIndexOf('@');
    const action = separator < 0 ? reference : reference.slice(0, separator);
    const revision = separator < 0 ? '' : reference.slice(separator + 1);
    const reviewed = REVIEWED_ACTIONS.get(action);
    if (reviewed === undefined) {
      failures.push(`${file}:${index + 1}: external action ${action} is not reviewed/allowlisted`);
    } else if (!/^[0-9a-f]{40}$/u.test(revision)) {
      failures.push(`${file}:${index + 1}: ${action} must use a full 40-character commit SHA`);
    } else if (revision !== reviewed) {
      failures.push(
        `${file}:${index + 1}: ${action}@${revision} is not the reviewed allowlisted SHA ${reviewed}`,
      );
    }
  }
  return failures;
}

function yamlFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return yamlFiles(file);
    return entry.isFile() && /\.ya?ml$/u.test(entry.name) ? [file] : [];
  });
}

export function verifyWorkflowDirectory(root) {
  return ['workflows', 'actions']
    .flatMap((directory) => yamlFiles(path.join(root, '.github', directory)))
    .sort()
    .flatMap((file) =>
      verifyWorkflowText(path.relative(root, file), fs.readFileSync(file, 'utf8')),
    );
}

const invoked = process.argv[1] === fileURLToPath(import.meta.url);
if (invoked) {
  const failures = verifyWorkflowDirectory(process.cwd());
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`GitHub Actions pinning verified (${REVIEWED_ACTIONS.size} reviewed actions).`);
  }
}
