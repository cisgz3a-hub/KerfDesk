/**
 * T1-131: regression test for the PropertiesPanel style-constant
 * extraction. Pre-T1-131 these 9 React.CSSProperties literals lived
 * inside the `ObjectPropertiesTab` function body (lines 316-388 of
 * PropertiesPanel.tsx) and got recreated on every render. They only
 * referenced the static `theme` module, so hoisting them to module
 * scope is a behavior-preserving allocation win + readability slice.
 *
 * This test pins:
 *   - All 9 style constants exist as named exports.
 *   - Each carries the expected theme-derived fields (sanity check
 *     to catch silent theme-token renames or accidental edits).
 *   - selectStyle extends inputStyle (the pre-T1-131 spread idiom).
 *   - Source-pin: PropertiesPanel imports all 9 constants AND no
 *     longer carries the inline definitions.
 *
 * Run: npx tsx tests/properties-panel-styles.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  containerStyle,
  dividerStyle,
  emptyStateStyle,
  inputStyle,
  labelStyle,
  rowStyle,
  sectionHeaderStyle,
  selectStyle,
  traceButtonStyle,
} from '../src/ui/components/properties/propertiesPanelStyles';
import { theme } from '../src/ui/styles/theme';

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

console.log('\n=== T1-131 PropertiesPanel style constants ===\n');

// -------- 1. All 9 constants are exported and look like CSSProperties --------
{
  for (const [name, style] of Object.entries({
    containerStyle,
    labelStyle,
    inputStyle,
    selectStyle,
    sectionHeaderStyle,
    emptyStateStyle,
    dividerStyle,
    traceButtonStyle,
    rowStyle,
  })) {
    assert(typeof style === 'object' && style != null,
      `${name} is exported and is an object`);
  }
}

// -------- 2. Each carries the expected theme-derived fields --------
{
  assert(containerStyle.fontFamily === theme.font.ui,
    'containerStyle.fontFamily = theme.font.ui');
  assert(containerStyle.color === theme.text.secondary,
    'containerStyle.color = theme.text.secondary');

  assert(labelStyle.fontSize === theme.font.size.xs,
    'labelStyle.fontSize = theme.font.size.xs');

  assert(inputStyle.background === theme.bg.base,
    'inputStyle.background = theme.bg.base');
  assert(inputStyle.fontFamily === theme.font.mono,
    'inputStyle.fontFamily = theme.font.mono (monospace input field)');
  assert(inputStyle.borderRadius === theme.radius.sm,
    'inputStyle.borderRadius = theme.radius.sm');

  // selectStyle extends inputStyle but overrides fontFamily + adds cursor
  assert(selectStyle.background === inputStyle.background,
    'selectStyle inherits inputStyle.background');
  assert(selectStyle.fontFamily === theme.font.ui,
    'selectStyle overrides fontFamily to theme.font.ui (not mono — selects show labels)');
  assert(selectStyle.cursor === 'pointer',
    'selectStyle.cursor = pointer');

  assert(sectionHeaderStyle.fontWeight === 600,
    'sectionHeaderStyle.fontWeight = 600');
  assert(sectionHeaderStyle.textTransform === 'uppercase',
    'sectionHeaderStyle.textTransform = uppercase');

  assert(emptyStateStyle.fontStyle === 'italic',
    'emptyStateStyle.fontStyle = italic');
  assert(emptyStateStyle.color === theme.text.tertiary,
    'emptyStateStyle.color = theme.text.tertiary');

  assert(dividerStyle.borderTop === `1px solid ${theme.border.subtle}`,
    'dividerStyle.borderTop uses theme.border.subtle');

  assert(traceButtonStyle.color === theme.accent.green,
    'traceButtonStyle.color = theme.accent.green');
  assert(traceButtonStyle.transition === `all ${theme.transition.fast}`,
    'traceButtonStyle.transition uses theme.transition.fast');

  assert(rowStyle.display === 'flex' && rowStyle.gap === 6,
    'rowStyle: flex layout with gap=6');
}

// -------- 3. Source-level pin: PropertiesPanel imports + uses --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const panelSrc = readFileSync(
    resolve(here, '../src/ui/components/PropertiesPanel.tsx'),
    'utf-8',
  );
  assert(/from '\.\/properties\/propertiesPanelStyles'/.test(panelSrc),
    'PropertiesPanel imports from properties/propertiesPanelStyles');
  for (const name of [
    'containerStyle',
    'labelStyle',
    'inputStyle',
    'selectStyle',
    'sectionHeaderStyle',
    'emptyStateStyle',
    'dividerStyle',
    'traceButtonStyle',
    'rowStyle',
  ]) {
    assert(panelSrc.includes(name),
      `PropertiesPanel imports / uses ${name}`);
  }
  assert(/T1-131/.test(panelSrc),
    'PropertiesPanel carries T1-131 marker');
  // Pre-T1-131 inline pattern is gone — pin one distinctive
  // signature (the `const labelStyle: React.CSSProperties` inline
  // declaration) is no longer in the panel source.
  assert(
    !/const containerStyle: React\.CSSProperties = \{/.test(panelSrc),
    'inline containerStyle declaration is gone from PropertiesPanel',
  );
  assert(
    !/const labelStyle: React\.CSSProperties = \{/.test(panelSrc),
    'inline labelStyle declaration is gone from PropertiesPanel',
  );

  const stylesSrc = readFileSync(
    resolve(here, '../src/ui/components/properties/propertiesPanelStyles.ts'),
    'utf-8',
  );
  assert(/T1-131/.test(stylesSrc),
    'propertiesPanelStyles carries T1-131 marker');
  // Module scope: every style export is `export const NAME: CSSProperties`.
  for (const name of [
    'containerStyle',
    'labelStyle',
    'inputStyle',
    'selectStyle',
    'sectionHeaderStyle',
    'emptyStateStyle',
    'dividerStyle',
    'traceButtonStyle',
    'rowStyle',
  ]) {
    const re = new RegExp(`export const ${name}: CSSProperties = \\{`);
    assert(re.test(stylesSrc),
      `${name} is exported as module-scope const`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
