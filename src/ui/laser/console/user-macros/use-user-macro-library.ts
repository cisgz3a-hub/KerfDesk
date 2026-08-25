import { useEffect, useState } from 'react';
import {
  deleteUserMacro,
  findUserMacro,
  saveUserMacro,
  type SaveUserMacroRequest,
  type UserMacro,
  type UserMacroCollection,
} from './user-macro-collection';
import {
  readUserMacros,
  USER_MACRO_STORAGE_KEY,
  writeUserMacros,
  type UserMacroWriteResult,
} from './user-macro-storage';

const USER_MACROS_CHANGED_EVENT = 'curvedesk:user-macros-changed';

export type UserMacroLibraryMutationResult =
  | { readonly kind: 'ok'; readonly macro?: UserMacro }
  | { readonly kind: 'error'; readonly message: string };

/** Keeps both Console surfaces synchronized with the last persisted collection. */
export function useUserMacroLibrary(): {
  readonly macros: UserMacroCollection;
  readonly save: (request: Omit<SaveUserMacroRequest, 'now'>) => UserMacroLibraryMutationResult;
  readonly remove: (name: string) => UserMacroLibraryMutationResult;
} {
  const [macros, setMacros] = useState<UserMacroCollection>(readUserMacros);

  useEffect(() => {
    const reload = (): void => setMacros(readUserMacros());
    const reloadStorage = (event: StorageEvent): void => {
      if (event.key === USER_MACRO_STORAGE_KEY || event.key === null) reload();
    };
    window.addEventListener(USER_MACROS_CHANGED_EVENT, reload);
    window.addEventListener('storage', reloadStorage);
    return () => {
      window.removeEventListener(USER_MACROS_CHANGED_EVENT, reload);
      window.removeEventListener('storage', reloadStorage);
    };
  }, []);

  const persist = (
    next: UserMacroCollection,
    macro?: UserMacro,
  ): UserMacroLibraryMutationResult => {
    const write = writeUserMacros(next);
    if (write.kind !== 'ok') return { kind: 'error', message: storageWriteError(write) };
    // The listener updates this instance and every other mounted Console from
    // the exact persisted collection in one synchronous notification.
    window.dispatchEvent(new Event(USER_MACROS_CHANGED_EVENT));
    return { kind: 'ok', ...(macro === undefined ? {} : { macro }) };
  };

  const save = (request: Omit<SaveUserMacroRequest, 'now'>): UserMacroLibraryMutationResult => {
    const previous =
      request.originalName === undefined ? null : findUserMacro(macros, request.originalName);
    const result = saveUserMacro(macros, {
      ...request,
      now: Math.max(Date.now(), previous?.updatedAt ?? 0),
    });
    if (result.kind !== 'ok') return { kind: 'error', message: result.message };
    return persist(result.collection, result.macro);
  };

  const remove = (name: string): UserMacroLibraryMutationResult => {
    const result = deleteUserMacro(macros, name);
    if (result.kind !== 'ok') return { kind: 'error', message: result.message };
    return persist(result.collection);
  };

  return { macros, save, remove };
}

function storageWriteError(result: Exclude<UserMacroWriteResult, { readonly kind: 'ok' }>): string {
  if (result.kind === 'invalid-collection') return result.message;
  return 'Local macro storage is unavailable. The saved collection was not changed.';
}
