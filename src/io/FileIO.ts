/**
 * === FILE: /src/io/FileIO.ts ===
 *
 * Purpose:    Browser-based file save and load.
 *             Uses Blob + URL.createObjectURL for download,
 *             and <input type="file"> for upload.
 *
 *             Works in browser/Electron renderer process.
 *             Not usable in Node.js (no DOM).
 *
 * Dependencies:
 *   - /src/io/SceneSerializer.ts
 *   - /src/core/scene/Scene.ts
 * Last updated: File Save/Load feature
 */

import { type Scene } from '../core/scene/Scene';
import { serializeScene, deserializeScene } from './SceneSerializer';

// ─── SAVE ────────────────────────────────────────────────────────

/**
 * Save a Scene to disk by triggering a browser download.
 * Creates a .json file with the scene name as filename.
 */
export function saveSceneToFile(scene: Scene): void {
  const json = serializeScene(scene);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const filename = sanitizeFilename(scene.metadata.name || 'untitled') + '.laserforge.json';

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// ─── LOAD ────────────────────────────────────────────────────────

/**
 * Open a file picker and load a Scene from the selected JSON file.
 * Returns null if the user cancels or the file is invalid.
 */
export function loadSceneFromFile(): Promise<Scene | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.laserforge.json';
    input.style.display = 'none';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      try {
        const text = await file.text();
        const scene = deserializeScene(text);
        resolve(scene);
      } catch (e) {
        console.error('Failed to load scene:', e);
        resolve(null);
      } finally {
        document.body.removeChild(input);
      }
    };

    input.oncancel = () => {
      document.body.removeChild(input);
      resolve(null);
    };

    document.body.appendChild(input);
    input.click();
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')  // Remove invalid chars
    .replace(/\s+/g, '_')                       // Spaces → underscores
    .replace(/_+/g, '_')                        // Collapse multiple underscores
    .replace(/^_|_$/g, '')                      // Trim leading/trailing
    || 'untitled';
}
