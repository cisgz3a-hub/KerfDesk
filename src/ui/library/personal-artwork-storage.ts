import { parsePersonalArtwork } from './personal-artwork-format';
import type { PersonalArtwork } from './personal-artwork-model';

export type PersonalArtworkRepository = {
  readonly list: () => Promise<readonly PersonalArtwork[]>;
  readonly add: (entries: readonly PersonalArtwork[]) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
};

/** A separate local database: project replacement and autosave cleanup never delete it. */
export function personalArtworkRepository(
  factory: IDBFactory = globalThis.indexedDB,
  databaseName = 'kerfdesk-personal-artwork-v1',
): PersonalArtworkRepository {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      if (factory === undefined) {
        reject(new Error('Local artwork storage is unavailable.'));
        return;
      }
      const request = factory.open(databaseName, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('artwork', { keyPath: 'id' });
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () =>
        reject(request.error ?? new Error('Could not open local artwork storage.'));
      request.onblocked = () =>
        reject(new Error('Close other KerfDesk windows to upgrade local artwork storage.'));
    });
  return {
    list: async () => {
      const db = await open();
      try {
        const tx = db.transaction('artwork', 'readonly');
        const done = finished(tx);
        const request = tx.objectStore('artwork').getAll();
        await done;
        return (request.result as unknown[])
          .map(parsePersonalArtwork)
          .sort((a, b) => a.name.localeCompare(b.name));
      } finally {
        db.close();
      }
    },
    add: async (entries) => {
      // Validate the complete batch before starting the atomic transaction.
      const validated = entries.map(parsePersonalArtwork);
      const db = await open();
      try {
        const tx = db.transaction('artwork', 'readwrite');
        const done = finished(tx);
        for (const entry of validated) tx.objectStore('artwork').add(entry);
        await done;
      } finally {
        db.close();
      }
    },
    remove: async (id) => {
      const db = await open();
      try {
        const tx = db.transaction('artwork', 'readwrite');
        const done = finished(tx);
        tx.objectStore('artwork').delete(id);
        await done;
      } finally {
        db.close();
      }
    },
  };
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error('Local artwork storage did not commit.'));
  });
}
