// Why a program could not be rendered or simulated — shared by the 3D render
// model (core/gcode-view) and the 2D simulator parser (io/gcode) so both
// surfaces name the same state in the same words.

export const PROGRAM_PARSE_REASON = {
  /** Nothing recognizable AND at least one unparseable line: the input is not
   * a G-code program. */
  notGcode: 'This does not look like G-code.',
  /** Every line parsed cleanly as a comment, a blank, or a `%` marker. That IS
   * well-formed G-code — it simply commands nothing. Reporting it as "not
   * G-code" sends the operator hunting for a parse fault when the real cause is
   * an empty program: a layer that produces no toolpath emits the provenance
   * header and nothing else (io/gcode/emit-gcode.ts). */
  noMotion: 'This program has no motion — only comments and blank lines.',
} as const;
