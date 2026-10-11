/** Keep established basic Latin outlines unchanged; other scripts, combining
 * marks and bidi controls need the explicitly prepared shaping runtime. */
export function needsTextShaping(content: string): boolean {
  return /[\p{M}\p{Cf}]|[^\p{Script=Latin}\p{Script=Common}]/u.test(content);
}
