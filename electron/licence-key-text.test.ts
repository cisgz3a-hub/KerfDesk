import { describe, expect, it } from 'vitest';
import { findLicenceKey, looksLikePartialLicenceKey } from '../public/licence-key-text.mjs';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const SECRET = 'aB3_dE-fGhIjKlMnOpQrStUvWxYz0123456789abcde';
const KEY = `KD1.${ID}.${SECRET}`;

describe('finding a licence key in pasted text', () => {
  it('reads the bare key and the shapes customers paste from emails, chats and receipts', () => {
    expect(KEY).toHaveLength(84);
    for (const pasted of [
      KEY,
      `  ${KEY}\n`,
      `Licence key: ${KEY}`,
      `Your key is ${KEY}. Keep it safe.`,
      `KD1.${ID}.\n${SECRET}`,
      `KD1.${ID.slice(0, 18)}\r\n${ID.slice(18)}.${SECRET}`,
      `KD1.${ID}.${SECRET.slice(0, 20)}\u200b${SECRET.slice(20)}`,
      `${KEY}\n${KEY}`,
    ])
      expect(findLicenceKey(pasted)).toBe(KEY);
  });
  it('finds nothing in a partial key, an altered key, two different keys or unrelated text', () => {
    const other = `KD1.${ID}.${'z'.repeat(43)}`;
    for (const pasted of [
      '',
      'hello',
      KEY.slice(0, -1),
      `${KEY}x`,
      KEY.replace('KD1.', 'KD2.'),
      KEY.toUpperCase(),
      `${KEY} ${other}`,
      null,
      'x'.repeat(5000),
    ])
      expect(findLicenceKey(pasted)).toBeNull();
    expect(looksLikePartialLicenceKey(KEY.slice(0, 50))).toBe(true);
    expect(looksLikePartialLicenceKey(KEY)).toBe(false);
    expect(looksLikePartialLicenceKey('synthetic-key')).toBe(false);
  });
});
