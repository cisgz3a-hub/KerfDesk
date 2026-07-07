// Splits emitted laser G-code into per-layer sections keyed by the layer
// header comments the laser strategies emit, so tests can assert per-layer
// properties (the right S/F inside the right layer's section — PROJECT.md
// non-negotiable #7 applied per layer) instead of only whole-program
// properties.
//
// Recognized header shapes (grbl-strategy.ts / emit-raster.ts):
//   ; layer <id> color <hex> power <n>% speed <n> mm/min passes <n>
//   ; fill layer <id> ...
//   ; offset fill layer <id> ...
//   ; image layer <id> color <hex> power <n>%
//
// Boundary semantics: everything before the first header (the preamble)
// belongs to no section. A section runs from its header up to (not including)
// the next header, so the modal-power flips (M5 / M4 S0), coolant transitions,
// and the job postamble stay attached to the PRECEDING section — none of those
// are G1 lines, so per-section G1 S/F collectors are unaffected.

export type GcodeLayerSection = {
  readonly layerId: string;
  readonly header: string;
  readonly body: string;
};

const LAYER_HEADER = /^; (?:image layer|offset fill layer|fill layer|layer) (\S+) /;

export function splitGcodeLayerSections(gcode: string): readonly GcodeLayerSection[] {
  const sections: GcodeLayerSection[] = [];
  let layerId: string | null = null;
  let header = '';
  let bodyLines: string[] = [];
  const flush = (): void => {
    if (layerId === null) return;
    sections.push({ layerId, header, body: bodyLines.join('\n') });
  };
  for (const line of gcode.split('\n')) {
    const match = LAYER_HEADER.exec(line);
    const matchedId = match?.[1];
    if (matchedId !== undefined) {
      flush();
      layerId = matchedId;
      header = line;
      bodyLines = [line];
      continue;
    }
    if (layerId !== null) bodyLines.push(line);
  }
  flush();
  return sections;
}
