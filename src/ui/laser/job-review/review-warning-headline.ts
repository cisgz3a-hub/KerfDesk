// Splits a Job Review warning into a short headline and the rest of its text
// (ADR-224 v3). The detectors keep writing full sentences; the review shows
// the leading label or first sentence and keeps the remainder one click away,
// so a list of warnings reads at a glance without dropping a word.

/** A leading "Label: rest" split only when the label is a short phrase. */
const LABEL_MAX_CHARS = 64;
/** Longer headlines are cut at a word and the whole warning becomes the detail. */
const HEADLINE_MAX_CHARS = 110;
/** "e.g. X" and friends end in a full stop that does not end the sentence. */
const ABBREVIATION_ENDING = /\b(?:e\.g|i\.e|vs|etc|approx|incl)$/iu;
const SENTENCE_END = /[.!?]\s+(?=["'([]?[A-Z0-9$])/gu;

export type ReviewWarningParts = {
  readonly headline: string;
  /** The rest of the warning, or null when the headline is the whole text. */
  readonly detail: string | null;
};

export function splitReviewWarning(warning: string): ReviewWarningParts {
  const text = warning.trim();
  const split = paragraphSplit(text) ?? labelSplit(text) ?? sentenceSplit(text);
  const parts = split ?? { headline: stripStop(text), detail: null };
  if (parts.headline.length <= HEADLINE_MAX_CHARS) return parts;
  return { headline: cutAtWord(parts.headline), detail: text };
}

// "Controller identity unconfirmed: no firmware…" → the label. A label must be
// a phrase of three or more words with no quoted name, so "Layer "Cut": …"
// keeps its finding in the headline.
function labelSplit(text: string): ReviewWarningParts | null {
  const index = text.indexOf(': ');
  if (index <= 0 || index > LABEL_MAX_CHARS) return null;
  const label = text.slice(0, index);
  if (/["'“”]/u.test(label) || label.split(' ').length < 3 || /[.!?]\s/u.test(label)) return null;
  return withDetail(label, text.slice(index + 2));
}

// A multi-paragraph prompt reads its first paragraph as the headline.
function paragraphSplit(text: string): ReviewWarningParts | null {
  const index = text.indexOf('\n');
  if (index <= 0) return null;
  const first = text.slice(0, index).trim();
  const sentence = sentenceSplit(first);
  if (sentence !== null) return withDetail(sentence.headline, text.slice(sentence.headline.length));
  return withDetail(first, text.slice(index + 1));
}

function sentenceSplit(text: string): ReviewWarningParts | null {
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = match.index;
    if (ABBREVIATION_ENDING.test(text.slice(0, end))) continue;
    return withDetail(text.slice(0, end), text.slice(end + match[0].length));
  }
  return null;
}

function withDetail(headline: string, rest: string): ReviewWarningParts {
  const detail = rest.replace(/^[\s.]+/u, '').trim();
  return {
    headline: stripStop(headline.trim()),
    detail: detail === '' ? null : detail.charAt(0).toUpperCase() + detail.slice(1),
  };
}

function stripStop(text: string): string {
  return text.endsWith('.') && !text.endsWith('..') ? text.slice(0, -1) : text;
}

function cutAtWord(text: string): string {
  const space = text.lastIndexOf(' ', HEADLINE_MAX_CHARS);
  return `${text.slice(0, space > 0 ? space : HEADLINE_MAX_CHARS).replace(/[\s,;:—-]+$/u, '')}…`;
}
