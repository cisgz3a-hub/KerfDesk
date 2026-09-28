// Which nudge distance an arrow-key press asks for (nudge-preferences.ts).
//
//   arrow            normal (1 mm)
//   Shift+arrow      large (10 mm)
//   Ctrl/Cmd+arrow   fine (0.1 mm) — LightBurn's small-step chord
//
// Alt/Option+arrow is not a nudge: it aligns the selection (arrange-shortcuts.ts),
// as in LightBurn. Ctrl/Cmd+Shift+arrow stays unbound. Windows AltGr arrives
// as Ctrl+Alt, so it never nudges either.

import { DEFAULT_NUDGE_STEPS, type NudgeSteps } from '../state/nudge-preferences';

type ModifierState = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

export function nudgeStepMm(event: ModifierState, steps: NudgeSteps): number | null {
  if (event.altKey) return null;
  const command = event.ctrlKey || event.metaKey;
  if (command) return event.shiftKey ? null : steps.fineMm;
  return event.shiftKey ? steps.largeMm : steps.normalMm;
}

const ARROW_DELTAS: Readonly<Record<string, { dx: number; dy: number }>> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

type NudgeCtx = {
  readonly selectedPathNode: unknown;
  readonly nudgeSelection: (dx: number, dy: number) => void;
  readonly nudgeSelectedPathNode: (dx: number, dy: number) => void;
  readonly nudgeSteps?: NudgeSteps;
};

/** Moves the selected node, or else the selection, for an arrow-key nudge. */
export function tryNudge(e: KeyboardEvent, ctx: NudgeCtx): boolean {
  const arrow = ARROW_DELTAS[e.key];
  if (arrow === undefined) return false;
  const step = nudgeStepMm(e, ctx.nudgeSteps ?? DEFAULT_NUDGE_STEPS);
  if (step === null) return false;
  e.preventDefault();
  if (ctx.selectedPathNode !== null) ctx.nudgeSelectedPathNode(arrow.dx * step, arrow.dy * step);
  else ctx.nudgeSelection(arrow.dx * step, arrow.dy * step);
  return true;
}
