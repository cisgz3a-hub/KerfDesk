import { useStore } from '../state/store';
import type { RemoteControlOptions } from './types';
import { safeLabel } from './projections';
import type { Scene, SceneObject } from '../../core/scene';
import { artworkOperationName } from '../../core/scene/artwork-operation';

const PATTERN_LIMIT = 512;
const PATTERN_CHAR_LIMIT = 65_536;
const MESSAGE_SCAN_LIMIT = 65_536;
const normalized = (value: string): string => value.normalize('NFC').replace(/\s+/g, ' ').trim();

/** Warning generators sometimes include automatically text-named operations. */
export function reviewMessageProjector(
  options: RemoteControlOptions,
): (value: string, fallback: string) => string {
  if (options.canShareArtwork?.() === true)
    return (value, fallback) => safeLabel(value, fallback, 512);
  const scene = (options.store ?? useStore).getState().project.scene;
  const labels = collectPrivateLabels(scene);
  if (labels === null) return (_value, fallback) => fallback;
  const alternatives = [...labels]
    .sort((a, b) => b.length - a.length)
    .map((label) => {
      const literal = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return label.length < 3 ? `(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])` : literal;
    });
  const pattern = alternatives.length === 0 ? null : new RegExp(alternatives.join('|'), 'giu');
  const quotedNames = new Set([...labels].map((label) => label.toLowerCase()));
  return (value, fallback) => {
    if (value.length > MESSAGE_SCAN_LIMIT) return fallback;
    const original = normalized(safeLabel(value, fallback, MESSAGE_SCAN_LIMIT));
    // Output-time variable values and CSV headings are not scene labels.
    // Never inspect or re-evaluate the private dataset to disclose a failure.
    if (/\b(?:Barcode .*? cannot encode |CSV column )/iu.test(original)) return fallback;
    const projected = redactKnownLabelContexts(original, quotedNames);
    // Every occurrence must be consumed, rather than treating one redacted
    // context as permission to disclose the same label elsewhere in the prose.
    if (pattern !== null && projected.match(pattern) !== null) return fallback;
    return projected.slice(0, 512);
  };
}

/** Other prose can coincide with a private label: never rewrite units or facts. */
function redactKnownLabelContexts(message: string, names: ReadonlySet<string>): string {
  const contexts = /\b(?:Layers?|Operations?|Images?)\s+"[^"]*"(?:\s*,\s*"[^"]*")*/giu;
  return message.replace(contexts, (context) =>
    context.replace(/"([^"]*)"/gu, (quoted: string, raw: string) => {
      const name = normalized(raw).toLowerCase();
      if (!names.has(name)) return quoted;
      return '"artwork"';
    }),
  );
}

function collectPrivateLabels(scene: Scene): Set<string> | null {
  const budget = new LabelBudget();
  for (const object of scene.objects) {
    if (!addObjectLabels(object, budget)) return null;
  }
  for (const layer of scene.layers) {
    if (!budget.add(layer.name)) return null;
    if (!(layer.subLayers ?? []).every((item) => budget.add(item.label))) return null;
  }
  return budget.labels;
}
function addObjectLabels(object: SceneObject, budget: LabelBudget): boolean {
  if (!budget.add(artworkOperationName(object))) return false;
  if ('source' in object && !budget.add(object.source)) return false;
  if (object.kind === 'shape' && object.spec.kind === 'barcode' && !budget.add(object.spec.data))
    return false;
  if (object.kind !== 'text') return true;
  return (
    budget.add(object.content) &&
    budget.add(normalized(object.content).slice(0, 48)) &&
    object.content.split(/\r?\n/).every((line) => budget.add(line))
  );
}

class LabelBudget {
  readonly labels = new Set<string>();
  private characters = 0;
  add(value: string): boolean {
    if (value.length > PATTERN_CHAR_LIMIT) return false;
    const label = normalized(value);
    if (label === '' || this.labels.has(label)) return true;
    this.characters += label.length;
    if (this.labels.size >= PATTERN_LIMIT || this.characters > PATTERN_CHAR_LIMIT) return false;
    this.labels.add(label);
    return true;
  }
}
