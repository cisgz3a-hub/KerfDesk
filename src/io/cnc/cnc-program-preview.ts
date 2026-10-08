import type { CncProgramGeometry } from './cnc-program-geometry';
import type { CncSetupFixture } from '../../core/scene/cnc-machining-setup';

export function cncProgramPreviewSvg(
  geometry: CncProgramGeometry,
  fixtures: ReadonlyArray<CncSetupFixture>,
): string {
  const paths: string[] = [];
  let count = 0,
    minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    truncated = false;
  for (const section of geometry.sections) {
    for (const path of section.paths) {
      if (count + path.length > 12_000) {
        truncated = true;
        break;
      }
      count += path.length;
      for (const point of path) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      paths.push(
        '<polyline fill="none" stroke="#17608a" stroke-width="1" vector-effect="non-scaling-stroke" points="' +
          path.map((point) => point.x.toFixed(3) + ',' + point.y.toFixed(3)).join(' ') +
          '"/>',
      );
    }
    if (truncated) break;
  }
  for (const fixture of fixtures) {
    minX = Math.min(minX, fixture.xMm);
    minY = Math.min(minY, fixture.yMm);
    maxX = Math.max(maxX, fixture.xMm + fixture.widthMm);
    maxY = Math.max(maxY, fixture.yMm + fixture.heightMm);
  }
  if (!Number.isFinite(minX)) return '<p>No positioned motion was available for a preview.</p>';
  const pad = Math.max(2, Math.max(maxX - minX, maxY - minY) * 0.03),
    width = Math.max(1, maxX - minX) + pad * 2,
    height = Math.max(1, maxY - minY) + pad * 2;
  const boxes = fixtures
    .map(
      (fixture) =>
        '<rect x="' +
        fixture.xMm +
        '" y="' +
        fixture.yMm +
        '" width="' +
        fixture.widthMm +
        '" height="' +
        fixture.heightMm +
        '" fill="#ffb45455" stroke="#a55a00" stroke-width="1" vector-effect="non-scaling-stroke"/>',
    )
    .join('');
  return (
    '<svg role="img" aria-label="Program XY path and fixture envelope preview" viewBox="' +
    (minX - pad) +
    ' ' +
    (-maxY - pad) +
    ' ' +
    width +
    ' ' +
    height +
    '" style="width:100%;max-height:420px;border:1px solid #aaa"><g transform="scale(1,-1)">' +
    boxes +
    paths.join('') +
    '</g></svg><p>Work-coordinate XY preview includes travel. ' +
    (truncated ? 'Preview truncated at 12,000 vertices. ' : '') +
    (geometry.incomplete ? 'Geometry coverage is incomplete; see the review findings. ' : '') +
    'This preview does not qualify physical clearance.</p>'
  );
}
