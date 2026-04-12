import React, { useState, useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject } from '../../core/scene/SceneObject';
import { generateId } from '../../core/types';
import { NumberInput } from './NumberInput';

interface KerfWizardProps {
  scene: Scene;
  selectedIds: ReadonlySet<string>;
  onGenerateTestPiece: (objects: SceneObject[]) => void;
  onApplyKerf: (kerfMm: number, objectIds: string[]) => void;
  onSaveToPreset: (kerfMm: number) => void;
  onClose: () => void;
}

type WizardStep = 'intro' | 'generate' | 'cut' | 'measure' | 'apply';

function btnStyle(active: boolean, color: string = '#00d4ff'): React.CSSProperties {
  const rgb =
    color === '#2dd4a0' ? '45,212,160' :
      color === '#ff4466' ? '255,68,102' :
        '0,212,255';
  return {
    flex: 1, padding: '10px 12px', fontSize: 12, fontWeight: 600,
    borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans', system-ui, sans-serif",
    background: active ? `rgba(${rgb},0.1)` : '#0a0a14',
    border: active ? `1px solid ${color}` : '1px solid #252540',
    color: active ? color : '#555570',
  };
}

export function KerfWizard({
  scene,
  selectedIds,
  onGenerateTestPiece,
  onApplyKerf,
  onSaveToPreset,
  onClose,
}: KerfWizardProps) {
  const [step, setStep] = useState<WizardStep>('intro');
  const [testSize, setTestSize] = useState(30);
  const [measuredOuter, setMeasuredOuter] = useState(30);
  const [measuredInner, setMeasuredInner] = useState(30);
  const [calculatedKerf, setCalculatedKerf] = useState<number | null>(null);
  const [applyMode, setApplyMode] = useState<'outward' | 'inward'>('outward');
  const [savedKerf, setSavedKerf] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('laserforge_kerf');
      return raw ? parseFloat(raw) : 0;
    } catch { return 0; }
  });

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px',
    background: '#0a0a14', border: '1px solid #252540', borderRadius: 5,
    color: '#e0e0ec', fontSize: 12, outline: 'none', fontFamily: mono,
  };

  const handleGenerateTest = useCallback(() => {
    const uid = () => generateId();

    const startX = scene.material
      ? scene.material.x + (scene.material.width - testSize * 2.5) / 2
      : (scene.canvas.width - testSize * 2.5) / 2;
    const startY = scene.material
      ? scene.material.y + (scene.material.height - testSize) / 2
      : (scene.canvas.height - testSize) / 2;

    const layerId = scene.layers[0]?.id ?? '';

    const objects: SceneObject[] = [
      {
        id: uid(),
        type: 'rect',
        name: `Kerf Test Outer (${testSize}mm)`,
        visible: true,
        locked: false,
        layerId,
        parentId: null,
        transform: { a: 1, b: 0, c: 0, d: 1, tx: startX, ty: startY },
        geometry: {
          type: 'rect',
          x: 0,
          y: 0,
          width: testSize,
          height: testSize,
          cornerRadius: 0,
        },
        powerScale: 1,
        _bounds: null,
        _worldTransform: null,
      },
      {
        id: uid(),
        type: 'rect',
        name: `Kerf Test Hole (${testSize}mm)`,
        visible: true,
        locked: false,
        layerId,
        parentId: null,
        transform: { a: 1, b: 0, c: 0, d: 1, tx: startX + testSize * 1.5, ty: startY },
        geometry: {
          type: 'rect',
          x: 0,
          y: 0,
          width: testSize,
          height: testSize,
          cornerRadius: 0,
        },
        powerScale: 1,
        _bounds: null,
        _worldTransform: null,
      },
      {
        id: uid(),
        type: 'text',
        name: 'Kerf Test Label',
        visible: true,
        locked: false,
        layerId,
        parentId: null,
        transform: { a: 1, b: 0, c: 0, d: 1, tx: startX, ty: startY - 5 },
        geometry: {
          type: 'text',
          text: `Kerf Test: ${testSize}mm squares — measure both after cutting`,
          fontSize: 2.5,
          fontFamily: 'sans-serif',
          bold: false,
          italic: false,
        },
        powerScale: 1,
        _bounds: null,
        _worldTransform: null,
      },
    ];

    onGenerateTestPiece(objects);
    setMeasuredOuter(testSize);
    setMeasuredInner(testSize);
    setStep('cut');
  }, [scene, testSize, onGenerateTestPiece]);

  const handleCalculate = useCallback(() => {
    const outerDiff = testSize - measuredOuter;
    const innerDiff = measuredInner - testSize;
    const kerf = (outerDiff + innerDiff) / 2;
    const clampedKerf = Math.max(0, Math.min(2, kerf));
    setCalculatedKerf(Math.round(clampedKerf * 1000) / 1000);
    setStep('apply');
  }, [testSize, measuredOuter, measuredInner]);

  const effectiveKerf = calculatedKerf ?? (savedKerf > 0 ? savedKerf : null);

  const handleApply = useCallback(() => {
    const k = calculatedKerf ?? (savedKerf > 0 ? savedKerf : null);
    if (k === null || k <= 0) return;

    try {
      localStorage.setItem('laserforge_kerf', String(k));
    } catch { /* ignore */ }
    setSavedKerf(k);

    const ids = selectedIds.size > 0
      ? Array.from(selectedIds)
      : scene.objects.filter(o => o.visible && !o.locked).map(o => o.id);

    const halfKerf = k / 2;
    const offset = applyMode === 'outward' ? halfKerf : -halfKerf;

    onApplyKerf(offset, ids);
    onClose();
  }, [calculatedKerf, savedKerf, applyMode, selectedIds, scene, onApplyKerf, onClose]);

  const handleSaveOnly = useCallback(() => {
    const k = calculatedKerf ?? (savedKerf > 0 ? savedKerf : null);
    if (k === null || k <= 0) return;
    try {
      localStorage.setItem('laserforge_kerf', String(k));
    } catch { /* ignore */ }
    setSavedKerf(k);
    onSaveToPreset(k);
    onClose();
  }, [calculatedKerf, savedKerf, onSaveToPreset, onClose]);

  const stepOrder: WizardStep[] = ['intro', 'generate', 'cut', 'measure', 'apply'];
  const stepIdx = stepOrder.indexOf(step);

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 2000, fontFamily: font,
    },
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
  },
    React.createElement('div', {
      style: {
        background: '#12121e', border: '1px solid #252540', borderRadius: 14,
        width: 500, maxHeight: '85vh', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column' as const,
      },
    },
      React.createElement('div', {
        style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
      },
        React.createElement('div', null,
          React.createElement('div', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Kerf & Fit Wizard'),
          React.createElement('div', { style: { color: '#555570', fontSize: 10, marginTop: 2 } },
            savedKerf > 0 ? `Current kerf: ${savedKerf.toFixed(3)}mm` : 'Calibrate your laser\'s cut width',
          ),
        ),
        React.createElement('button', {
          onClick: onClose,
          style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' },
        }, '×'),
      ),

      React.createElement('div', {
        style: { padding: '8px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', gap: 4, flexShrink: 0 },
      },
        ...stepOrder.map((s, i) =>
          React.createElement('div', {
            key: s,
            style: {
              flex: 1, height: 3, borderRadius: 2,
              background: stepIdx >= i ? '#00d4ff' : '#1a1a2e',
              transition: 'background 0.3s',
            },
          }),
        ),
      ),

      React.createElement('div', {
        style: { flex: 1, padding: '20px 18px', overflowY: 'auto' as const },
      },

        step === 'intro' && React.createElement('div', null,
          React.createElement('div', { style: { textAlign: 'center' as const, marginBottom: 20 } },
            React.createElement('div', { style: { fontSize: 36, marginBottom: 8 } }, '📐'),
            React.createElement('h2', { style: { color: '#e0e0ec', fontSize: 16, marginBottom: 8 } }, 'What is kerf?'),
            React.createElement('p', { style: { color: '#8888aa', fontSize: 12, lineHeight: 1.7, maxWidth: 380, margin: '0 auto' } },
              'Kerf is the width of material removed by the laser beam. When you cut a 30mm square, the actual piece will be slightly smaller than 30mm because the laser burns away a thin line of material.',
            ),
          ),

          React.createElement('svg', {
            width: 300, height: 80,
            style: { display: 'block', margin: '0 auto 16px' },
          },
            React.createElement('line', { x1: 50, y1: 40, x2: 250, y2: 40, stroke: '#00d4ff', strokeWidth: 1, strokeDasharray: '4,3' }),
            React.createElement('text', { x: 150, y: 30, textAnchor: 'middle', fill: '#00d4ff', fontSize: 9, fontFamily: mono }, 'Design path'),
            React.createElement('rect', { x: 50, y: 36, width: 200, height: 8, fill: 'rgba(255,68,102,0.2)', stroke: 'none' }),
            React.createElement('text', { x: 150, y: 58, textAnchor: 'middle', fill: '#ff4466', fontSize: 8, fontFamily: mono }, '← kerf width →'),
            React.createElement('line', { x1: 50, y1: 36, x2: 250, y2: 36, stroke: '#2dd4a0', strokeWidth: 1 }),
            React.createElement('line', { x1: 50, y1: 44, x2: 250, y2: 44, stroke: '#2dd4a0', strokeWidth: 1 }),
            React.createElement('text', { x: 275, y: 40, fill: '#2dd4a0', fontSize: 8, fontFamily: mono, dominantBaseline: 'middle' }, 'Cut edges'),
          ),

          React.createElement('p', { style: { color: '#8888aa', fontSize: 11, textAlign: 'center' as const, marginBottom: 16 } },
            'This wizard generates a test piece, measures the kerf, and compensates your designs so parts fit perfectly.',
          ),

          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            savedKerf > 0 && React.createElement('button', {
              type: 'button',
              onClick: () => { setCalculatedKerf(savedKerf); setStep('apply'); },
              style: btnStyle(false),
            }, `Use saved kerf (${savedKerf.toFixed(3)}mm)`),
            React.createElement('button', {
              type: 'button',
              onClick: () => setStep('generate'),
              style: btnStyle(true),
            }, 'Start Kerf Test →'),
          ),
        ),

        step === 'generate' && React.createElement('div', null,
          React.createElement('h3', { style: { color: '#e0e0ec', fontSize: 14, marginBottom: 12 } }, 'Step 1: Generate test piece'),
          React.createElement('p', { style: { color: '#8888aa', fontSize: 12, marginBottom: 16, lineHeight: 1.6 } },
            'We\'ll create two identical squares on your canvas. Cut them both from your target material. Then measure them with calipers.',
          ),

          React.createElement('div', { style: { marginBottom: 16 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 4 } }, 'Test square size (mm)'),
            React.createElement('div', { style: { maxWidth: 120 } },
              React.createElement(NumberInput, { value: testSize, min: 10, max: 100, integer: true, inputMode: 'numeric', defaultValue: 30, style: inputStyle, onCommit: setTestSize }),
            ),
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 4 } }, 'Larger = more accurate measurement. 30mm is recommended.'),
          ),

          React.createElement('svg', {
            width: 280, height: 100,
            style: { display: 'block', margin: '0 auto 16px', background: '#08080f', borderRadius: 8, border: '1px solid #1a1a2e', padding: 10 },
          },
            React.createElement('rect', { x: 30, y: 20, width: 60, height: 60, fill: 'none', stroke: '#00d4ff', strokeWidth: 1.5 }),
            React.createElement('text', { x: 60, y: 55, textAnchor: 'middle', fill: '#00d4ff', fontSize: 9, fontFamily: mono }, `${testSize}mm`),
            React.createElement('text', { x: 60, y: 92, textAnchor: 'middle', fill: '#555570', fontSize: 8 }, 'Outer piece'),
            React.createElement('rect', { x: 140, y: 20, width: 60, height: 60, fill: 'none', stroke: '#ff4466', strokeWidth: 1.5 }),
            React.createElement('rect', { x: 155, y: 35, width: 30, height: 30, fill: 'rgba(255,68,102,0.1)', stroke: '#ff4466', strokeWidth: 1, strokeDasharray: '3,2' }),
            React.createElement('text', { x: 170, y: 55, textAnchor: 'middle', fill: '#ff4466', fontSize: 9, fontFamily: mono }, `${testSize}mm`),
            React.createElement('text', { x: 170, y: 92, textAnchor: 'middle', fill: '#555570', fontSize: 8 }, 'Hole piece'),
          ),

          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('button', {
              type: 'button',
              onClick: () => setStep('intro'),
              style: btnStyle(false),
            }, '← Back'),
            React.createElement('button', {
              type: 'button',
              onClick: handleGenerateTest,
              style: btnStyle(true),
            }, 'Add to Canvas'),
          ),
        ),

        step === 'cut' && React.createElement('div', null,
          React.createElement('div', {
            style: { textAlign: 'center' as const, marginBottom: 20 },
          },
            React.createElement('div', { style: { fontSize: 36, marginBottom: 8 } }, '✓'),
            React.createElement('h3', { style: { color: '#2dd4a0', fontSize: 16, marginBottom: 12 } },
              'Test pieces added to canvas',
            ),
          ),

          React.createElement('div', {
            style: {
              padding: '16px 20px', background: '#08080f',
              borderRadius: 8, border: '1px solid #1a1a2e', marginBottom: 16,
            },
          },
            React.createElement('div', { style: { fontSize: 12, color: '#e0e0ec', fontWeight: 600, marginBottom: 10 } },
              'What to do now:',
            ),
            ...[
              'Close this dialog (or leave it open)',
              'Connect to your laser',
              `Cut the two ${testSize}mm test squares`,
              'Measure both pieces with calipers',
              'Come back here and click the button below',
            ].map((text, i) =>
              React.createElement('div', {
                key: i,
                style: { fontSize: 11, color: '#8888aa', padding: '4px 0', display: 'flex', gap: 8, lineHeight: 1.5 },
              },
                React.createElement('span', { style: { color: '#555570', fontFamily: mono, flexShrink: 0 } }, `${i + 1}.`),
                React.createElement('span', null, text),
              ),
            ),
          ),

          React.createElement('button', {
            type: 'button',
            onClick: () => setStep('measure'),
            style: {
              width: '100%', padding: '14px', fontSize: 13, fontWeight: 600,
              borderRadius: 8, cursor: 'pointer', fontFamily: font,
              background: 'rgba(0,212,255,0.1)', border: '1px solid #00d4ff',
              color: '#00d4ff', marginBottom: 8,
            },
          }, '✂ I\'ve cut and measured them'),

          React.createElement('button', {
            type: 'button',
            onClick: () => setStep('generate'),
            style: {
              width: '100%', padding: '8px', fontSize: 10,
              borderRadius: 6, cursor: 'pointer', fontFamily: font,
              background: 'transparent', border: '1px solid #1a1a2e',
              color: '#555570',
            },
          }, '← Generate different test pieces'),
        ),

        step === 'measure' && React.createElement('div', null,
          React.createElement('h3', { style: { color: '#e0e0ec', fontSize: 14, marginBottom: 8 } }, 'Step 3: Enter measurements'),

          React.createElement('div', {
            style: {
              padding: '8px 12px', marginBottom: 12,
              background: 'rgba(45,212,160,0.06)', border: '1px solid rgba(45,212,160,0.15)', borderRadius: 6,
            },
          },
            React.createElement('div', { style: { fontSize: 11, color: '#2dd4a0' } },
              `✓ Test piece was ${testSize}mm squares`,
            ),
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginTop: 4 } },
              'Measure the cut pieces with calipers and enter the actual dimensions below.',
            ),
          ),

          React.createElement('div', { style: { display: 'flex', gap: 16, marginBottom: 16 } },
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 10, color: '#00d4ff', marginBottom: 4, fontWeight: 600 } }, `Outer square (designed: ${testSize}mm)`),
              React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 4 } }, 'Actual measured width:'),
              React.createElement(NumberInput, {
                value: measuredOuter, min: 0.1, max: 200, defaultValue: testSize,
                style: inputStyle,
                onCommit: setMeasuredOuter,
              }),
              React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 4 } },
                measuredOuter < testSize
                  ? `${(testSize - measuredOuter).toFixed(3)}mm smaller than designed ✓`
                  : measuredOuter > testSize ? 'Larger than designed? Check measurement.' : 'Same as designed',
              ),
            ),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 10, color: '#ff4466', marginBottom: 4, fontWeight: 600 } }, `Inner hole (designed: ${testSize}mm)`),
              React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 4 } }, 'Actual measured width:'),
              React.createElement(NumberInput, {
                value: measuredInner, min: 0.1, max: 200, defaultValue: testSize,
                style: inputStyle,
                onCommit: setMeasuredInner,
              }),
              React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 4 } },
                measuredInner > testSize
                  ? `${(measuredInner - testSize).toFixed(3)}mm larger than designed ✓`
                  : measuredInner < testSize ? 'Smaller than designed? Check measurement.' : 'Same as designed',
              ),
            ),
          ),

          React.createElement('button', {
            type: 'button',
            onClick: () => setStep('cut'),
            style: {
              background: 'none', border: 'none', color: '#555570',
              fontSize: 9, cursor: 'pointer', fontFamily: font,
              padding: 0, marginTop: 8, textDecoration: 'underline' as const,
            },
          }, 'I haven\'t cut the test piece yet — go back'),

          React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 12 } },
            React.createElement('button', {
              type: 'button',
              onClick: () => setStep('cut'),
              style: btnStyle(false),
            }, '← Back'),
            React.createElement('button', { type: 'button', onClick: handleCalculate, style: btnStyle(true, '#2dd4a0') }, 'Calculate Kerf →'),
          ),
        ),

        step === 'apply' && React.createElement('div', null,
          React.createElement('h3', { style: { color: '#e0e0ec', fontSize: 14, marginBottom: 12 } }, 'Step 4: Apply kerf compensation'),

          React.createElement('div', {
            style: {
              padding: '16px 20px', marginBottom: 16,
              background: '#08080f', borderRadius: 10, border: '1px solid #1a1a2e',
              textAlign: 'center' as const,
            },
          },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 4, textTransform: 'uppercase' as const } }, 'Your Laser Kerf'),
            React.createElement('div', { style: { fontSize: 32, color: '#2dd4a0', fontWeight: 700, fontFamily: mono } },
              `${(effectiveKerf ?? 0).toFixed(3)} mm`,
            ),
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginTop: 4 } },
              `Compensation: ±${((effectiveKerf ?? 0) / 2).toFixed(3)} mm per edge`,
            ),
          ),

          React.createElement('div', { style: { marginBottom: 16 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 6 } }, 'Compensation direction:'),
            React.createElement('div', { style: { display: 'flex', gap: 8 } },
              React.createElement('button', {
                type: 'button',
                onClick: () => setApplyMode('outward'),
                style: btnStyle(applyMode === 'outward'),
              }, '↗ Outward (parts bigger)'),
              React.createElement('button', {
                type: 'button',
                onClick: () => setApplyMode('inward'),
                style: btnStyle(applyMode === 'inward'),
              }, '↙ Inward (holes smaller)'),
            ),
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 6, lineHeight: 1.5 } },
              applyMode === 'outward'
                ? 'Outward: expands cut paths so the finished piece matches the designed size. Use for parts that need to be exact.'
                : 'Inward: shrinks cut paths so holes match the designed size. Use for slots, inlays, or parts that need to fit snugly.',
            ),
          ),

          React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 16 } },
            selectedIds.size > 0
              ? `Will apply to ${selectedIds.size} selected object${selectedIds.size !== 1 ? 's' : ''}`
              : 'Will apply to all visible objects (select specific objects to limit scope)',
          ),

          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('button', {
              type: 'button',
              onClick: handleSaveOnly,
              disabled: !effectiveKerf || effectiveKerf <= 0,
              style: { ...btnStyle(false), opacity: !effectiveKerf || effectiveKerf <= 0 ? 0.45 : 1, cursor: !effectiveKerf || effectiveKerf <= 0 ? 'default' : 'pointer' },
            }, 'Save Kerf Only'),
            React.createElement('button', {
              type: 'button',
              onClick: handleApply,
              disabled: !effectiveKerf || effectiveKerf <= 0,
              style: { ...btnStyle(true, '#2dd4a0'), opacity: !effectiveKerf || effectiveKerf <= 0 ? 0.45 : 1, cursor: !effectiveKerf || effectiveKerf <= 0 ? 'default' : 'pointer' },
            }, 'Save & Apply to Design'),
          ),
        ),
      ),
    ),
  );
}
