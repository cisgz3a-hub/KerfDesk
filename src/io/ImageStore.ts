/**
 * Image asset store using IndexedDB.
 * Stores image data outside the scene to prevent:
 * - localStorage quota exceeded (5-10MB limit)
 * - Undo history bloat (data URI cloned per snapshot)
 * - Autosave serialization explosion
 *
 * Images are stored by content hash. Scene objects reference them by ID.
 */

const DB_NAME = 'laserforge_images';
const DB_VERSION = 1;
const STORE_NAME = 'images';

interface StoredImage {
  id: string;
  dataUri: string;
  width: number;
  height: number;
  sizeBytes: number;
  addedAt: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Generate a collision-resistant hash ID from a data URI using SHA-256.
 */
export async function hashDataUri(dataUri: string): Promise<string> {
  const encoded = new TextEncoder().encode(dataUri);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `img_${hex.slice(0, 32)}`; // First 32 hex chars = 128 bits, more than enough
}

/** Store an image and return its ID */
export async function storeImage(dataUri: string, width: number, height: number): Promise<string> {
  const id = await hashDataUri(dataUri);
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const getReq = store.get(id);
    getReq.onsuccess = () => {
      if (getReq.result) {
        resolve(id);
        return;
      }
      const putReq = store.put({
        id,
        dataUri,
        width,
        height,
        sizeBytes: dataUri.length,
        addedAt: new Date().toISOString(),
      } as StoredImage);
      putReq.onsuccess = () => resolve(id);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Retrieve an image data URI by ID */
export async function getImage(id: string): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result?.dataUri ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Check if an image exists in the store */
export async function hasImage(id: string): Promise<boolean> {
  const img = await getImage(id);
  return img !== null;
}

/** Delete an image by ID */
export async function deleteImage(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** List all stored image IDs with their sizes */
export async function listImages(): Promise<Array<{ id: string; sizeBytes: number }>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(
      (req.result as StoredImage[]).map(img => ({ id: img.id, sizeBytes: img.sizeBytes }))
    );
    req.onerror = () => reject(req.error);
  });
}

/** Get total storage used in bytes */
export async function getStorageUsed(): Promise<number> {
  const images = await listImages();
  return images.reduce((sum, img) => sum + img.sizeBytes, 0);
}

/** Clear all stored images */
export async function clearImageStore(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * ⚠️ DANGER: Do not call this automatically.
 * This function deletes images from IndexedDB that aren't referenced by the
 * passed scene. But IndexedDB is shared across ALL projects, so calling this
 * with Project B's objects will delete Project A's images.
 *
 * Only call this from a manual "Clean Up Storage" action with a clear user
 * warning and confirmation dialog.
 */
export async function pruneUnusedImages(sceneObjects: Array<{ geometry: { src?: string } }>): Promise<number> {
  try {
    const referencedIds = new Set<string>();
    for (const obj of sceneObjects) {
      const src = obj.geometry?.src;
      if (typeof src === 'string' && src.startsWith('indexeddb://')) {
        referencedIds.add(src.replace('indexeddb://', ''));
      }
    }

    const stored = await listImages();
    let pruned = 0;

    for (const img of stored) {
      if (!referencedIds.has(img.id)) {
        await deleteImage(img.id);
        pruned++;
      }
    }

    if (pruned > 0) {
      console.log(`[ImageStore] Pruned ${pruned} unused image(s)`);
    }

    return pruned;
  } catch (err) {
    console.warn('[ImageStore] Prune failed:', err);
    return 0;
  }
}
