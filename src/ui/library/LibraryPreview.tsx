import { useState } from 'react';
import { IconFrame } from '../kit/icon-frame';
import type { LibraryEntry } from './design-library-types';

const previewUrlCache = new Map<string, string>();

function previewUrlFor(entry: LibraryEntry): string {
  if (entry.preview.kind === 'asset-url') return entry.preview.url;
  const cached = previewUrlCache.get(entry.id);
  if (cached !== undefined) return cached;
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(entry.preview.svgText)}`;
  previewUrlCache.set(entry.id, url);
  return url;
}

export function LibraryPreview(props: {
  readonly entry: LibraryEntry;
  readonly detail?: boolean;
}): JSX.Element {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const detail = props.detail ?? false;
  return (
    <span
      className={`lf-library-preview${detail ? ' lf-library-preview--detail' : ''}`}
      data-preview-state={state}
    >
      {state === 'error' ? (
        <span className="lf-library-preview__fallback" role="img" aria-label="Preview unavailable">
          <IconFrame size={22}>
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <path d="m5 16 5-5 4 4 3-3 3 3" />
            <path className="lf-icon-accent" d="M3 3l18 18" />
          </IconFrame>
          Preview unavailable
        </span>
      ) : (
        <img
          src={previewUrlFor(props.entry)}
          alt={detail ? `${props.entry.title} preview` : ''}
          loading={detail ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
        />
      )}
    </span>
  );
}
