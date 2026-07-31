import { useState } from 'react';
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
          <span aria-hidden="true">◇</span>
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
