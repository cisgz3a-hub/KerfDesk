import { ROUTE } from './routes.mjs';

// Paddle's deliveries (and their retries) and trial starts each get their own budget,
// so neither can exhaust the other or ordinary licence calls; everything else keeps
// `REQUEST_RATE_LIMITER` (ADR-523 Amendment 3).
export function rateLimiterFor(env, path) {
  if (path === ROUTE.webhook) return env.WEBHOOK_RATE_LIMITER;
  if (path === ROUTE.trial) return env.TRIAL_RATE_LIMITER;
  return env.REQUEST_RATE_LIMITER;
}

/**
 * The rate-limit key for a `cf-connecting-ip` value, or null when it is not an IP
 * address. IPv4 counts per address. IPv6 counts per /64, because one subscriber
 * usually holds a whole /64 and could otherwise change address at will. An
 * IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) is that IPv4 client.
 */
export function rateLimitKey(address) {
  if (typeof address !== 'string' || address.length < 2 || address.length > 64) return null;
  const ipv4 = parseIpv4(address);
  if (ipv4) return `ipv4:${ipv4.join('.')}`;
  const words = parseIpv6(address);
  if (!words) return null;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff)
    return `ipv4:${[words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.')}`;
  return `ipv6:${words
    .slice(0, 4)
    .map((word) => word.toString(16))
    .join(':')}::/64`;
}

function parseIpv4(text) {
  const parts = text.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^(0|[1-9][0-9]{0,2})$/u.test(part)))
    return null;
  const bytes = parts.map(Number);
  return bytes.every((byte) => byte <= 255) ? bytes : null;
}

/** Sixteen-bit words of one side of `::`, or null when a part is malformed. */
function ipv6Words(side, allowIpv4Tail) {
  if (side === '') return [];
  const parts = side.split(':');
  const words = [];
  for (const [index, part] of parts.entries()) {
    if (/^[0-9A-Fa-f]{1,4}$/u.test(part)) {
      words.push(Number.parseInt(part, 16));
      continue;
    }
    // A dotted IPv4 tail is allowed only as the final part of the address.
    const tail = allowIpv4Tail && index === parts.length - 1 ? parseIpv4(part) : null;
    if (!tail) return null;
    words.push((tail[0] << 8) | tail[1], (tail[2] << 8) | tail[3]);
  }
  return words;
}

function parseIpv6(text) {
  if (!/^[0-9A-Fa-f:.]+$/u.test(text)) return null;
  const sides = text.split('::');
  if (sides.length > 2) return null;
  if (sides.length === 1) {
    const words = ipv6Words(text, true);
    return words?.length === 8 ? words : null;
  }
  const head = ipv6Words(sides[0], false);
  const tail = ipv6Words(sides[1], true);
  if (!head || !tail || head.length + tail.length > 7) return null;
  return [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail];
}
