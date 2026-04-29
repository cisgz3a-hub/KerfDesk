import { useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject, type TextGeometry } from '../../core/scene/SceneObject';
import { type SceneCommitAction } from '../scene/SceneCommitActions';
import { computeObjectBounds } from '../../geometry/bounds';
import { booleanOperation, type BooleanOp } from '../../geometry/BooleanOps';
import { textGeometryToPath } from '../../geometry/TextToPath';
import { offsetObject } from '../../geometry/OffsetPath';
import { generateId, IDENTITY_MATRIX } from '../../core/types';
import { requireFeature } from '../../entitlements';

export function alignSelection(scn: Scene, selIds: ReadonlySet<string>, alignment: string): Scene {
  const selected = scn.objects.filter(o => selIds.has(o.id));
  if (selected.length === 0) return scn;

  let wMinX = Infinity, wMinY = Infinity, wMaxX = -Infinity, wMaxY = -Infinity;

  for (const o of selected) {
    const b = computeObjectBounds(o);
    if (!b) continue;
    wMinX = Math.min(wMinX, b.minX);
    wMinY = Math.min(wMinY, b.minY);
    wMaxX = Math.max(wMaxX, b.maxX);
    wMaxY = Math.max(wMaxY, b.maxY);
  }

  if (!isFinite(wMinX)) return scn;

  let dx = 0, dy = 0;

  switch (alignment) {
    case 'center': {
      const targetCx = scn.material
        ? scn.material.x + scn.material.width / 2
        : scn.canvas.width / 2;
      const targetCy = scn.material
        ? scn.material.y + scn.material.height / 2
        : scn.canvas.height / 2;
      dx = targetCx - (wMinX + wMaxX) / 2;
      dy = targetCy - (wMinY + wMaxY) / 2;
      break;
    }
    case 'left': {
      const edge = scn.material?.enabled ? scn.material.x : 0;
      dx = edge - wMinX;
      break;
    }
    case 'right': {
      const edge = scn.material?.enabled ? scn.material.x + scn.material.width : scn.canvas.width;
      dx = edge - wMaxX;
      break;
    }
    case 'top': {
      const edge = scn.material?.enabled ? scn.material.y : 0;
      dy = edge - wMinY;
      break;
    }
    case 'bottom': {
      const edge = scn.material?.enabled ? scn.material.y + scn.material.height : scn.canvas.height;
      dy = edge - wMaxY;
      break;
    }
  }

  return {
    ...scn,
    objects: scn.objects.map(o => {
      if (!selIds.has(o.id)) return o;
      return {
        ...o,
        transform: { ...o.transform, tx: o.transform.tx + dx, ty: o.transform.ty + dy },
        _bounds: null, _worldTransform: null,
      };
    }),
  };
}

function getSelectionWorldBounds(scn: Scene, selIds: ReadonlySet<string>) {
  let wMinX = Infinity, wMinY = Infinity, wMaxX = -Infinity, wMaxY = -Infinity;
  for (const o of scn.objects) {
    if (!selIds.has(o.id)) continue;
    const b = computeObjectBounds(o);
    if (!b) continue;
    wMinX = Math.min(wMinX, b.minX);
    wMinY = Math.min(wMinY, b.minY);
    wMaxX = Math.max(wMaxX, b.maxX);
    wMaxY = Math.max(wMaxY, b.maxY);
  }
  if (!isFinite(wMinX)) return null;
  return { wMinX, wMinY, wMaxX, wMaxY };
}

function translateSelection(scn: Scene, selIds: ReadonlySet<string>, dx: number, dy: number): Scene {
  if (dx === 0 && dy === 0) return scn;
  return {
    ...scn,
    objects: scn.objects.map(o => {
      if (!selIds.has(o.id)) return o;
      return {
        ...o,
        transform: { ...o.transform, tx: o.transform.tx + dx, ty: o.transform.ty + dy },
        _bounds: null, _worldTransform: null,
      };
    }),
  };
}

interface SceneOperationsActions {
  scene: Scene;
  selectedIds: ReadonlySet<string>;
  handleSceneCommit: (scene: Scene, action?: SceneCommitAction, selectionAfter?: ReadonlySet<string>) => void;
  showAlert: (title: string, message: string) => void | Promise<void>;
  showConfirm: (title: string, message: string) => Promise<boolean>;
}

