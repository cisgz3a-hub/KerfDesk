import type { ContourEdge } from './contour-edges';

export type SweepAxis = 'minX' | 'minY';
type OwnedEdge = { readonly edge: ContourEdge; readonly owner: number };
export type ContourContact = { readonly first: OwnedEdge; readonly second: OwnedEdge };
export type ContactChoices = { minX: ContourContact | null; minY: ContourContact | null };

function edgeOrder(a: OwnedEdge, b: OwnedEdge, axis: SweepAxis): number {
  return a.edge[axis] - b.edge[axis] || a.owner - b.owner || a.edge.index - b.edge.index;
}

export function contactOrder(a: ContourContact, b: ContourContact, axis: SweepAxis): number {
  return edgeOrder(a.first, b.first, axis) || edgeOrder(a.second, b.second, axis);
}

/** Keep the earliest sweep event; all later events only revisit the same owners. */
export function rememberContact(
  choices: ContactChoices,
  a: ContourEdge,
  b: ContourEdge,
  sameLoop: boolean,
): void {
  const first = { edge: a, owner: 0 },
    second = { edge: b, owner: sameLoop ? 0 : 1 };
  for (const axis of ['minX', 'minY'] as const) {
    const event =
      edgeOrder(first, second, axis) <= 0 ? { first, second } : { first: second, second: first };
    const previous = choices[axis];
    if (previous === null || contactOrder(event, previous, axis) < 0) choices[axis] = event;
  }
}

/** Geometry may occur more than once; each occurrence keeps its own loop id. */
export function ownedContact(contact: ContourContact, a: number, b: number): ContourContact {
  return {
    first: { edge: contact.first.edge, owner: contact.first.owner === 0 ? a : b },
    second: { edge: contact.second.edge, owner: contact.second.owner === 0 ? a : b },
  };
}
