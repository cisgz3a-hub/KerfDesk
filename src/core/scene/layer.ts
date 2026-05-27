// Layer — one per unique stroke color in the scene. Carries the cut/engrave
// parameters (power, speed, passes) that the OutputStrategy consumes when
// emitting G-code. WORKFLOW.md F-A7 defines defaults and value ranges.

// MVP only enables 'line'; Fill/Image remain in the type so the UI dropdown
// can render them visible-but-disabled (ADR-005).
export type LayerMode = 'line' | 'fill' | 'image';

export type Layer = {
  readonly id: string;
  readonly color: string; // lowercase 6-digit hex
  readonly mode: LayerMode; // 'line' in MVP
  readonly power: number; // 0..100 (percent)
  readonly speed: number; // mm/min; ≤ device.maxFeed
  readonly passes: number; // integer ≥ 1
  readonly visible: boolean;
  readonly output: boolean;
};

export const LAYER_DEFAULTS = {
  mode: 'line',
  power: 30,
  speed: 1500,
  passes: 1,
  visible: true,
  output: true,
} as const satisfies Omit<Layer, 'id' | 'color'>;

export function createLayer(args: { id: string; color: string }): Layer {
  return { id: args.id, color: args.color, ...LAYER_DEFAULTS };
}
