import type * as HarfBuzz from 'harfbuzzjs';
import bidiFactory from 'bidi-js';
import {
  bidiCharacters,
  bidiLineCharacters,
  visualBidiRuns,
  type BidiCharacter,
} from './text-bidi';
import { textScripts } from './text-script-runs';
import type { ShapedGlyph, ShapedLine, TextShaping } from './text-shaping-types';

type Runtime = typeof HarfBuzz;
type Run = { start: number; end: number; level: number; script: string };
const bidi = bidiFactory();
const MAX_CACHED_LINES = 128;
const runtimeResources = new WeakMap<
  Runtime,
  {
    buffer: HarfBuzz.Buffer;
    fonts: WeakMap<ArrayBuffer, HarfBuzz.Font>;
  }
>();

/** Already-loaded runtime is injected by io/text. No font fetching, WASM
 * loading, browser locale or fallback face participates in this pure layout. */
export function createTextShaping(
  hb: Runtime,
  fontBuffer: ArrayBuffer,
  content: string,
): TextShaping {
  const { font, buffer } = shapingResources(hb, fontBuffer);
  const characters = bidiCharacters(content, bidi);
  const starts = new Map(characters.map((character, index) => [character.start, index]));
  starts.set(content.length, characters.length);
  const cache = new Map<string, ShapedLine>();
  const line = (start: number, end: number): ShapedLine => {
    const key = `${start}:${end}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const from = starts.get(start),
      to = starts.get(end);
    if (from === undefined || to === undefined || end < start) {
      throw new Error('Text layout attempted to split a Unicode character.');
    }
    const resolved = bidiLineCharacters(characters.slice(from, to));
    const shaped = shapeLine(hb, font, buffer, content.slice(start, end), start, resolved);
    if (cache.size >= MAX_CACHED_LINES) cache.delete(cache.keys().next().value as string);
    cache.set(key, shaped);
    return shaped;
  };
  return {
    content,
    fontBuffer,
    line,
    breakUnits(text, sourceStart) {
      const shaped = line(sourceStart, sourceStart + text.length);
      const boundaries = [
        ...new Set([
          sourceStart,
          ...shaped.glyphs.map((glyph) => glyph.cluster),
          sourceStart + text.length,
        ]),
      ].sort((a, b) => a - b);
      return boundaries
        .slice(0, -1)
        .map((start, index) => content.slice(start, boundaries[index + 1]));
    },
  };
}

// Shaping is synchronous, so one resettable buffer serves concurrent render
// owners without interleaving. Weak font keys don't retain retired documents;
// HarfBuzz.js releases the native face/font references through its finalizers.
function shapingResources(hb: Runtime, fontBuffer: ArrayBuffer) {
  let resources = runtimeResources.get(hb);
  if (resources === undefined) {
    resources = { buffer: new hb.Buffer(), fonts: new WeakMap() };
    runtimeResources.set(hb, resources);
  }
  let font = resources.fonts.get(fontBuffer);
  if (font === undefined) {
    const face = new hb.Face(new hb.Blob(fontBuffer));
    font = new hb.Font(face);
    font.setScale(face.upem, face.upem);
    resources.fonts.set(fontBuffer, font);
  }
  return { font, buffer: resources.buffer };
}

function shapeLine(
  hb: Runtime,
  font: HarfBuzz.Font,
  buffer: HarfBuzz.Buffer,
  text: string,
  sourceStart: number,
  characters: ReadonlyArray<BidiCharacter>,
): ShapedLine {
  const scripts = textScripts(characters, bidi);
  const runs = visualBidiRuns(logicalRuns(characters, scripts));
  const glyphs: ShapedGlyph[] = [];
  let advance = 0;
  let trackingIndex = -1;
  let lastCluster: number | undefined;
  for (const run of runs) {
    buffer.reset();
    // Prefix/suffix context is available across script runs, but deliberately
    // stops at the physical line: Arabic must not join across a soft wrap.
    buffer.addText(text, run.start - sourceStart, run.end - run.start);
    buffer.setDirection(run.level % 2 === 1 ? hb.Direction.RTL : hb.Direction.LTR);
    buffer.setScript(run.script);
    buffer.setLanguage('und');
    buffer.setFlags(hb.BufferFlag.REMOVE_DEFAULT_IGNORABLES);
    buffer.setClusterLevel(hb.ClusterLevel.MONOTONE_GRAPHEMES);
    hb.shape(font, buffer);
    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();
    for (let index = 0; index < infos.length; index += 1) {
      const info = infos[index],
        position = positions[index];
      if (info === undefined || position === undefined)
        throw new Error('Text shaping returned incomplete glyph positions.');
      const cluster = sourceStart + info.cluster;
      if (cluster !== lastCluster) trackingIndex += 1;
      lastCluster = cluster;
      glyphs.push({
        id: info.codepoint,
        cluster,
        x: advance + position.xOffset,
        y: position.yOffset === 0 ? 0 : -position.yOffset,
        trackingIndex,
      });
      advance += position.xAdvance;
    }
  }
  return { glyphs, advance, trackingGaps: Math.max(0, trackingIndex) };
}

function logicalRuns(
  characters: ReadonlyArray<BidiCharacter>,
  scripts: ReadonlyArray<string>,
): Run[] {
  const runs: Run[] = [];
  characters.forEach((character, index) => {
    const script = scripts[index] ?? 'Latn';
    const last = runs[runs.length - 1];
    if (last !== undefined && last.level === character.level && last.script === script)
      last.end = character.end;
    else runs.push({ start: character.start, end: character.end, level: character.level, script });
  });
  return runs;
}
