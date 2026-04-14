import React, { useCallback, useEffect, useRef, useState } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { theme } from '../styles/theme';
import {
  type ImageGeometry,
  type PathGeometry,
  type PolygonGeometry,
  type RectGeometry,
  type TextGeometry,
} from '../../core/scene/SceneObject';
import { geometryToPoints } from '../../core/job/JobCompiler';
import { computeObjectBounds } from '../../geometry/bounds';
import { ditherImage, type DitherMode } from '../../import/Dithering';
import { traceToSceneObject, DEFAULT_TRACE_OPTIONS } from '../../import/trace';
import { NumberInput } from './NumberInput';
import { isProUnlocked } from './TrialGuard';

const TEXT_FONT_OPTIONS = [
  'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana',
  'Trebuchet MS', 'Impact', 'Comic Sans MS', 'Palatino', 'Garamond',
  'Bookman', 'Avant Garde',
] as const;

export interface ObjectPropertiesTabProps {
  scene: Scene;
  selectedIds: ReadonlySet<string>;
  onSceneCommit: (scene: Scene) => void;
  /** Live preview without history (optional). */
  onSceneChange?: (scene: Scene) => void;
  onSelectionChange?: (ids: ReadonlySet<string>) => void;
  showAlert: (title: string, message: string, details?: string) => Promise<void>;
  handleTextToPath: () => void;
  productionMode?: boolean;
}

