/**
 * T1-112: tiny build stamp overlay rendered in the bottom-right of the
 * canvas viewport. Shows the short git commit hash + the build's ISO
 * date so testers can read off-screen which deployment they're running.
 *
 * Click-to-copy puts the commit hash on the clipboard so the tester can
 * paste it back to the dev for verification — this is the diagnostic
 * step we hand-rolled during the T1-111 follow-up (DevTools → Network
 * → bundle hash) reduced to one click.
 *
 * Globals come from `vite.config.ts` (T1-112) via Vite `define`. Both
 * are guarded with `typeof` so the component renders gracefully under
 * tsx tests where the defines aren't injected.
 */
import React, { useState } from 'react';

const font = "'JetBrains Mono', 'Menlo', monospace";

function readCommit(): string {
  return typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'dev';
}

function readBuildTime(): string {
  return typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';
}

function shortDate(iso: string): string {
  // Render only the YYYY-MM-DD portion. Cheap, no Date parsing — the
  // ISO string from `git log --format=%cI` is always
  // `YYYY-MM-DDTHH:MM:SS±HH:MM`.
  if (iso.length >= 10 && iso[4] === '-' && iso[7] === '-') {
    return iso.slice(0, 10);
  }
  return '';
}

export function BuildStamp(): React.ReactElement {
  const commit = readCommit();
  const date = shortDate(readBuildTime());
  const [copied, setCopied] = useState(false);

  const handleClick = (): void => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(commit).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {
        // Clipboard write rejected (e.g. focus / permission). Silent —
        // the stamp is a diagnostic aid, not a primary control flow.
      },
    );
  };

  const label = date ? `v${commit} · ${date}` : `v${commit}`;

  // T1-112 follow-up: inline rendering. Initially shipped as an
  // absolute-positioned canvas overlay (bottom-right), but the
  // tester reported they couldn't see the bottom of the canvas in
  // their layout. Now an inline button so the parent picks the
  // location — currently mounted in FileToolbar next to Settings.
  return React.createElement('button', {
    type: 'button',
    'data-testid': 'build-stamp',
    'data-build-commit': commit,
    onClick: handleClick,
    title: `Build ${commit}${date ? ` · ${date}` : ''} — click to copy commit hash`,
    style: {
      padding: '4px 8px',
      background: 'transparent',
      border: '1px solid #252540',
      borderRadius: 4,
      color: copied ? '#2dd4a0' : '#7a7a90',
      fontFamily: font,
      fontSize: 10,
      lineHeight: '20px',
      height: 28,
      cursor: 'pointer',
      userSelect: 'none' as const,
      flexShrink: 0,
    },
  }, copied ? 'copied!' : label);
}
