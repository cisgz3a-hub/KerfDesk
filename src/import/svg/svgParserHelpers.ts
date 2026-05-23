/**
 * T1-158: pure parser helpers extracted from `SvgParser.ts`. Pre-
 * T1-158 these three helpers lived inside the 631-line SVG parser
 * mixed with traversal / style-merging / use-resolution logic. All
 * three are pure and only depend on the DOM `Element` shape.
 *
 *   - `parseViewBox(attr)`: parse SVG `viewBox` attribute (four
 *     space/comma-separated numbers) into a typed rectangle, or
 *     `null` for missing/malformed input.
 *   - `extractAttributes(el)`: shallow attribute-map snapshot of an
 *     SVG element. Used to feed the typed-attribute parsers without
 *     keeping a reference to the live DOM element.
 *   - `unsupportedFeatureMessage(feature, count)`: build the
 *     user-facing warning message for unsupported SVG features
 *     (clipPath, mask, `<style>`, generic fallback). The
 *     pluralization rule + recovery hints are part of the user
 *     surface; pinned verbatim by the test.
 *
 * No behavioral change — SvgParser.parseSvg still produces the
 * same SvgParseResult.
 */

/**
 * Parse an SVG `viewBox` attribute. Format: four numbers separated
 * by whitespace and/or commas, e.g. `"0 0 100 200"` or `"0,0,100,200"`.
 * Returns `null` when the attribute is missing, has fewer than four
 * numeric parts, or any part fails to parse as a number.
 */
export function parseViewBox(
  attr: string | null,
): { x: number; y: number; width: number; height: number } | null {
  if (!attr) return null;

  const parts = attr.trim().split(/[\s,]+/).map(Number);
  if (parts.length < 4 || parts.some(isNaN)) return null;

  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

/**
 * Shallow attribute-map snapshot of an SVG element. Returns an
 * object whose keys are attribute names and values are the
 * attribute values as strings. Attributes with no name or no value
 * (defensive — should not happen on a well-formed DOM) are skipped.
 */
export function extractAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrList = el.attributes;
  if (!attrList) return attrs;

  for (let i = 0; i < attrList.length; i++) {
    const attr = attrList[i];
    if (attr && attr.name && attr.value !== undefined) {
      attrs[attr.name] = attr.value;
    }
  }

  return attrs;
}

/**
 * User-facing message for unsupported SVG features encountered
 * during import. Per-feature recovery hint:
 *   - clipPath → "convert clipped artwork to real paths before importing"
 *   - mask → "flatten masked artwork before importing"
 *   - <style> → "use presentation attributes or inline styles on shapes"
 *   - everything else → generic "N unsupported SVG <feature> features"
 *
 * Pluralization: `count === 1 ? '' : 's'` for the noun.
 */
export function unsupportedFeatureMessage(feature: string, count: number): string {
  if (feature === 'clipPath') {
    return `${count} SVG clipPath reference${count === 1 ? '' : 's'} found. `
      + 'Clipping is not applied during import; convert clipped artwork to real paths before importing.';
  }
  if (feature === 'mask') {
    return `${count} SVG mask reference${count === 1 ? '' : 's'} found. `
      + 'Masks are not applied during import; flatten masked artwork before importing.';
  }
  if (feature === '<style>') {
    return `${count} SVG <style> block${count === 1 ? '' : 's'} found. `
      + 'Only simple tag, id, and class CSS paint/renderability rules are applied during import; '
      + 'flatten complex CSS styling before machine output.';
  }
  return `${count} unsupported SVG ${feature} feature${count === 1 ? '' : 's'} found during import.`;
}
