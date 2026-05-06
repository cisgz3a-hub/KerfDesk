import { useCallback, useEffect, useRef, type DragEvent } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject, type ImageGeometry } from '../../core/scene/SceneObject';
import { importSvgIntoScene } from '../../import/svg/SvgToScene';
import { importDxfIntoScene } from '../../import/dxf';
import { deserializeScene } from '../../io/SceneSerializer';
import { storeImage } from '../../io/ImageStore';
import { generateId } from '../../core/types';
import { createLayer, defaultLaserSettings, type Layer } from '../../core/scene/Layer';
import { type SceneCommitAction } from '../scene/SceneCommitActions';
import { prepareImageGrayscale } from '../../workers/imagePrepClient';
import { captureSceneRevision, isSceneStale } from './asyncSceneGuard';

const IMAGE_INDEXEDDB_THRESHOLD = 100 * 1024; // 100KB - inline below, IndexedDB above

type ImageImportResult =
  | { kind: 'ok'; scene: Scene }
  | { kind: 'stale' }
  | { kind: 'failed' };

export interface UseImportDeps {
  handleSceneCommit: (scene: Scene, action?: SceneCommitAction, selectionAfter?: ReadonlySet<string>) => void;
  handleNewProject: (scene: Scene, source: 'file' | 'autosave' | 'new') => void;
  setIsDragOver: (v: boolean) => void;
  showAlert: (title: string, message: string, details?: string) => Promise<void>;
}

