import { useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject, type TextGeometry } from '../../core/scene/SceneObject';
import { computeObjectBounds } from '../../geometry/bounds';
import { booleanOperation, type BooleanOp } from '../../geometry/BooleanOps';
import { textToPath as geometryTextToPath } from '../../geometry/TextToPath';
import { offsetObject } from '../../geometry/OffsetPath';
import { generateId, IDENTITY_MATRIX } from '../../core/types';

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
  };
}
