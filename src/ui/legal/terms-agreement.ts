// Agreement to the terms and to machine safety on first use (ADR-564). The terms
// say KerfDesk asks for both the first time it is opened (terms 1.3 and 2.5),
// and asks again only after a change that reduces users' rights, which applies
// to a user only once they agree (24.3). The answer is kept on this device, like
// the other settings, and is never sent anywhere.

import { TERMS_LAST_UPDATED, TERMS_VERSION } from './terms-text.generated';

export const TERMS_AGREEMENT_KEY = 'kerfdesk.terms-agreement.v1';

/**
 * The oldest terms version whose agreement still covers the current terms.
 * Raise it to the new version only when a change reduces users' rights (terms
 * 24.3). Any other change applies from the day it is published, with no new ask.
 */
export const AGREEMENT_COVERS_FROM = '1.0';

export type PublishedTerms = {
  readonly version: string;
  /** Null while the publication date is still a blank: the terms are not out yet. */
  readonly lastUpdated: string | null;
  readonly coversFrom: string;
};

export const CURRENT_TERMS: PublishedTerms = {
  version: TERMS_VERSION,
  lastUpdated: TERMS_LAST_UPDATED,
  coversFrom: AGREEMENT_COVERS_FROM,
};

export type TermsAgreementRecord = {
  readonly version: string;
  readonly agreedAt: string;
  /** A newer version this user was asked about and chose not to agree to. */
  readonly keptEarlier?: string;
};

/** Nothing to ask, the first-use agreement, or a newer version to offer. */
export type TermsAgreementStep = 'none' | 'first' | 'changed';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

// A browser that says it is automated (tests, monitoring) is not a person who
// could agree, so it is never asked.
export function termsAgreementStep(
  record: TermsAgreementRecord | null,
  nav: { readonly webdriver?: boolean },
  terms: PublishedTerms = CURRENT_TERMS,
): TermsAgreementStep {
  if (terms.lastUpdated === null || nav.webdriver === true) return 'none';
  if (record === null) return 'first';
  if (compareVersions(record.version, terms.coversFrom) >= 0) return 'none';
  return record.keptEarlier === terms.version ? 'none' : 'changed';
}

// A record this build cannot read counts as no agreement, so it asks again
// rather than assume one.
export function readTermsAgreement(storage: StorageLike | null): TermsAgreementRecord | null {
  try {
    const stored: unknown = JSON.parse(storage?.getItem(TERMS_AGREEMENT_KEY) ?? 'null');
    if (typeof stored !== 'object' || stored === null) return null;
    const { version, agreedAt, keptEarlier } = stored as Record<string, unknown>;
    if (typeof version !== 'string' || parseVersion(version) === null) return null;
    if (typeof agreedAt !== 'string') return null;
    return typeof keptEarlier === 'string'
      ? { version, agreedAt, keptEarlier }
      : { version, agreedAt };
  } catch {
    return null;
  }
}

export function recordTermsAgreement(
  storage: StorageLike | null,
  version: string,
  now: Date = new Date(),
): void {
  write(storage, { version, agreedAt: now.toISOString() });
}

/** The user keeps the terms they agreed to before; `version` is not asked about again. */
export function recordEarlierTermsKept(
  storage: StorageLike | null,
  record: TermsAgreementRecord,
  version: string,
): void {
  write(storage, { ...record, keptEarlier: version });
}

function write(storage: StorageLike | null, record: TermsAgreementRecord): void {
  try {
    storage?.setItem(TERMS_AGREEMENT_KEY, JSON.stringify(record));
  } catch {
    // Storage that is full or blocked keeps nothing, so the next visit asks again.
  }
}

function parseVersion(version: string): readonly [number, number] | null {
  const match = /^(\d+)\.(\d+)$/.exec(version);
  return match === null ? null : [Number(match[1]), Number(match[2])];
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a) ?? [0, 0];
  const right = parseVersion(b) ?? [0, 0];
  return left[0] - right[0] || left[1] - right[1];
}
