import type { ReactNode } from 'react';

/** The shared optical grid for KerfDesk's precision icon family. */
export function IconFrame({
  children,
  size = 18,
  className,
}: {
  readonly children: ReactNode;
  readonly size?: number;
  readonly className?: string;
}): JSX.Element {
  return (
    <svg
      className={className === undefined ? 'lf-icon' : `lf-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
