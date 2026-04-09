import React, { useCallback, useEffect, useState } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { theme } from '../styles/theme';
import { type ImageGeometry, type PathGeometry, type RectGeometry } from '../../core/scene/SceneObject';
import { computeObjectBounds } from '../../geometry/bounds';
import { ditherImage, type DitherMode } from '../../import/Dithering';
import { traceToSceneObject, DEFAULT_TRACE_OPTIONS } from '../../import/trace';

interface PropertiesPanelProps {
  scene: Scene;
  selectedIds: ReadonlySet<string>;
  onSceneCommit: (scene: Scene) => void;
  /** Live preview without history (optional). */
  onSceneChange?: (scene: Scene) => void;
  onSelectionChange?: (ids: ReadonlySet<string>) => void;
  showAlert: (title: string, message: string) => Promise<void>;
  handleTextToPath: () => void;
  productionMode?: boolean;
}

export function PropertiesPanel({ scene, selectedIds, onSceneCommit, onSceneChange, onSelectionChange, showAlert, handleTextToPath, productionMode = false }: PropertiesPanelProps) {
  const selectedObjects = scene.objects.filter(o => selectedIds.has(o.id));
  const singleId = selectedObjects.length === 1 ? selectedObjects[0].id : null;
  const [txDraft, setTxDraft] = useState<string | undefined>(undefined);
  const [tyDraft, setTyDraft] = useState<string | undefined>(undefined);
  const [wDraft, setWDraft] = useState<string | undefined>(undefined);
  const [hDraft, setHDraft] = useState<string | undefined>(undefined);
  const [powerScaleDraft, setPowerScaleDraft] = useState<string | undefined>(undefined);
  useEffect(() => {
    setTxDraft(undefined);
    setTyDraft(undefined);
    setWDraft(undefined);
    setHDraft(undefined);
    setPowerScaleDraft(undefined);
  }, [singleId]);

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

  const handleTrace = useCallback(async () => {
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
      await showAlert('Trace', 'No contours found. Try adjusting the threshold.');
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
  }, [scene, selectedObjects, traceThreshold, traceTurdsize, traceAlphamax, traceInvert, onSceneCommit, onSelectionChange, showAlert]);

  const containerStyle: React.CSSProperties = {
    padding: '10px 12px',
    borderTop: `1px solid ${theme.border.subtle}`,
    fontFamily: theme.font.ui,
    color: theme.text.secondary,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: theme.font.size.xs,
    color: theme.text.secondary,
    fontFamily: theme.font.ui,
    marginBottom: 2,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '4px 8px',
    background: theme.bg.base,
    border: `1px solid ${theme.border.default}`,
    borderRadius: theme.radius.sm,
    color: theme.text.primary,
    fontSize: theme.font.size.sm,
    fontFamily: theme.font.mono,
    outline: 'none',
    marginBottom: 6,
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    fontFamily: theme.font.ui,
    cursor: 'pointer',
  };

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: theme.font.size.sm,
    fontWeight: 600,
    color: theme.text.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 6,
  };

  const emptyStateStyle: React.CSSProperties = {
    padding: 12,
    color: theme.text.tertiary,
    fontSize: theme.font.size.sm,
    fontFamily: theme.font.ui,
    fontStyle: 'italic' as const,
  };

  const dividerStyle: React.CSSProperties = {
    marginTop: 8,
    borderTop: `1px solid ${theme.border.subtle}`,
    paddingTop: 8,
  };

  const traceButtonStyle: React.CSSProperties = {
    width: '100%',
    padding: '7px 12px',
    background: 'rgba(45, 212, 160, 0.1)',
    border: `1px solid ${theme.accent.green}`,
    borderRadius: theme.radius.md,
    color: theme.accent.green,
    cursor: 'pointer',
    fontFamily: theme.font.ui,
    fontSize: theme.font.size.sm,
    fontWeight: 500,
    transition: `all ${theme.transition.fast}`,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    gap: 6,
  };

  if (selectedObjects.length === 0) {
    return React.createElement('div', { style: containerStyle },
      React.createElement('div', { style: emptyStateStyle }, 'No selection')
    );
  }

  if (selectedObjects.length > 1) {
    return React.createElement('div', { style: containerStyle },
      React.createElement('div', { style: labelStyle }, 'Selection'),
      React.createElement('div', { style: emptyStateStyle }, `${selectedObjects.length} objects selected`)
    );
  }

  const obj = selectedObjects[0];
  const bounds = computeObjectBounds(obj);
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;

  const commitWidth = (newW: number) => {
    if (!Number.isFinite(newW) || newW <= 0) return;
    const b = computeObjectBounds(obj);
    if (!b) return;
    const oldW = b.maxX - b.minX;
    if (oldW === 0) return;
    const scale = newW / (oldW * Math.abs(obj.transform.a || 1));
    const newScene = {
      ...scene,
      objects: scene.objects.map(o =>
        o.id === obj.id
          ? { ...o, transform: { ...o.transform, a: o.transform.a * scale }, _bounds: null, _worldTransform: null }
          : o
      ),
    };
    onSceneCommit(newScene);
  };

  const commitHeight = (newH: number) => {
    if (!Number.isFinite(newH) || newH <= 0) return;
    const b = computeObjectBounds(obj);
    if (!b) return;
    const oldH = b.maxY - b.minY;
    if (oldH === 0) return;
    const scale = newH / (oldH * Math.abs(obj.transform.d || 1));
    const newScene = {
      ...scene,
      objects: scene.objects.map(o =>
        o.id === obj.id
          ? { ...o, transform: { ...o.transform, d: o.transform.d * scale }, _bounds: null, _worldTransform: null }
          : o
      ),
    };
    onSceneCommit(newScene);
  };

  return React.createElement('div', { style: containerStyle },
    React.createElement('div', { style: { ...labelStyle, marginBottom: 6, fontWeight: 600, color: theme.text.primary } }, obj.name || obj.type),

    React.createElement('div', { style: rowStyle },
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: labelStyle }, 'X (mm)'),
        React.createElement('input', {
          type: 'text',
          inputMode: 'decimal',
          value: txDraft !== undefined ? txDraft : obj.transform.tx.toFixed(2),
          style: inputStyle,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTxDraft(e.target.value),
          onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
            setTxDraft(undefined);
            const v = parseFloat(e.target.value);
            updateObjectTransform(obj.id, 'tx', Number.isFinite(v) ? v : obj.transform.tx);
          },
        }),
      ),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: labelStyle }, 'Y (mm)'),
        React.createElement('input', {
          type: 'text',
          inputMode: 'decimal',
          value: tyDraft !== undefined ? tyDraft : obj.transform.ty.toFixed(2),
          style: inputStyle,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTyDraft(e.target.value),
          onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
            setTyDraft(undefined);
            const v = parseFloat(e.target.value);
            updateObjectTransform(obj.id, 'ty', Number.isFinite(v) ? v : obj.transform.ty);
          },
        }),
      ),
    ),

    React.createElement('div', { style: rowStyle },
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: labelStyle }, 'Width'),
        React.createElement('input', {
          type: 'text',
          inputMode: 'decimal',
          value: wDraft !== undefined ? wDraft : w.toFixed(2),
          style: inputStyle,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setWDraft(e.target.value),
          onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
            setWDraft(undefined);
            const v = parseFloat(e.target.value);
            commitWidth(Number.isFinite(v) ? v : w);
          },
        }),
      ),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: labelStyle }, 'Height'),
        React.createElement('input', {
          type: 'text',
          inputMode: 'decimal',
          value: hDraft !== undefined ? hDraft : h.toFixed(2),
          style: inputStyle,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setHDraft(e.target.value),
          onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
            setHDraft(undefined);
            const v = parseFloat(e.target.value);
            commitHeight(Number.isFinite(v) ? v : h);
          },
        }),
      ),
    ),

    obj.geometry.type === 'rect' && React.createElement('div', {
      style: { marginTop: 8 },
    },
      React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 2 } }, 'Corner Radius (mm)'),
      React.createElement('input', {
        type: 'number',
        value: (obj.geometry as RectGeometry).cornerRadius || 0,
        min: 0,
        max: Math.min((obj.geometry as RectGeometry).width / 2, (obj.geometry as RectGeometry).height / 2) || 50,
        step: 0.5,
        style: inputStyle,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
          const raw = e.target.value;
          if (raw === '') return;
          const val = parseFloat(raw);
          if (isNaN(val)) return;
          const newScene = {
            ...scene,
            objects: scene.objects.map(o =>
              selectedIds.has(o.id) && o.geometry.type === 'rect'
                ? { ...o, geometry: { ...o.geometry, cornerRadius: val }, _bounds: null, _worldTransform: null }
                : o
            ),
          };
          (onSceneChange ?? onSceneCommit)(newScene);
        },
        onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
          const geom = obj.geometry as RectGeometry;
          const maxR = Math.min(geom.width / 2, geom.height / 2);
          const val = Math.max(0, Math.min(maxR, parseFloat(e.target.value) || 0));
          const newScene = {
            ...scene,
            objects: scene.objects.map(o =>
              selectedIds.has(o.id) && o.geometry.type === 'rect'
                ? { ...o, geometry: { ...o.geometry, cornerRadius: val }, _bounds: null, _worldTransform: null }
                : o
            ),
          };
          onSceneCommit(newScene);
        },
      }),
    ),

    productionMode && React.createElement('div', { style: { marginTop: 8 } },
      React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 2 } }, 'Power Scale %'),
      React.createElement('input', {
        type: 'text',
        inputMode: 'numeric',
        value: powerScaleDraft !== undefined ? powerScaleDraft : String(Math.round((obj.powerScale ?? 1) * 100)),
        style: inputStyle,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPowerScaleDraft(e.target.value),
        onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
          setPowerScaleDraft(undefined);
          const prevPct = Math.round((obj.powerScale ?? 1) * 100);
          let val = parseInt(e.target.value, 10);
          if (!Number.isFinite(val)) val = prevPct;
          val = Math.max(1, Math.min(100, val));
          onSceneCommit({
            ...scene,
            objects: scene.objects.map(o =>
              selectedIds.has(o.id) ? { ...o, powerScale: val / 100 } : o
            ),
          });
        },
      }),
    ),

    React.createElement('div', { style: labelStyle }, 'Layer'),
    React.createElement('select', {
      value: obj.layerId,
      style: selectStyle,
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
        updateObjectLayer(obj.id, e.target.value),
    },
      ...scene.layers.map(l =>
        React.createElement('option', { key: l.id, value: l.id },
          l.name + ' (' + l.settings.mode + ')')
      ),
    ),

    React.createElement('div', { style: { ...labelStyle, marginTop: 6 } }, 'Type'),
    React.createElement('div', { style: { color: theme.text.secondary, fontSize: theme.font.size.sm } }, obj.type),

    obj.geometry.type === 'text' && React.createElement('div', {
      style: {
        padding: '8px 12px', margin: '8px 0',
        background: 'rgba(255, 170, 50, 0.08)',
        border: '1px solid rgba(255, 170, 50, 0.2)',
        borderRadius: 6, fontSize: 10, color: '#ffaa32', lineHeight: 1.5,
      },
    },
      '⚠ Text must be converted to paths before cutting. ',
      React.createElement('span', {
        onClick: () => void handleTextToPath(),
        style: { textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 },
      }, 'Convert now'),
    ),

    obj.geometry.type === 'image' && React.createElement('div', { style: dividerStyle },
      React.createElement('div', { style: sectionHeaderStyle }, 'Image Processing'),

      React.createElement('div', { style: labelStyle }, 'Brightness'),
      React.createElement('input', {
        type: 'range',
        min: -100,
        max: 100,
        value: (obj.geometry as ImageGeometry).brightness ?? 0,
        style: { width: '100%', accentColor: theme.accent.cyan, marginBottom: 6 },
        onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
          updateImageSettings(obj.id, 'brightness', parseInt(e.target.value, 10)),
      }),

      React.createElement('div', { style: labelStyle }, 'Contrast'),
      React.createElement('input', {
        type: 'range',
        min: -100,
        max: 100,
        value: (obj.geometry as ImageGeometry).contrast ?? 0,
        style: { width: '100%', accentColor: theme.accent.cyan, marginBottom: 6 },
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
        React.createElement('span', { style: { color: theme.text.secondary, fontSize: theme.font.size.sm } }, 'Invert'),
      ),

      React.createElement('div', { style: { ...labelStyle, marginTop: 6 } }, 'Dither Mode'),
      React.createElement('select', {
        value: (obj.geometry as ImageGeometry).ditherMode ?? ditherMode,
        style: selectStyle,
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

      React.createElement('div', { style: dividerStyle },
        React.createElement('div', { style: sectionHeaderStyle }, 'Image Tracing'),

        React.createElement('div', { style: labelStyle }, `Threshold: ${traceThreshold}`),
        React.createElement('input', {
          type: 'range', min: 1, max: 255, value: traceThreshold,
          style: { width: '100%', accentColor: theme.accent.green, marginBottom: 4 },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTraceThreshold(parseInt(e.target.value, 10)),
        }),

        React.createElement('div', { style: labelStyle }, `Speckle filter: ${traceTurdsize}`),
        React.createElement('input', {
          type: 'range', min: 0, max: 50, value: traceTurdsize,
          style: { width: '100%', accentColor: theme.accent.green, marginBottom: 4 },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTraceTurdsize(parseInt(e.target.value, 10)),
        }),

        React.createElement('div', { style: labelStyle }, `Smoothness: ${traceAlphamax.toFixed(1)}`),
        React.createElement('input', {
          type: 'range', min: 0, max: 1.33, step: 0.1, value: traceAlphamax,
          style: { width: '100%', accentColor: theme.accent.green, marginBottom: 4 },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTraceAlphamax(parseFloat(e.target.value)),
        }),

        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 } },
          React.createElement('input', {
            type: 'checkbox', checked: traceInvert,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTraceInvert(e.target.checked),
          }),
          React.createElement('span', { style: { color: theme.text.secondary, fontSize: theme.font.size.sm } }, 'Trace light areas'),
        ),

        React.createElement('button', {
          onClick: handleTrace,
          style: traceButtonStyle,
        }, 'Trace to Vector (Cut layer)'),
      ),
    ),
  );
}
