import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...filesUnder(path));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(path.replaceAll('\\', '/'));
    }
  }
  return out;
}

const allowed = new Set([
  'src/app/MachineCommandGateway.ts',
]);

const directPatterns = [
  /\bcontroller\.sendCommand\s*\(/,
  /\bctrl\.sendCommand\s*\(/,
  /\bcontrollerRef\.current\.sendCommand\s*\(/,
];

const offenders: string[] = [];

for (const file of [...filesUnder('src/app'), ...filesUnder('src/ui')]) {
  if (allowed.has(file)) continue;
  const source = readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (directPatterns.some(pattern => pattern.test(line))) {
      offenders.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
}

assert(
  offenders.length === 0,
  `Direct controller sendCommand outside MachineCommandGateway:\n${offenders.join('\n')}`,
);
