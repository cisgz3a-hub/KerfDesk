/**
 * T1-137: pure GRBL identity-line parser extracted from
 * `GrblController._tryParseIdentityLine` (T3-50). The `$I` system
 * command yields two stock identity lines that LaserForge keys off
 * of for firmware-capability gates:
 *
 *   [VER:1.1h.20221128:]   — version string + optional build tag
 *   [OPT:VL,15,128]        — feature-option flags
 *
 * Some forks emit a build tag after the trailing colon
 * (`[VER:1.1f.20220824:custom-build]`); stock GRBL leaves an empty
 * trailing colon. The parser preserves both shapes — the version is
 * the content up to but not including the empty trailing colon when
 * present, and the whole payload otherwise.
 *
 * Pre-T1-137 the parser was a private method of the 2664-line
 * GrblController; the method also wrote `this._firmwareVersion` and
 * `this._buildOptions` directly. Hoisting the pure-parse part into a
 * helper lets the regex match + payload-slicing rules be unit-tested
 * without mounting the whole controller; the controller method
 * shrinks to a 3-line "parse, apply fields" wrapper.
 */

/**
 * Parse result. `null` means the line was not an identity line — the
 * controller should fall through to the next parser (settings,
 * status, etc.). When `firmwareVersion` is present, the value is the
 * VER payload with the trailing empty-build-tag colon stripped.
 */
export type ParsedGrblIdentity =
  | { firmwareVersion: string }
  | { buildOptions: string }
  | null;

/**
 * Parse a single line as a GRBL `$I` response. Returns:
 *   - { firmwareVersion } for `[VER:...]`
 *   - { buildOptions }    for `[OPT:...]`
 *   - null when the line is neither
 *
 * Behavior pinned from the pre-T1-137 inline implementation:
 *   - Both prefixes are case-sensitive (`[VER:` / `[OPT:`) matching
 *     stock GRBL emission.
 *   - The payload is trimmed.
 *   - For VER, a trailing empty `:` (stock GRBL pattern) is dropped:
 *     `[VER:1.1h.20221128:]` → `1.1h.20221128`.
 *   - For VER, a populated build tag after the colon is kept:
 *     `[VER:1.1f:custom-build]` → `1.1f:custom-build`.
 */
export function parseGrblIdentityLine(line: string): ParsedGrblIdentity {
  if (line.startsWith('[VER:') && line.endsWith(']')) {
    // Strip the leading `[VER:` (5 chars) and trailing `]`.
    const payload = line.slice(5, -1).trim();
    // Stock GRBL ends `[VER:...:]` with a trailing colon — keep the version
    // string but drop the empty trailing build-tag if it has no content.
    const firmwareVersion = payload.endsWith(':') ? payload.slice(0, -1) : payload;
    return { firmwareVersion };
  }
  if (line.startsWith('[OPT:') && line.endsWith(']')) {
    return { buildOptions: line.slice(5, -1).trim() };
  }
  return null;
}
