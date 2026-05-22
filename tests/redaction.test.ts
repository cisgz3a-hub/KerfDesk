/**
 * T2-115: privacy redaction layer for diagnostic exports. Pre-T2-115
 * support bundles, crash reports, and exported logs had no central
 * redaction; license keys, emails, file paths, and IP addresses could
 * leak into customer-shared artifacts. T2-115 centralises the rules
 * in `src/diagnostics/Redaction.ts` so a security review has ONE file
 * to enforce.
 *
 * Run: npx tsx tests/redaction.test.ts
 */
import {
  redactString,
  redactObject,
  redactDefault,
  defaultRedactionOptions,
  type RedactionOptions,
} from '../src/diagnostics/Redaction';

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

console.log('\n=== T2-115 Redaction ===\n');

const ALL_OFF: RedactionOptions = {
  redactLicenseKeys: false,
  redactFilePaths: false,
  redactEmails: false,
  redactIpAddresses: false,
  redactProjectNames: false,
  redactGcode: false,
  redactImages: false,
};

void (async () => {

// 1. License keys ALWAYS redacted (defence-in-depth — even with all
//    options off, the always-on rule fires)
{
  const key = 'A1B2C3D4-E5F6-7890-ABCD-1234567890EF';
  const out = redactString(`license: ${key}`, ALL_OFF);
  assert(out === 'license: [REDACTED:LICENSE]',
    `license key redacted with all options off (got '${out}')`);
}

// 2. License keys redacted when explicitly enabled too
{
  const key = 'a1b2c3d4-e5f6-7890-abcd-1234567890ef';
  const out = redactString(`license: ${key}`, defaultRedactionOptions());
  assert(out === 'license: [REDACTED:LICENSE]',
    `lowercase license key redacted (got '${out}')`);
}

// 3. License keys redacted when nested in an object
{
  const obj = { license: { key: 'A1B2C3D4-E5F6-7890-ABCD-1234567890EF' } };
  const out = redactObject(obj, ALL_OFF) as { license: { key: string } };
  assert(out.license.key === '[REDACTED:LICENSE]',
    `license key redacted in nested object (got '${out.license.key}')`);
}

// 4. Email redacted when redactEmails=true
{
  const opts = { ...ALL_OFF, redactEmails: true };
  const out = redactString('Contact: user@example.com for help', opts);
  assert(out === 'Contact: [REDACTED:EMAIL] for help',
    `email redacted (got '${out}')`);
}

// 5. Email NOT redacted when redactEmails=false
{
  const out = redactString('Contact: user@example.com', ALL_OFF);
  assert(out === 'Contact: user@example.com',
    `email left intact when option off (got '${out}')`);
}

// 6. IPv4 redacted when redactIpAddresses=true
{
  const opts = { ...ALL_OFF, redactIpAddresses: true };
  const out = redactString('Connected to 192.168.1.42 today', opts);
  assert(out === 'Connected to [REDACTED:IP] today',
    `IPv4 redacted (got '${out}')`);
}

// 7. Windows file path redacted
{
  const opts = { ...ALL_OFF, redactFilePaths: true };
  const out = redactString('Open C:\\Users\\alice\\Documents\\proj.lf for details', opts);
  assert(out.includes('[REDACTED:PATH]') && !out.includes('alice'),
    `Windows path redacted, username gone (got '${out}')`);
}

// 8. POSIX home file path redacted
{
  const opts = { ...ALL_OFF, redactFilePaths: true };
  const out = redactString('Loaded /Users/bob/projects/cut.lf at startup', opts);
  assert(out.includes('[REDACTED:PATH]') && !out.includes('bob'),
    `POSIX path redacted, username gone (got '${out}')`);
}

// 9. Linux /home path redacted
{
  const opts = { ...ALL_OFF, redactFilePaths: true };
  const out = redactString('error in /home/charlie/.config/laserforge', opts);
  assert(out.includes('[REDACTED:PATH]') && !out.includes('charlie'),
    `/home path redacted (got '${out}')`);
}

// 10. Recursive object redaction
{
  const obj = {
    error: 'failed loading /Users/dave/proj.lf',
    user: { email: 'dave@example.com', ip: '10.0.0.5' },
    nested: { stack: ['at C:\\Users\\eve\\app.js:42'] },
  };
  const out = redactObject(obj, defaultRedactionOptions()) as typeof obj;
  assert(!out.error.includes('dave'),
    `recursive: top-level path redacted`);
  assert(out.user.email === '[REDACTED:EMAIL]',
    `recursive: nested email redacted (got '${out.user.email}')`);
  assert(out.user.ip === '[REDACTED:IP]',
    `recursive: nested IP redacted (got '${out.user.ip}')`);
  assert(!out.nested.stack[0].includes('eve'),
    `recursive: array element path redacted`);
}

// 11. Input object NOT mutated
{
  const obj = { email: 'user@example.com' };
  redactObject(obj, defaultRedactionOptions());
  assert(obj.email === 'user@example.com',
    `input object unchanged after redactObject`);
}

// 12. Project-name key redacted
{
  const obj = { projectName: 'My Secret Project', objectCount: 42 };
  const opts = { ...ALL_OFF, redactProjectNames: true };
  const out = redactObject(obj, opts) as typeof obj;
  assert(out.projectName === '[REDACTED:PROJECT_NAME]',
    `projectName key redacted (got '${out.projectName}')`);
  assert(out.objectCount === 42,
    `non-string non-PII field preserved`);
}

// 13. sceneName / fileName / name keys also recognised as project-name-shaped
{
  const obj = { sceneName: 'foo', fileName: 'bar', name: 'baz', other: 'qux' };
  const opts = { ...ALL_OFF, redactProjectNames: true };
  const out = redactObject(obj, opts) as typeof obj;
  assert(out.sceneName === '[REDACTED:PROJECT_NAME]', 'sceneName redacted');
  assert(out.fileName === '[REDACTED:PROJECT_NAME]', 'fileName redacted');
  assert(out.name === '[REDACTED:PROJECT_NAME]', 'name redacted');
  assert(out.other === 'qux', 'unrelated key preserved');
}

// 14. G-code intact when redactGcode=false (user opted to share)
{
  const gcode = 'G1 X100.0 Y50.0 F3000 ; layer';
  const out = redactString(gcode, { ...defaultRedactionOptions(), redactGcode: false });
  assert(out === gcode, `G-code preserved when redactGcode=false (got '${out}')`);
}

// 15. G-code-line license key still redacted (defence-in-depth)
{
  const line = 'G1 X10 ; license A1B2C3D4-E5F6-7890-ABCD-1234567890EF';
  const out = redactString(line, defaultRedactionOptions());
  assert(out.includes('[REDACTED:LICENSE]'),
    `license in G-code comment still redacted (got '${out}')`);
}

// 16. Uint8Array under known image-key replaced with size summary
{
  const obj = { data: new Uint8Array([1, 2, 3, 4, 5]) };
  const out = redactObject(obj, defaultRedactionOptions()) as { data: unknown };
  assert(out.data === '[REDACTED:BINARY:5b]',
    `Uint8Array under 'data' key replaced with size summary (got ${String(out.data)})`);
}

// 17. Uint8Array under unrelated key preserved unless redactImages=true
{
  const obj = { payload: new Uint8Array([1, 2, 3]) };
  const out = redactObject(obj, defaultRedactionOptions()) as { payload: unknown };
  assert(out.payload instanceof Uint8Array,
    `Uint8Array under unrelated key preserved by default`);
  const optsWithImages = { ...defaultRedactionOptions(), redactImages: true };
  const out2 = redactObject(obj, optsWithImages) as { payload: unknown };
  assert(out2.payload === '[REDACTED:BINARY:3b]',
    `Uint8Array under unrelated key redacted when redactImages=true`);
}

// 18. Array of strings recursively redacted
{
  const arr = ['user@example.com', '/Users/bob/x', 'plain'];
  const out = redactObject(arr, defaultRedactionOptions()) as string[];
  assert(out[0] === '[REDACTED:EMAIL]', 'array[0] email redacted');
  assert(out[1].includes('[REDACTED:PATH]'), 'array[1] path redacted');
  assert(out[2] === 'plain', 'array[2] plain string unchanged');
}

// 19. Numbers / booleans / null preserved
{
  const obj = { count: 42, ok: true, missing: null, big: BigInt(10) };
  const out = redactObject(obj, defaultRedactionOptions()) as typeof obj;
  assert(out.count === 42, 'number preserved');
  assert(out.ok === true, 'boolean preserved');
  assert(out.missing === null, 'null preserved');
  assert(out.big === BigInt(10), 'bigint preserved');
}

// 20. defaultRedactionOptions: license/path/email/IP on; project/gcode/image off
{
  const opts = defaultRedactionOptions();
  assert(opts.redactLicenseKeys === true, 'default: redactLicenseKeys=true');
  assert(opts.redactFilePaths === true, 'default: redactFilePaths=true');
  assert(opts.redactEmails === true, 'default: redactEmails=true');
  assert(opts.redactIpAddresses === true, 'default: redactIpAddresses=true');
  assert(opts.redactProjectNames === false, 'default: redactProjectNames=false');
  assert(opts.redactGcode === false, 'default: redactGcode=false');
  assert(opts.redactImages === false, 'default: redactImages=false');
}

// 21. redactDefault wires defaults
{
  const obj = { email: 'a@b.com', license: 'A1B2C3D4-E5F6-7890-ABCD-1234567890EF' };
  const out = redactDefault(obj);
  assert(out.email === '[REDACTED:EMAIL]', 'redactDefault: email handled');
  assert(out.license === '[REDACTED:LICENSE]', 'redactDefault: license handled');
}

// 22. Multiple license keys in one string all redacted
{
  const text = 'A1B2C3D4-E5F6-7890-ABCD-1234567890EF and FFEEDDCC-BBAA-9988-7766-554433221100';
  const out = redactString(text, ALL_OFF);
  const matches = out.match(/\[REDACTED:LICENSE\]/g) || [];
  assert(matches.length === 2,
    `both license keys redacted (got ${matches.length})`);
}

// 23. Empty/edge cases
{
  assert(redactString('', defaultRedactionOptions()) === '',
    `empty string → empty string`);
  assert(redactObject(null, defaultRedactionOptions()) === null,
    `null → null`);
  assert(redactObject(undefined, defaultRedactionOptions()) === undefined,
    `undefined → undefined`);
}

// 24. Controller identifiers and secret tokens are redacted by default.
{
  const text = [
    'Controller SN: LF-FALCON-123456',
    'mac=AA:BB:CC:DD:EE:FF',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
    'apiKey=sk_live_1234567890abcdef1234567890abcdef',
    '-----BEGIN PRIVATE KEY-----',
    'not-a-real-key-material',
    '-----END PRIVATE KEY-----',
  ].join('\n');
  const out = redactString(text, defaultRedactionOptions());
  assert(out.includes('[REDACTED:SERIAL]'), `controller serial redacted (got '${out}')`);
  assert(out.includes('[REDACTED:MAC]'), `MAC address redacted (got '${out}')`);
  assert(out.includes('[REDACTED:TOKEN]'), `bearer/API token redacted (got '${out}')`);
  assert(out.includes('[REDACTED:PRIVATE_KEY]'), `private key block redacted (got '${out}')`);
  assert(!/LF-FALCON-123456|AA:BB:CC:DD:EE:FF|abcdefghijklmnopqrstuvwxyz123456|sk_live_|not-a-real-key/.test(out),
    'raw controller identifiers and secrets do not remain');
}

// 25. Opted-in G-code preserves motion but still redacts secrets in comments.
{
  const gcode = [
    'G1 X100.0 Y50.0 F3000 ; token=sk_live_1234567890abcdef1234567890abcdef',
    'M4 S200 ; mac AA:BB:CC:DD:EE:FF',
  ].join('\n');
  const out = redactString(gcode, { ...defaultRedactionOptions(), redactGcode: false });
  assert(out.includes('G1 X100.0 Y50.0 F3000'), 'opted-in G-code motion is preserved');
  assert(out.includes('M4 S200'), 'opted-in G-code laser command is preserved');
  assert(out.includes('[REDACTED:TOKEN]'), `G-code comment token redacted (got '${out}')`);
  assert(out.includes('[REDACTED:MAC]'), `G-code comment MAC redacted (got '${out}')`);
  assert(!/sk_live_|AA:BB:CC:DD:EE:FF/.test(out), 'raw G-code comment secrets do not remain');
}

// 26. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/diagnostics/Redaction.ts'), 'utf-8');
  assert(/T2-115/.test(src), 'T2-115 marker in Redaction.ts');
  for (const fn of ['redactString', 'redactObject', 'defaultRedactionOptions', 'redactDefault']) {
    assert(src.includes(fn), `helper ${fn} declared`);
  }
  for (const placeholder of [
    '[REDACTED:LICENSE]', '[REDACTED:EMAIL]', '[REDACTED:IP]', '[REDACTED:PATH]',
    '[REDACTED:MAC]', '[REDACTED:TOKEN]', '[REDACTED:PRIVATE_KEY]', '[REDACTED:SERIAL]',
  ]) {
    assert(src.includes(placeholder), `placeholder '${placeholder}' present`);
  }
  // defence-in-depth contract: license redaction not gated on the option
  assert(/Always-on|always redacted|defence-in-depth|defense-in-depth/i.test(src),
    `source documents always-on license redaction`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
