import React, { useCallback, useEffect, useState } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type ImageGeometry, type PathGeometry } from '../../core/scene/SceneObject';
import { computeObjectBounds } from '../../geometry/bounds';
import { ditherImage, type DitherMode } from '../../import/Dithering';
import { traceToSceneObject, DEFAULT_TRACE_OPTIONS } from '../../import/trace';

interface PropertiesPanelProps {
  scene: Scene;
  selectedIds: ReadonlySet<string>;
  onSceneCommit: (scene: Scene) => void;
  onSelectionChange?: (ids: ReadonlySet<string>) => void;
}

export function PropertiesPanel({ scene, selectedIds, onSceneCommit, onSelectionChange }: PropertiesPanelProps) {
  const selectedObjects = scene.objects.filter(o => selectedIds.has(o.id));

  const updateObjectTransform = useCallback((objId: string, field: 'tx' | 'ty', value: number) => {
    if (!Number.isFinite(value)) return;
    const newScene = {
      ...scene,
      objects: scene.objects.map(o =>
        o.id === objId
          ? { ...o, transform: { ...o.transform, [field]: value }, _bounds: null, _worldTransform: null }
          : o
      ),
    };
    onSceneCommit(newScene);
  }, [scene, onSceneCommit]);

  const updateObjectLayer = useCallback((objId: string, newLayerId: string) => {
    const newScene = {
      ...scene,
      objects: scene.objects.map(o =>
        o.id === objId ? { ...o, layerId: newLayerId } : o
      ),
    };
    onSceneCommit(newScene);
  }, [scene, onSceneCommit]);

  const updateImageSettings = useCallback((objId: string, field: string, value: number | boolean) => {
    const newScene = {
      ...scene,
      objects: scene.objects.map(o => {
        if (o.id !== objId || o.geometry.type !== 'image') return o;
        const geom = o.geometry as ImageGeometry;

        // Get current grayscale data
        if (!geom.grayscaleData || !geom.grayscaleWidth || !geom.grayscaleHeight) return o;

        // Store adjustment values on the geometry (we'll add these fields)
        const newGeom = { ...geom, [field]: value } as ImageGeometry;

        // Recompute adjusted grayscale
        const src = geom.grayscaleData;
        const adjusted = new Uint8Array(src.length);
        const brightness = newGeom.brightness ?? 0;
        const contrast = newGeom.contrast ?? 0;
        const invert = newGeom.invert ?? false;

        const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

        for (let i = 0; i < src.length; i++) {
          let v = src[i];
          // Brightness
          v = Math.max(0, Math.min(255, v + brightness));
          // Contrast
          v = Math.max(0, Math.min(255, Math.round(contrastFactor * (v - 128) + 128)));
          // Invert
          if (invert) v = 255 - v;
          adjusted[i] = v;
        }

        return {
          ...o,
          geometry: { ...newGeom, adjustedData: adjusted, ditherMode: undefined },
          _bounds: null,
          _worldTransform: null,
        };
      }),
    };
    onSceneCommit(newScene);
  }, [scene, onSceneCommit]);

  const [traceThreshold, setTraceThreshold] = React.useState(DEFAULT_TRACE_OPTIONS.threshold);
  const [traceTurdsize, setTraceTurdsize] = React.useState(DEFAULT_TRACE_OPTIONS.turdsize);
  const [traceAlphamax, setTraceAlphamax] = React.useState(DEFAULT_TRACE_OPTIONS.alphamax);
  const [traceInvert, setTraceInvert] = React.useState(DEFAULT_TRACE_OPTIONS.invert);

  const [ditherMode, setDitherMode] = useState<DitherMode>('none');

  useEffect(() => {
    const o = scene.objects.find(x => selectedIds.has(x.id) && x.geometry.type === 'image');
    if (o) setDitherMode((o.geometry as ImageGeometry).ditherMode ?? 'none');
  }, [scene, selectedIds]);

  const handleTrace = useCallback(() => {
    if (selectedObjects.length !== 1) return;
    const obj = selectedObjects[0];
    if (obj.geometry.type !== 'image') return;
    const geom = obj.geometry as ImageGeometry;
    if (!geom.grayscaleData || !geom.grayscaleWidth || !geom.grayscaleHeight) return;

    const cutLayerId = scene.layers.find(l => l.settings.mode === 'cut')?.id || scene.layers[0].id;

    const dpi = 96;
    const physW = (geom.originalWidth / dpi) * 25.4;
    const physH = (geom.originalHeight / dpi) * 25.4;
    const scaleX = physW / geom.grayscaleWidth;
    const scaleY = physH / geom.grayscaleHeight;

    const traced = traceToSceneObject(
      geom.grayscaleData,
      geom.grayscaleWidth,
      geom.grayscaleHeight,
      {
        threshold: traceThreshold,
        turdsize: traceTurdsize,
        alphamax: traceAlphamax,
        opttolerance: DEFAULT_TRACE_OPTIONS.opttolerance,
        invert: traceInvert,
      },
      cutLayerId,
      obj.name || 'Image'
    );

    if (!traced) {
      alert('No contours found. Try adjusting the threshold.');
      return;
    }

    const pathGeom = traced.geometry as PathGeometry;
    const scaledSubPaths = pathGeom.subPaths.map(sp => ({
      ...sp,
      segments: sp.segments.map(seg => {
        if (seg.type === 'close') return seg;
        if (seg.type === 'move' || seg.type === 'line') {
          return { ...seg, to: { x: seg.to.x * scaleX, y: seg.to.y * scaleY } };
        }
        if (seg.type === 'quadratic') {
          return {
            ...seg,
            cp: { x: seg.cp.x * scaleX, y: seg.cp.y * scaleY },
            to: { x: seg.to.x * scaleX, y: seg.to.y * scaleY },
          };
        }
        if (seg.type === 'cubic') {
          return {
            ...seg,
            cp1: { x: seg.cp1.x * scaleX, y: seg.cp1.y * scaleY },
            cp2: { x: seg.cp2.x * scaleX, y: seg.cp2.y * scaleY },
            to: { x: seg.to.x * scaleX, y: seg.to.y * scaleY },
          };
        }
        return seg;
      }),
    }));

    const finalObj = {
      ...traced,
      transform: { ...obj.transform },
      geometry: { ...pathGeom, subPaths: scaledSubPaths },
    };

    const newScene = {
      ...scene,
      objects: [...scene.objects, finalObj],
    };
    onSceneCommit(newScene);
    onSelectionChange?.(new Set([finalObj.id]));
  }, [scene, selectedObjects, traceThreshold, traceTurdsize, traceAlphamax, traceInvert, onSceneCommit, onSelectionChange]);

  const containerStyle: React.CSSProperties = {
    padding: '8px 10px',
    borderTop: '1px solid #1a1a30',
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#999',
  };

  const labelStyle: React.CSSProperties = {
    color: '#666688',
    fontSize: 10,
    marginBottom: 2,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: '#12121f',
    border: '1px solid #2a2a44',
    borderRadius: 3,
    color: '#ccc',
    padding: '3px 6px',
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 6,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    gap: 6,
  };

  if (selectedObjects.length === 0) {
    return React.createElement('div', { style: containerStyle },
      React.createElement('div', { style: { color: '#444466', fontStyle: 'italic' } }, 'No selection')
    );
  }

  if (selectedObjects.length > 1) {
    return React.createElement('div', { style: containerStyle },
      React.createElement('div', { style: labelStyle }, 'Selection'),
      React.createElement('div', null, `${selectedObjects.length} objects selected`)
    );
  }

  const obj = selectedObjects[0];
  const bounds = computeObjectBounds(obj);
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;

  return React.createElement('div', { style: containerStyle },
    React.createElement('div', { style: { ...labelStyle, marginBottom: 6, color: '#888' } }, obj.name || obj.type),

    React.createElement('div', { style: rowStyle },
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: labelStyle }, 'X (mm)'),
        React.createElement('input', {
          type: 'number',
          step: 0.1,
          value: obj.transform.tx.toFixed(2),
          style: inputStyle,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            updateObjectTransform(obj.id, 'tx', parseFloat(e.target.value)),
        }),
      ),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: labelStyle }, 'Y (mm)'),
        React.createElement('input', {
          type: 'number',
          step: 0.1,
          value: obj.transform.ty.toFixed(2),
          style: inputStyle,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            updateObjectTransform(obj.id, 'ty', parseFloat(e.target.value)),
        }),
      ),
    ),

    React.createElement('div', { style: rowStyle },
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: labelStyle }, 'Width'),
        React.createElement('input', {
          type: 'text',
          value: w.toFixed(2) + ' mm',
          readOnly: true,
          style: { ...inputStyle, color: '#666' },
        }),
      ),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: labelStyle }, 'Height'),
        React.createElement('input', {
          type: 'text',
          value: h.toFixed(2) + ' mm',
          readOnly: true,
          style: { ...inputStyle, color: '#666' },
        }),
      ),
    ),

    React.createElement('div', { style: labelStyle }, 'Layer'),
    React.createElement('select', {
      value: obj.layerId,
      style: inputStyle,
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
        updateObjectLayer(obj.id, e.target.value),
    },
      ...scene.layers.map(l =>
        React.createElement('option', { key: l.id, value: l.id },
          l.name + ' (' + l.settings.mode + ')')
      ),
    ),

    React.createElement('div', { style: { ...labelStyle, marginTop: 6 } }, 'Type'),
    React.createElement('div', { style: { color: '#aaa' } }, obj.type),

    obj.geometry.type === 'image' && React.createElement('div', { style: { marginTop: 8, borderTop: '1px solid #1a1a30', paddingTop: 8 } },
      React.createElement('div', { style: { ...labelStyle, color: '#888', marginBottom: 6 } }, 'Image Processing'),

      React.createElement('div', { style: labelStyle }, 'Brightness'),
      React.createElement('input', {
        type: 'range',
        min: -100,
        max: 100,
        value: (obj.geometry as ImageGeometry).brightness ?? 0,
        style: { width: '100%', accentColor: '#3b8beb', marginBottom: 6 },
        onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
          updateImageSettings(obj.id, 'brightness', parseInt(e.target.value, 10)),
      }),

      React.createElement('div', { style: labelStyle }, 'Contrast'),
      React.createElement('input', {
        type: 'range',
        min: -100,
        max: 100,
        value: (obj.geometry as ImageGeometry).contrast ?? 0,
        style: { width: '100%', accentColor: '#3b8beb', marginBottom: 6 },
        onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
          updateImageSettings(obj.id, 'contrast', parseInt(e.target.value, 10)),
      }),

      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: (obj.geometry as ImageGeometry).invert ?? false,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            updateImageSettings(obj.id, 'invert', e.target.checked),
        }),
        React.createElement('span', { style: { color: '#aaa' } }, 'Invert'),
      ),

      React.createElement('div', { style: { ...labelStyle, marginTop: 6 } }, 'Dither Mode'),
      React.createElement('select', {
        value: (obj.geometry as ImageGeometry).ditherMode ?? ditherMode,
        style: inputStyle,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
          const mode = e.target.value as DitherMode;
          setDitherMode(mode);

          const imgObj = selectedObjects[0];
          if (!imgObj || imgObj.geometry.type !== 'image') return;
          const geom = imgObj.geometry as ImageGeometry;
          const srcData = geom.grayscaleData;
          if (!srcData || !geom.grayscaleWidth || !geom.grayscaleHeight) return;

          const brightness = geom.brightness ?? 0;
          const contrast = geom.contrast ?? 0;
          const invert = geom.invert ?? false;
          const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

          const preprocessed = new Uint8Array(srcData.length);
          for (let i = 0; i < srcData.length; i++) {
            let v = srcData[i];
            v = Math.max(0, Math.min(255, v + brightness));
            v = Math.max(0, Math.min(255, Math.round(contrastFactor * (v - 128) + 128)));
            if (invert) v = 255 - v;
            preprocessed[i] = v;
          }

          const dithered = ditherImage(preprocessed, geom.grayscaleWidth, geom.grayscaleHeight, mode);

          const newScene = {
            ...scene,
            objects: scene.objects.map(o =>
              o.id === imgObj.id
                ? { ...o, geometry: { ...o.geometry, adjustedData: dithered, ditherMode: mode } as ImageGeometry, _bounds: null, _worldTransform: null }
                : o
            ),
          };
          onSceneCommit(newScene);
        },
      },
        React.createElement('option', { value: 'none' }, 'None (grayscale)'),
        React.createElement('option', { value: 'threshold' }, 'Threshold'),
        React.createElement('option', { value: 'floyd-steinberg' }, 'Floyd-Steinberg'),
        React.createElement('option', { value: 'jarvis' }, 'Jarvis'),
        React.createElement('option', { value: 'stucki' }, 'Stucki'),
        React.createElement('option', { value: 'atkinson' }, 'Atkinson'),
        React.createElement('option', { value: 'ordered' }, 'Ordered (Bayer)'),
      ),

      React.createElement('div', { style: { marginTop: 8, borderTop: '1px solid #1a1a30', paddingTop: 8 } },
        React.createElement('div', { style: { ...labelStyle, color: '#888', marginBottom: 6 } }, 'Image Tracing'),

        React.createElement('div', { style: labelStyle }, `Threshold: ${traceThreshold}`),
        React.createElement('input', {
          type: 'range', min: 1, max: 255, value: traceThreshold,
          style: { width: '100%', accentColor: '#2dd4a0', marginBottom: 4 },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTraceThreshold(parseInt(e.target.value, 10)),
        }),

        React.createElement('div', { style: labelStyle }, `Speckle filter: ${traceTurdsize}`),
        React.createElement('input', {
          type: 'range', min: 0, max: 50, value: traceTurdsize,
          style: { width: '100%', accentColor: '#2dd4a0', marginBottom: 4 },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTraceTurdsize(parseInt(e.target.value, 10)),
        }),

        React.createElement('div', { style: labelStyle }, `Smoothness: ${traceAlphamax.toFixed(1)}`),
        React.createElement('input', {
          type: 'range', min: 0, max: 1.33, step: 0.1, value: traceAlphamax,
          style: { width: '100%', accentColor: '#2dd4a0', marginBottom: 4 },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTraceAlphamax(parseFloat(e.target.value)),
        }),

        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 } },
          React.createElement('input', {
            type: 'checkbox', checked: traceInvert,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTraceInvert(e.target.checked),
          }),
          React.createElement('span', { style: { color: '#aaa' } }, 'Trace light areas'),
        ),

        React.createElement('button', {
          onClick: handleTrace,
          style: {
            width: '100%', padding: '6px 12px',
            background: '#1a3a2e', border: '1px solid #2dd4a0', borderRadius: 4,
            color: '#2dd4a0', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11,
          },
        }, 'Trace to Vector (Cut layer)'),
      ),
    ),
  );
}