export function useImport(scene: Scene, deps: UseImportDeps) {
  const { handleSceneCommit, handleNewProject, setIsDragOver, showAlert } = deps;

  // T1-17 Pass 3: keep a live ref to scene so importImageUnified can read
  // the current scene without listing it in its useCallback deps. Without
  // this, every scene mutation minted a fresh importImageUnified identity,
  // which cascaded into re-renders of every component that depended on
  // the import handlers (handleImageImport, handleDrop).
  const sceneRef = useRef(scene);
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);
  const showAlertRef = useRef(showAlert);
  useEffect(() => {
    showAlertRef.current = showAlert;
  }, [showAlert]);

  /**
   * Build a scene with one new image object (layer + grayscale + placement).
   * Large images go to IndexedDB; small ones stay inline data URIs.
   */
  const importImageUnified = useCallback(async (
    source: File | string,
    fileName?: string,
  ): Promise<ImageImportResult> => {
    try {
      // T1-17 Pass 3: read the live scene from the ref. This shadows the
      // outer `scene` parameter for the body of this callback, so every
      // existing `scene.X` reference below picks up the current value at
      // call time instead of the value closed over at definition time.
      const scene = sceneRef.current;
      const revisionAtStart = captureSceneRevision(scene);
      let dataUri: string;
      let displayName: string;

      if (typeof source === 'string') {
        dataUri = source;
        displayName = (fileName || 'image').replace(/\.[^.]+$/, '');
      } else {
        dataUri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(source);
        });
        displayName = source.name.replace(/\.[^.]+$/, '');
      }

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to decode image'));
        img.src = dataUri;
      });

      let imageSrc = dataUri;
      if (dataUri.length > IMAGE_INDEXEDDB_THRESHOLD) {
        try {
          const imageId = await storeImage(dataUri, img.naturalWidth, img.naturalHeight);
          imageSrc = `indexeddb://${imageId}`;
        } catch {
          imageSrc = dataUri;
        }
      }

      const dpi = 96;
      const physicalWidth = (img.width / dpi) * 25.4;
      const physicalHeight = (img.height / dpi) * 25.4;

      const maxW = scene.canvas.width * 0.8;
      const maxH = scene.canvas.height * 0.8;
      let fitScale = 1;
      if (physicalWidth > maxW || physicalHeight > maxH) {
        fitScale = Math.min(maxW / physicalWidth, maxH / physicalHeight);
      }
      const finalWidth = physicalWidth * fitScale;
      const finalHeight = physicalHeight * fitScale;
      const centerX = scene.material
        ? scene.material.x + scene.material.width / 2
        : scene.canvas.width / 2;
      const centerY = scene.material
        ? scene.material.y + scene.material.height / 2
        : scene.canvas.height / 2;
      const cx = centerX - finalWidth / 2;
      const cy = centerY - finalHeight / 2;

      // T1-35: image import max-dim cap raised from 1000 → 4000.
      // Pre-T1-35 every image with longest dimension > 1000 px was silently
      // downscaled at import. A 4000×3000 phone photo (12 MP) became
      // 1000×750 (0.75 MP) before processing — for 200×150 mm engraves at
      // 254 DPI the user lost half the available resolution to the cap and
      // never knew. T1-17 Pass 1 moved the grayscale loop to a Web Worker
      // (see prepareImageGrayscale below), so larger source bitmaps no
      // longer block the UI on import; raising the cap is now safe.
      // 4000 px supports 400×300 mm prints at 254 DPI without downscale.
      // When a downscale still happens, console.warn surfaces it for
      // support diagnosis. Per-user override via Settings is filed as a
      // future T1-35 follow-up.
      const IMAGE_IMPORT_MAX_DIM = 4000;
      const scale = Math.min(1, IMAGE_IMPORT_MAX_DIM / Math.max(img.width, img.height));
      const gsWidth = Math.round(img.width * scale);
      const gsHeight = Math.round(img.height * scale);
      if (scale < 1) {
        console.warn(
          `[LaserForge T1-35] Imported image ${img.width}×${img.height} downscaled to ` +
          `${gsWidth}×${gsHeight} (cap = ${IMAGE_IMPORT_MAX_DIM}px). ` +
          'Detail beyond the cap is lost; raise the limit if needed.',
        );
      }
      // T1-17 pass 1: offload getImageData + grayscale luminance loop to a
      // Web Worker. The previous inline canvas + per-pixel loop here ran
      // tens to hundreds of ms on the main thread for any phone-camera
      // photo, freezing the UI during import. The worker uses
      // OffscreenCanvas + ImageBitmap; client falls back to the legacy
      // main-thread path if any of those APIs are missing. Math is
      // identical across both paths — see imagePrepClient.ts.
      const grayscaleData = await prepareImageGrayscale(img, gsWidth, gsHeight);

      // T2-77: image import is a long-running async scene producer. If
      // the scene changed while file read / decode / grayscale prep was
      // running, refuse to return a stale scene built from the old
      // snapshot; otherwise the later commit would erase the user's edits.
      if (isSceneStale(revisionAtStart, sceneRef.current)) {
        await showAlertRef.current(
          'Import Skipped',
          'The scene changed while the image was importing. Please import the image again.',
        );
        return { kind: 'stale' };
      }

      let targetScene = scene;
      let layerId: string;

      const activeLayer = scene.activeLayerId
        ? scene.layers.find(l => l.id === scene.activeLayerId)
        : undefined;
      const activeIsEmpty = activeLayer != null
        && !scene.objects.some(o => o.layerId === activeLayer.id);

      if (activeLayer && activeIsEmpty && activeLayer.settings.mode !== 'image') {
        // Empty active layer -> convert it in place to image mode.
        // Rename only if still using the default "Layer N" / mode-name pattern.
        const defaultNames = new Set([
          activeLayer.name,
          'Cut', 'Engrave', 'Score',
          `Layer ${scene.layers.indexOf(activeLayer)}`,
        ]);
        const isDefaultName = /^Layer \d+$/.test(activeLayer.name)
          || defaultNames.has(activeLayer.name);
        const converted: Layer = {
          ...activeLayer,
          name: isDefaultName ? 'Image' : activeLayer.name,
          settings: defaultLaserSettings('image'),
        };
        targetScene = {
          ...scene,
          layers: scene.layers.map(l => l.id === activeLayer.id ? converted : l),
        };
        layerId = activeLayer.id;
      } else if (activeLayer && activeLayer.settings.mode === 'image') {
        // Active layer is already image mode -> use it.
        layerId = activeLayer.id;
      } else {
        // Non-empty active, or no active layer -> find existing image layer or create one.
        const existing = scene.layers.find(l => l.settings.mode === 'image');
        if (existing) {
          layerId = existing.id;
        } else {
          const newLayer = createLayer(scene.layers.length, 'image', 'Image');
          targetScene = {
            ...scene,
            layers: [...scene.layers, newLayer],
          };
          layerId = newLayer.id;
        }
      }

      const imageObj: SceneObject = {
        id: generateId(),
        type: 'image',
        name: displayName,
        layerId,
        parentId: null,
        transform: { a: fitScale, b: 0, c: 0, d: fitScale, tx: cx, ty: cy },
        geometry: {
          type: 'image',
          src: imageSrc,
          originalWidth: img.width,
          originalHeight: img.height,
          cropX: 0,
          cropY: 0,
          cropWidth: img.width,
          cropHeight: img.height,
          grayscaleData,
          grayscaleWidth: gsWidth,
          grayscaleHeight: gsHeight,
        } as ImageGeometry,
        visible: true,
        locked: false,
        powerScale: 1,
        _bounds: null,
        _worldTransform: null,
      };

      const newScene = {
        ...targetScene,
        objects: [...targetScene.objects, imageObj],
        activeLayerId: layerId,
      };

      return { kind: 'ok', scene: newScene };
    } catch (err) {
      console.error('[useImport] Image import failed:', err);
      return { kind: 'failed' };
    }
  }, []);

  const handleImageImport = useCallback(async (file: File) => {
    const result = await importImageUnified(file, file.name);
    if (result.kind === 'stale') return;
    if (result.kind === 'failed') {
      await showAlert('Import Failed', 'Could not import the image file.');
      return;
    }
    handleSceneCommit(result.scene, 'image-import');
  }, [importImageUnified, handleSceneCommit, showAlert]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, [setIsDragOver]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, [setIsDragOver]);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const file = e.dataTransfer.files[0];
      if (!file) return;

      const name = file.name.toLowerCase();
      const text = name.endsWith('.svg') || name.endsWith('.dxf') || name.endsWith('.json')
        ? await file.text()
        : null;

      try {
        if (name.endsWith('.laserforge.json') || (name.endsWith('.json') && text)) {
          const loaded = deserializeScene(text!);
          handleNewProject(loaded, 'file');
        } else if (name.endsWith('.svg') && text) {
          const layerId = scene.activeLayerId || scene.layers[0]?.id;
          if (!layerId) return;
          const updated = importSvgIntoScene(text, scene, layerId, {
            mode: 'fit',
            allowScaleUp: false,
            targetBounds: scene.material
              ? {
                  minX: scene.material.x,
                  minY: scene.material.y,
                  maxX: scene.material.x + scene.material.width,
                  maxY: scene.material.y + scene.material.height,
                }
              : {
                  minX: 0,
                  minY: 0,
                  maxX: scene.canvas.width,
                  maxY: scene.canvas.height,
                },
          });
          handleSceneCommit(updated, 'svg-import');
        } else if (name.endsWith('.dxf') && text) {
          const updated = importDxfIntoScene(text, scene);
          handleSceneCommit(updated, 'dxf-import');
        } else if (file.type.startsWith('image/')) {
          const result = await importImageUnified(file, file.name);
          if (result.kind === 'ok') {
            handleSceneCommit(result.scene, 'image-import');
          }
        }
      } catch (err) {
        console.error('Drop import failed:', err);
      }
    },
    [scene, handleSceneCommit, handleNewProject, setIsDragOver, importImageUnified],
  );

  return { handleDragOver, handleDragLeave, handleDrop, handleImageImport };
}
