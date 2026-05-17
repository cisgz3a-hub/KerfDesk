/**
 * GRBL user console command classification (safe / warn / dangerous).
 * Run: npx tsx tests/command-classifier.test.ts
 */
import { classifyUserCommand } from '../src/controllers/grbl/CommandClassifier';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function expectSafe(cmd: string): void {
  const c = classifyUserCommand(cmd);
  assert(c.severity === 'safe', `safe: ${JSON.stringify(cmd)} → ${c.severity}`);
}

function expectWarn(cmd: string): void {
  const c = classifyUserCommand(cmd);
  assert(c.severity === 'warn', `warn: ${JSON.stringify(cmd)} → ${c.severity}`);
}

function expectDangerous(cmd: string): void {
  const c = classifyUserCommand(cmd);
  assert(c.severity === 'dangerous', `dangerous: ${JSON.stringify(cmd)} → ${c.severity}`);
}

console.log('\n=== command-classifier ===\n');

// SAFE
expectSafe('?');
expectSafe('!');
expectSafe('~');
expectSafe(String.fromCharCode(0x18));
expectSafe('$$');
expectSafe('$#');
expectSafe('$G');
expectSafe('$H');
expectSafe('G0 X10');
expectSafe('G1 X10 Y10');
expectSafe('G2 X10 I5');
expectSafe('$J=X10F1000');
expectSafe('M5');
expectSafe('M3 S0');
expectSafe('M4 S0');
expectSafe('M3 s0');
expectSafe('M30');
expectSafe('G100 X0');
expectSafe('G0 X0 ; M3 S500');
expectSafe('G1 X1 (M4 S300)');
expectSafe('G0 G91');
expectSafe('G90');

// WARN — settings / offsets / laser on
expectWarn('$10=0');
expectWarn('$100=250');
expectWarn('$130=400');
expectWarn('G10 L2 P1 X0 Y0');
expectWarn('G92 X0');
expectWarn('M3 S500');
expectWarn('m4 s100');
expectWarn('M3 S0.5');
expectWarn('M3');
expectWarn('M4');
expectWarn('G92 X0Y0');
expectWarn('G10 P1 R10');
expectWarn('G0 X0 M3 S500');
expectWarn('G1 X10 M4 S300');
expectWarn('G0 G92 X0 Y0');
expectWarn('G90 G10 L20 P1 X0 Y0');
expectWarn('G1 X0 M3');

// DANGEROUS
expectDangerous('$X');
expectDangerous('$RST=*');
expectDangerous('$RST=#');
expectDangerous('$RST=$');
expectDangerous('$SLP');

// Edge: whitespace, empty
{
  const c1 = classifyUserCommand('   $X   ');
  assert(
    c1.severity === 'dangerous' && c1.command === '$X',
    "trimmed: '   $X   ' is dangerous, command is '$X'",
  );
  const c2 = classifyUserCommand('');
  assert(c2.severity === 'safe' && c2.command === '', 'empty string → safe');
  const c3 = classifyUserCommand('   \t  ');
  assert(c3.severity === 'safe', 'whitespace-only → safe');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
