/**
 * T1-141: regression test for the LayerPanel style-constant
 * extraction. Pre-T1-141 these 8 style objects + 1 style function
 * lived inside the `LayerPanel` function body (lines 234-310) and got
 * recreated on every render. Hoisting them to module scope is a
 * behavior-preserving allocation win + render-body shrink (same
 * pattern as T1-131 PropertiesPanel).
 *
 * Run: npx tsx tests/layer-panel-styles.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fieldStyle,
  iconToggleStyle,
  listStyle,
  numberInputStyle,
  outerColumnStyle,
  scrollTabContentStyle,
  selectStyle,
  settingsLabelStyle,
  settingsStyle,
} from '../src/ui/components/layers/layerPanelStyles';
import { theme } from '../src/ui/styles/theme';
import type { Layer } from '../src/core/scene/Layer';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T1-141 LayerPanel style constants ===\n');

// -------- 1. All exports look like CSSProperties --------
for (const [name, style] of Object.entries({
  outerColumnStyle,
  scrollTabContentStyle,
  listStyle,
  settingsStyle,
  fieldStyle,
  settingsLabelStyle,
  numberInputStyle,
  selectStyle,
})) {
  assert(typeof style === 'object' && style != null,
    `${name} is exported and is an object`);
}

// -------- 2. Theme-derived fields --------
assert(outerColumnStyle.fontFamily === theme.font.ui,
  'outerColumnStyle.fontFamily = theme.font.ui');
assert(outerColumnStyle.background === '#0c0c18',
  'outerColumnStyle.background is the dark gradient base');

assert(scrollTabContentStyle.flex === 1,
  'scrollTabContentStyle.flex = 1');

assert(listStyle.borderBottom === `1px solid ${theme.border.subtle}`,
  'listStyle.borderBottom uses theme.border.subtle');

assert(settingsStyle.padding === '10px 12px',
  'settingsStyle has 10px 12px padding');

assert(fieldStyle.gap === 4 && fieldStyle.display === 'flex',
  'fieldStyle is a flex column with gap=4');

assert(settingsLabelStyle.fontFamily === theme.font.ui,
  'settingsLabelStyle uses theme.font.ui');

assert(numberInputStyle.fontFamily === theme.font.mono,
  'numberInputStyle uses theme.font.mono (number entry)');
assert(numberInputStyle.borderRadius === theme.radius.sm,
  'numberInputStyle has theme.radius.sm');

assert(selectStyle.fontFamily === theme.font.ui,
  'selectStyle uses theme.font.ui (labels)');
assert(selectStyle.cursor === 'pointer',
  'selectStyle has cursor: pointer');

// -------- 3. iconToggleStyle is a function and reacts to visible --------
{
  const visibleLayer = { visible: true } as Layer;
  const hiddenLayer = { visible: false } as Layer;
  const vStyle = iconToggleStyle(visibleLayer);
  const hStyle = iconToggleStyle(hiddenLayer);
  assert(vStyle.color === theme.text.secondary,
    'iconToggleStyle(visible): color = theme.text.secondary');
  assert(hStyle.color === theme.text.tertiary,
    'iconToggleStyle(hidden): color = theme.text.tertiary');
  assert(vStyle.opacity === 1,
    'iconToggleStyle(visible): opacity = 1');
  assert(hStyle.opacity === 0.4,
    'iconToggleStyle(hidden): opacity = 0.4');
}

// -------- 4. Source-level pin: LayerPanel delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const panelSrc = readFileSync(
    resolve(here, '../src/ui/components/LayerPanel.tsx'),
    'utf-8',
  );
  assert(/from '\.\/layers\/layerPanelStyles'/.test(panelSrc),
    'LayerPanel imports from layers/layerPanelStyles');
  for (const name of [
    'outerColumnStyle',
    'scrollTabContentStyle',
    'listStyle',
    'settingsStyle',
    'fieldStyle',
    'settingsLabelStyle',
    'numberInputStyle',
    'selectStyle',
    'iconToggleStyle',
  ]) {
    assert(panelSrc.includes(name),
      `LayerPanel imports / uses ${name}`);
  }
  assert(/T1-141/.test(panelSrc),
    'LayerPanel carries T1-141 marker');
  // Pre-T1-141 the inline `const outerColumnStyle = {` declaration is gone.
  assert(!/const outerColumnStyle = \{/.test(panelSrc),
    'inline outerColumnStyle declaration is gone from LayerPanel');
  assert(!/const iconToggleStyle = \(layer: Layer\) => \(\{/.test(panelSrc),
    'inline iconToggleStyle function declaration is gone from LayerPanel');

  const stylesSrc = readFileSync(
    resolve(here, '../src/ui/components/layers/layerPanelStyles.ts'),
    'utf-8',
  );
  assert(/T1-141/.test(stylesSrc),
    'layerPanelStyles carries T1-141 marker');
  for (const name of [
    'outerColumnStyle',
    'scrollTabContentStyle',
    'listStyle',
    'settingsStyle',
    'fieldStyle',
    'settingsLabelStyle',
    'numberInputStyle',
    'selectStyle',
  ]) {
    const re = new RegExp(`export const ${name}: CSSProperties =`);
    assert(re.test(stylesSrc),
      `${name} is exported as module-scope CSSProperties const`);
  }
  assert(/export const iconToggleStyle = \(layer: Layer\)/.test(stylesSrc),
    'iconToggleStyle is exported as a module-scope function');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
