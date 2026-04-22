import React, { useMemo, useRef, useState } from 'react';
import {
  emitCalibrationGrid,
  type CalibrationGridOptions,
  type CalibrationGridResult,
} from '../../../core/materials/CalibrationGrid';

type Stage = 'configure' | 'burn' | 'analyze';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onGridEmitted: (result: CalibrationGridResult) => void;
  onPhotoReady?: (
    photoData: ImageData,
    result: CalibrationGridResult,
    roi: { x: number; y: number; width: number; height: number },
  ) => void;
  initialResult?: CalibrationGridResult | null;
  initialStage?: Stage;
  emitGridFn?: (opts: CalibrationGridOptions) => CalibrationGridResult;
}

export function getStageLabel(stage: Stage): string {
  if (stage === 'configure') return 'Configure';
  if (stage === 'burn') return 'Burn';
  return 'Analyze';
}

export function buildCalibrationGridOptions(form: {
  materialName: string;
  scanSpeed: number;
  powerSteps: number;
  powerMin: number;
  powerMax: number;
}): CalibrationGridOptions {
  return {
    materialName: form.materialName.trim(),
    scanSpeed: form.scanSpeed,
    powerSteps: form.powerSteps,
    powerMin: form.powerMin,
    powerMax: form.powerMax,
  };
}

