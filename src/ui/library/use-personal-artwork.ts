import { useEffect, useRef, useState } from 'react';
import { usePlatform } from '../app/platform-context';
import {
  personalArtworkActions,
  personalArtworkError,
  type PersonalArtworkRun,
} from './personal-artwork-actions';
import type { PersonalArtwork } from './personal-artwork-model';
import {
  personalArtworkRepository,
  type PersonalArtworkRepository,
} from './personal-artwork-storage';

export function usePersonalArtwork(onClose: () => void, repository?: PersonalArtworkRepository) {
  const platform = usePlatform();
  const [storage] = useState(() => repository ?? personalArtworkRepository());
  const session = usePersonalArtworkSession(storage);
  return {
    ...session,
    ...personalArtworkActions(platform, storage, session.run, onClose, session.setError),
  };
}

function usePersonalArtworkSession(storage: PersonalArtworkRepository) {
  const [entries, setEntries] = useState<readonly PersonalArtwork[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const owner = useRef({ mounted: false, revision: 0, busy: false });
  useEffect(() => {
    const current = owner.current;
    current.mounted = true;
    const revision = ++current.revision;
    void storage
      .list()
      .then((next) => {
        if (!current.mounted || current.revision !== revision) return;
        setEntries(next);
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (current.mounted && current.revision === revision) setError(personalArtworkError(cause));
      });
    return () => {
      current.mounted = false;
      current.revision += 1;
    };
  }, [storage]);
  const run: PersonalArtworkRun = async (action) => {
    if (owner.current.busy) return;
    owner.current.busy = true;
    const revision = ++owner.current.revision;
    const isCurrent = (): boolean => owner.current.mounted && owner.current.revision === revision;
    setBusy(true);
    setError('');
    try {
      await action(isCurrent);
      if (!isCurrent()) return;
      const next = await storage.list();
      if (isCurrent()) {
        setEntries(next);
        setLoaded(true);
      }
    } catch (cause) {
      if (isCurrent()) setError(personalArtworkError(cause));
    } finally {
      if (isCurrent()) {
        owner.current.busy = false;
        setBusy(false);
      }
    }
  };
  return { entries, busy, error, loaded, setError, run };
}
