import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimitKey, rateLimiterFor } from './rate-limit.mjs';

test('IPv4 counts per address; IPv4-mapped IPv6 counts as that IPv4 client', () => {
  assert.equal(rateLimitKey('192.0.2.1'), 'ipv4:192.0.2.1');
  assert.equal(rateLimitKey('::ffff:192.0.2.1'), 'ipv4:192.0.2.1');
  assert.equal(rateLimitKey('::FFFF:c000:0201'), 'ipv4:192.0.2.1');
  assert.equal(rateLimitKey('0:0:0:0:0:ffff:192.0.2.1'), 'ipv4:192.0.2.1');
});

test('IPv6 counts per /64, whatever the spelling of the address', () => {
  const key = 'ipv6:2001:db8:1:2::/64';
  for (const address of [
    '2001:db8:1:2::7',
    '2001:0DB8:0001:0002:ffff:ffff:ffff:ffff',
    '2001:db8:1:2:3:4:5:6',
    '2001:db8:1:2:0:0:192.0.2.1',
  ])
    assert.equal(rateLimitKey(address), key);
  assert.notEqual(rateLimitKey('2001:db8:1:3::7'), key);
  assert.equal(rateLimitKey('2001:db8::1'), 'ipv6:2001:db8:0:0::/64');
  assert.equal(rateLimitKey('::1'), 'ipv6:0:0:0:0::/64');
  assert.equal(rateLimitKey('fe80::'), 'ipv6:fe80:0:0:0::/64');
});

test('anything that is not an IP address has no key', () => {
  for (const value of [
    null,
    undefined,
    '',
    ':',
    'abc',
    '1.2.3',
    '1.2.3.4.5',
    '256.1.1.1',
    '01.2.3.4',
    '1.2.3.4 ',
    '2001:db8:::1',
    '1::2::3',
    '1:2:3:4:5:6:7:8:9',
    '1:2:3:4:5:6:7:8::',
    '1.2.3.4::',
    '::1.2.3.4:5',
    'fe80::1%eth0',
    '12345::',
    `${'1:'.repeat(40)}1`,
  ])
    assert.equal(rateLimitKey(value), null, String(value));
});

test('webhooks and trial starts have their own limiter; every other route keeps the general one', () => {
  const env = {
    REQUEST_RATE_LIMITER: 'request',
    WEBHOOK_RATE_LIMITER: 'webhook',
    TRIAL_RATE_LIMITER: 'trial',
  };
  assert.equal(rateLimiterFor(env, '/v1/payments/webhook'), 'webhook');
  assert.equal(rateLimiterFor(env, '/v1/trials/start'), 'trial');
  for (const path of ['/v1/licenses/activate', '/v1/checkout', '/v1/admin/export', '/other'])
    assert.equal(rateLimiterFor(env, path), 'request');
});
