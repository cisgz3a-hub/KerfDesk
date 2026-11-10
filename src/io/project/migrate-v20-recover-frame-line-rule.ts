import {
  frameFitsByLineRule,
  legacyLineEmOf,
  storedFrameRule,
  type SingleLineFrameText,
} from '../../core/text/single-line-frame-rule';
import type { RawProject } from './migrations';
import { asRecord } from '../../core/util/is-record';

// Schema 21. Step 18 gives a converted frame its old line rule, but 1.0.28 ran
// step 18 without that rule and saved the result, so a schema-19 file reaches
// here with no `legacyLineEm`. The stored geometry still tells: a frame nobody
// edited on 1.0.28 keeps the shape the old rule drew, which the em rule does not
// draw. Such a frame gets its rule back. A frame the file cannot place keeps the
// em rule and Open and Job Review say so (ADR-682 Amendment 3).
export function migrateV20RecoverFrameLineRule(raw: RawProject): RawProject {
  const scene = asRecord(raw['scene']);
  return {
    ...raw,
    schemaVersion: 21,
    ...(scene !== null && Array.isArray(scene['objects'])
      ? { scene: { ...scene, objects: scene['objects'].map(withRecoveredRule) } }
      : {}),
  };
}

function withRecoveredRule(value: unknown): unknown {
  const text = asRecord(value);
  if (text === null) return value;
  const frame = frameTextWithoutRule(text);
  const stored = asRecord(text['bounds']);
  if (frame === null || stored === null) return value;
  const legacyLineEm = legacyLineEmOf(frame.fontKey);
  if (legacyLineEm === undefined || !drawnByOldRule(frame, stored, text['paths'])) return value;
  return { ...text, textBox: { ...frame.textBox, legacyLineEm } };
}

function drawnByOldRule(
  frame: SingleLineFrameText,
  stored: Record<string, unknown>,
  paths: unknown,
): boolean {
  const { minX, maxX, minY, maxY } = stored;
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return false;
  try {
    return (
      storedFrameRule(frame, {
        widthMm: (maxX as number) - (minX as number),
        heightMm: (maxY as number) - (minY as number),
        paths,
      }) === 'legacy'
    );
  } catch {
    // The shape validator reports whatever could not be rendered.
    return false;
  }
}

/** A text whose frame could have lost the rule; anything malformed is left for the validator. */
export function frameTextWithoutRule(text: Record<string, unknown>): SingleLineFrameText | null {
  const box = asRecord(text['textBox']);
  if (text['kind'] !== 'text' || box === null || box['legacyLineEm'] !== undefined) return null;
  if (typeof text['fontKey'] !== 'string' || typeof text['content'] !== 'string') return null;
  const shape = box as unknown as SingleLineFrameText['textBox'];
  if (!frameFitsByLineRule(text['fontKey'], shape)) return null;
  const numbers = [
    text['sizeMm'],
    text['lineHeight'],
    text['letterSpacing'],
    box['widthMm'],
    box['heightMm'],
    box['minSizeMm'],
  ];
  return numbers.every(Number.isFinite) ? (text as unknown as SingleLineFrameText) : null;
}
