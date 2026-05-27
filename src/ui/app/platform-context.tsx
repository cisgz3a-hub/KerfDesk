// PlatformContext — React Context that the App provides at the root so any
// component can grab the active PlatformAdapter without ui/ files importing
// from src/platform/web/ or src/platform/electron/ directly (ADR-011,
// CLAUDE.md "Imports — boundaries enforced").

import { createContext, useContext, type ReactNode } from 'react';
import type { PlatformAdapter } from '../../platform/types';

const PlatformContext = createContext<PlatformAdapter | null>(null);

export function PlatformProvider({
  adapter,
  children,
}: {
  readonly adapter: PlatformAdapter;
  readonly children: ReactNode;
}): JSX.Element {
  return <PlatformContext.Provider value={adapter}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformAdapter {
  const adapter = useContext(PlatformContext);
  if (adapter === null) {
    throw new Error('usePlatform() called outside a PlatformProvider.');
  }
  return adapter;
}