export function CalibrateMaterialDialog({
  isOpen,
  onClose,
  onGridEmitted,
  onPhotoReady,
  initialResult = null,
  initialStage,
  emitGridFn = emitCalibrationGrid,
}: Props) {
  const [materialName, setMaterialName] = useState('Test Material');
  const [scanSpeed, setScanSpeed] = useState(3000);
  const [powerMin, setPowerMin] = useState(5);
  const [powerMax, setPowerMax] = useState(95);
  const [powerSteps, setPowerSteps] = useState(10);
  const [stage, setStage] = useState<Stage>(initialStage ?? (initialResult ? 'burn' : 'configure'));
  const [gridResult, setGridResult] = useState<CalibrationGridResult | null>(initialResult);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [roi, setRoi] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";
  const resultForAnalyze = gridResult ?? initialResult;

  const configureValid = useMemo(() => {
    const nameOk = materialName.trim().length > 0;
    const speedOk = scanSpeed >= 100 && scanSpeed <= 12000;
    const powerOk = powerMin >= 0 && powerMax <= 100 && powerMin < powerMax;
    const stepsOk = powerSteps >= 3 && powerSteps <= 20;
    return nameOk && speedOk && powerOk && stepsOk;
  }, [materialName, scanSpeed, powerMin, powerMax, powerSteps]);

  const analyzeEnabled = photoLoaded
    && resultForAnalyze != null
    && roi != null
    && roi.width >= 50
    && roi.height >= 50;

  if (!isOpen) return null;

  const closeOverlay = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleEmitGrid = () => {
    if (!configureValid) return;
    const opts = buildCalibrationGridOptions({
      materialName,
      scanSpeed,
      powerSteps,
      powerMin,
      powerMax,
    });
    const emitted = emitGridFn(opts);
    setGridResult(emitted);
    onGridEmitted(emitted);
    setStage('burn');
  };

  const drawRoiOverlay = (nextRoi: { x: number; y: number; width: number; height: number } | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.putImageData(snapshot, 0, 0);
    if (!nextRoi) return;
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(nextRoi.x, nextRoi.y, nextRoi.width, nextRoi.height);
    ctx.setLineDash([]);
  };

  const loadPhoto = (file: File) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      setPhotoLoaded(true);
      setPhotoError(null);
      setRoi(null);
      setDragStart(null);
    };
    img.onerror = () => {
      setPhotoError('Failed to load image.');
      setPhotoLoaded(false);
      setRoi(null);
    };
    img.src = URL.createObjectURL(file);
  };

  const onCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!photoLoaded) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, e.currentTarget.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, e.currentTarget.height));
    setDragStart({ x, y });
    setRoi({ x, y, width: 0, height: 0 });
  };

  const onCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragStart || !photoLoaded) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, e.currentTarget.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, e.currentTarget.height));
    const next = {
      x: Math.min(dragStart.x, x),
      y: Math.min(dragStart.y, y),
      width: Math.abs(x - dragStart.x),
      height: Math.abs(y - dragStart.y),
    };
    setRoi(next);
    drawRoiOverlay(next);
  };

  const onCanvasMouseUp = () => {
    setDragStart(null);
  };

  const handleAnalyze = () => {
    if (!analyzeEnabled || !resultForAnalyze || !roi) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    onPhotoReady?.(imageData, resultForAnalyze, roi);
    onClose();
  };

  return React.createElement('div', {
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.8)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2200,
      fontFamily: font,
    },
    onClick: closeOverlay,
  },
  React.createElement('div', {
    style: {
      width: 860,
      maxWidth: '92vw',
      maxHeight: '92vh',
      background: '#12121e',
      border: '1px solid #252540',
      borderRadius: 12,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    },
  },
  React.createElement('div', {
    style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e' },
  },
  React.createElement('div', { style: { fontSize: 16, color: '#e0e0ec', fontWeight: 600 } }, 'Calibrate Material'),
  React.createElement('div', { style: { fontSize: 11, color: '#7e7ea4', marginTop: 2 } }, `Stage: ${getStageLabel(stage)}`),
  ),

  React.createElement('div', {
    style: { padding: 16, overflow: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 },
  },
  stage === 'configure' && React.createElement(React.Fragment, null,
    React.createElement('label', { style: { fontSize: 11, color: '#8888aa' } }, 'Material name'),
    React.createElement('input', {
      value: materialName,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setMaterialName(e.target.value),
      style: {
        background: '#0a0a14', color: '#e0e0ec', border: '1px solid #252540', borderRadius: 6,
        padding: '9px 10px', fontSize: 12, fontFamily: font,
      },
    }),
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } },
      React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#8888aa' } },
        'Scan speed (mm/min)',
        React.createElement('input', {
          type: 'number',
          value: scanSpeed,
          min: 100,
          max: 12000,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setScanSpeed(Number(e.target.value)),
          style: { background: '#0a0a14', color: '#c0c0d0', border: '1px solid #252540', borderRadius: 6, padding: '8px 10px', fontFamily: mono },
        }),
      ),
      React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#8888aa' } },
        'Power steps',
        React.createElement('input', {
          type: 'number',
          value: powerSteps,
          min: 3,
          max: 20,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPowerSteps(Number(e.target.value)),
          style: { background: '#0a0a14', color: '#c0c0d0', border: '1px solid #252540', borderRadius: 6, padding: '8px 10px', fontFamily: mono },
        }),
      ),
      React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#8888aa' } },
        'Power min (%)',
        React.createElement('input', {
          type: 'number',
          value: powerMin,
          min: 0,
          max: 100,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPowerMin(Number(e.target.value)),
          style: { background: '#0a0a14', color: '#c0c0d0', border: '1px solid #252540', borderRadius: 6, padding: '8px 10px', fontFamily: mono },
        }),
      ),
      React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#8888aa' } },
        'Power max (%)',
        React.createElement('input', {
          type: 'number',
          value: powerMax,
          min: 0,
          max: 100,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPowerMax(Number(e.target.value)),
          style: { background: '#0a0a14', color: '#c0c0d0', border: '1px solid #252540', borderRadius: 6, padding: '8px 10px', fontFamily: mono },
        }),
      ),
    ),
    React.createElement('button', {
      type: 'button',
      disabled: !configureValid,
      onClick: handleEmitGrid,
      style: {
        marginTop: 6, padding: '10px 12px', fontSize: 13, borderRadius: 8,
        border: '1px solid #00d4ff', background: 'rgba(0,212,255,0.08)', color: '#00d4ff',
        cursor: configureValid ? 'pointer' : 'default', opacity: configureValid ? 1 : 0.5, fontFamily: font,
      },
    }, 'Emit grid into scene'),
  ),

  stage === 'burn' && React.createElement(React.Fragment, null,
    React.createElement('div', { style: { fontSize: 12, color: '#e0e0ec', lineHeight: 1.5 } },
      '1. Run the job on your machine.',
      React.createElement('br'),
      '2. Photograph the burned grid straight-on with even lighting, fitting the whole grid in frame with a small margin.',
      React.createElement('br'),
      '3. Include a white reference patch near the grid if possible (ignored in Phase 1, used in Phase 4).',
    ),
    React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
      React.createElement('button', {
        type: 'button',
        onClick: () => {
          const ok = globalThis.confirm?.('Going back keeps the emitted grid in the scene. Continue?') ?? true;
          if (ok) setStage('configure');
        },
        style: { padding: '9px 10px', border: '1px solid #252540', borderRadius: 8, background: '#0a0a14', color: '#8888aa', cursor: 'pointer', fontFamily: font },
      }, 'Back'),
      React.createElement('button', {
        type: 'button',
        onClick: () => setStage('analyze'),
        style: { padding: '9px 12px', border: '1px solid #00d4ff', borderRadius: 8, background: 'rgba(0,212,255,0.08)', color: '#00d4ff', cursor: 'pointer', fontFamily: font },
      }, "I've burned the grid - upload photo"),
    ),
  ),

  stage === 'analyze' && React.createElement(React.Fragment, null,
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
      React.createElement('input', {
        type: 'file',
        accept: 'image/jpeg,image/png',
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          if (file) loadPhoto(file);
        },
      }),
      React.createElement('button', {
        type: 'button',
        onClick: () => {
          setPhotoLoaded(false);
          setRoi(null);
          setPhotoError(null);
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        },
        style: { padding: '8px 10px', border: '1px solid #252540', borderRadius: 6, background: '#0a0a14', color: '#8888aa', cursor: 'pointer', fontFamily: font },
      }, 'Re-take photo'),
    ),
    photoError && React.createElement('div', { style: { color: '#ff6b6b', fontSize: 11 } }, photoError),
    React.createElement('div', { style: { border: '1px solid #1a1a2e', borderRadius: 8, overflow: 'auto', maxHeight: '50vh' } },
      React.createElement('canvas', {
        ref: canvasRef,
        width: 640,
        height: 480,
        style: { display: 'block', cursor: photoLoaded ? 'crosshair' : 'default' },
        onMouseDown: onCanvasMouseDown,
        onMouseMove: onCanvasMouseMove,
        onMouseUp: onCanvasMouseUp,
      }),
    ),
    React.createElement('div', { style: { fontSize: 11, color: '#8888aa' } },
      roi
        ? `ROI: x ${Math.round(roi.x)}, y ${Math.round(roi.y)}, w ${Math.round(roi.width)}, h ${Math.round(roi.height)}`
        : 'Draw ROI by click-dragging over the grid area.',
    ),
    React.createElement('button', {
      type: 'button',
      disabled: !analyzeEnabled,
      onClick: handleAnalyze,
      style: {
        alignSelf: 'flex-start',
        padding: '9px 12px',
        border: '1px solid #2dd4a0',
        borderRadius: 8,
        background: 'rgba(45,212,160,0.08)',
        color: '#2dd4a0',
        cursor: analyzeEnabled ? 'pointer' : 'default',
        opacity: analyzeEnabled ? 1 : 0.5,
        fontFamily: font,
      },
    }, 'Analyze'),
  ),
  ),

  React.createElement('div', {
    style: { borderTop: '1px solid #1a1a2e', padding: 12, display: 'flex', justifyContent: 'flex-end' },
  },
  React.createElement('button', {
    type: 'button',
    onClick: onClose,
    style: {
      padding: '8px 12px',
      border: '1px solid #252540',
      borderRadius: 8,
      background: '#0a0a14',
      color: '#8888aa',
      cursor: 'pointer',
      fontFamily: font,
    },
  }, 'Close'),
  ),
  ),
  );
}
