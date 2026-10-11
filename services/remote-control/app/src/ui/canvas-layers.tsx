import { artworkBox, pathData, type Box, type DecodedObject } from '../core/scene';
import type { AppState } from '../core/store';
import type { Artwork, Scene } from '../core/types';
import { previewTransform } from './canvas-view';

export const HANDLE_PX = 11;

/** Pure rendering of the bed, artwork, draft and selection in scene millimetres. */
export function CanvasLayers({
  viewBox,
  px,
  scene,
  decoded,
  artwork,
  selection,
  selBox,
  editable,
  marquee,
  preview,
  draft,
  highlight,
}: {
  viewBox: string;
  px: number;
  scene: Scene | null;
  decoded: readonly DecodedObject[];
  artwork: readonly Artwork[];
  selection: readonly string[];
  selBox: Box | null;
  editable: boolean;
  marquee: Box | null;
  preview: AppState['preview'];
  draft: AppState['draft'];
  highlight: AppState['highlight'];
}) {
  const bed = scene?.bed;
  const flashing = new Set(highlight !== null && highlight.until > Date.now() ? highlight.ids : []);
  const showBoxes = decoded.length === 0 && (scene?.images?.length ?? 0) === 0;
  const selected = new Set(selection);
  const selTransform =
    selection.length > 0 ? previewTransform(preview, selection[0] as string) : undefined;
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMinYMin meet">
      <defs>
        <pattern id="kd-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" className="grid-minor" strokeWidth={px} />
        </pattern>
        <pattern id="kd-grid-major" width="50" height="50" patternUnits="userSpaceOnUse">
          <rect width="50" height="50" fill="url(#kd-grid)" />
          <path d="M50 0H0V50" className="grid-major" strokeWidth={px} />
        </pattern>
      </defs>
      {bed === undefined ? null : (
        <>
          <rect className="bed-fill" x={0} y={0} width={bed.widthMm} height={bed.heightMm} />
          <rect x={0} y={0} width={bed.widthMm} height={bed.heightMm} fill="url(#kd-grid-major)" />
          <rect
            className="bed-edge"
            x={0}
            y={0}
            width={bed.widthMm}
            height={bed.heightMm}
            strokeWidth={px}
          />
        </>
      )}
      {(scene?.images ?? []).map((image) => (
        <polygon
          key={image.id}
          className="art-image"
          points={image.corners.join(' ')}
          transform={previewTransform(preview, image.id)}
        />
      ))}
      {decoded.map((object) => (
        <g
          key={object.source.id}
          transform={previewTransform(preview, object.source.id)}
          className={flashing.has(object.source.id) ? 'flash' : undefined}
        >
          {object.paths.map((path, index) => (
            <path
              key={index}
              d={path.d}
              className={`art-path${path.fill ? ' fill' : ''}${path.output ? '' : ' no-output'}`}
              stroke={path.color}
              fill={path.fill ? path.color : 'none'}
              strokeWidth={selected.has(object.source.id) ? 2 : 1.4}
            />
          ))}
        </g>
      ))}
      {showBoxes
        ? artwork.map((item) => {
            const box = artworkBox(item);
            return box === null ? null : (
              <rect
                key={item.id}
                className="art-box"
                x={box.minX}
                y={box.minY}
                width={box.maxX - box.minX}
                height={box.maxY - box.minY}
                transform={previewTransform(preview, item.id)}
              />
            );
          })
        : null}
      {draft === null ? null : draft.kind === 'pen' ? (
        <path className="draft-shape" d={pathData(draft.points, false)} fill="none" />
      ) : draft.kind === 'rect' ? (
        <rect
          className="draft-shape"
          x={draft.x}
          y={draft.y}
          width={draft.width}
          height={draft.height}
        />
      ) : (
        <ellipse
          className="draft-shape"
          cx={draft.x + draft.width / 2}
          cy={draft.y + draft.height / 2}
          rx={draft.width / 2}
          ry={draft.height / 2}
        />
      )}
      {selBox === null ? null : (
        <g transform={selTransform}>
          <rect
            className="sel-box"
            x={selBox.minX}
            y={selBox.minY}
            width={selBox.maxX - selBox.minX}
            height={selBox.maxY - selBox.minY}
          />
          {editable ? (
            <>
              {[
                [selBox.minX, selBox.minY],
                [selBox.maxX, selBox.minY],
                [selBox.maxX, selBox.maxY],
                [selBox.minX, selBox.maxY],
              ].map(([x, y]) => (
                <rect
                  key={`${x},${y}`}
                  className="sel-handle"
                  x={(x as number) - (HANDLE_PX / 2) * px}
                  y={(y as number) - (HANDLE_PX / 2) * px}
                  width={HANDLE_PX * px}
                  height={HANDLE_PX * px}
                  rx={2 * px}
                />
              ))}
              <line
                className="sel-box"
                x1={(selBox.minX + selBox.maxX) / 2}
                y1={selBox.minY}
                x2={(selBox.minX + selBox.maxX) / 2}
                y2={selBox.minY - 30 * px}
              />
              <circle
                className="sel-handle"
                cx={(selBox.minX + selBox.maxX) / 2}
                cy={selBox.minY - 30 * px}
                r={(HANDLE_PX / 2 + 1) * px}
              />
            </>
          ) : null}
        </g>
      )}
      {marquee === null ? null : (
        <rect
          className="marquee"
          x={marquee.minX}
          y={marquee.minY}
          width={marquee.maxX - marquee.minX}
          height={marquee.maxY - marquee.minY}
        />
      )}
    </svg>
  );
}
