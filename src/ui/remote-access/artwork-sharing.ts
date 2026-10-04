import { useSyncExternalStore } from 'react';

export const ARTWORK_SHARING_KEY = 'kerfdesk.remote.artwork-sharing.v1';
export const ARTWORK_SHARING_EVENT = 'kerfdesk-remote-artwork-sharing';
let forcedOff = false;

/** A separate desktop choice: old pairing grants never opt into raw artwork. */
export function artworkSharingEnabled(): boolean {
  if (forcedOff) return false;
  try {
    return localStorage.getItem(ARTWORK_SHARING_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Enabling must persist successfully; a failed write always fails closed. */
export function setArtworkSharingEnabled(enabled: boolean): boolean {
  let saved = false;
  try {
    localStorage.setItem(ARTWORK_SHARING_KEY, String(enabled));
    forcedOff = false;
    saved = true;
  } catch {
    forcedOff = true;
  }
  window.dispatchEvent(new Event(ARTWORK_SHARING_EVENT));
  return saved;
}

function subscribe(listener: () => void): () => void {
  const changed = (event: StorageEvent): void => {
    if (event.key === ARTWORK_SHARING_KEY || event.key === null) listener();
  };
  window.addEventListener(ARTWORK_SHARING_EVENT, listener);
  window.addEventListener('storage', changed);
  return () => {
    window.removeEventListener(ARTWORK_SHARING_EVENT, listener);
    window.removeEventListener('storage', changed);
  };
}

export function useArtworkSharing(): boolean {
  return useSyncExternalStore(subscribe, artworkSharingEnabled, () => false);
}