export function useSceneOperations({
  scene,
  selectedIds,
  handleSceneCommit,
  showAlert,
  showConfirm,
}: SceneOperationsActions) {
  const alignLeft = useCallback(() => {
    handleSceneCommit(alignSelection(scene, selectedIds, 'left'), 'align');
  }, [scene, selectedIds, handleSceneCommit]);

  const alignRight = useCallback(() => {
    handleSceneCommit(alignSelection(scene, selectedIds, 'right'), 'align');
  }, [scene, selectedIds, handleSceneCommit]);

  const alignTop = useCallback(() => {
    handleSceneCommit(alignSelection(scene, selectedIds, 'top'), 'align');
  }, [scene, selectedIds, handleSceneCommit]);

  const alignBottom = useCallback(() => {
    handleSceneCommit(alignSelection(scene, selectedIds, 'bottom'), 'align');
  }, [scene, selectedIds, handleSceneCommit]);

  const alignCenterH = useCallback(() => {
    const b = getSelectionWorldBounds(scene, selectedIds);
    if (!b) return;
    const targetCx = scene.material?.enabled
      ? scene.material.x + scene.material.width / 2
      : scene.canvas.width / 2;
    const cx = (b.wMinX + b.wMaxX) / 2;
    handleSceneCommit(translateSelection(scene, selectedIds, targetCx - cx, 0), 'align');
  }, [scene, selectedIds, handleSceneCommit]);

  const alignCenterV = useCallback(() => {
    const b = getSelectionWorldBounds(scene, selectedIds);
    if (!b) return;
    const targetCy = scene.material?.enabled
      ? scene.material.y + scene.material.height / 2
      : scene.canvas.height / 2;
    const cy = (b.wMinY + b.wMaxY) / 2;
    handleSceneCommit(translateSelection(scene, selectedIds, 0, targetCy - cy), 'align');
  }, [scene, selectedIds, handleSceneCommit]);

  const centerOnCanvas = useCallback(() => {
    const b = getSelectionWorldBounds(scene, selectedIds);
    if (!b) return;
    const selWidth = b.wMaxX - b.wMinX;
    const selHeight = b.wMaxY - b.wMinY;
    const targetX = (scene.canvas.width - selWidth) / 2;
    const targetY = (scene.canvas.height - selHeight) / 2;
    const dx = targetX - b.wMinX;
    const dy = targetY - b.wMinY;
    handleSceneCommit(translateSelection(scene, selectedIds, dx, dy), 'align');
  }, [scene, selectedIds, handleSceneCommit]);

  /** Center selection on the material (or canvas if no material), same as legacy alignSelection(..., 'center'). */
  const centerOnMaterial = useCallback(() => {
    handleSceneCommit(alignSelection(scene, selectedIds, 'center'), 'align');
  }, [scene, selectedIds, handleSceneCommit]);

  const performBoolean = useCallback(
    async (op: BooleanOp) => {
      const ids = [...selectedIds];
      if (ids.length !== 2) {
        await showAlert('Boolean', 'Select exactly 2 objects for boolean operations.');
        return;
      }

      const objA = scene.objects.find(o => o.id === ids[0]);
      const objB = scene.objects.find(o => o.id === ids[1]);
      if (!objA || !objB) return;

      const resultGeom = booleanOperation(objA, objB, op);

      if (!resultGeom) {
        await showAlert('Boolean', 'Boolean operation failed — shapes may not overlap.');
        return;
      }

      const newId = generateId();
      const newObj: SceneObject = {
        id: newId,
        type: 'path',
        name: `${op} result`,
        layerId: objA.layerId,
        parentId: null,
        transform: { ...IDENTITY_MATRIX },
        geometry: resultGeom,
        visible: true,
        locked: false,
        powerScale: 1,
        _bounds: null,
        _worldTransform: null,
      };

      const newScene = {
        ...scene,
        objects: [...scene.objects.filter(o => !selectedIds.has(o.id)), newObj],
      };

      handleSceneCommit(newScene, 'boolean-op', new Set([newId]));
    },
    [scene, selectedIds, handleSceneCommit, showAlert],
  );

  const offsetShapes = useCallback(
    async (distance: number) => {
      if (selectedIds.size === 0) return;

      const newObjects: typeof scene.objects = [];

      for (const obj of scene.objects) {
        if (!selectedIds.has(obj.id)) continue;

        const resultGeom = offsetObject(obj, distance);
        if (!resultGeom) continue;

        newObjects.push({
          id: generateId(),
          type: 'path',
          name: `${distance > 0 ? 'Outset' : 'Inset'} ${Math.abs(distance)}mm`,
          layerId: obj.layerId,
          parentId: null,
          transform: { ...IDENTITY_MATRIX },
          geometry: resultGeom,
          visible: true,
          locked: false,
          powerScale: obj.powerScale ?? 1,
          _bounds: null,
          _worldTransform: null,
        });
      }

      if (newObjects.length === 0) {
        await showAlert('Offset', 'Offset failed — shape may be too small or complex.');
        return;
      }

      handleSceneCommit({
        ...scene,
        objects: [...scene.objects, ...newObjects],
      }, 'offset');
    },
    [scene, selectedIds, handleSceneCommit, showAlert],
  );

  const textToPath = useCallback(async () => {
    if (!requireFeature('text_to_path')) {
      throw new Error('Text-to-path requires a Pro license');
    }
    const textObjs = scene.objects.filter(
      o => selectedIds.has(o.id) && o.geometry.type === 'text',
    );

    if (textObjs.length === 0) {
      await showAlert('Text to Path', 'Select a text object first.');
      return;
    }

    // Warn if text is on an engrave layer — conversion is not needed for engrave
    const engraveTextObjs = textObjs.filter(o => {
      const layer = scene.layers.find(l => l.id === o.layerId);
      return layer && layer.settings.mode === 'engrave';
    });
    if (engraveTextObjs.length > 0) {
      const proceed = await showConfirm(
        'Text to Path',
        'Text on engrave layers is handled automatically — you don\'t need to convert it.\n\n' +
        'Converting removes text editing (spacing, font changes).\n\n' +
        'Convert anyway?',
      );
      if (!proceed) return;
    }

    const newObjects: SceneObject[] = [];
    const removeIds = new Set<string>();

    for (const obj of textObjs) {
      const geom = obj.geometry as TextGeometry;
      const result = await textGeometryToPath(geom);

      if (!result) continue;

      removeIds.add(obj.id);

      newObjects.push({
        id: generateId(),
        type: 'path',
        name: `Path: "${geom.text}"`,
        layerId: obj.layerId,
        parentId: null,
        transform: { ...obj.transform },
        geometry: {
          type: 'path',
          subPaths: result.subPaths,
          sourceText: { ...geom },
        },
        visible: true,
        locked: false,
        powerScale: obj.powerScale ?? 1,
        _bounds: null,
        _worldTransform: null,
      });
    }

    if (newObjects.length === 0) {
      await showAlert('Text to Path', 'Text to path conversion failed.');
      return;
    }

    const newScene = {
      ...scene,
      objects: [...scene.objects.filter(o => !removeIds.has(o.id)), ...newObjects],
    };

    handleSceneCommit(newScene, 'text-to-path', new Set(newObjects.map(o => o.id)));
  }, [scene, selectedIds, handleSceneCommit, showAlert, showConfirm]);

  const distributeObjects = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      const selected = scene.objects.filter(o => selectedIds.has(o.id));
      if (selected.length < 3) return;

      const sorted = [...selected].sort((a, b) =>
        direction === 'horizontal'
          ? a.transform.tx - b.transform.tx
          : a.transform.ty - b.transform.ty,
      );

      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = direction === 'horizontal'
        ? last.transform.tx - first.transform.tx
        : last.transform.ty - first.transform.ty;
      const step = totalSpan / (sorted.length - 1);

      const newScene = {
        ...scene,
        objects: scene.objects.map(o => {
          const idx = sorted.findIndex(s => s.id === o.id);
          if (idx <= 0 || idx >= sorted.length - 1) return o;
          if (direction === 'horizontal') {
            return {
              ...o,
              transform: { ...o.transform, tx: first.transform.tx + step * idx },
              _bounds: null,
              _worldTransform: null,
            };
          }
          return {
            ...o,
            transform: { ...o.transform, ty: first.transform.ty + step * idx },
            _bounds: null,
            _worldTransform: null,
          };
        }),
      };
      handleSceneCommit(newScene, 'distribute');
    },
    [scene, selectedIds, handleSceneCommit],
  );

  const rotateSelected = useCallback((degrees: number) => {
    const selected = scene.objects.filter(o => selectedIds.has(o.id));
    if (selected.length === 0) return;

    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Pivot = center of union world AABB (same corners/transform as SceneRenderer + computeObjectBounds).
    // SceneRenderer applies ctx.transform(t.a, t.b, t.c, t.d, t.tx, t.ty) → wx = a*lx + c*ly + tx, wy = b*lx + d*ly + ty.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of selected) {
      const b = computeObjectBounds(obj);
      if (!b || !Number.isFinite(b.minX) || b.minX > b.maxX || b.minY > b.maxY) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    if (!Number.isFinite(minX) || minX > maxX) return;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const newScene = {
      ...scene,
      objects: scene.objects.map(o => {
        if (!selectedIds.has(o.id)) return o;

        const t = o.transform;

        // Linear part L = [[a,c],[b,d]]; new L = R * L with R = [[cos,-sin],[sin,cos]] (Canvas2D / Matrix3x2 layout).
        const newA = cos * t.a - sin * t.b;
        const newB = sin * t.a + cos * t.b;
        const newC = cos * t.c - sin * t.d;
        const newD = sin * t.c + cos * t.d;

        const newTx = cos * (t.tx - cx) - sin * (t.ty - cy) + cx;
        const newTy = sin * (t.tx - cx) + cos * (t.ty - cy) + cy;

        return {
          ...o,
          transform: { a: newA, b: newB, c: newC, d: newD, tx: newTx, ty: newTy },
          _bounds: null,
          _worldTransform: null,
        };
      }),
    };
    handleSceneCommit(newScene, 'rotate');
  }, [scene, selectedIds, handleSceneCommit]);

  const flipSelected = useCallback((axis: 'horizontal' | 'vertical') => {
    const selected = scene.objects.filter(o => selectedIds.has(o.id));
    if (selected.length === 0) return;

    const newScene = {
      ...scene,
      objects: scene.objects.map(o => {
        if (!selectedIds.has(o.id)) return o;

        // Get current bounds in world space BEFORE flip
        const bounds = computeObjectBounds(o);
        if (!bounds) return o;

        const t = o.transform;
        const sx = axis === 'horizontal' ? -1 : 1;
        const sy = axis === 'vertical' ? -1 : 1;

        // Apply negative scale to the linear part
        const newA = sx * t.a;
        const newB = sx * t.b;
        const newC = sy * t.c;
        const newD = sy * t.d;

        // Compute what the new bounds WOULD be with this flipped transform
        // and adjust translation to keep the object in the same world position
        const flippedObj = {
          ...o,
          transform: { a: newA, b: newB, c: newC, d: newD, tx: t.tx, ty: t.ty },
          _bounds: null,
          _worldTransform: null,
        };
        const newBounds = computeObjectBounds(flippedObj);
        if (!newBounds) return o;

        // Calculate offset needed to align centers
        const oldCx = (bounds.minX + bounds.maxX) / 2;
        const oldCy = (bounds.minY + bounds.maxY) / 2;
        const newCx = (newBounds.minX + newBounds.maxX) / 2;
        const newCy = (newBounds.minY + newBounds.maxY) / 2;

        const dx = oldCx - newCx;
        const dy = oldCy - newCy;

        return {
          ...o,
          transform: {
            a: newA,
            b: newB,
            c: newC,
            d: newD,
            tx: t.tx + dx,
            ty: t.ty + dy,
          },
          _bounds: null,
          _worldTransform: null,
        };
      }),
    };
    handleSceneCommit(newScene, 'flip');
  }, [scene, selectedIds, handleSceneCommit]);

  const moveToCorner = useCallback(
    (corner: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight') => {
      const selected = scene.objects.filter(o => selectedIds.has(o.id));
      if (selected.length === 0) return;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const o of selected) {
        const b = computeObjectBounds(o);
        if (!b) continue;
        minX = Math.min(minX, b.minX);
        minY = Math.min(minY, b.minY);
        maxX = Math.max(maxX, b.maxX);
        maxY = Math.max(maxY, b.maxY);
      }
      if (!Number.isFinite(minX)) return;

      const groupW = maxX - minX;
      const groupH = maxY - minY;
      let targetX = 0;
      let targetY = 0;
      switch (corner) {
        case 'topLeft': targetX = 0; targetY = 0; break;
        case 'topRight': targetX = scene.canvas.width - groupW; targetY = 0; break;
        case 'bottomLeft': targetX = 0; targetY = scene.canvas.height - groupH; break;
        case 'bottomRight': targetX = scene.canvas.width - groupW; targetY = scene.canvas.height - groupH; break;
      }
      const dx = targetX - minX;
      const dy = targetY - minY;

      const newScene = {
        ...scene,
        objects: scene.objects.map(o =>
          selectedIds.has(o.id)
            ? {
                ...o,
                transform: { ...o.transform, tx: o.transform.tx + dx, ty: o.transform.ty + dy },
                _bounds: null,
                _worldTransform: null,
              }
            : o,
        ),
      };
      handleSceneCommit(newScene, 'move-to-corner');
    },
    [scene, selectedIds, handleSceneCommit],
  );

  const moveToMaterialOrigin = useCallback(() => {
    if (!scene.material) return;
    const selected = scene.objects.filter(o => selectedIds.has(o.id));
    if (selected.length === 0) return;

    let minX = Infinity, minY = Infinity;
    for (const o of selected) {
      const b = computeObjectBounds(o);
      if (!b) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
    }
    if (!Number.isFinite(minX)) return;

    const dx = scene.material.x - minX;
    const dy = scene.material.y - minY;

    const newScene = {
      ...scene,
      objects: scene.objects.map(o =>
        selectedIds.has(o.id)
          ? {
              ...o,
              transform: { ...o.transform, tx: o.transform.tx + dx, ty: o.transform.ty + dy },
              _bounds: null,
              _worldTransform: null,
            }
          : o,
      ),
    };
    handleSceneCommit(newScene, 'move-to-material-origin');
  }, [scene, selectedIds, handleSceneCommit]);

  const toggleLock = useCallback(() => {
    const selected = scene.objects.filter(o => selectedIds.has(o.id));
    if (selected.length === 0) return;
    const allLocked = selected.every(o => o.locked);
    const newScene = {
      ...scene,
      objects: scene.objects.map(o =>
        selectedIds.has(o.id) ? { ...o, locked: !allLocked } : o,
      ),
    };
    handleSceneCommit(newScene, 'toggle-lock');
  }, [scene, selectedIds, handleSceneCommit]);

  const toggleVisibility = useCallback(() => {
    const selected = scene.objects.filter(o => selectedIds.has(o.id));
    if (selected.length === 0) return;
    const allVisible = selected.every(o => o.visible);
    const newScene = {
      ...scene,
      objects: scene.objects.map(o =>
        selectedIds.has(o.id) ? { ...o, visible: !allVisible } : o,
      ),
    };
    handleSceneCommit(newScene, 'toggle-visibility');
  }, [scene, selectedIds, handleSceneCommit]);

  const alignObjects = useCallback(
    (mode: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY') => {
      switch (mode) {
        case 'left': alignLeft(); break;
        case 'right': alignRight(); break;
        case 'top': alignTop(); break;
        case 'bottom': alignBottom(); break;
        case 'centerX': alignCenterH(); break;
        case 'centerY': alignCenterV(); break;
      }
    },
    [alignLeft, alignRight, alignTop, alignBottom, alignCenterH, alignCenterV],
  );

  return {
    alignLeft,
    alignRight,
    alignTop,
    alignBottom,
    alignCenterH,
    alignCenterV,
    alignObjects,
    centerOnCanvas,
    centerOnMaterial,
    performBoolean,
    offsetShapes,
    offsetSelected: offsetShapes,
    textToPath,
    convertTextToPath: textToPath,
    distributeObjects,
    rotateSelected,
    flipSelected,
    moveToCorner,
    moveToMaterialOrigin,
    toggleLock,
    toggleVisibility,
  };
}
