/**
 * Guardrails: text outline cache fingerprint is deterministic and sensitive to every outline-affecting field.
 * Run: npx tsx tests/text-outline-cache.test.ts
 */

import { textOutlineFingerprint } from '../src/geometry/textOutlineFingerprint';
import { type TextGeometry } from '../src/core/scene/SceneObject';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function baseText(over: Partial<TextGeometry> = {}): TextGeometry {
  return {
    type: 'text',
    text: 'Hello',
    fontSize: 12,
    fontFamily: 'Arial',
    bold: false,
    italic: false,
    textAlign: 'left',
    letterSpacing: 0,
    lineSpacing: 120,
    wordSpacing: 100,
    ...over,
  };
}

console.log('\n=== Text outline fingerprint guardrails ===');

const a = baseText();
const b = baseText();
assert(textOutlineFingerprint(a) === textOutlineFingerprint(b), 'same geometry → same fingerprint');
assert(textOutlineFingerprint(a) === textOutlineFingerprint(a), 'deterministic repeat call');

assert(
  textOutlineFingerprint(baseText({ text: 'Hello' })) !== textOutlineFingerprint(baseText({ text: 'Hellx' })),
  'text content changes fingerprint',
);
assert(
  textOutlineFingerprint(baseText({ fontSize: 12 })) !== textOutlineFingerprint(baseText({ fontSize: 13 })),
  'fontSize changes fingerprint',
);
assert(
  textOutlineFingerprint(baseText({ fontFamily: 'Arial' })) !==
    textOutlineFingerprint(baseText({ fontFamily: 'Helvetica' })),
  'fontFamily changes fingerprint',
);
assert(
  textOutlineFingerprint(baseText({ bold: false })) !== textOutlineFingerprint(baseText({ bold: true })),
  'bold changes fingerprint',
);
assert(
  textOutlineFingerprint(baseText({ italic: false })) !== textOutlineFingerprint(baseText({ italic: true })),
  'italic changes fingerprint',
);
assert(
  textOutlineFingerprint(baseText({ textAlign: 'left' })) !==
    textOutlineFingerprint(baseText({ textAlign: 'right' })),
  'textAlign changes fingerprint',
);
assert(
  textOutlineFingerprint(baseText({ letterSpacing: 0 })) !==
    textOutlineFingerprint(baseText({ letterSpacing: 5 })),
  'letterSpacing changes fingerprint',
);
assert(
  textOutlineFingerprint(baseText({ lineSpacing: 120 })) !==
    textOutlineFingerprint(baseText({ lineSpacing: 121 })),
  'lineSpacing changes fingerprint',
);
assert(
  textOutlineFingerprint(baseText({ wordSpacing: 100 })) !==
    textOutlineFingerprint(baseText({ wordSpacing: 101 })),
  'wordSpacing changes fingerprint',
);

// outlineSubPaths is compile-time only — must not appear in fingerprint (would thrash cache every compile)
assert(
  !textOutlineFingerprint({ ...a, outlineSubPaths: [] }).includes('outline'),
  'fingerprint JSON does not embed outlineSubPaths label',
);

console.log(`\nText outline fingerprint: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