/** Object properties UI (embedded in LayerPanel Object tab). */
export function ObjectPropertiesTab({ scene, selectedIds, onSceneCommit, onSceneChange, onSelectionChange, showAlert, handleTextToPath, productionMode = false }: ObjectPropertiesTabProps) {
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  /** Skip one blur commit after pointer-up (same slider already committed). */
  const skipBlurBrightnessCommit = useRef(false);
  const skipBlurContrastCommit = useRef(false);

  const selectedObjects = scene.objects.filter(o => selectedIds.has(o.id));
  const singleId = selectedObjects.length === 1 ? selectedObjects[0].id : null;

  const updateObjectLayer = useCallback((objId: string, newLayerId: string) => {
    const newScene = {
      ...scene,
      objects: scene.objects.map(o =>
        o.id === objId ? { ...o, layerId: newLayerId } : o
      ),
    };
    onSceneCommit(newScene);
  }, [scene, onSceneCommit]);

  /** Live preview only: updates brightness/contrast/invert on geometry. Canvas uses ctx.filter; no buffer work, no history. */
  const previewImageSettings = useCallback(
    (objId: string, field: 'brightness' | 'contrast' | 'invert', value: number | boolean) => {
      if (!onSceneChange) return;
      const s = sceneRef.current;
      const newScene = {
        ...s,
        objects: s.objects.map(o => {
          if (o.id !== objId || o.geometry.type !== 'image') return o;
          const geom = o.geometry as ImageGeometry;
          return {
            ...o,
            geometry: { ...geom, [field]: value } as ImageGeometry,
            _bounds: null,
            _worldTransform: null,
          };
        }),
      };
      onSceneChange(newScene);
    },
    [onSceneChange],
  );

  /** Recompute adjusted grayscale from source + current settings; one history entry (dither cleared). */
  const commitImageSettings = useCallback(
    (objId: string, overrides?: Partial<Pick<ImageGeometry, 'brightness' | 'contrast' | 'invert'>>) => {
      const s = sceneRef.current;
      const newScene = {
        ...s,
        objects: s.objects.map(o => {
          if (o.id !== objId || o.geometry.type !== 'image') return o;
          const geom = o.geometry as ImageGeometry;

          if (!geom.grayscaleData || !geom.grayscaleWidth || !geom.grayscaleHeight) return o;

          const newGeom = {
            ...geom,
            brightness: overrides?.brightness ?? geom.brightness ?? 0,
            contrast: overrides?.contrast ?? geom.contrast ?? 0,
            invert: overrides?.invert ?? geom.invert ?? false,
          } as ImageGeometry;

          const src = geom.grayscaleData;
          const adjusted = new Uint8Array(src.length);
          const brightness = newGeom.brightness ?? 0;
          const contrast = newGeom.contrast ?? 0;
          const invert = newGeom.invert ?? false;

          const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

          for (let i = 0; i < src.length; i++) {
            let v = src[i];
            v = Math.max(0, Math.min(255, v + brightness));
            v = Math.max(0, Math.min(255, Math.round(contrastFactor * (v - 128) + 128)));
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
    },
    [onSceneCommit],
  );

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
    return React.createElement('div', {
      style: {
        ...containerStyle,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 120,
      },
    },
      React.createElement('div', {
        style: {
          color: theme.text.tertiary,
          fontSize: theme.font.size.sm,
          textAlign: 'center' as const,
          fontFamily: theme.font.ui,
        },
      }, 'Select an object to see its properties'),
    );
  }

  if (selectedObjects.length > 1) {
    return React.createElement('div', { style: containerStyle },
      React.createElement('div', { style: labelStyle }, 'Selection'),
      React.createElement('div', { style: emptyStateStyle }, `${selectedObjects.length} objects selected`)
    );
  }

  const obj = selectedObjects[0];

  const patchTextGeometry = (updates: Partial<TextGeometry>) => {
    if (obj.geometry.type !== 'text') return;
    const prev = obj.geometry as TextGeometry;
    const newGeom: TextGeometry = { ...prev, ...updates, type: 'text' };
    const newScene = {
      ...scene,
      objects: scene.objects.map(o =>
        o.id === obj.id
          ? { ...o, geometry: newGeom, _bounds: null, _worldTransform: null }
          : o
      ),
    };
    (onSceneChange ?? onSceneCommit)(newScene);
    try {
      window.dispatchEvent(new Event('laserforge-canvas-repaint'));
    } catch { /* ignore */ }
  };

  const bounds = computeObjectBounds(obj);
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;

  const buildWidthScene = (newW: number): Scene | null => {
    if (!Number.isFinite(newW) || newW <= 0) return null;
    const b = computeObjectBounds(obj);
    if (!b) return null;
    const oldW = b.maxX - b.minX;
    if (oldW === 0) return null;
    const scale = newW / (oldW * Math.abs(obj.transform.a || 1));
    return {
      ...scene,
      objects: scene.objects.map(o =>
        o.id === obj.id
          ? { ...o, transform: { ...o.transform, a: o.transform.a * scale }, _bounds: null, _worldTransform: null }
          : o
      ),
    };
  };

  const buildHeightScene = (newH: number): Scene | null => {
    if (!Number.isFinite(newH) || newH <= 0) return null;
    const b = computeObjectBounds(obj);
    if (!b) return null;
    const oldH = b.maxY - b.minY;
    if (oldH === 0) return null;
    const scale = newH / (oldH * Math.abs(obj.transform.d || 1));
    return {
      ...scene,
      objects: scene.objects.map(o =>
        o.id === obj.id
          ? { ...o, transform: { ...o.transform, d: o.transform.d * scale }, _bounds: null, _worldTransform: null }
          : o
      ),
    };
  };

  const buildTxScene = (v: number): Scene => ({
    ...scene,
    objects: scene.objects.map(o =>
      o.id === obj.id
        ? { ...o, transform: { ...o.transform, tx: v }, _bounds: null, _worldTransform: null }
        : o
    ),
  });

  const buildTyScene = (v: number): Scene => ({
    ...scene,
    objects: scene.objects.map(o =>
      o.id === obj.id
        ? { ...o, transform: { ...o.transform, ty: v }, _bounds: null, _worldTransform: null }
        : o
    ),
  });

  return React.createElement('div', { style: containerStyle },
    React.createElement('div', { style: { ...labelStyle, marginBottom: 6, fontWeight: 600, color: theme.text.primary } }, obj.name || obj.type),

    React.createElement('div', { style: rowStyle },
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: labelStyle }, 'X (mm)'),
        React.createElement(NumberInput, {
          value: obj.transform.tx,
          defaultValue: obj.transform.tx,
          style: inputStyle,
          onChange: (v: number) => { onSceneChange?.(buildTxScene(v)); },
          onCommit: (v: number) => { onSceneCommit(buildTxScene(v)); },
        }),
      ),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: labelStyle }, 'Y (mm)'),
        React.createElement(NumberInput, {
          value: obj.transform.ty,
          defaultValue: obj.transform.ty,
          style: inputStyle,
          onChange: (v: number) => { onSceneChange?.(buildTyScene(v)); },
          onCommit: (v: number) => { onSceneCommit(buildTyScene(v)); },
        }),
      ),
    ),

    React.createElement('div', { style: rowStyle },
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: labelStyle }, 'Width'),
        React.createElement(NumberInput, {
          value: w,
          min: 0.01,
          defaultValue: w,
          style: inputStyle,
          onChange: (v: number) => {
            const s = buildWidthScene(v);
            if (s) onSceneChange?.(s);
          },
          onCommit: (v: number) => {
            const s = buildWidthScene(v);
            if (s) onSceneCommit(s);
          },
        }),
      ),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: labelStyle }, 'Height'),
        React.createElement(NumberInput, {
          value: h,
          min: 0.01,
          defaultValue: h,
          style: inputStyle,
          onChange: (v: number) => {
            const s = buildHeightScene(v);
            if (s) onSceneChange?.(s);
          },
          onCommit: (v: number) => {
            const s = buildHeightScene(v);
            if (s) onSceneCommit(s);
          },
        }),
      ),
    ),

    obj.geometry.type === 'rect' && React.createElement('div', {
      style: { marginTop: 8 },
    },
      React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 2 } }, 'Corner Radius (mm)'),
      React.createElement(NumberInput, {
        value: (obj.geometry as RectGeometry).cornerRadius || 0,
        min: 0,
        max: Math.min((obj.geometry as RectGeometry).width / 2, (obj.geometry as RectGeometry).height / 2) || 50,
        defaultValue: 0,
        style: inputStyle,
        onChange: (val: number) => {
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
        onCommit: (val: number) => {
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

    (() => {
      if (!isProUnlocked()) return null;
      const g = obj.geometry;
      const closedPath = g.type === 'path' && (g as PathGeometry).subPaths.some(sp => sp.closed);
      const eligible =
        (g.type === 'polygon' && (g as PolygonGeometry).closed) ||
        g.type === 'rect' ||
        g.type === 'ellipse' ||
        closedPath;
      if (!eligible) return null;
      const groups = geometryToPoints(g);
      const primary = groups.find(gr => gr.closed && gr.points.length > 1);
      if (!primary) return null;
      const maxIdx = Math.max(0, primary.points.length - 1);
      return React.createElement('div', {
        style: { marginTop: 8 },
      },
        React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 2 } }, 'Cut Start Point'),
        React.createElement('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
          React.createElement(NumberInput, {
            value: obj.cutStartIndex ?? 0,
            min: 0,
            max: maxIdx,
            integer: true,
            inputMode: 'numeric',
            defaultValue: 0,
            style: { ...inputStyle, width: 60 },
            onCommit: (val: number) => {
              const newScene = {
                ...scene,
                objects: scene.objects.map(o =>
                  selectedIds.has(o.id) ? { ...o, cutStartIndex: Math.round(val) } : o
                ),
              };
              onSceneCommit(newScene);
            },
          }),
          React.createElement('span', { style: { fontSize: 9, color: '#555570' } },
            `of ${primary.points.length} points`),
        ),
        React.createElement('div', { style: { fontSize: 9, color: '#444460', marginTop: 3 } },
          'Choose which vertex the laser starts from. Helps hide the entry mark.'),
      );
    })(),

    isProUnlocked() && productionMode && React.createElement('div', { style: { marginTop: 8 } },
      React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 2 } }, 'Power Scale %'),
      React.createElement(NumberInput, {
        value: Math.round((obj.powerScale ?? 1) * 100),
        min: 1,
        max: 100,
        integer: true,
        inputMode: 'numeric',
        defaultValue: Math.round((obj.powerScale ?? 1) * 100),
        style: inputStyle,
        onChange: (val: number) => {
          onSceneChange?.({
            ...scene,
            objects: scene.objects.map(o =>
              selectedIds.has(o.id) ? { ...o, powerScale: val / 100 } : o
            ),
          });
        },
        onCommit: (val: number) => {
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

    obj.geometry.type === 'text' && (() => {
      const tg = obj.geometry as TextGeometry;
      const mono = theme.font.mono;
      const font = theme.font.ui;
      const textSectionStyle: React.CSSProperties = {
        padding: '10px 0',
        borderBottom: `1px solid ${theme.border.subtle}`,
      };
      const subLabel: React.CSSProperties = {
        fontSize: 9,
        color: theme.text.tertiary,
        marginBottom: 3,
      };
      const alignBtn = (value: 'left' | 'center' | 'right', label: string, title: string) => {
        const active = (tg.textAlign || 'left') === value;
        return React.createElement('button', {
          key: value,
          type: 'button',
          title,
          onClick: () => patchTextGeometry({ textAlign: value }),
          style: {
            flex: 1,
            padding: '5px',
            fontSize: 11,
            borderRadius: 3,
            cursor: 'pointer',
            fontFamily: font,
            background: active ? 'rgba(0,212,255,0.1)' : theme.bg.base,
            border: active ? `1px solid ${theme.accent.cyan}` : `1px solid ${theme.border.default}`,
            color: active ? theme.accent.cyan : theme.text.tertiary,
          },
        }, label);
      };
      return React.createElement(React.Fragment, { key: 'text-props' },
        React.createElement('div', { style: textSectionStyle },
          React.createElement('div', {
            style: { ...sectionHeaderStyle, marginBottom: 8 },
          }, 'Text'),

          React.createElement('div', { style: { marginBottom: 8 } },
            React.createElement('div', { style: subLabel }, 'Font'),
            React.createElement('select', {
              value: tg.fontFamily || 'Arial',
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                patchTextGeometry({ fontFamily: e.target.value });
              },
              style: { ...selectStyle, fontFamily: font },
            },
              ...(TEXT_FONT_OPTIONS as readonly string[]).includes(tg.fontFamily || 'Arial')
                ? []
                : [React.createElement('option', { key: '__ff', value: tg.fontFamily }, tg.fontFamily || 'Arial')],
              ...TEXT_FONT_OPTIONS.map(f =>
                React.createElement('option', { key: f, value: f, style: { fontFamily: f } }, f),
              ),
            ),
          ),

          React.createElement('div', { style: { marginBottom: 8 } },
            React.createElement('div', { style: subLabel }, 'Size (mm)'),
            React.createElement('input', {
              type: 'number',
              value: tg.fontSize || 10,
              min: 1,
              max: 500,
              step: 1,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                const v = parseFloat(e.target.value);
                patchTextGeometry({ fontSize: Number.isFinite(v) ? v : 10 });
              },
              style: { ...inputStyle, marginBottom: 0 },
            }),
          ),

          React.createElement('div', { style: { display: 'flex', gap: 4, marginBottom: 8 } },
            React.createElement('button', {
              type: 'button',
              onClick: () => patchTextGeometry({ bold: !tg.bold }),
              style: {
                flex: 1,
                padding: '6px',
                fontSize: 12,
                fontWeight: 'bold',
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'serif',
                background: tg.bold ? 'rgba(0,212,255,0.1)' : theme.bg.base,
                border: tg.bold ? `1px solid ${theme.accent.cyan}` : `1px solid ${theme.border.default}`,
                color: tg.bold ? theme.accent.cyan : theme.text.tertiary,
              },
            }, 'B'),
            React.createElement('button', {
              type: 'button',
              onClick: () => patchTextGeometry({ italic: !tg.italic }),
              style: {
                flex: 1,
                padding: '6px',
                fontSize: 12,
                fontStyle: 'italic',
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'serif',
                background: tg.italic ? 'rgba(0,212,255,0.1)' : theme.bg.base,
                border: tg.italic ? `1px solid ${theme.accent.cyan}` : `1px solid ${theme.border.default}`,
                color: tg.italic ? theme.accent.cyan : theme.text.tertiary,
              },
            }, 'I'),
          ),

          React.createElement('div', { style: { marginBottom: 8 } },
            React.createElement('div', { style: subLabel }, 'Align'),
            React.createElement('div', { style: { display: 'flex', gap: 3 } },
              alignBtn('left', 'L', 'Left align'),
              alignBtn('center', 'C', 'Center align'),
              alignBtn('right', 'R', 'Right align'),
            ),
          ),

          React.createElement('div', { style: { marginBottom: 8 } },
            React.createElement('span', { style: subLabel }, 'Letter Spacing'),
            React.createElement('div', { style: { fontSize: 8, color: '#333355', marginBottom: 3 } },
              'Space between each character',
            ),
            React.createElement('div', {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 3,
              },
            },
              React.createElement('span', { style: { fontSize: 9, color: theme.text.tertiary } }, 'Amount'),
              React.createElement('span', { style: { fontSize: 9, color: theme.accent.cyan, fontFamily: mono } },
                `${tg.letterSpacing ?? 0}%`,
              ),
            ),
            React.createElement('input', {
              type: 'range',
              min: -50,
              max: 200,
              step: 5,
              value: tg.letterSpacing ?? 0,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                const v = parseInt(e.target.value, 10);
                patchTextGeometry({ letterSpacing: Number.isFinite(v) ? v : 0 });
              },
              style: { width: '100%', accentColor: theme.accent.cyan },
            }),
            React.createElement('div', {
              style: { display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#333355' },
            },
              React.createElement('span', null, 'Tight'),
              React.createElement('span', null, 'Normal'),
              React.createElement('span', null, 'Wide'),
            ),
          ),

          React.createElement('div', { style: { marginBottom: 8 } },
            React.createElement('span', { style: subLabel }, 'Line Spacing'),
            React.createElement('div', { style: { fontSize: 8, color: '#333355', marginBottom: 3 } },
              'Space between text lines (multi-line)',
            ),
            React.createElement('div', {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 3,
              },
            },
              React.createElement('span', { style: { fontSize: 9, color: theme.text.tertiary } }, 'Amount'),
              React.createElement('span', { style: { fontSize: 9, color: theme.accent.cyan, fontFamily: mono } },
                `${tg.lineSpacing ?? 120}%`,
              ),
            ),
            React.createElement('input', {
              type: 'range',
              min: 50,
              max: 300,
              step: 10,
              value: tg.lineSpacing ?? 120,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                const v = parseInt(e.target.value, 10);
                patchTextGeometry({ lineSpacing: Number.isFinite(v) ? v : 120 });
              },
              style: { width: '100%', accentColor: theme.accent.cyan },
            }),
            React.createElement('div', {
              style: { display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#333355' },
            },
              React.createElement('span', null, 'Tight'),
              React.createElement('span', null, 'Normal'),
              React.createElement('span', null, 'Spacious'),
            ),
          ),

          React.createElement('div', { style: { marginBottom: 8 } },
            React.createElement('span', { style: subLabel }, 'Word Spacing'),
            React.createElement('div', { style: { fontSize: 8, color: '#333355', marginBottom: 3 } },
              'Extra space between words',
            ),
            React.createElement('div', {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 3,
              },
            },
              React.createElement('span', { style: { fontSize: 9, color: theme.text.tertiary } }, 'Amount'),
              React.createElement('span', { style: { fontSize: 9, color: theme.accent.cyan, fontFamily: mono } },
                `${tg.wordSpacing ?? 100}%`,
              ),
            ),
            React.createElement('input', {
              type: 'range',
              min: 50,
              max: 300,
              step: 10,
              value: tg.wordSpacing ?? 100,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                const v = parseInt(e.target.value, 10);
                patchTextGeometry({ wordSpacing: Number.isFinite(v) ? v : 100 });
              },
              style: { width: '100%', accentColor: theme.accent.cyan },
            }),
          ),

          React.createElement('button', {
            type: 'button',
            disabled: true,
            style: {
              width: '100%',
              padding: '6px',
              fontSize: 10,
              borderRadius: 4,
              fontFamily: font,
              background: theme.bg.base,
              border: `1px solid ${theme.border.subtle}`,
              color: '#333355',
              cursor: 'default',
              marginTop: 4,
            },
          }, '↺ Text on Path (coming soon)'),
        ),

        React.createElement('div', {
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
      );
    })(),

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
          previewImageSettings(obj.id, 'brightness', parseInt(e.target.value, 10)),
        onFocus: () => {
          skipBlurBrightnessCommit.current = false;
        },
        onPointerUp: (e: React.PointerEvent<HTMLInputElement>) => {
          skipBlurBrightnessCommit.current = true;
          commitImageSettings(obj.id, { brightness: parseInt(e.currentTarget.value, 10) });
        },
        onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
          if (skipBlurBrightnessCommit.current) {
            skipBlurBrightnessCommit.current = false;
            return;
          }
          commitImageSettings(obj.id, { brightness: parseInt(e.currentTarget.value, 10) });
        },
      }),

      React.createElement('div', { style: labelStyle }, 'Contrast'),
      React.createElement('input', {
        type: 'range',
        min: -100,
        max: 100,
        value: (obj.geometry as ImageGeometry).contrast ?? 0,
        style: { width: '100%', accentColor: theme.accent.cyan, marginBottom: 6 },
        onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
          previewImageSettings(obj.id, 'contrast', parseInt(e.target.value, 10)),
        onFocus: () => {
          skipBlurContrastCommit.current = false;
        },
        onPointerUp: (e: React.PointerEvent<HTMLInputElement>) => {
          skipBlurContrastCommit.current = true;
          commitImageSettings(obj.id, { contrast: parseInt(e.currentTarget.value, 10) });
        },
        onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
          if (skipBlurContrastCommit.current) {
            skipBlurContrastCommit.current = false;
            return;
          }
          commitImageSettings(obj.id, { contrast: parseInt(e.currentTarget.value, 10) });
        },
      }),

      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: (obj.geometry as ImageGeometry).invert ?? false,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            commitImageSettings(obj.id, { invert: e.target.checked }),
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
