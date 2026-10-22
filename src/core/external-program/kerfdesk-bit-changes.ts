// KerfDesk's own bit change in a file opened for Run G-code file (ADR-392
// Amendment 2, controller audit v4 E3-P2-1). Project Start holds that M0
// host-side so the operator can re-zero Z. An external run sends it: stock
// GRBL then parses no line, a jog included, until cycle start (protocol.c
// loops `while (sys.suspend)`), and the next bit's spindle start and plunge
// are already queued behind it. A warning, never a refusal (ADR-630).

import { TOOL_CHANGE_LOAD_PREFIX, extractToolChangeLabels } from '../output/tool-change-labels';

const BIT_CHANGE_WARNING_BODY =
  'Run G-code file sends that M0 to the controller as written. The controller then takes no ' +
  "jog or Zero Z until cycle start, and the new bit's spindle start and plunge are already " +
  "sent, so it would cut at the old bit's Z zero. Start the job from its project, which holds " +
  'for the re-zero, or save its tiles again: each bit is then its own file.';

/** The bits KerfDesk's bit-change comments name, in file order. Read from the
 * file as opened: the bytes an external run sends carry no comments. */
export function kerfDeskBitChangeLabels(text: string): ReadonlyArray<string> {
  return text.includes(TOOL_CHANGE_LOAD_PREFIX) ? extractToolChangeLabels(text) : [];
}

/** One warning when the program stops at M0 and names KerfDesk bit changes. */
export function kerfDeskBitChangeWarnings(
  stopsAtM0: boolean,
  labels: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const [first] = labels;
  if (first === undefined || !stopsAtM0) return [];
  const more = labels.length > 1 ? `, then ${labels.length - 1} more` : '';
  return [
    `This file changes bits at an M0 stop (load ${first}${more}). ${BIT_CHANGE_WARNING_BODY}`,
  ];
}
