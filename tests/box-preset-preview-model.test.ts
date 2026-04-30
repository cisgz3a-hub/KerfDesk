/**
 * Box preset preview model contracts.
 * Run: npx tsx tests/box-preset-preview-model.test.ts
 */
import { getBoxPresetById } from '../src/core/box/boxLibrary';
import { createBoxPreviewModel } from '../src/core/box/boxPreviewModel';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function preset(id: string) {
  const found = getBoxPresetById(id);
  if (!found) throw new Error(`missing preset ${id}`);
  return found;
}

console.log('\n=== box preset preview model ===\n');

{
  const model = createBoxPreviewModel(preset('open-parts-tray'));
  assert(model.openTop === true, 'open tray yields openTop=true');
  assert(model.variant === 'open-tray', 'open tray keeps variant');
}

{
  const model = createBoxPreviewModel(preset('ventilated-project-box'));
  assert(model.showVentSlots === true, 'electronics vent preset shows vent slots');
  assert(model.openTop === false, 'electronics box remains closed');
}

{
  const model = createBoxPreviewModel(preset('fit-test-mini-box'));
  assert(model.showCouponMarks === true, 'calibration preset shows coupon marks');
  assert(model.variant === 'test-coupon', 'calibration preset uses coupon variant');
}

{
  const model = createBoxPreviewModel(preset('workshop-bin'));
  assert(model.showHandleSlots === true, 'handleStyle=slot shows handle slots');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
