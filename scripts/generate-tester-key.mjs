/**
 * Offline tester key generator. Set LASERFORGE_TESTER_HMAC_SECRET to the
 * same value as VITE_TESTER_HMAC_SECRET used at build time of the build that
 * will validate these keys.
 *
 * Usage: LASERFORGE_TESTER_HMAC_SECRET=... node scripts/generate-tester-key.mjs WILLEM
 *
 * T1-77: this script no longer carries a hardcoded default secret. The
 * previous default lived in source-controlled text and was identical to the
 * one previously baked into the client bundle. Removing it from this script
 * is consistent with removing it from the client bundle: the secret is now
 * strictly out-of-source.
 */
import crypto from 'crypto';

const secret = process.env.LASERFORGE_TESTER_HMAC_SECRET;
if (!secret) {
  console.error(
    'Error: LASERFORGE_TESTER_HMAC_SECRET is not set.\n'
    + 'Set it to the same value used as VITE_TESTER_HMAC_SECRET at build time.',
  );
  process.exit(1);
}
const name = process.argv[2] || 'TESTER';
const slug = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) || 'TESTER';
const msg = `LaserForge|tester|v1|${slug}`;
const h = crypto.createHmac('sha256', secret).update(msg, 'utf8').digest('hex').slice(0, 8).toUpperCase();
console.log(`TF-${slug}-${h}`);
