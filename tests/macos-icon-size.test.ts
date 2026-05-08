import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
  }
}

console.log('\n=== macOS icon size ===\n');

const repoRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
  build?: { mac?: { icon?: string } };
};
const iconPath = packageJson.build?.mac?.icon;

assert(iconPath === 'public/icon.png', 'macOS build icon points at public/icon.png');

const png = readFileSync(resolve(repoRoot, iconPath ?? 'public/icon.png'));
const pngSignature = '89504e470d0a1a0a';
assert(png.subarray(0, 8).toString('hex') === pngSignature, 'icon is a PNG');

const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);

assert(width >= 512, `icon width is at least 512px (got ${width})`);
assert(height >= 512, `icon height is at least 512px (got ${height})`);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
