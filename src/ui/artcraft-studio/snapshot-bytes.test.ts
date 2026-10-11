import { expect, it } from 'vitest';
import { decodeSnapshotBytes } from './snapshot-bytes';

it('decodes native binary bytes across chunk boundaries while input can run', async () => {
  const source = `${'\u0000\u0080\u00ff'.repeat(200_000)}\u0001\u00fe`;
  let inputTurns = 0;
  const timer = setInterval(() => inputTurns++, 0);
  try {
    const pending = decodeSnapshotBytes(btoa(source));
    expect(inputTurns).toBe(0);
    const result = await pending;
    expect(inputTurns).toBeGreaterThan(3);
    expect(result.length).toBe(source.length);
    for (let index = 0; index < result.length; index++) {
      if (result[index] !== source.charCodeAt(index)) throw new Error(`Byte mismatch at ${index}`);
    }
  } finally {
    clearInterval(timer);
  }
});

it.each(['A', 'AA=A', '!!!!', `${'AAAA'.repeat(65535)}AA==AAAA`])(
  'rejects malformed data, including padding before the last chunk (%#)',
  async (value) => {
    await expect(decodeSnapshotBytes(value)).rejects.toThrow('invalid artwork data');
  },
);
