// Rebuild the pinned Unicode script tables used by multilingual text layout.
// --check compares generated output without writing. --source-dir=PATH uses
// an offline cache; SHA256 is checked identically for cache and network input.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceOption = process.argv.find((argument) => argument.startsWith('--source-dir='));
const sourceDir = sourceOption?.slice('--source-dir='.length);
const hashes = {
  'Scripts.txt': '9f5e50d3abaee7d6ce09480f325c706f485ae3240912527e651954d2d6b035bf',
  'ScriptExtensions.txt': 'ec2107e58825a1586acee8e0911ce18260394ac8b87e535ca325f1ccbeb06bc6',
  'PropertyValueAliases.txt': '64e9a5f76f7a1e8b5a47d6a1f9a26522a251208f5276bdfa1559dac7cf2e827a',
};
async function source(name) {
  let bytes;
  if (sourceDir !== undefined) bytes = await readFile(resolve(sourceDir, name));
  else {
    const response = await fetch(`https://www.unicode.org/Public/17.0.0/ucd/${name}`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== hashes[name]) {
    throw new Error(`${name}: pinned Unicode data hash mismatch`);
  }
  return bytes.toString('utf8');
}
const data = Object.fromEntries(
  await Promise.all(Object.keys(hashes).map(async (name) => [name, await source(name)])),
);
const fields = (text) =>
  text.split('\n').map((line) =>
    line
      .split('#')[0]
      .split(';')
      .map((field) => field.trim()),
  );
const aliases = new Map(
  fields(data['PropertyValueAliases.txt'])
    .filter((parts) => parts[0] === 'sc')
    .map((parts) => [parts[2], parts[1]]),
);
const outputs = [
  ['Scripts.txt', 'UNICODE_SCRIPT_RANGES', 'unicode-script-ranges.ts'],
  ['ScriptExtensions.txt', 'UNICODE_SCRIPT_EXTENSION_RANGES', 'unicode-script-extensions.ts'],
];
for (const [name, exportName, output] of outputs) {
  const groups = new Map();
  for (const parts of fields(data[name])) {
    if (parts.length < 2) continue;
    const tag = name === 'Scripts.txt' ? aliases.get(parts[1]) : parts[1];
    if (tag === undefined) throw new Error(`Unknown script ${parts[1]}`);
    const ranges = groups.get(tag) ?? [];
    ranges.push(parts[0].replace('..', '-'));
    groups.set(tag, ranges);
  }
  const destination = resolve(root, 'src/core/text', output);
  const generated = `// Unicode 17.0.0 ${name}, https://www.unicode.org/Public/17.0.0/ucd/${name}\n// Derived Unicode data, Unicode-3.0 licence; see THIRD_PARTY_NOTICES.md.\n// Inclusive hexadecimal ranges grouped by ISO 15924 script tag(s).\nexport const ${exportName}: Readonly<Record<string, string>> = {\n${[...groups].map(([tag, ranges]) => `  '${tag}': '${ranges.join(',')}',`).join('\n')}\n};\n`;
  const formatted = await format(generated, {
    ...(await resolveConfig(destination)),
    filepath: destination,
  });
  if (process.argv.includes('--check')) {
    if ((await readFile(destination, 'utf8')) !== formatted) throw new Error(`${output} is stale`);
  } else await writeFile(destination, formatted);
}
console.log('Unicode 17.0.0 text script tables verified.');
