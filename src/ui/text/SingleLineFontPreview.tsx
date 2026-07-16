import { useEffect, useState } from 'react';
import { textToPolylines, type FontEntry } from '../../core/text';
import { isTracedScriptFontKey } from './font-loader';
import { canTraceScriptText, traceScriptText } from './trace-script-text';

type SingleLineFontKey = Extract<FontEntry, { readonly geometry: 'single-line' }>['key'];

type PreviewGeometry = {
  readonly pathData: string;
  readonly width: number;
  readonly height: number;
};

export function SingleLineFontPreview(props: { readonly fontKey: SingleLineFontKey }): JSX.Element {
  const [geometry, setGeometry] = useState<PreviewGeometry | null>(null);
  useEffect(() => {
    let cancelled = false;
    void renderPreview(props.fontKey)
      .then((next) => {
        if (!cancelled) setGeometry(next);
      })
      .catch(() => {
        if (!cancelled) setGeometry(null);
      });
    return () => {
      cancelled = true;
    };
  }, [props.fontKey]);
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
  const shared = {
    content: 'Aa',
    sizeMm: 10,
    alignment: 'left' as const,
    lineHeight: 1,
    color: 'currentColor',
  };
  const rendered =
    isTracedScriptFontKey(fontKey) && canTraceScriptText()
      ? await traceScriptText({ ...shared, fontKey })
      : await textToPolylines({ geometry: 'single-line', fontKey, ...shared });
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
