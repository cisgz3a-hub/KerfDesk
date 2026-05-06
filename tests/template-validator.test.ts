/**
 * T2-5: gcode template validator. Pre-T2-5 the template surfaces
 * (customStartGcode / customEndGcode / gcodeHeaderTemplate / gcode
 * FooterTemplate) were concatenated directly into the emitted
 * stream; preflight saw the plan, not the templates.
 *
 * Run: npx tsx tests/template-validator.test.ts
 */
import {
  validateGcodeTemplate,
  stripComments,
  extractNumber,
  hashTemplate,
  type TemplateValidationContext,
} from '../src/core/plan/GcodeTemplateValidator';

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

console.log('\n=== T2-5 Gcode template validator ===\n');

const baseCtx: TemplateValidationContext = {
  profile: null,
  controllerType: 'grbl',
  machinePlanBounds: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
  isFooter: false,
  allowAdvanced: false,
};

void (async () => {

// 1. Empty template → ok
{
  const r = validateGcodeTemplate('', baseCtx);
  assert(r.ok && r.issues.length === 0, 'empty template → ok, no issues');
}

// 2. Comment-only template → ok
{
  const r = validateGcodeTemplate('; safety baseline\n(comment in parens)', baseCtx);
  assert(r.ok && r.issues.length === 0, 'comment-only template → ok');
}

// 3. M3 without S0 → unsafe-laser-on error
{
  const r = validateGcodeTemplate('M3 S1000', baseCtx);
  assert(!r.ok, `M3 S1000: not ok`);
  assert(r.issues.some((i) => i.kind === 'unsafe-laser-on'),
    `M3 S1000: unsafe-laser-on raised`);
}

// 4. M3 S0 → allowed (safety baseline pattern)
{
  const r = validateGcodeTemplate('M3 S0', baseCtx);
  assert(r.ok, `M3 S0: ok (used as safety baseline)`);
}

// 5. M4 without S0 also unsafe
{
  const r = validateGcodeTemplate('M4 S500', baseCtx);
  assert(r.issues.some((i) => i.kind === 'unsafe-laser-on'),
    `M4 S500: unsafe-laser-on raised`);
}

// 6. G91 in header → unmanaged-relative-mode
{
  const r = validateGcodeTemplate('G91\nG0 X10', baseCtx);
  assert(r.issues.some((i) => i.kind === 'unmanaged-relative-mode'),
    `G91 in header: unmanaged-relative-mode raised`);
}

// 7. G91 in footer → permitted
{
  const r = validateGcodeTemplate('G91\nG0 X-10\nG90\nM5', { ...baseCtx, isFooter: true });
  assert(!r.issues.some((i) => i.kind === 'unmanaged-relative-mode'),
    `G91 in footer: NOT raised (relative-return is a valid footer pattern)`);
}

// 8. G92 → blocked
{
  const r = validateGcodeTemplate('G92 X0 Y0', baseCtx);
  assert(r.issues.some((i) => i.kind === 'g92-coordinate-reset'),
    `G92: g92-coordinate-reset raised`);
}

// 9. $$ system command → blocked
{
  const r = validateGcodeTemplate('$$', baseCtx);
  assert(r.issues.some((i) => i.kind === 'system-command'),
    `$$ system command raised`);
}

// 10. G53 → blocked
{
  const r = validateGcodeTemplate('G53 G0 X0 Y0', baseCtx);
  assert(r.issues.some((i) => i.kind === 'g53-machine-coords'),
    `G53 raised`);
}

// 11. G28 → blocked
{
  const r = validateGcodeTemplate('G28', baseCtx);
  assert(r.issues.some((i) => i.kind === 'g28-go-home'),
    `G28 raised`);
}

// 12. Standalone F setter → warning
{
  const r = validateGcodeTemplate('F3000', baseCtx);
  assert(r.issues.some((i) => i.kind === 'standalone-feed-setter' && i.severity === 'warning'),
    `standalone F setter: warning`);
}

// 13. Standalone S setter → warning
{
  const r = validateGcodeTemplate('S100', baseCtx);
  assert(r.issues.some((i) => i.kind === 'standalone-spindle-setter' && i.severity === 'warning'),
    `standalone S setter: warning`);
}

// 14. M300 on GRBL → controller-mismatch
{
  const r = validateGcodeTemplate('M300', baseCtx);
  assert(r.issues.some((i) => i.kind === 'controller-mismatch'),
    `M300 on GRBL: controller-mismatch raised`);
}

// 15. Bounds violation: G1 X500 outside [0, 400]
{
  const r = validateGcodeTemplate('G0 X500 Y100', baseCtx);
  assert(r.issues.some((i) => i.kind === 'bounds-violation'),
    `X500 outside bounds: bounds-violation raised`);
}

// 16. Bounds OK: G1 X100 inside [0, 400]
{
  const r = validateGcodeTemplate('G0 X100 Y50', baseCtx);
  assert(!r.issues.some((i) => i.kind === 'bounds-violation'),
    `X100 inside bounds: no bounds-violation`);
}

// 17. Bounds NOT enforced when machinePlanBounds=null
{
  const r = validateGcodeTemplate('G0 X9999 Y9999', { ...baseCtx, machinePlanBounds: null });
  assert(!r.issues.some((i) => i.kind === 'bounds-violation'),
    `null bounds: bounds-violation not raised`);
}

// 18. Bounds NOT enforced when in relative mode
{
  const r = validateGcodeTemplate('G91\nG0 X9999\nG90', { ...baseCtx, isFooter: true });
  assert(!r.issues.some((i) => i.kind === 'bounds-violation'),
    `relative mode: bounds-violation not raised on relative move`);
}

// 19. Footer hygiene: footer leaves laser on (M3 S0 then M4 S500 with no M5)
{
  const r = validateGcodeTemplate('M3 S0\nM4 S500', { ...baseCtx, isFooter: true });
  // M4 S500 itself is also flagged; we only assert footer-hygiene presence
  assert(r.issues.some((i) => i.kind === 'footer-leaves-laser-on'),
    `footer leaves laser on: footer-leaves-laser-on raised`);
}

// 20. Footer hygiene: laser turned off cleanly → no footer-leaves-laser-on
{
  const r = validateGcodeTemplate('M5\nG0 X0 Y0', { ...baseCtx, isFooter: true });
  assert(!r.issues.some((i) => i.kind === 'footer-leaves-laser-on'),
    `footer with M5: footer-leaves-laser-on NOT raised`);
}

// 21. Footer hygiene: footer leaves relative mode
{
  const r = validateGcodeTemplate('G91\nG0 X-5', { ...baseCtx, isFooter: true });
  assert(r.issues.some((i) => i.kind === 'footer-leaves-relative-mode'),
    `footer ends in G91: footer-leaves-relative-mode raised`);
}

// 22. Footer hygiene: G90 restored → no footer-leaves-relative-mode
{
  const r = validateGcodeTemplate('G91\nG0 X-5\nG90\nM5', { ...baseCtx, isFooter: true });
  assert(!r.issues.some((i) => i.kind === 'footer-leaves-relative-mode'),
    `footer with G90 restore: not raised`);
}

// 23. Invalid syntax → invalid-syntax
{
  const r = validateGcodeTemplate('blah blah\nG0 X10', baseCtx);
  assert(r.issues.some((i) => i.kind === 'invalid-syntax'),
    `non-gcode line: invalid-syntax raised`);
}

// 24. allowAdvanced downgrades blocked errors to warnings (except syntax/bounds)
{
  const r = validateGcodeTemplate('G91\nG0 X10', { ...baseCtx, allowAdvanced: true });
  const g91 = r.issues.find((i) => i.kind === 'unmanaged-relative-mode');
  assert(g91 != null && g91.severity === 'warning',
    `allowAdvanced: G91 downgraded to warning (got ${g91?.severity})`);
}

// 25. allowAdvanced does NOT downgrade bounds violations
{
  const r = validateGcodeTemplate('G0 X9999', { ...baseCtx, allowAdvanced: true });
  const bv = r.issues.find((i) => i.kind === 'bounds-violation');
  assert(bv != null && bv.severity === 'error',
    `allowAdvanced: bounds violation stays error`);
}

// 26. allowAdvanced does NOT downgrade controller-mismatch
{
  const r = validateGcodeTemplate('M300', { ...baseCtx, allowAdvanced: true });
  const cm = r.issues.find((i) => i.kind === 'controller-mismatch');
  assert(cm != null && cm.severity === 'error',
    `allowAdvanced: controller-mismatch stays error`);
}

// 27. Issue carries 1-based line number + source
{
  const r = validateGcodeTemplate(';\n;\nM3 S1000', baseCtx);
  const iss = r.issues.find((i) => i.kind === 'unsafe-laser-on');
  assert(iss != null && iss.line === 3,
    `issue.line is 1-based and points to line 3 (got ${iss?.line})`);
  assert(iss != null && iss.source.includes('M3'),
    `issue.source carries the offending text`);
}

// 28. ok=false when any error-severity issue
{
  const r = validateGcodeTemplate('M3 S1000', baseCtx);
  assert(r.ok === false, `M3 S1000 → ok=false`);
}

// 29. ok=true when only warnings
{
  const r = validateGcodeTemplate('F3000', baseCtx);
  assert(r.ok === true, `warning-only → ok=true`);
}

// 30. stripComments helper
{
  assert(stripComments('G0 X10 ; comment') === 'G0 X10', `strip ; comment`);
  assert(stripComments('G0 X10 (parens)') === 'G0 X10', `strip parens`);
  assert(stripComments('  G1 X5  ') === 'G1 X5', `strip whitespace`);
}

// 31. extractNumber helper
{
  assert(extractNumber('S', 'M3 S1000') === 1000, `extract S=1000`);
  assert(extractNumber('X', 'G1 X-12.5 Y0') === -12.5, `extract X=-12.5`);
  assert(extractNumber('Z', 'G1 X10') === null, `missing Z → null`);
}

// 32. hashTemplate: same input → same hash
{
  const a = hashTemplate('M3 S0\nG0 X0 Y0');
  const b = hashTemplate('M3 S0\nG0 X0 Y0');
  assert(a === b && /^[0-9a-f]{8}$/.test(a),
    `hash is stable + 8-char hex (got '${a}')`);
}

// 33. hashTemplate: different input → different hash
{
  assert(hashTemplate('A') !== hashTemplate('B'),
    `different inputs produce different hashes`);
}

// 34. profile with homingEnabled=false + $H → controller-mismatch
{
  const profile = { homingEnabled: false } as unknown as
    Parameters<typeof validateGcodeTemplate>[1]['profile'];
  const r = validateGcodeTemplate('$H', { ...baseCtx, profile });
  assert(r.issues.some((i) => i.kind === 'controller-mismatch'),
    `$H + homing disabled: controller-mismatch raised`);
}

// 35. M5 inside template → tracked, no spurious footer-leaves-laser-on
{
  const r = validateGcodeTemplate('M3 S0\nM5\nG0 X0 Y0', { ...baseCtx, isFooter: true });
  assert(!r.issues.some((i) => i.kind === 'footer-leaves-laser-on'),
    `M5 before final motion: laser-on tracking correct`);
}

// 36. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/core/plan/GcodeTemplateValidator.ts'), 'utf-8');
  assert(/T2-5/.test(src), 'T2-5 marker in GcodeTemplateValidator.ts');
  for (const id of [
    'validateGcodeTemplate', 'stripComments', 'extractNumber', 'hashTemplate',
    'TemplateValidationContext', 'TemplateValidationResult', 'TemplateIssue',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const kind of [
    'unsafe-laser-on', 'unmanaged-relative-mode', 'g92-coordinate-reset',
    'system-command', 'g53-machine-coords', 'g28-go-home',
    'standalone-feed-setter', 'standalone-spindle-setter',
    'controller-mismatch', 'bounds-violation',
    'footer-leaves-laser-on', 'footer-leaves-relative-mode', 'invalid-syntax',
  ]) {
    assert(src.includes(`'${kind}'`), `issue kind '${kind}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
