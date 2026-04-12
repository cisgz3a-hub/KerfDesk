import { useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject, type TextGeometry, type Geometry } from '../../core/scene/SceneObject';
import { computeObjectBounds } from '../../geometry/bounds';
import { booleanOperation, type BooleanOp } from '../../geometry/BooleanOps';
import { textToPath as geometryTextToPath } from '../../geometry/TextToPath';
import { offsetObject } from '../../geometry/OffsetPath';
import { generateId, IDENTITY_MATRIX, type Matrix3x2 } from '../../core/types';

/** World point from local (lx, ly) using the same convention as computeObjectBounds. */
function transformLocalToWorld(t: Matrix3x2, lx: number, ly: number): { x: number; y: number } {
  return {
    x: t.a * lx + t.c * ly + t.tx,
    y: t.b * lx + t.d * ly + t.ty,
  };
}

/** Axis-aligned center of geometry in local space (not control-point hull for curves). */
function geometryLocalCenter(geom: Geometry): { x: number; y: number } | null {
  switch (geom.type) {
    case 'rect':
      return { x: geom.x + geom.width / 2, y: geom.y + geom.height / 2 };
    case 'ellipse':
      return { x: geom.cx, y: geom.cy };
    case 'line':
      return { x: (geom.x1 + geom.x2) / 2, y: (geom.y1 + geom.y2) / 2 };
    case 'polygon': {
      const pts = geom.points;
      if (pts.length === 0) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }
    case 'path': {
      const pts: { x: number; y: number }[] = [];
      for (const sub of geom.subPaths) {
        for (const seg of sub.segments) {
          switch (seg.type) {
            case 'move':
            case 'line':
              pts.push(seg.to);
              break;
            case 'cubic':
              pts.push(seg.cp1, seg.cp2, seg.to);
              break;
            case 'quadratic':
              pts.push(seg.cp, seg.to);
              break;
            default:
              break;
          }
        }
      }
      if (pts.length === 0) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }
    case 'text': {
      const tw = geom.text.length * geom.fontSize * 0.6;
      const th = geom.fontSize;
      return { x: tw / 2, y: th / 2 };
    }
    case 'image': {
      const dpi = 96;
      const w = ((geom.cropWidth || geom.originalWidth) / dpi) * 25.4;
      const h = ((geom.cropHeight || geom.originalHeight) / dpi) * 25.4;
      return { x: w / 2, y: h / 2 };
    }
    default:
      return null;
  }
}

