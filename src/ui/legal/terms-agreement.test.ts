import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_COVERS_FROM,
  CURRENT_TERMS,
  TERMS_AGREEMENT_KEY,
  readTermsAgreement,
  recordEarlierTermsKept,
  recordTermsAgreement,
  termsAgreementStep,
  type PublishedTerms,
} from './terms-agreement';
import { TERMS_VERSION } from './terms-text.generated';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

const PUBLISHED: PublishedTerms = {
  version: '1.0',
  lastUpdated: '12 October 2026',
  coversFrom: '1.0',
};
const PERSON = { webdriver: false };

describe('when KerfDesk asks for agreement to the terms (ADR-564)', () => {
  it('asks on first use once the terms are published', () => {
    expect(termsAgreementStep(null, PERSON, PUBLISHED)).toBe('first');
  });

  it('asks nothing while the publication date is still a blank', () => {
    expect(termsAgreementStep(null, PERSON, { ...PUBLISHED, lastUpdated: null })).toBe('none');
  });

  it('never asks a browser that reports it is automated', () => {
    expect(termsAgreementStep(null, { webdriver: true }, PUBLISHED)).toBe('none');
  });

  it('asks nothing after agreement to a version the current terms still cover', () => {
    const record = { version: '1.0', agreedAt: '2026-10-12T08:00:00.000Z' };
    expect(termsAgreementStep(record, PERSON, PUBLISHED)).toBe('none');
    // A change that keeps users' rights applies from publication (terms 24.3).
    expect(termsAgreementStep(record, PERSON, { ...PUBLISHED, version: '1.1' })).toBe('none');
  });

  it('offers a version that reduces rights once, and keeping the earlier terms ends it', () => {
    const newer = { version: '2.0', lastUpdated: '1 March 2027', coversFrom: '2.0' };
    const record = { version: '1.0', agreedAt: '2026-10-12T08:00:00.000Z' };
    expect(termsAgreementStep(record, PERSON, newer)).toBe('changed');
    expect(termsAgreementStep({ ...record, keptEarlier: '2.0' }, PERSON, newer)).toBe('none');
    expect(
      termsAgreementStep({ ...record, keptEarlier: '2.0' }, PERSON, { ...newer, version: '2.1' }),
    ).toBe('changed');
    // Versions compare as numbers: 1.10 is newer than 1.9.
    expect(
      termsAgreementStep({ version: '1.10', agreedAt: record.agreedAt }, PERSON, {
        ...newer,
        version: '1.10',
        coversFrom: '1.9',
      }),
    ).toBe('none');
  });

  it('covers the current terms from their own version or an earlier one', () => {
    expect(CURRENT_TERMS.version).toBe(TERMS_VERSION);
    expect(
      AGREEMENT_COVERS_FROM.localeCompare(TERMS_VERSION, 'en', { numeric: true }),
    ).toBeLessThanOrEqual(0);
  });
});

describe('the stored agreement', () => {
  it('keeps the version and time agreed, and a newer version declined', () => {
    const storage = memoryStorage();
    recordTermsAgreement(storage, '1.0', new Date('2026-10-12T08:00:00.000Z'));
    const record = readTermsAgreement(storage);
    expect(record).toEqual({ version: '1.0', agreedAt: '2026-10-12T08:00:00.000Z' });
    recordEarlierTermsKept(storage, record!, '2.0');
    expect(readTermsAgreement(storage)).toEqual({
      version: '1.0',
      agreedAt: '2026-10-12T08:00:00.000Z',
      keptEarlier: '2.0',
    });
    recordTermsAgreement(storage, '2.0', new Date('2027-03-01T08:00:00.000Z'));
    expect(readTermsAgreement(storage)).toEqual({
      version: '2.0',
      agreedAt: '2027-03-01T08:00:00.000Z',
    });
  });

  it('reads a record it cannot understand as no agreement', () => {
    for (const stored of [
      'not json',
      '"1.0"',
      '{"version":"one","agreedAt":"x"}',
      '{"version":"1.0"}',
    ]) {
      expect(readTermsAgreement(memoryStorage({ [TERMS_AGREEMENT_KEY]: stored }))).toBeNull();
    }
    expect(readTermsAgreement(null)).toBeNull();
  });

  it('survives storage that refuses to read or write', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(readTermsAgreement(blocked)).toBeNull();
    expect(() => recordTermsAgreement(blocked, '1.0')).not.toThrow();
  });
});
