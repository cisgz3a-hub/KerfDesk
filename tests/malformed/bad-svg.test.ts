/**
 * T3-39: malformed and unsupported SVG import safety.
 *
 * Run: npx tsx tests/malformed/bad-svg.test.ts
 */
import { compileGcode } from '../../src/app/PipelineService';
import { createBlankProfile } from '../../src/core/devices/DeviceProfile';
import { importSvgToSceneWithReport } from '../../src/import/svg/SvgToScene';
import { parseGcode } from '../helpers/parseGcode';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function profile() {
  const p = createBlankProfile('T3-39 malformed SVG');
  p.bedWidth = 300;
  p.bedHeight = 300;
  p.maxSpindle = 1000;
  p.originCorner = 'rear-left';
  return p;
}

async function main(): Promise<void> {
  console.log('\n=== T3-39 malformed SVG ===\n');

  {
    const report = importSvgToSceneWithReport(`
      <svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="40mm">
        <foreignObject id="html-widget"><div xmlns="http://www.w3.org/1999/xhtml">HTML</div></foreignObject>
        <rect x="10" y="10" width="20" height="10" fill="black"/>
      </svg>
    `);
    const warning = report.warnings.find(w => w.code === 'SVG_FEATURE_UNSUPPORTED' && w.feature === 'foreignObject');
    assert(warning != null, 'foreignObject emits an unsupported-feature warning');
    assert(report.scene.objects.some(obj => obj.geometry.type === 'rect'), 'supported SVG geometry still imports');
  }

  {
    const report = importSvgToSceneWithReport(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm">
        <path d="%%%%" stroke="red" fill="none"/>
        <rect x="20" y="20" width="25" height="15" stroke="black" fill="none"/>
      </svg>
    `);
    assert(report.scene.objects.length >= 1, 'malformed path does not abort the whole SVG import');

    const compiled = await compileGcode(report.scene, 'absolute', null, null, 'grbl', null, null, profile());
    assert(compiled != null, 'scene with malformed path plus valid geometry compiles');
    if (compiled) {
      const parsed = parseGcode(compiled.gcode);
      assert(parsed.asserts.noNaN, 'malformed SVG path never emits NaN G-code');
      assert(parsed.asserts.noInfinity, 'malformed SVG path never emits Infinity G-code');
      assert(parsed.asserts.finalLaserOff, 'malformed SVG path output still ends laser-off');
    }
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
