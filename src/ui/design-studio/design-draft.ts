// design-draft — the in-progress gesture, and how it becomes an entity
// (ADR-271, DS-3).
//
// Lives in ui/ rather than core/design on purpose: a draft is interaction state,
// not a domain concept, and it carries the modifier keys that only a pointer has.
// It is still pure and separately tested — the geometry of "what does this drag
// mean" must be checkable without a canvas.
//
// Modifier semantics follow LightBurn (verified in its docs): Shift constrains
// (square / circle / 45 degrees), Alt draws from the centre outward. Same keys as
// the main workspace's drawing tools, so the two surfaces do not disagree.

import type { SketchEntity } from '../../core/design';
import type { Vec2 } from '../../core/scene';

export type DraftModifiers = {
  // Shift: equal sides, or a 45-degree-locked direction.
  readonly constrain: boolean;
  // Alt: the anchor is the centre rather than a corner.
  readonly fromCentre: boolean;
};

export const NO_MODIFIERS: DraftModifiers = { constrain: false, fromCentre: false };

export type DraftTool = 'line' | 'rect' | 'circle';

export type DesignDraft = {
  readonly tool: DraftTool;
  readonly anchorMm: Vec2;
  readonly pointerMm: Vec2;
  readonly modifiers: DraftModifiers;
};

const DEGREES_PER_CONSTRAINED_STEP = 45;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// Turns the gesture into an entity, or null while it is still too small to mean
// anything. Null is "keep drawing", never an error.
export function draftToEntity(draft: DesignDraft, id: string): SketchEntity | null {
  switch (draft.tool) {
    case 'line':
      return { kind: 'line', id, start: draft.anchorMm, end: lineEndMm(draft) };
    case 'rect':
      return rectEntity(draft, id);
    case 'circle':
      return { kind: 'circle', id, center: circleCentreMm(draft), radiusMm: circleRadiusMm(draft) };
  }
}

// Shift locks the direction to the nearest 45 degrees while preserving the
// pointer's distance, so a constrained line does not also change length.
export function lineEndMm(draft: DesignDraft): Vec2 {
  const dx = draft.pointerMm.x - draft.anchorMm.x;
  const dy = draft.pointerMm.y - draft.anchorMm.y;
  if (!draft.modifiers.constrain) return draft.pointerMm;
  const length = Math.hypot(dx, dy);
  if (length === 0) return draft.pointerMm;
  const snappedDeg =
    Math.round((Math.atan2(dy, dx) * RAD_TO_DEG) / DEGREES_PER_CONSTRAINED_STEP) *
    DEGREES_PER_CONSTRAINED_STEP;
  const snappedRad = snappedDeg * DEG_TO_RAD;
  return {
    x: draft.anchorMm.x + Math.cos(snappedRad) * length,
    y: draft.anchorMm.y + Math.sin(snappedRad) * length,
  };
}

export function draftLengthMm(draft: DesignDraft): number {
  const end = lineEndMm(draft);
  return Math.hypot(end.x - draft.anchorMm.x, end.y - draft.anchorMm.y);
}

export function draftAngleDeg(draft: DesignDraft): number {
  const end = lineEndMm(draft);
  const deg = Math.atan2(end.y - draft.anchorMm.y, end.x - draft.anchorMm.x) * RAD_TO_DEG;
  return deg < 0 ? deg + 360 : deg;
}

// Corner-to-corner by default; Alt makes the anchor the centre. Shift squares it
// using the larger extent so the shape follows the pointer rather than shrinking.
export function draftRectMm(draft: DesignDraft): {
  readonly origin: Vec2;
  readonly widthMm: number;
  readonly heightMm: number;
} {
  let width = Math.abs(draft.pointerMm.x - draft.anchorMm.x);
  let height = Math.abs(draft.pointerMm.y - draft.anchorMm.y);
  if (draft.modifiers.constrain) {
    const side = Math.max(width, height);
    width = side;
    height = side;
  }
  if (draft.modifiers.fromCentre) {
    return {
      origin: { x: draft.anchorMm.x - width, y: draft.anchorMm.y - height },
      widthMm: width * 2,
      heightMm: height * 2,
    };
  }
  const signX = draft.pointerMm.x < draft.anchorMm.x ? -1 : 1;
  const signY = draft.pointerMm.y < draft.anchorMm.y ? -1 : 1;
  return {
    origin: {
      x: signX < 0 ? draft.anchorMm.x - width : draft.anchorMm.x,
      y: signY < 0 ? draft.anchorMm.y - height : draft.anchorMm.y,
    },
    widthMm: width,
    heightMm: height,
  };
}

function rectEntity(draft: DesignDraft, id: string): SketchEntity {
  const rect = draftRectMm(draft);
  return {
    kind: 'rect',
    id,
    origin: rect.origin,
    widthMm: rect.widthMm,
    heightMm: rect.heightMm,
    cornerRadiusMm: 0,
  };
}

// Alt reinterprets the drag as diameter-across (anchor and pointer are opposite
// points on the rim), which is how a two-point circle is normally drawn.
export function circleCentreMm(draft: DesignDraft): Vec2 {
  if (!draft.modifiers.fromCentre) return draft.anchorMm;
  return {
    x: (draft.anchorMm.x + draft.pointerMm.x) / 2,
    y: (draft.anchorMm.y + draft.pointerMm.y) / 2,
  };
}

export function circleRadiusMm(draft: DesignDraft): number {
  const dx = draft.pointerMm.x - draft.anchorMm.x;
  const dy = draft.pointerMm.y - draft.anchorMm.y;
  const distance = Math.hypot(dx, dy);
  return draft.modifiers.fromCentre ? distance / 2 : distance;
}

export function isDraftTool(tool: string): tool is DraftTool {
  return tool === 'line' || tool === 'rect' || tool === 'circle';
}