function singleObjectRotationCenterWorld(obj: SceneObject): { x: number; y: number } | null {
  const lc = geometryLocalCenter(obj.geometry);
  if (lc) {
    return transformLocalToWorld(obj.transform, lc.x, lc.y);
  }
  const b = computeObjectBounds(obj);
  if (!b || !Number.isFinite(b.minX) || b.minX > b.maxX || b.minY > b.maxY) return null;
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

function groupRotationCenterWorld(objects: SceneObject[]): { x: number; y: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const obj of objects) {
    const b = computeObjectBounds(obj);
    if (!b || !Number.isFinite(b.minX) || b.minX > b.maxX || b.minY > b.maxY) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (!Number.isFinite(minX) || minX > maxX) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

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
  handleSceneCommit: (scene: Scene) => void;
  setSelectedIds: (ids: Set<string>) => void;
  showAlert: (title: string, message: string) => void | Promise<void>;
}

export function useSceneOperations({
  scene,
  selectedIds,
  handleSceneCommit,
  setSelectedIds,
  showAlert,
}: SceneOperationsActions) {
  const alignLeft = useCallback(() => {
    handleSceneCommit(alignSelection(scene, selectedIds, 'left'));
  }, [scene, selectedIds, handleSceneCommit]);

  const alignRight = useCallback(() => {
    handleSceneCommit(alignSelection(scene, selectedIds, 'right'));
  }, [scene, selectedIds, handleSceneCommit]);

  const alignTop = useCallback(() => {
    handleSceneCommit(alignSelection(scene, selectedIds, 'top'));
  }, [scene, selectedIds, handleSceneCommit]);

  const alignBottom = useCallback(() => {
    handleSceneCommit(alignSelection(scene, selectedIds, 'bottom'));
  }, [scene, selectedIds, handleSceneCommit]);

  const alignCenterH = useCallback(() => {
    const b = getSelectionWorldBounds(scene, selectedIds);
    if (!b) return;
    const targetCx = scene.material?.enabled
      ? scene.material.x + scene.material.width / 2
      : scene.canvas.width / 2;
    const cx = (b.wMinX + b.wMaxX) / 2;
    handleSceneCommit(translateSelection(scene, selectedIds, targetCx - cx, 0));
  }, [scene, selectedIds, handleSceneCommit]);

  const alignCenterV = useCallback(() => {
    const b = getSelectionWorldBounds(scene, selectedIds);
    if (!b) return;
    const targetCy = scene.material?.enabled
      ? scene.material.y + scene.material.height / 2
      : scene.canvas.height / 2;
    const cy = (b.wMinY + b.wMaxY) / 2;
    handleSceneCommit(translateSelection(scene, selectedIds, 0, targetCy - cy));
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
    handleSceneCommit(translateSelection(scene, selectedIds, dx, dy));
  }, [scene, selectedIds, handleSceneCommit]);

  /** Center selection on the material (or canvas if no material), same as legacy alignSelection(..., 'center'). */
  const centerOnMaterial = useCallback(() => {
    handleSceneCommit(alignSelection(scene, selectedIds, 'center'));
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

      handleSceneCommit(newScene);
      setSelectedIds(new Set([newId]));
    },
    [scene, selectedIds, handleSceneCommit, setSelectedIds, showAlert],
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
      });
    },
    [scene, selectedIds, handleSceneCommit, showAlert],
  );

  const textToPath = useCallback(async () => {
    const textObjs = scene.objects.filter(
      o => selectedIds.has(o.id) && o.geometry.type === 'text',
    );

    if (textObjs.length === 0) {
      await showAlert('Text to Path', 'Select a text object first.');
      return;
    }

    const newObjects: SceneObject[] = [];
    const removeIds = new Set<string>();

    for (const obj of textObjs) {
      const geom = obj.geometry as TextGeometry;
      const result = await geometryTextToPath(
        geom.text || '',
        geom.fontFamily || 'Arial',
        geom.fontSize || 20,
        geom.bold ?? false,
      );

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

    handleSceneCommit(newScene);
    setSelectedIds(new Set(newObjects.map(o => o.id)));
  }, [scene, selectedIds, handleSceneCommit, setSelectedIds, showAlert]);

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
      handleSceneCommit(newScene);
    },
    [scene, selectedIds, handleSceneCommit],
  );

  const rotateSelected = useCallback((degrees: number) => {
    const selected = scene.objects.filter(o => selectedIds.has(o.id));
    if (selected.length === 0) return;

    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    let groupCx: number;
    let groupCy: number;
    if (selected.length === 1) {
      const c = singleObjectRotationCenterWorld(selected[0]);
      if (!c) return;
      groupCx = c.x;
      groupCy = c.y;
    } else {
      const c = groupRotationCenterWorld(selected);
      if (!c) return;
      groupCx = c.x;
      groupCy = c.y;
    }

    const newScene = {
      ...scene,
      objects: scene.objects.map(o => {
        if (!selectedIds.has(o.id)) return o;

        const t = o.transform;

        const newA = cos * t.a - sin * t.c;
        const newB = cos * t.b - sin * t.d;
        const newC = sin * t.a + cos * t.c;
        const newD = sin * t.b + cos * t.d;

        const newTx = cos * (t.tx - groupCx) - sin * (t.ty - groupCy) + groupCx;
        const newTy = sin * (t.tx - groupCx) + cos * (t.ty - groupCy) + groupCy;

        return {
          ...o,
          transform: { a: newA, b: newB, c: newC, d: newD, tx: newTx, ty: newTy },
          _bounds: null,
          _worldTransform: null,
        };
      }),
    };
    handleSceneCommit(newScene);
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
    handleSceneCommit(newScene);
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
      handleSceneCommit(newScene);
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
    handleSceneCommit(newScene);
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
    handleSceneCommit(newScene);
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
    handleSceneCommit(newScene);
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
