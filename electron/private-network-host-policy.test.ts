import { describe, expect, it } from 'vitest';
import { isAllowedPrivateNetworkHost } from './private-network-host-policy';

describe('private network host policy', () => {
  it('allows loopback hosts', () => {
    expect(isAllowedPrivateNetworkHost('localhost')).toBe(true);
    expect(isAllowedPrivateNetworkHost('LOCALHOST')).toBe(true);
    expect(isAllowedPrivateNetworkHost('::1')).toBe(true);
    expect(isAllowedPrivateNetworkHost('[::1]')).toBe(true);
    expect(isAllowedPrivateNetworkHost('127.0.0.1')).toBe(true);
  });

  it('allows RFC1918 private IPv4 hosts', () => {
    expect(isAllowedPrivateNetworkHost('10.0.0.5')).toBe(true);
    expect(isAllowedPrivateNetworkHost('172.16.4.2')).toBe(true);
    expect(isAllowedPrivateNetworkHost('172.31.255.255')).toBe(true);
    expect(isAllowedPrivateNetworkHost('192.168.10.1')).toBe(true);
  });

  it('rejects public and malformed hosts', () => {
    expect(isAllowedPrivateNetworkHost('8.8.8.8')).toBe(false);
    expect(isAllowedPrivateNetworkHost('172.15.0.1')).toBe(false);
    expect(isAllowedPrivateNetworkHost('172.32.0.1')).toBe(false);
    expect(isAllowedPrivateNetworkHost('192.169.1.1')).toBe(false);
    expect(isAllowedPrivateNetworkHost('10.999.1.1')).toBe(false);
    expect(isAllowedPrivateNetworkHost('192.168.1')).toBe(false);
    expect(isAllowedPrivateNetworkHost('example.com')).toBe(false);
    expect(isAllowedPrivateNetworkHost('kerfdesk.com')).toBe(false);
  });

  it('allows IPv6 ULA (fc00::/7) and link-local (fe80::/10) hosts', () => {
    expect(isAllowedPrivateNetworkHost('fc00::1')).toBe(true);
    expect(isAllowedPrivateNetworkHost('fd12:3456::1')).toBe(true);
    expect(isAllowedPrivateNetworkHost('[fe80::1]')).toBe(true);
    expect(isAllowedPrivateNetworkHost('FE80::1')).toBe(true);
    expect(isAllowedPrivateNetworkHost('fe80::1%eth0')).toBe(true); // scoped zone id
    expect(isAllowedPrivateNetworkHost('febf::1')).toBe(true); // link-local upper edge
    expect(isAllowedPrivateNetworkHost('fdff::1')).toBe(true); // ULA upper edge
  });

  it('rejects public, site-local, v4-mapped, and malformed IPv6 hosts', () => {
    expect(isAllowedPrivateNetworkHost('2001:4860:4860::8888')).toBe(false); // public
    expect(isAllowedPrivateNetworkHost('fec0::1')).toBe(false); // deprecated site-local
    expect(isAllowedPrivateNetworkHost('fe7f::1')).toBe(false); // just below link-local
    expect(isAllowedPrivateNetworkHost('::ffff:8.8.8.8')).toBe(false); // v4-mapped public
    expect(isAllowedPrivateNetworkHost('fc00:zzzz')).toBe(false); // malformed, no throw
    expect(isAllowedPrivateNetworkHost('::')).toBe(false); // unspecified
  });

  it('rejects private-prefixed but structurally malformed IPv6 literals', () => {
    // First-hextet classification alone would admit these; structural validation
    // refuses them (self-audit: the exported gate must be robust to raw callers).
    expect(isAllowedPrivateNetworkHost('fdff:')).toBe(false); // trailing single colon
    expect(isAllowedPrivateNetworkHost('fe80:')).toBe(false); // trailing single colon
    expect(isAllowedPrivateNetworkHost('fc00:::::')).toBe(false); // ':::' run
    expect(isAllowedPrivateNetworkHost('fc00::1::2')).toBe(false); // two '::' elisions
    expect(isAllowedPrivateNetworkHost('fc00:1:2:3:4:5:6:7:8')).toBe(false); // 9 groups
    expect(isAllowedPrivateNetworkHost('fc000::1')).toBe(false); // 5-digit group
  });
});
