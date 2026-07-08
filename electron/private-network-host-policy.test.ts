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
});
