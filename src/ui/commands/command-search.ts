// Command search (Ctrl+K): ranks the registry's commands against what the
// operator typed. It searches the same commands the menus render, after the
// machine-kind and edition gates, so a result can never offer a command the
// menus hide. Each command is matched on its menu label, its menu name and
// its help tooltip, so "kerf" or "rotary" finds a command whose label does
// not say it.
//
// Every typed word must match somewhere. A word that starts a label word
// outranks one found inside the tooltip, and an enabled command outranks an
// equally good disabled one; ties keep menu order. Disabled commands stay in
// the results with their reason, because "why can't I do this" is half of
// what a search is for.

import { COMMAND_HELP } from '../help/command-help-topics';
import type { AppCommand } from './command-types';

export type CommandSearchResult = {
  readonly command: AppCommand;
  readonly score: number;
};

type SearchFields = {
  readonly label: string;
  // Spaces removed, so "gcode" finds "G-code" and "setorigin" finds "Set origin".
  readonly compactLabel: string;
  readonly labelWords: ReadonlyArray<string>;
  readonly family: string;
  readonly compactTooltip: string;
  readonly tooltipWords: ReadonlyArray<string>;
};

export function searchCommands(
  commands: ReadonlyArray<AppCommand>,
  query: string,
  familyLabel: (command: AppCommand) => string,
): ReadonlyArray<CommandSearchResult> {
  const words = splitWords(normalize(query));
  if (words.length === 0) return commands.map((command) => ({ command, score: 0 }));
  const phrase = words.join(' ');
  const scored: Array<CommandSearchResult & { readonly order: number }> = [];
  commands.forEach((command, order) => {
    const score = scoreCommand(fieldsFor(command, familyLabel(command)), words, phrase);
    if (score === null) return;
    scored.push({ command, score: command.enabled ? score : score - DISABLED_PENALTY, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map(({ command, score }) => ({ command, score }));
}

const DISABLED_PENALTY = 5;

function scoreCommand(
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
  if (labelIndex === 0) return 40;
  if (labelIndex > 0) return 30;
  if (fields.compactLabel.includes(word)) return 15;
  if (fields.family.startsWith(word)) return 8;
  if (fields.tooltipWords.some((tooltipWord) => tooltipWord.startsWith(word))) return 6;
  if (word.length >= 3 && fields.compactTooltip.includes(word)) return 3;
  if (word.length >= 3 && isSubsequence(word, fields.compactLabel)) return 2;
  return 0;
}

function fieldsFor(command: AppCommand, family: string): SearchFields {
  const label = normalize(command.label);
  const tooltip = normalize(COMMAND_HELP[command.id]?.tooltip ?? command.title);
  return {
    label,
    compactLabel: label.replace(/ /g, ''),
    labelWords: splitWords(label),
    family: normalize(family),
    compactTooltip: tooltip.replace(/ /g, ''),
    tooltipWords: splitWords(tooltip),
  };
}

// Lower case, accents folded, punctuation (the menus' "…", "&", "/") turned
// into word breaks so "save as" matches "Save As…" and "g code" matches
// "G-code".
function normalize(text: string): string {
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
