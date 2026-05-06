/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';

const root = process.cwd();
const source = readFileSync(join(root, 'src/ui/components/settings/GcodeSettingsTab.tsx'), 'utf8');

assert.match(source, /Custom start G-code/);
assert.match(source, /Custom end G-code/);
assert.match(source, /value:\s*activeProfile\.startGcode\s*\?\?\s*''/);
assert.match(source, /value:\s*activeProfile\.endGcode\s*\?\?\s*''/);
assert.match(source, /onUpdateProfile\(\{\s*startGcode:\s*e\.target\.value\s*\}\)/s);
assert.match(source, /onUpdateProfile\(\{\s*endGcode:\s*e\.target\.value\s*\}\)/s);

