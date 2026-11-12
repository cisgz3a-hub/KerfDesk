// spindle-bit — which bit is in the spindle, as the operator last declared it
// (ADR-416 Amendment 4, annoyance audit A2 B4-P1-1).
//
// Zero Z, the touch-plate probe and the controller read-back record Work Z for
// one bit, and a bit-change hold's Continue needs that record to be for the bit
// the program is about to cut with. The bit used to be the open project's
// Default bit, whose only control is in Machine Setup, and Machine Setup's Save
// is refused for the whole of a job (ADR-416 Amendment 1). A job could
// therefore never continue past a bit change unless the next bit already was
// the Default bit.
//
// The bit in the spindle is a fact about the machine, not about the design, so
// it is session state here. A bit-change hold declares the bit it asked for
// (the operator confirms it by touching that bit off), and the Machine rail's
// "Bit in the spindle" selector declares any other. Until either has happened,
// the project's Default bit stands in, as before. The declaration is never
// proof on its own: it only names the bit the NEXT Zero Z or probe records.

import { activeCncTool, type CncTool, type Project } from '../../core/scene';

/** The label of the Machine rail control, as every message names it. */
export const SPINDLE_BIT_LABEL = 'Bit in the spindle';

export type SpindleBit = {
  readonly toolId: string;
  /** Kept with the id: the open project's bit list may not hold this bit. */
  readonly name: string;
};

export type SpindleBitState = {
  /** The declared bit, or null/undefined while the Default bit stands in. */
  readonly spindleBit?: SpindleBit | null;
};

type HoldState = {
  readonly pendingToolId?: string | null;
  readonly pendingToolLabel?: string | null;
};

// Spelled out so a selector's possibly-undefined machine can be passed as it is.
type ProjectMachine = { readonly machine?: Project['machine'] | undefined };

function projectTools(project: ProjectMachine): ReadonlyArray<CncTool> {
  return project.machine?.kind === 'cnc' ? project.machine.tools : [];
}

/** The bit Zero Z, the probe and the controller read-back record Work Z for:
 * the declared bit, else the open CNC project's Default bit. */
export function spindleBitId(state: SpindleBitState, project: ProjectMachine): string | undefined {
  const declared = state.spindleBit;
  if (declared !== null && declared !== undefined) return declared.toolId;
  return project.machine?.kind === 'cnc' ? activeCncTool(project.machine).id : undefined;
}

/** The same bit with the name to show for it, or null when none is known. */
export function spindleBitOf(state: SpindleBitState, project: ProjectMachine): SpindleBit | null {
  const declared = state.spindleBit;
  if (declared !== null && declared !== undefined) {
    // The open project's name for the bit wins: it may have been renamed.
    const listed = projectTools(project).find((tool) => tool.id === declared.toolId);
    return listed === undefined ? declared : { toolId: listed.id, name: listed.name };
  }
  if (project.machine?.kind !== 'cnc') return null;
  const tool = activeCncTool(project.machine);
  return { toolId: tool.id, name: tool.name };
}

/** The open project's entry for the bit in the spindle: its diameter and kind
 * for a corner probe. Null when the declared bit is not in that project's bit
 * list, where nothing is known about it but its name. */
export function spindleBitTool(state: SpindleBitState, project: ProjectMachine): CncTool | null {
  if (project.machine?.kind !== 'cnc') return null;
  const id = spindleBitId(state, project);
  return project.machine.tools.find((tool) => tool.id === id) ?? null;
}

/** What the selector offers: the open project's bits, then the bit a hold is
 * waiting for and the declared bit when that list does not hold them. */
export function spindleBitChoices(
  state: SpindleBitState & HoldState,
  project: ProjectMachine,
): ReadonlyArray<SpindleBit> {
  const choices: SpindleBit[] = projectTools(project).map((tool) => ({
    toolId: tool.id,
    name: tool.name,
  }));
  const add = (bit: SpindleBit | null): void => {
    if (bit !== null && !choices.some((choice) => choice.toolId === bit.toolId)) choices.push(bit);
  };
  add(pendingSpindleBit(state));
  add(state.spindleBit ?? null);
  return choices;
}

/** The bit the current bit-change hold is waiting for, when the program named it. */
export function pendingSpindleBit(state: HoldState): SpindleBit | null {
  const toolId = state.pendingToolId;
  if (toolId === null || toolId === undefined) return null;
  return { toolId, name: state.pendingToolLabel ?? toolId };
}

/** Entering a bit-change hold declares the bit the program asked for, so the
 * touch-off that follows is recorded for it. A hold that names no bit (an
 * imported program, a resume tail) leaves the declaration as it was. */
export function holdEntrySpindleBitPatch(hold: HoldState): SpindleBitState {
  const pending = pendingSpindleBit(hold);
  return pending === null ? {} : { spindleBit: pending };
}

/** Continue's reason at a hold while Work Z is recorded for another bit than
 * the one the program is about to cut with. */
export function wrongBitContinueMessage(expectedBit: string): string {
  return (
    `Work Z belongs to a different bit. Load ${expectedBit}, choose it under ${SPINDLE_BIT_LABEL}, ` +
    'then touch it to the stock top and Zero Z — or probe again — before continuing.'
  );
}

/** The operator's choice in the selector, or null for an id nobody offered. */
export function declaredSpindleBit(
  state: SpindleBitState & HoldState,
  project: ProjectMachine,
  toolId: string,
): SpindleBit | null {
  return spindleBitChoices(state, project).find((choice) => choice.toolId === toolId) ?? null;
}
