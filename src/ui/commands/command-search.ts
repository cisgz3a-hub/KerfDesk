// Command search (Ctrl+K): ranks what the operator typed against the
// registry's commands and, since ADR-604 Amendment 1, the named machine-panel
// actions, the Settings entries and the Learn lessons (search-entries.ts). A
// command entry is the registry's own command after the machine-kind and
// edition gates, so a result can never offer a command the menus hide. Each
// entry is matched on its label, its tag (menu, panel, Settings or Learn) and
// its description, so "kerf" or "rotary" finds a command whose label does not
// say it.
//
// Every typed word must match somewhere. A word that is a whole label word
// outranks one that only starts a label word, which outranks one found inside
// the description; an enabled entry outranks an equally good disabled one;
// ties keep list order (menus, then panel actions, Settings and lessons).
// Disabled commands stay in the results with their reason, because "why
// can't I do this" is half of what a search is for.

import { COMMAND_HELP } from '../help/command-help-topics';
import type { AppCommand } from './command-types';

/** One searchable row: a menu command, a panel action, a setting or a lesson. */
export type SearchEntry = {
  readonly id: string;
  readonly kind: 'command' | 'panel' | 'setting' | 'lesson';
  readonly label: string;
  /** The tag shown beside the label: the menu, "Machine panel", "Settings" or "Learn". */
  readonly family: string;
  readonly detail: string;
  /** Extra words that find the entry but are not shown. */
  readonly keywords?: string;
  readonly enabled: boolean;
  readonly disabledReason?: string;
  readonly shortcut?: string;
  readonly command?: AppCommand;
  readonly invoke: () => void;
};

export type CommandSearchResult = {
  readonly command: AppCommand;
  readonly score: number;
};

export type SearchEntryResult = {
  readonly entry: SearchEntry;
  readonly score: number;
};

type SearchFields = {
  readonly label: string;
  // Spaces removed, so "gcode" finds "G-code" and "boxgen" finds "Box Generator".
  readonly compactLabel: string;
  readonly labelWords: ReadonlyArray<string>;
  readonly family: string;
  readonly compactTooltip: string;
  readonly tooltipWords: ReadonlyArray<string>;
};

export function commandSearchEntry(command: AppCommand, family: string): SearchEntry {
  return {
    id: command.id,
    kind: 'command',
    label: command.label,
    family,
    detail: command.disabledReason ?? COMMAND_HELP[command.id]?.tooltip ?? command.title,
    keywords: COMMAND_HELP[command.id]?.tooltip ?? command.title,
    enabled: command.enabled,
    ...(command.disabledReason === undefined ? {} : { disabledReason: command.disabledReason }),
    ...(command.shortcut === undefined ? {} : { shortcut: command.shortcut }),
    command,
    invoke: command.invoke,
  };
}

export function searchCommands(
  commands: ReadonlyArray<AppCommand>,
  query: string,
  familyLabel: (command: AppCommand) => string,
): ReadonlyArray<CommandSearchResult> {
  const entries = commands.map((command) => commandSearchEntry(command, familyLabel(command)));
  return searchEntries(entries, query).map(({ entry, score }) => ({
    command: entry.command as AppCommand,
    score,
  }));
}

export function searchEntries(
  entries: ReadonlyArray<SearchEntry>,
  query: string,
): ReadonlyArray<SearchEntryResult> {
  const words = splitWords(normalize(query));
  if (words.length === 0) return entries.map((entry) => ({ entry, score: 0 }));
  const phrase = words.join(' ');
  const scored: Array<SearchEntryResult & { readonly order: number }> = [];
  entries.forEach((entry, order) => {
    const score = scoreEntry(fieldsFor(entry), words, phrase);
    if (score === null) return;
    scored.push({ entry, score: entry.enabled ? score : score - DISABLED_PENALTY, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map(({ entry, score }) => ({ entry, score }));
}

const DISABLED_PENALTY = 5;
// A whole word ("frame") before a word it only starts ("framework").
const WHOLE_WORD_BONUS = 5;

function scoreEntry(
  fields: SearchFields,
  words: ReadonlyArray<string>,
  phrase: string,
): number | null {
  let total = 0;
  for (const word of words) {
    const score = scoreWord(fields, word);
    if (score === 0) return null;
    total += score;
  }
  if (fields.label === phrase) total += 100;
  else if (fields.label.startsWith(phrase)) total += 50;
  return total;
}

function scoreWord(fields: SearchFields, word: string): number {
  const labelIndex = fields.labelWords.findIndex((labelWord) => labelWord.startsWith(word));
  const whole = labelIndex >= 0 && fields.labelWords[labelIndex] === word ? WHOLE_WORD_BONUS : 0;
  if (labelIndex === 0) return 40 + whole;
  if (labelIndex > 0) return 30 + whole;
  if (fields.compactLabel.includes(word)) return 15;
  if (fields.family.startsWith(word)) return 8;
  if (fields.tooltipWords.some((tooltipWord) => tooltipWord.startsWith(word))) return 6;
  if (word.length >= 3 && fields.compactTooltip.includes(word)) return 3;
  if (word.length >= 3 && isSubsequence(word, fields.compactLabel)) return 2;
  return 0;
}

function fieldsFor(entry: SearchEntry): SearchFields {
  const label = normalize(entry.label);
  const tooltip = normalize(entry.keywords ?? entry.detail);
  return {
    label,
    compactLabel: label.replace(/ /g, ''),
    labelWords: splitWords(label),
    family: normalize(entry.family),
    compactTooltip: tooltip.replace(/ /g, ''),
    tooltipWords: splitWords(tooltip),
  };
}

// Lower case, accents folded, punctuation (the menus' "…", "&", "/") turned
// into word breaks so "save as" matches "Save As…" and "g code" matches
// "G-code".
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function splitWords(text: string): ReadonlyArray<string> {
  return text === '' ? [] : text.split(' ');
}

// "bxgen" finds "Box generator": every typed letter appears in order.
function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const char of haystack) {
    if (char === needle[at]) at += 1;
    if (at === needle.length) return true;
  }
  return false;
}
