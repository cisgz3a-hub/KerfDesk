import type { SVGProps } from 'react';

/** First-party 24×24 stroke glyphs. */
const PATHS = {
  design: 'M4 20l4-1 10-10-3-3L5 16l-1 4zM14 7l3 3',
  layers: 'M12 4l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 16l8 4 8-4',
  machine: 'M4 6h16v9H4zM8 19h8M12 15v4M8 10h3M14 10h2',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  select: 'M6 4l12 7-5 1.5L10.5 18 6 4z',
  pan: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  text: 'M5 6V5h14v1M12 5v14M9 19h6',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
  pen: 'M4 18c3-6 5 2 8-4s5-2 8-6',
  import: 'M12 4v11M8 11l4 4 4-4M5 19h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  undo: 'M9 7L5 11l4 4M5 11h9a5 5 0 010 10h-2',
  redo: 'M15 7l4 4-4 4M19 11h-9a5 5 0 000 10h2',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  align: 'M4 4v16M8 7h10v4H8zM8 13h6v4H8z',
  props: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  chevron: 'M9 6l6 6-6 6',
  up: 'M12 5v14M6 11l6-6 6 6',
  down: 'M12 19V5M6 13l6 6 6-6',
  left: 'M19 12H5M11 6l-6 6 6 6',
  right: 'M5 12h14M13 6l6 6-6 6',
  home: 'M4 11l8-7 8 7M6 10v10h12V10',
  target: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 110 8 4 4 0 010-8z',
  frame: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M9 9h6v6H9z',
  play: 'M8 5l11 7-11 7z',
  pause: 'M8 5v14M16 5v14',
  stop: 'M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7z',
  plug: 'M9 3v5M15 3v5M7 8h10v3a5 5 0 01-10 0zM12 16v5',
  unplug: 'M9 3v5M15 3v5M7 8h10v3a5 5 0 01-10 0zM12 16v5M3 3l18 18',
  camera: 'M4 8h4l2-3h4l2 3h4v11H4zM12 10a3.5 3.5 0 110 7 3.5 3.5 0 010-7z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M7 14h10',
  phone: 'M8 3h8v18H8zM11 18h2',
  bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4l2-2zM10 20a2 2 0 004 0',
  sun: 'M12 8a4 4 0 110 8 4 4 0 010-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 15A8 8 0 019 4a8 8 0 1011 11z',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  link: 'M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1 1M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1-1',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7M8 20v-6h8v6',
  group: 'M4 4h7v7H4zM13 13h7v7h-7zM11 7.5h5v5M8 11v5h5',
  mirror: 'M12 3v18M9 7L4 17h5zM15 7l5 10h-5z',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  wifi: 'M5 12a10 10 0 0114 0M8 15a6 6 0 018 0M12 19h.01',
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 22,
  ...props
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3 : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 4v16M5 13l9-9M9.5 9.5L19 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="19" cy="5" r="2" fill="currentColor" />
    </svg>
  );
}
