import { useCallback, type DragEvent } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject, type ImageGeometry } from '../../core/scene/SceneObject';
import { importSvgIntoScene } from '../../import/svg/SvgToScene';
import { importDxfIntoScene } from '../../import/dxf';
import { deserializeScene } from '../../io/SceneSerializer';
import { storeImage } from '../../io/ImageStore';
import { generateId } from '../../core/types';
import { createLayer, defaultLaserSettings, type Layer } from '../../core/scene/Layer';

const IMAGE_INDEXEDDB_THRESHOLD = 100 * 1024; // 100KB — inline below, IndexedDB above

export interface UseImportDeps {
  handleSceneCommit: (scene: Scene) => void;
  handleNewProject: (scene: Scene) => void;
  setIsDragOver: (v: boolean) => void;
  showAlert: (title: string, message: string, details?: string) => Promise<void>;
}

export function useImport(scene: Scene, deps: UseImportDeps) {
  const { handleSceneCommit, handleNewProject, setIsDragOver, showAlert } = deps;

  /**
   * Build a scene with one new image object (layer + grayscale + placement).
   * Large images go to IndexedDB; small ones stay inline data URIs.
   */
  const importImageUnified = useCallback(async (
    source: File | string,
    fileName?: string,
  ): Promise<Scene | null> => {
    try {
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

      const maxDim = 1000;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const gsWidth = Math.round(img.width * scale);
      const gsHeight = Math.round(img.height * scale);
      const offscreen = document.createElement('canvas');
      offscreen.width = gsWidth;
      offscreen.height = gsHeight;
      const offCtx = offscreen.getContext('2d')!;
      offCtx.drawImage(img, 0, 0, gsWidth, gsHeight);
      const imageData = offCtx.getImageData(0, 0, gsWidth, gsHeight);
      const grayscaleData = new Uint8Array(gsWidth * gsHeight);
      for (let i = 0; i < grayscaleData.length; i++) {
        const r = imageData.data[i * 4];
        const g = imageData.data[i * 4 + 1];
        const b = imageData.data[i * 4 + 2];
        const a = imageData.data[i * 4 + 3];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        grayscaleData[i] = Math.round(lum * (a / 255) + 255 * (1 - a / 255));
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

      return newScene;
    } catch (err) {
      console.error('[useImport] Image import failed:', err);
      return null;
    }
  }, [scene]);

  const handleImageImport = useCallback(async (file: File) => {
    const newScene = await importImageUnified(file, file.name);
    if (!newScene) {
      await showAlert('Import Failed', 'Could not import the image file.');
      return;
    }
    handleSceneCommit(newScene);
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
          handleNewProject(loaded);
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
          handleSceneCommit(updated);
        } else if (name.endsWith('.dxf') && text) {
          const updated = importDxfIntoScene(text, scene);
          handleSceneCommit(updated);
        } else if (file.type.startsWith('image/')) {
          const newScene = await importImageUnified(file, file.name);
          if (newScene) {
            handleSceneCommit(newScene);
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
