import { useEffect, useState } from 'react';
import { textToPolylines, type FontEntry } from '../../core/text';

type SingleLineFontKey = Extract<FontEntry, { readonly geometry: 'single-line' }>['key'];

type PreviewGeometry = {
  readonly pathData: string;
  readonly width: number;
  readonly height: number;
};

/** Draws the real machining paths instead of faking a stroke font with CSS. */
export function SingleLineFontPreview({
  fontKey,
}: {
  readonly fontKey: SingleLineFontKey;
}): JSX.Element {
  const [geometry, setGeometry] = useState<PreviewGeometry | null>(null);
  useEffect(() => {
    let cancelled = false;
    void renderPreview(fontKey)
      .then((next) => {
        if (!cancelled) setGeometry(next);
      })
      .catch((error: unknown) => {
        console.warn(`SingleLineFontPreview: failed to render ${fontKey}:`, error);
        if (!cancelled) setGeometry(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fontKey]);
  if (geometry === null) return <span aria-hidden style={placeholderStyle} />;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      preserveAspectRatio="xMidYMid meet"
      style={previewStyle}
    >
      <path
        d={geometry.pathData}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

async function renderPreview(fontKey: SingleLineFontKey): Promise<PreviewGeometry> {
  const rendered = await textToPolylines({
    geometry: 'single-line',
    fontKey,
    content: 'Aa',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1,
    color: 'currentColor',
  });
  const pathData = rendered.paths[0]?.polylines.map(polylinePath).join(' ') ?? '';
  return {
    pathData,
    width: Math.max(rendered.bounds.maxX, 0.1),
    height: Math.max(rendered.bounds.maxY, 0.1),
  };
}

function polylinePath(polyline: {
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}): string {
  return polyline.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
    .join(' ');
}

const previewStyle: React.CSSProperties = {
  width: 72,
  height: 24,
  flex: '0 0 72px',
};

const placeholderStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 72,
  height: 24,
  flex: '0 0 72px',
};
