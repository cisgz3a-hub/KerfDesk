// An SVG that draws one `points`-point path `copies` times through <use>.
// The <use> budget counts the points the copies place (ADR-269 Amendment 3),
// so 1,000 points copied 501 times is just past its 500,000-point floor.
export function svgUseCopies(points: number, copies: number): string {
  const d = Array.from(
    { length: points },
    (_, index) => `${index === 0 ? 'M' : 'L'}${index} ${index % 2}`,
  ).join(' ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${points} 2" ` +
    `width="${points / 10}mm" height="2mm"><defs>` +
    `<path id="part" d="${d}" fill="none" stroke="#000000"/></defs>` +
    '<use href="#part"/>'.repeat(copies) +
    '</svg>'
  );
}
