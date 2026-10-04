import { readFile, writeFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const check = process.argv.includes('--check');
if (process.argv.slice(2).some((value) => value !== '--check'))
  throw new Error('Use generate-touch-ui.mjs with no arguments or --check.');
let source = '';
for (const suffix of ['geometry', 'viewport', 'view', ''])
  source +=
    (await readFile(
      new URL('../public/control-touch' + (suffix ? '-' + suffix : '') + '.js', import.meta.url),
      'utf8',
    )) + '\n';
source = source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
source += '\nfunction bindMcpTouchCanvas(options){return bindTouchCanvas(options);}\n';
const script = (await transform(source, { minifyWhitespace: true, target: 'es2022' })).code.trim();
const style = await readFile(new URL('../public/control-touch.css', import.meta.url), 'utf8');
// String.raw preserves regex escapes. Reject syntax that would escape the generated literal.
if ([script, style].some((value) => /`|\$\{/.test(value)))
  throw new Error('Touch sources contain a template literal; update the bounded generator.');
const expected = `/** Generated from the shared phone canvas. Run pnpm generate:touch; do not edit. */\nexport const MCP_TOUCH_MARKUP = String.raw\`<div id="touch-tools"></div>\`;\n\nexport const MCP_TOUCH_STYLE = String.raw\`${style}\`;\n\nexport const MCP_TOUCH_SCRIPT = String.raw\`${script}\`;\n`;
const destination = new URL('../../../electron/mcp/workspace-touch-ui.ts', import.meta.url);
if (check) {
  if ((await readFile(destination, 'utf8')) !== expected)
    throw new Error('Portable touch canvas is stale. Run pnpm generate:touch.');
} else await writeFile(destination, expected);
console.log(`Shared phone/MCP canvas: ${check ? 'current' : 'generated'}.`);
