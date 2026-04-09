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

/** Generate a simple hash ID from a data URI */
export function hashDataUri(dataUri: string): string {
  let hash = 0;
  const sample = dataUri.slice(0, 10000) + dataUri.slice(-10000);
  for (let i = 0; i < sample.length; i++) {
    const char = sample.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `img_${Math.abs(hash).toString(36)}_${dataUri.length}`;
}

/** Store an image and return its ID */
export async function storeImage(dataUri: string, width: number, height: number): Promise<string> {
  const id = hashDataUri(dataUri);
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
