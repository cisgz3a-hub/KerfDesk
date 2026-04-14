/**
 * Offline tester key generator. Keep LASERFORGE_TESTER_HMAC_SECRET private;
 * it must match VITE_TESTER_HMAC_SECRET / the default in src/entitlements/testerKey.ts for keys to validate.
 *
 * Usage: node scripts/generate-tester-key.mjs WILLEM
 */
import crypto from 'crypto';

const DEFAULT_SECRET = 'bf5c9e2a-7d41-4c8e-9a1b-laserforge-tester-hmac-v1';
const secret = process.env.LASERFORGE_TESTER_HMAC_SECRET || DEFAULT_SECRET;
const name = process.argv[2] || 'TESTER';
const slug = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) || 'TESTER';
const msg = `LaserForge|tester|v1|${slug}`;
const h = crypto.createHmac('sha256', secret).update(msg, 'utf8').digest('hex').slice(0, 8).toUpperCase();
console.log(`TF-${slug}-${h}`);
