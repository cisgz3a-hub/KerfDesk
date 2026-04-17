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
import { createLayer, type LayerMode } from '../../core/scene/Layer';
import { geometryToPoints } from '../../core/job/JobCompiler';
import { computeObjectBounds } from '../../geometry/bounds';
import { ditherImage, getDitherModes, type DitherMode } from '../../import/Dithering';
import type { ImageRasterMode } from '../../core/scene/Layer';
import {
  adjustBrightness,
  adjustContrast,
  adjustGamma,
  invertImage,
} from '../../core/image/ImageProcessing';
import { traceToSceneObjectAsync, DEFAULT_TRACE_OPTIONS } from '../../import/trace';
import { NumberInput } from './NumberInput';
import { isProUnlocked } from './TrialGuard';
import { getActiveProfile } from '../../core/devices/DeviceProfile';
import { computeSmartOverscan } from '../../core/plan/SmartOverscan';
import { BUNDLED_FONTS, type BundledFont } from '../../fonts/fontRegistry';

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
  const skipBlurImageThresholdCommit = useRef(false);

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
    (objId: string, field: 'brightness' | 'contrast' | 'gamma' | 'invert', value: number | boolean) => {
      if (!onSceneChange) return;
      const s = sceneRef.current;
      const target = s.objects.find(o => o.id === objId && o.geometry.type === 'image');
      if (!target) return;
      const newScene = {
        ...s,
        layers: s.layers.map(l => {
          if (l.id !== target.layerId) return l;
          return {
            ...l,
            settings: {
              ...l.settings,
              image: { ...l.settings.image, [field]: value },
            },
          };
        }),
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

  /** Persist image adjustments on the image layer (compile uses layer + original `grayscaleData` only). */
  const commitImageSettings = useCallback(
    (objId: string, overrides?: Partial<Pick<ImageGeometry, 'brightness' | 'contrast' | 'gamma' | 'invert'>>) => {
      const s = sceneRef.current;
      const target = s.objects.find(o => o.id === objId && o.geometry.type === 'image');
      if (!target || target.geometry.type !== 'image') return;
      const geom = target.geometry as ImageGeometry;
      if (!geom.grayscaleData) return;

      const brightness = overrides?.brightness ?? geom.brightness ?? 0;
      const contrast = overrides?.contrast ?? geom.contrast ?? 0;
      const gamma = overrides?.gamma ?? geom.gamma ?? 1;
      const invert = overrides?.invert ?? geom.invert ?? false;

      const newScene = {
        ...s,
        layers: s.layers.map(l => {
          if (l.id !== target.layerId) return l;
          return {
            ...l,
            settings: {
              ...l.settings,
              image: {
                ...l.settings.image,
                brightness,
                contrast,
                gamma,
                invert,
              },
            },
          };
        }),
        objects: s.objects.map(o => {
          if (o.id !== objId || o.geometry.type !== 'image') return o;
          return {
            ...o,
            geometry: {
              ...(o.geometry as ImageGeometry),
              brightness,
              contrast,
              gamma,
              invert,
              adjustedData: undefined,
              ditherMode: undefined,
            } as ImageGeometry,
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
  const [isTracing, setIsTracing] = useState(false);
  const [deleteImageAfterTrace, setDeleteImageAfterTrace] = useState(true);

  const [ditherMode, setDitherMode] = useState<DitherMode>('floyd-steinberg');

  useEffect(() => {
    const o = scene.objects.find(x => selectedIds.has(x.id) && x.geometry.type === 'image');
    if (!o) return;
    const L = scene.layers.find(l => l.id === o.layerId);
    if (L) setDitherMode(L.settings.image.dithering ?? 'floyd-steinberg');
  }, [scene, selectedIds]);

  const handleTrace = useCallback(async (targetMode: 'cut' | 'engrave') => {
    if (selectedObjects.length !== 1) return;
    const obj = selectedObjects[0];
    if (obj.geometry.type !== 'image') return;
    const geom = obj.geometry as ImageGeometry;
    if (!geom.grayscaleData || !geom.grayscaleWidth || !geom.grayscaleHeight) return;

    const pixelCount = (geom.grayscaleWidth ?? 0) * (geom.grayscaleHeight ?? 0);
    const MAX_SAFE_PIXELS = 1_000_000; // ~1 megapixel — traces fast enough not to freeze

    if (pixelCount > MAX_SAFE_PIXELS) {
      const mp = (pixelCount / 1_000_000).toFixed(1);
      const proceed = window.confirm(
        `This image is ${mp} megapixels. Tracing may take a while — the UI stays responsive, but there is no way to cancel mid-trace. ` +
          'For best results, resize the image to under 1 megapixel first.\n\nTrace anyway?',
      );
      if (!proceed) return;
    }

    setIsTracing(true);
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => resolve());
    });

    try {
      // Find existing layer of the chosen mode, or create one.
      let targetLayer = scene.layers.find(l => l.settings.mode === targetMode);
      let layersForCommit = scene.layers;
      if (!targetLayer) {
        const newLayer = createLayer(
          scene.layers.length,
          targetMode as LayerMode,
          targetMode === 'cut' ? 'Cut' : 'Engrave',
        );
        targetLayer = newLayer;
        layersForCommit = [...scene.layers, newLayer];
      }
      const targetLayerId = targetLayer.id;

      const dpi = 96;
      const physW = (geom.originalWidth / dpi) * 25.4;
      const physH = (geom.originalHeight / dpi) * 25.4;
      const scaleX = physW / geom.grayscaleWidth;
      const scaleY = physH / geom.grayscaleHeight;

      const traced = await traceToSceneObjectAsync(
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
        targetLayerId,
        obj.name || 'Image',
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
        layers: layersForCommit,
        activeLayerId: targetLayerId,
        objects: deleteImageAfterTrace
          ? [...scene.objects.filter(o => o.id !== obj.id), finalObj]
          : [...scene.objects, finalObj],
      };
      try {
        onSceneCommit(newScene);
        onSelectionChange?.(new Set([finalObj.id]));
      } catch (err) {
        console.error('[Trace] scene commit failed:', err);
        await showAlert(
          'Trace produced invalid output',
          'The traced paths could not be added to the scene. Try a different threshold or smaller image.',
        );
      }
    } catch (err) {
      console.error('[Trace] failed:', err);
      await showAlert(
        'Trace failed',
        err instanceof Error ? err.message : 'Unknown error during tracing.',
      );
    } finally {
      setIsTracing(false);
    }
  }, [scene, selectedObjects, traceThreshold, traceTurdsize, traceAlphamax, traceInvert, deleteImageAfterTrace, onSceneCommit, onSelectionChange, showAlert]);

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
              value: tg.fontFamily ?? 'Arial',
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                const nextFamily = e.target.value;
                patchTextGeometry({ fontFamily: nextFamily });
              },
              style: { ...selectStyle, fontFamily: font },
            },
              React.createElement('option', { value: 'Arial' }, 'System default (Arial)'),
              React.createElement('option', {
                value: '',
                disabled: true,
                style: { fontStyle: 'italic', color: '#555570' },
              }, '— Bundled —'),
              ...BUNDLED_FONTS.filter((f: BundledFont) => !f.hersheyFamily).map((f: BundledFont) =>
                React.createElement('option', { key: f.family, value: f.family }, f.label),
              ),
              BUNDLED_FONTS.some((f: BundledFont) => !!f.hersheyFamily) && React.createElement('option', {
                value: '',
                disabled: true,
                style: { fontStyle: 'italic', color: '#555570' },
              }, '— Engraving (single-line) —'),
              ...BUNDLED_FONTS.filter((f: BundledFont) => !!f.hersheyFamily).map((f: BundledFont) =>
                React.createElement('option', { key: f.family, value: f.family }, f.label),
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

    obj.geometry.type === 'image' && (() => {
      const imageLayer = scene.layers.find(l => l.id === obj.layerId);
      if (!imageLayer) return null;
      const ims = imageLayer.settings.image;
      const geom = obj.geometry as ImageGeometry;
      const brightVal = ims.brightness ?? geom.brightness ?? 0;
      const contrastVal = ims.contrast ?? geom.contrast ?? 0;
      const gammaVal = ims.gamma ?? geom.gamma ?? 1;
      const invertVal = ims.invert ?? geom.invert ?? false;
      const imageMode: ImageRasterMode = ims.imageMode ?? 'dither';
      const thresholdVal = ims.imageThreshold ?? 128;

      const commitRasterLayer = (patch: Partial<typeof ims>) => {
        const s = sceneRef.current;
        const newScene = {
          ...s,
          layers: s.layers.map(l =>
            l.id === imageLayer.id
              ? { ...l, settings: { ...l.settings, image: { ...l.settings.image, ...patch } } }
              : l,
          ),
          objects: s.objects.map(o =>
            o.id === obj.id && o.geometry.type === 'image'
              ? {
                ...o,
                geometry: {
                  ...(o.geometry as ImageGeometry),
                  adjustedData: undefined,
                  ditherMode: undefined,
                } as ImageGeometry,
                _bounds: null,
                _worldTransform: null,
              }
              : o,
          ),
        };
        onSceneCommit(newScene);
      };

      const buildPreprocessedForDitherPreview = (): Uint8Array | null => {
        const srcData = geom.grayscaleData;
        if (!srcData || !geom.grayscaleWidth || !geom.grayscaleHeight) return null;
        let buf = new Uint8Array(srcData);
        const b = ims.brightness ?? 0;
        const c = ims.contrast ?? 0;
        const g = ims.gamma ?? 1;
        const inv = ims.invert === true;
        if (b !== 0) buf = adjustBrightness(buf, b);
        if (c !== 0) buf = adjustContrast(buf, c);
        if (g !== 1) buf = adjustGamma(buf, g);
        if (inv) buf = invertImage(buf);
        return buf;
      };

      const profileForRaster = getActiveProfile();
      const smartOverscanUiEnabled =
        imageLayer.settings.smartOverscanEnabled ?? profileForRaster?.smartOverscanEnabled ?? true;
      const smartOverscanPreview = computeSmartOverscan({
        scanSpeedMmPerMin: imageLayer.settings.speed,
        maxAccelMmPerS2: profileForRaster?.maxAccelMmPerS2 ?? 1000,
        accelAwarePowerEnabled: imageLayer.settings.accelAwarePower !== false,
      });

      return React.createElement('div', { style: dividerStyle, key: `img-${obj.id}` },
        React.createElement('div', { style: sectionHeaderStyle }, 'Image Processing'),

        React.createElement('div', { style: labelStyle }, 'Image mode'),
        React.createElement('select', {
          value: imageMode,
          style: { ...selectStyle, marginBottom: 8 },
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
            const next = e.target.value as ImageRasterMode;
            const s = sceneRef.current;
            onSceneCommit({
              ...s,
              layers: s.layers.map(l =>
                l.id === imageLayer.id
                  ? { ...l, settings: { ...l.settings, image: { ...l.settings.image, imageMode: next } } }
                  : l,
              ),
              objects: s.objects.map(o =>
                o.id === obj.id && o.geometry.type === 'image'
                  ? {
                    ...o,
                    geometry: {
                      ...(o.geometry as ImageGeometry),
                      adjustedData: undefined,
                      ditherMode: undefined,
                    } as ImageGeometry,
                    _bounds: null,
                    _worldTransform: null,
                  }
                  : o,
              ),
            });
          },
        },
          React.createElement('option', { value: 'dither' }, 'Dither'),
          React.createElement('option', { value: 'grayscale' }, 'Grayscale (variable power)'),
          React.createElement('option', { value: 'threshold' }, 'Threshold (1-bit)'),
        ),

        React.createElement('label', {
          style: {
            ...labelStyle,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 10,
            cursor: 'pointer',
          },
          title:
            'Scales laser power with actual velocity during accel/decel on each scan line. Reduces dark streaks at line ends. Turn off only if results look worse on your machine.',
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: imageLayer.settings.accelAwarePower !== false,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
              const s = sceneRef.current;
              onSceneCommit({
                ...s,
                layers: s.layers.map(l =>
                  l.id === imageLayer.id
                    ? { ...l, settings: { ...l.settings, accelAwarePower: e.target.checked } }
                    : l,
                ),
              });
            },
          }),
          'Acceleration-aware power (recommended)',
        ),

        React.createElement('label', {
          style: {
            ...labelStyle,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 6,
            cursor: 'pointer',
          },
          title:
            'Shifts raster scan lines to compensate for laser on/off latency vs motion. Calibrate speed/offset pairs in Connection → device profile.',
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: imageLayer.settings.useScanOffsets === true,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
              const s = sceneRef.current;
              onSceneCommit({
                ...s,
                layers: s.layers.map(l =>
                  l.id === imageLayer.id
                    ? { ...l, settings: { ...l.settings, useScanOffsets: e.target.checked } }
                    : l,
                ),
              });
            },
          }),
          'Scanning offset correction',
        ),

        React.createElement('label', {
          style: {
            ...labelStyle,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 6,
            cursor: 'pointer',
          },
          title:
            'Compute overscan from scan speed and machine acceleration (device profile). Uses Phase 2.6 accel-aware margin when enabled. Turn off to set a fixed overscan (mm) below.',
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: smartOverscanUiEnabled,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
              const s = sceneRef.current;
              onSceneCommit({
                ...s,
                layers: s.layers.map(l =>
                  l.id === imageLayer.id
                    ? { ...l, settings: { ...l.settings, smartOverscanEnabled: e.target.checked } }
                    : l,
                ),
              });
            },
          }),
          'Smart overscan sizing (recommended)',
        ),

        smartOverscanUiEnabled &&
          React.createElement(
            'div',
            {
              style: {
                fontSize: 10,
                color: theme.accent.green,
                marginTop: 2,
                paddingLeft: 20,
                fontFamily: theme.font.mono,
              },
            },
            `→ ${smartOverscanPreview.overscanMm.toFixed(2)} mm`,
            smartOverscanPreview.clampedByMinimum ? ' (minimum)' : '',
            ' at ',
            String(Math.round(imageLayer.settings.speed)),
            ' mm/min, ',
            String(profileForRaster?.maxAccelMmPerS2 ?? 1000),
            ' mm/s²',
          ),

        !smartOverscanUiEnabled &&
          React.createElement(React.Fragment, null,
            React.createElement('div', { style: { ...labelStyle, marginTop: 6 } }, 'Overscan (mm, fixed)'),
            React.createElement('input', {
              type: 'number',
              min: 0,
              step: 0.1,
              value: imageLayer.settings.fill.overscanning,
              style: { ...selectStyle, marginBottom: 8 },
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                const n = parseFloat(e.target.value);
                if (!Number.isFinite(n) || n < 0) return;
                const s = sceneRef.current;
                onSceneCommit({
                  ...s,
                  layers: s.layers.map(l =>
                    l.id === imageLayer.id
                      ? {
                        ...l,
                        settings: {
                          ...l.settings,
                          fill: { ...l.settings.fill, overscanning: n },
                        },
                      }
                      : l,
                  ),
                });
              },
            }),
          ),

        imageMode === 'dither' && React.createElement(React.Fragment, null,
          React.createElement('div', { style: { ...labelStyle, marginTop: 4 } }, 'Dithering algorithm'),
          React.createElement('select', {
            value: ims.dithering ?? ditherMode,
            style: { ...selectStyle, marginBottom: 8 },
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
              const mode = e.target.value as DitherMode;
              setDitherMode(mode);
              const imgObj = selectedObjects[0];
              if (!imgObj || imgObj.geometry.type !== 'image') return;
              const g = imgObj.geometry as ImageGeometry;
              const pre = buildPreprocessedForDitherPreview();
              if (!pre || !g.grayscaleWidth || !g.grayscaleHeight) return;
              const thr = sceneRef.current.layers.find(l => l.id === imgObj.layerId)?.settings.image.imageThreshold ?? 128;
              const dithered = ditherImage(pre, g.grayscaleWidth, g.grayscaleHeight, mode, thr);
              const s = sceneRef.current;
              onSceneCommit({
                ...s,
                layers: s.layers.map(l =>
                  l.id === imageLayer.id
                    ? { ...l, settings: { ...l.settings, image: { ...l.settings.image, dithering: mode, imageMode: 'dither' } } }
                    : l,
                ),
                objects: s.objects.map(o =>
                  o.id === imgObj.id
                    ? { ...o, geometry: { ...o.geometry, adjustedData: dithered, ditherMode: mode } as ImageGeometry, _bounds: null, _worldTransform: null }
                    : o,
                ),
              });
            },
          },
            ...getDitherModes().map(dm =>
              React.createElement('option', { key: dm.id, value: dm.id }, dm.name),
            ),
          ),
        ),

        imageMode === 'threshold' && React.createElement(React.Fragment, null,
          React.createElement('div', { style: labelStyle }, `Threshold (${thresholdVal})`),
          React.createElement('input', {
            type: 'range',
            min: 0,
            max: 255,
            value: thresholdVal,
            style: { width: '100%', accentColor: theme.accent.cyan, marginBottom: 8 },
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
              const v = parseInt(e.target.value, 10);
              if (!onSceneChange) return;
              const s = sceneRef.current;
              onSceneChange({
                ...s,
                layers: s.layers.map(l =>
                  l.id === imageLayer.id
                    ? { ...l, settings: { ...l.settings, image: { ...l.settings.image, imageThreshold: v } } }
                    : l,
                ),
                objects: s.objects.map(o =>
                  o.id === obj.id && o.geometry.type === 'image'
                    ? {
                      ...o,
                      geometry: {
                        ...(o.geometry as ImageGeometry),
                        adjustedData: undefined,
                        ditherMode: undefined,
                      } as ImageGeometry,
                      _bounds: null,
                      _worldTransform: null,
                    }
                    : o,
                ),
              });
            },
            onFocus: () => { skipBlurImageThresholdCommit.current = false; },
            onPointerUp: (e: React.PointerEvent<HTMLInputElement>) => {
              skipBlurImageThresholdCommit.current = true;
              commitRasterLayer({ imageThreshold: parseInt(e.currentTarget.value, 10) });
            },
            onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
              if (skipBlurImageThresholdCommit.current) {
                skipBlurImageThresholdCommit.current = false;
                return;
              }
              commitRasterLayer({ imageThreshold: parseInt(e.currentTarget.value, 10) });
            },
          }),
        ),

        React.createElement('div', { style: labelStyle }, `Brightness (${brightVal})`),
        React.createElement('input', {
          type: 'range',
          min: -100,
          max: 100,
          value: brightVal,
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

        React.createElement('div', { style: labelStyle }, `Contrast (${contrastVal})`),
        React.createElement('input', {
          type: 'range',
          min: -100,
          max: 100,
          value: contrastVal,
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

        React.createElement('div', { style: labelStyle }, `Gamma (${gammaVal.toFixed(2)})`),
        React.createElement('input', {
          type: 'range',
          min: 0.3,
          max: 3.0,
          step: 0.05,
          value: gammaVal,
          style: { width: '100%', accentColor: theme.accent.cyan, marginBottom: 6 },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            previewImageSettings(obj.id, 'gamma', parseFloat(e.target.value)),
          onBlur: (e: React.FocusEvent<HTMLInputElement>) =>
            commitImageSettings(obj.id, { gamma: parseFloat(e.currentTarget.value) }),
        }),

        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
          React.createElement('input', {
            type: 'checkbox',
            checked: invertVal,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
              commitImageSettings(obj.id, { invert: e.target.checked }),
          }),
          React.createElement('span', { style: { color: theme.text.secondary, fontSize: theme.font.size.sm } }, 'Invert'),
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

          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 } },
            React.createElement('input', {
              type: 'checkbox',
              checked: deleteImageAfterTrace,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDeleteImageAfterTrace(e.target.checked),
            }),
            React.createElement('span', { style: { color: theme.text.secondary, fontSize: theme.font.size.sm } }, 'Delete image after trace'),
          ),

          React.createElement('div', {
            style: { display: 'flex', gap: 6 },
          },
            React.createElement('button', {
              type: 'button',
              onClick: () => { void handleTrace('cut'); },
              disabled: isTracing,
              style: {
                ...traceButtonStyle,
                flex: 1,
                opacity: isTracing ? 0.6 : 1,
                cursor: isTracing ? 'wait' : 'pointer',
              },
            }, isTracing ? '⏳ Tracing...' : 'Trace to Cut'),
            React.createElement('button', {
              type: 'button',
              onClick: () => { void handleTrace('engrave'); },
              disabled: isTracing,
              style: {
                ...traceButtonStyle,
                flex: 1,
                opacity: isTracing ? 0.6 : 1,
                cursor: isTracing ? 'wait' : 'pointer',
              },
            }, isTracing ? '⏳ Tracing...' : 'Trace to Engrave'),
          ),
        ),
      );
    })(),
  );
}
