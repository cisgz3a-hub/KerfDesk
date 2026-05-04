/**
 * T1-60: device profile selector is pinned to the connection panel — always
 * visible when connected — instead of being buried under "More options."
 *
 * Pre-T1-60: a beginner connecting their machine had to click "More options
 * ▼" to even see which profile was active. The profile governs the most
 * safety-critical settings (bed dimensions, origin corner, max spindle,
 * homing, header/footer templates); a wrong profile makes every other
 * setting wrong. Audit 4B Critical UX failure 3 framed the pre-T1-60
 * location as a top-tier "wrong place to burn" cause for beginners.
 *
 * Source-level pin (rather than React mount): ConnectionPanelMain mounts
 * the entire machine-service / controller / preflight tree, which is
 * disproportionately heavy for a contract that targets the panel
 * structure (profileSection variable + position in the layout). The
 * structural assertions guarantee the regression cannot silently revert.
 *
 * Run: npx tsx tests/profile-selector-pinned-to-header.test.ts
 */

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T1-60 device profile selector pinned to header ===\n');

async function run(): Promise<void> {

const fs = await import('node:fs');
const url = await import('node:url');
const path = await import('node:path');
const here = path.dirname(url.fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'),
  'utf-8',
);

assert(/T1-60/.test(src), 'T1-60 marker present in ConnectionPanelMain.tsx');

// 1. profileSection variable exists and is conditional on isConnected.
assert(
  /const profileSection = isConnected && React\.createElement\(/.test(src),
  'profileSection is gated on isConnected (only rendered when machine is connected)',
);

// 2. profileSection mounts DeviceProfileSelector.
{
  const startIdx = src.indexOf('const profileSection = isConnected');
  assert(startIdx > 0, 'profileSection definition found');
  const sliceLen = 800;
  const slice = src.slice(startIdx, startIdx + sliceLen);
  assert(
    /React\.createElement\(DeviceProfileSelector/.test(slice),
    'profileSection mounts DeviceProfileSelector',
  );
}

// 3. profileSection is rendered in the main panel body, BEFORE the
//    MoveControls component (so the user sees it without scrolling).
{
  const profileIdx = src.indexOf('profileSection,\n');
  const moveControlsIdx = src.indexOf('React.createElement(MoveControls,', profileIdx);
  assert(profileIdx > 0, 'profileSection is referenced in the JSX tree');
  assert(
    profileIdx < moveControlsIdx,
    'profileSection renders BEFORE MoveControls (visible at panel top, no scrolling needed)',
  );
}

// 4. The OLD location (DeviceProfileSelector inside the More options
//    collapsed block) is gone.
{
  // Locate the moreSection block.
  const moreStart = src.indexOf('const moreSection = isConnected');
  const moreEnd = src.indexOf('// ─', moreStart);
  const moreBody = src.slice(moreStart, moreEnd > moreStart ? moreEnd : moreStart + 2000);
  assert(
    !/React\.createElement\(DeviceProfileSelector/.test(moreBody),
    'DeviceProfileSelector is NOT mounted inside moreSection (T1-60 moved it out)',
  );
}

// 5. Comment / marker text references the audit framing so the rationale
//    survives a future refactor.
{
  assert(
    /always visible|pinned to the panel/i.test(src.slice(src.indexOf('T1-60'), src.indexOf('T1-60') + 800)),
    'T1-60 marker comment cites "always visible" or "pinned to panel" rationale',
  );
}

// 6. profileSection is a sibling of MoveControls (both rendered inside
//    the same panel-body wrapper), not inside it.
{
  const bodyStart = src.indexOf("isConnected && React.createElement('div', {\n        style: {\n          flex: 1,");
  assert(bodyStart > 0, 'panel body wrapper found');
  // profileSection comma should appear inside this body wrapper.
  const bodyEnd = src.indexOf('React.createElement(JobControls,', bodyStart);
  const body = src.slice(bodyStart, bodyEnd);
  assert(
    /profileSection,/.test(body),
    'profileSection is a child of the scrollable panel-body wrapper (sibling of MoveControls + ConsolePanel)',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
