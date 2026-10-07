import { expect, it } from 'vitest';
import { MachineTelnetCodec, encodeMachineTelnet } from './machine-network-telnet';

it('keeps byte commands exact and escapes IAC without UTF-8 encoding', () => {
  expect([...encodeMachineTelnet(Uint8Array.from([0x85, 0x18, 255, 10]))]).toEqual([
    0x85, 0x18, 255, 255, 10,
  ]);
});
it('consumes split Telnet negotiation and never presents its bytes as controller replies', () => {
  const codec = new MachineTelnetCodec();
  expect(codec.decode(Uint8Array.from([255, 251])).data.length).toBe(0);
  const result = codec.decode(Uint8Array.from([1, 111, 107, 13, 10, 255, 253, 3]));
  expect(result.data.toString()).toBe('ok\r\n');
  expect([...result.reply]).toEqual([255, 254, 1, 255, 252, 3]);
  expect(codec.decode(Uint8Array.from([255, 252, 3])).reply.length).toBe(0);
});
it('skips bounded subnegotiation and handles escaped IAC data', () => {
  const codec = new MachineTelnetCodec();
  expect([...codec.decode(Uint8Array.from([255, 250, 1, 2, 255, 240, 65, 255, 255])).data]).toEqual(
    [65, 255],
  );
  expect(() => codec.decode(Uint8Array.from([255, 250, ...Array<number>(4097).fill(1)]))).toThrow(
    'limit',
  );
});
