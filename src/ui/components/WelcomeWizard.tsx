import React, { useState, useRef, useEffect } from 'react';
import { NumberInput } from './NumberInput';
import { type MachineOriginCorner } from '../../core/devices/DeviceProfile';

export interface WizardResult {
  bedWidth: number;
  bedHeight: number;
  materialType: string;
  materialName: string;
  materialColor: string;
  materialWidth: number;
  materialHeight: number;
  materialThickness: number;
  machineName?: string;
  machineWatts?: string;
  machineType?: string;
  /** Future-proof; only `grbl` is used today. */
  controllerType: 'grbl';
  originCorner: MachineOriginCorner;
  homingEnabled: boolean;
  maxSpindle: number;
  /**
   * Optional machine preset identifier. When set, the wizard handler uses a
   * brand-specific profile factory instead of `createBlankProfile`.
   * Currently Falcon A1 Pro and PRTCNC PRT4040 are recognized.
   */
  machinePresetKey?: 'falcon-a1-pro' | 'prt4040-router-laser';
}

export interface WelcomeWizardProps {
  onComplete: (result: WizardResult) => void;
  onSkip: () => void;
  /** When re-running setup, seed from active profile + scene so users can edit in place. */
  initialBedWidth?: number;
  initialBedHeight?: number;
  initialMaterialType?: string;
  initialMaterialName?: string;
  initialMaterialColor?: string;
  initialMaterialWidth?: number;
  initialMaterialHeight?: number;
  initialMaterialThickness?: number;
  initialMachineName?: string;
  initialMachineWatts?: string;
  initialMachineType?: string;
  initialOriginCorner?: MachineOriginCorner;
  initialHomingEnabled?: boolean;
  initialMaxSpindle?: number;
}

type MachineKind = 'diode' | 'co2' | 'fiber';

function parseMachineKind(t: string | undefined): MachineKind {
  if (t === 'co2' || t === 'fiber' || t === 'diode') return t;
  return 'diode';
}

const MACHINES: {
  name: string;
  icon: string;
  w: number;
  h: number;
  watts: string;
  desc: string;
  type: MachineKind;
  presetKey?: 'falcon-a1-pro' | 'prt4040-router-laser';
}[] = [
  { name: 'Creality Falcon A1 Pro', icon: '🎯', w: 400, h: 400, watts: '20W',
    desc: 'USB connection, autofocus supported', type: 'diode',
    presetKey: 'falcon-a1-pro' },
  { name: 'PRTCNC PRT4040', icon: '4040', w: 400, h: 400, watts: '20/40W',
    desc: 'CNC router laser, manual zero recommended', type: 'diode',
    presetKey: 'prt4040-router-laser' },
  { name: 'Small Diode', icon: '🔹', w: 200, h: 200, watts: '5-10W', desc: 'Atomstack, Ortur, Sculpfun S9', type: 'diode' },
  { name: 'Medium Diode', icon: '🔷', w: 400, h: 400, watts: '10-20W', desc: 'xTool D1 Pro, Sculpfun S30', type: 'diode' },
  { name: 'Large Diode', icon: '🟦', w: 800, h: 400, watts: '20-40W', desc: 'Large format diode laser', type: 'diode' },
  { name: 'Small CO2', icon: '🔴', w: 300, h: 200, watts: '40W', desc: 'K40, OMTech 40W', type: 'co2' },
  { name: 'Medium CO2', icon: '🟠', w: 500, h: 300, watts: '50-60W', desc: 'OMTech 50W, 60W', type: 'co2' },
  { name: 'Large CO2', icon: '🟡', w: 700, h: 500, watts: '80-130W', desc: '80W, 100W, 130W CO2', type: 'co2' },
  { name: 'Fiber Laser', icon: '⚪', w: 110, h: 110, watts: '20-50W', desc: 'Metal marking, MOPA', type: 'fiber' },
];

const MATERIALS = [
  { type: 'wood', name: 'Plywood', color: '#c4a882', icon: '🪵', desc: 'Birch, poplar, basswood' },
  { type: 'wood', name: 'MDF', color: '#b89968', icon: '🟫', desc: 'Medium density fiberboard' },
  { type: 'wood', name: 'Hardwood', color: '#8B6914', icon: '🌳', desc: 'Walnut, cherry, maple' },
  { type: 'acrylic', name: 'Acrylic', color: '#88bbdd', icon: '💎', desc: 'Cast or extruded' },
  { type: 'leather', name: 'Leather', color: '#8B6914', icon: '🟤', desc: 'Vegetable tanned' },
  { type: 'paper', name: 'Cardstock', color: '#e8e0d0', icon: '📄', desc: 'Card, paper, cardboard' },
  { type: 'fabric', name: 'Fabric', color: '#a0a0b0', icon: '🧵', desc: 'Cotton, felt, denim' },
];

const SIZE_PRESETS = [
  { label: 'A4 (297×210)', w: 297, h: 210 },
  { label: 'A5 (210×148)', w: 210, h: 148 },
  { label: '200×200', w: 200, h: 200 },
  { label: '300×200', w: 300, h: 200 },
  { label: '150×100', w: 150, h: 100 },
];

export function WelcomeWizard({
  onComplete,
  onSkip,
  initialBedWidth,
  initialBedHeight,
  initialMaterialType,
  initialMaterialName,
  initialMaterialColor,
  initialMaterialWidth,
  initialMaterialHeight,
  initialMaterialThickness,
  initialMachineName,
  initialMachineWatts,
  initialMachineType,
  initialOriginCorner,
  initialHomingEnabled,
  initialMaxSpindle,
}: WelcomeWizardProps) {
  const bedIw = initialBedWidth ?? 400;
  const bedIh = initialBedHeight ?? 300;
  // Prefer a preset whose NAME also matches the seeded machine name (so a
  // legacy Medium-Diode 400×400 profile doesn't light up the Falcon card,
  // and vice-versa). Fall back to size-only match otherwise.
  const bedPresetMatch =
    MACHINES.find(m => m.w === bedIw && m.h === bedIh && m.name === initialMachineName)
    ?? MACHINES.find(m => m.w === bedIw && m.h === bedIh);

  const [step, setStep] = useState(0);
  const [bedW, setBedW] = useState(bedIw);
  const [bedH, setBedH] = useState(bedIh);
  const [matType, setMatType] = useState(initialMaterialType ?? 'wood');
  const [matName, setMatName] = useState(initialMaterialName ?? 'Plywood');
  const [matColor, setMatColor] = useState(initialMaterialColor ?? '#c4a882');
  const [matW, setMatW] = useState(initialMaterialWidth ?? 200);
  const [matH, setMatH] = useState(initialMaterialHeight ?? 150);
  const [matThick, setMatThick] = useState(initialMaterialThickness ?? 3);
  const [customBed, setCustomBed] = useState(!bedPresetMatch);
  const [machineName, setMachineName] = useState(
    initialMachineName ?? bedPresetMatch?.name ?? 'Custom',
  );
  const [machineWatts, setMachineWatts] = useState(
    initialMachineWatts ?? bedPresetMatch?.watts ?? '',
  );
  const [machineType, setMachineType] = useState<MachineKind>(
    parseMachineKind(initialMachineType ?? bedPresetMatch?.type),
  );
  const [machinePresetKey, setMachinePresetKey] = useState<
    'falcon-a1-pro' | 'prt4040-router-laser' | undefined
  >(
    bedPresetMatch?.presetKey,
  );
  const [originCorner, setOriginCorner] = useState<MachineOriginCorner>(
    initialOriginCorner ?? 'front-left',
  );
  const [homingEnabled, setHomingEnabled] = useState(initialHomingEnabled ?? false);
  const [maxSpindle, setMaxSpindle] = useState(
    initialMaxSpindle === 255 ? 255 : (initialMaxSpindle ?? 1000),
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const font = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
  const mono = "'JetBrains Mono', 'Consolas', monospace";

  // Preview canvas for material step
  useEffect(() => {
    if (step !== 3) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const cw = 400;
    const ch = 160;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, cw, ch);

    const pad = 20;
    const scale = Math.min((cw - pad * 2) / bedW, (ch - pad * 2) / bedH);
    const ox = (cw - bedW * scale) / 2;
    const oy = (ch - bedH * scale) / 2;

    // Bed
    ctx.strokeStyle = '#252540';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, bedW * scale, bedH * scale);

    // Material centered on bed
    const mx = ox + ((bedW - matW) / 2) * scale;
    const my = oy + ((bedH - matH) / 2) * scale;
    ctx.fillStyle = matColor;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(mx, my, matW * scale, matH * scale);
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = matColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(mx, my, matW * scale, matH * scale);
    ctx.globalAlpha = 1;

    // Labels
    ctx.font = '9px ' + mono;
    ctx.fillStyle = matColor;
    ctx.globalAlpha = 0.5;
    ctx.textAlign = 'center';
    ctx.fillText(`${matW}×${matH}mm ${matName}`, mx + matW * scale / 2, my + matH * scale / 2 + 4);
    ctx.fillStyle = '#333355';
    ctx.fillText(`Bed: ${bedW}×${bedH}mm`, ox + bedW * scale / 2, oy + bedH * scale - 6);
    ctx.globalAlpha = 1;
  }, [step, bedW, bedH, matW, matH, matColor, matName]);

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 10px',
    background: '#0a0a14', border: '1px solid #252540', borderRadius: 6,
    color: '#e0e0ec', fontSize: 13, fontFamily: mono, outline: 'none',
    textAlign: 'center' as const,
  };

  const cardStyle = (selected: boolean): React.CSSProperties => ({
    padding: '12px 14px',
    background: selected ? 'rgba(0, 212, 255, 0.08)' : 'rgba(255,255,255,0.02)',
    border: selected ? '1px solid #00d4ff' : '1px solid #252540',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    textAlign: 'center' as const,
    flex: 1,
    minWidth: 100,
  });

  const inputLabel: React.CSSProperties = {
    fontSize: 10,
    color: '#8888aa',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  };

  const pickCardStyle = (selected: boolean): React.CSSProperties => ({
    ...cardStyle(selected),
    flex: 'none',
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 500,
    color: selected ? '#00d4ff' : '#e0e0ec',
  });

  const renderStep = () => {
    switch (step) {
      // Step 0: Welcome
      case 0:
        return React.createElement('div', { style: { textAlign: 'center' as const, padding: '20px 0' } },
          React.createElement('div', { style: { fontSize: 48, marginBottom: 16 } }, '⚡'),
          React.createElement('h2', { style: { color: '#e0e0ec', fontSize: 22, fontWeight: 700, marginBottom: 8 } }, 'Welcome to LaserForge'),
          React.createElement('p', { style: { color: '#8888aa', fontSize: 13, lineHeight: 1.6, maxWidth: 360, margin: '0 auto' } },
            "Let's set up your workspace in a few quick steps. This takes about a minute and makes everything work better for your laser."
          ),
          React.createElement('p', { style: { color: '#555570', fontSize: 11, marginTop: 16 } },
            "You can always change these settings later."
          ),
        );

      // Step 1: Machine
      case 1:
        return React.createElement('div', null,
          React.createElement('h3', { style: { color: '#e0e0ec', fontSize: 16, fontWeight: 600, marginBottom: 4 } }, "What's your laser?"),
          React.createElement('p', { style: { color: '#8888aa', fontSize: 11, marginBottom: 16 } }, "Pick the closest match — this sets your bed size."),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 } },
            ...MACHINES.map(m => {
              const isSelected =
                !customBed
                && bedW === m.w
                && bedH === m.h
                && machineName === m.name;
              return React.createElement('div', {
                key: m.name,
                onClick: () => {
                  setBedW(m.w); setBedH(m.h); setCustomBed(false);
                  setMachineName(m.name); setMachineWatts(m.watts); setMachineType(m.type);
                  setMachinePresetKey(m.presetKey);
                  if (m.presetKey === 'prt4040-router-laser') {
                    setOriginCorner('rear-right');
                    setHomingEnabled(false);
                    setMaxSpindle(1000);
                  } else if (m.presetKey === 'falcon-a1-pro') {
                    setOriginCorner('front-left');
                    setHomingEnabled(true);
                    setMaxSpindle(1000);
                  }
                },
                style: cardStyle(isSelected),
              },
                React.createElement('div', { style: { fontSize: 24, marginBottom: 4 } }, m.icon),
                React.createElement('div', { style: { color: isSelected ? '#00d4ff' : '#e0e0ec', fontSize: 12, fontWeight: 500 } }, m.name),
                React.createElement('div', { style: { color: '#00d4ff', fontSize: 10, fontFamily: mono, marginTop: 2 } }, m.watts),
                React.createElement('div', { style: { color: '#555570', fontSize: 9, marginTop: 2 } }, `${m.w}×${m.h}mm`),
                React.createElement('div', { style: { color: '#444460', fontSize: 8, marginTop: 2 } }, m.desc),
              );
            }),
          ),
          React.createElement('div', {
            onClick: () => { setCustomBed(true); setMachineName('Custom'); setMachineWatts(''); setMachineType('diode'); setMachinePresetKey(undefined); },
            style: { ...cardStyle(customBed), marginTop: 8, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' },
          },
            React.createElement('span', { style: { color: customBed ? '#00d4ff' : '#8888aa', fontSize: 12 } }, 'Custom size:'),
            React.createElement(NumberInput, {
              value: bedW,
              min: 50,
              max: 2000,
              integer: true,
              inputMode: 'numeric',
              defaultValue: bedW,
              onClick: (e: React.MouseEvent<HTMLInputElement>) => { e.stopPropagation(); setCustomBed(true); setMachineName('Custom'); setMachineWatts(''); setMachineType('diode'); setMachinePresetKey(undefined); },
              style: { ...inputStyle, width: 70 },
              onChange: (v: number) => {
                setBedW(v);
                setCustomBed(true);
                setMachineName('Custom');
                setMachineWatts('');
                setMachineType('diode');
                setMachinePresetKey(undefined);
              },
              onCommit: (v: number) => {
                setBedW(v);
                setCustomBed(true);
                setMachineName('Custom');
                setMachineWatts('');
                setMachineType('diode');
                setMachinePresetKey(undefined);
              },
            }),
            React.createElement('span', { style: { color: '#555570' } }, '×'),
            React.createElement(NumberInput, {
              value: bedH,
              min: 50,
              max: 2000,
              integer: true,
              inputMode: 'numeric',
              defaultValue: bedH,
              onClick: (e: React.MouseEvent<HTMLInputElement>) => { e.stopPropagation(); setCustomBed(true); setMachineName('Custom'); setMachineWatts(''); setMachineType('diode'); setMachinePresetKey(undefined); },
              style: { ...inputStyle, width: 70 },
              onChange: (v: number) => {
                setBedH(v);
                setCustomBed(true);
                setMachineName('Custom');
                setMachineWatts('');
                setMachineType('diode');
                setMachinePresetKey(undefined);
              },
              onCommit: (v: number) => {
                setBedH(v);
                setCustomBed(true);
                setMachineName('Custom');
                setMachineWatts('');
                setMachineType('diode');
                setMachinePresetKey(undefined);
              },
            }),
            React.createElement('span', { style: { color: '#555570', fontSize: 11 } }, 'mm'),
          ),
        );

      // Step 2: Machine setup (GRBL-oriented defaults)
      case 2:
        return React.createElement('div', null,
          React.createElement('h3', { style: { color: '#e0e0ec', fontSize: 16, fontWeight: 600, marginBottom: 4 } }, 'Machine setup'),
          React.createElement('p', { style: { color: '#8888aa', fontSize: 11, marginBottom: 16 } },
            "How is your machine configured? If you're not sure, the defaults are safe.",
          ),
          React.createElement('div', { style: { marginBottom: 20 } },
            React.createElement('label', { style: { ...inputLabel, marginBottom: 8, display: 'block' } }, 'Origin corner (machine zero)'),
            React.createElement('div', {
              style: {
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 6,
                maxWidth: 280,
                margin: '0 auto',
                aspectRatio: '1.4 / 1',
              },
            },
              React.createElement('div', {
                onClick: () => setOriginCorner('rear-left'),
                style: pickCardStyle(originCorner === 'rear-left'),
              }, 'Rear-left'),
              React.createElement('div', {
                onClick: () => setOriginCorner('rear-right'),
                style: pickCardStyle(originCorner === 'rear-right'),
              }, 'Rear-right'),
              React.createElement('div', {
                onClick: () => setOriginCorner('front-left'),
                style: pickCardStyle(originCorner === 'front-left'),
              }, 'Front-left'),
              React.createElement('div', {
                onClick: () => setOriginCorner('front-right'),
                style: pickCardStyle(originCorner === 'front-right'),
              }, 'Front-right'),
            ),
            React.createElement('p', { style: { color: '#555570', fontSize: 10, marginTop: 8, textAlign: 'center' } },
              'Most diode lasers use Front-left. CNC routers often use Rear-right.',
            ),
          ),
          React.createElement('div', { style: { marginBottom: 20 } },
            React.createElement('label', { style: { ...inputLabel, marginBottom: 8, display: 'block' } }, 'Auto-home on startup'),
            React.createElement('div', { style: { display: 'flex', gap: 8 } },
              React.createElement('div', {
                onClick: () => setHomingEnabled(false),
                style: { ...pickCardStyle(!homingEnabled), flex: 1 },
              }, 'No'),
              React.createElement('div', {
                onClick: () => setHomingEnabled(true),
                style: { ...pickCardStyle(homingEnabled), flex: 1 },
              }, 'Yes'),
            ),
            React.createElement('p', {
              style: {
                color: homingEnabled ? '#ffaa50' : '#555570',
                fontSize: 10,
                marginTop: 8,
                textAlign: 'center',
              },
            },
              homingEnabled
                ? 'Requires limit switches. Without them, homing can cause GRBL errors.'
                : 'Set origin manually by jogging before each job. Recommended without limit switches.',
            ),
          ),
          React.createElement('div', { style: { marginBottom: 8 } },
            React.createElement('label', { style: { ...inputLabel, marginBottom: 8, display: 'block' } }, 'Max power value (S-max)'),
            React.createElement('div', { style: { display: 'flex', gap: 8 } },
              React.createElement('div', {
                onClick: () => setMaxSpindle(1000),
                style: { ...pickCardStyle(maxSpindle === 1000), flex: 1, fontSize: 10 },
              }, '1000 (modern GRBL 1.1+)'),
              React.createElement('div', {
                onClick: () => setMaxSpindle(255),
                style: { ...pickCardStyle(maxSpindle === 255), flex: 1, fontSize: 10 },
              }, '255 (legacy)'),
            ),
            React.createElement('p', { style: { color: '#555570', fontSize: 10, marginTop: 8, textAlign: 'center' } },
              'GRBL setting $30. Use 1000 unless your controller is older (pre-2018).',
            ),
          ),
        );

      // Step 3: Material
      case 3:
        return React.createElement('div', null,
          React.createElement('h3', { style: { color: '#e0e0ec', fontSize: 16, fontWeight: 600, marginBottom: 4 } }, "What are you cutting?"),
          React.createElement('p', { style: { color: '#8888aa', fontSize: 11, marginBottom: 12 } }, "This sets recommended power and speed. You can skip if you're just exploring."),

          // Material types
          React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 12 } },
            ...MATERIALS.map(m =>
              React.createElement('div', {
                key: m.name,
                onClick: () => { setMatType(m.type); setMatName(m.name); setMatColor(m.color); },
                style: {
                  ...cardStyle(matName === m.name),
                  flex: 'none', width: 'auto', padding: '8px 12px',
                  display: 'flex', alignItems: 'center', gap: 6,
                },
              },
                React.createElement('span', { style: { fontSize: 16 } }, m.icon),
                React.createElement('span', { style: { fontSize: 11, color: matName === m.name ? '#00d4ff' : '#aaa' } }, m.name),
              ),
            ),
          ),

          // Size presets
          React.createElement('div', { style: { display: 'flex', gap: 4, marginBottom: 8 } },
            ...SIZE_PRESETS.map(p =>
              React.createElement('button', {
                key: p.label,
                onClick: () => { setMatW(p.w); setMatH(p.h); },
                style: {
                  padding: '4px 8px', fontSize: 9,
                  background: matW === p.w && matH === p.h ? 'rgba(0,212,255,0.1)' : 'transparent',
                  border: matW === p.w && matH === p.h ? '1px solid #00d4ff' : '1px solid #252540',
                  borderRadius: 4, color: matW === p.w && matH === p.h ? '#00d4ff' : '#555570',
                  cursor: 'pointer', fontFamily: mono,
                },
              }, p.label),
            ),
          ),

          // Size inputs
          React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 10 } },
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 10, color: '#8888aa', marginBottom: 2 } }, 'Width (mm)'),
              React.createElement(NumberInput, {
                value: matW,
                min: 10,
                max: bedW,
                integer: true,
                inputMode: 'numeric',
                defaultValue: matW,
                style: inputStyle,
                onChange: (v: number) => setMatW(v),
                onCommit: (v: number) => setMatW(v),
              }),
            ),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 10, color: '#8888aa', marginBottom: 2 } }, 'Height (mm)'),
              React.createElement(NumberInput, {
                value: matH,
                min: 10,
                max: bedH,
                integer: true,
                inputMode: 'numeric',
                defaultValue: matH,
                style: inputStyle,
                onChange: (v: number) => setMatH(v),
                onCommit: (v: number) => setMatH(v),
              }),
            ),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 10, color: '#8888aa', marginBottom: 2 } }, 'Thickness (mm)'),
              React.createElement(NumberInput, {
                value: matThick,
                min: 0.5,
                max: 30,
                defaultValue: matThick,
                style: inputStyle,
                onChange: (v: number) => setMatThick(v),
                onCommit: (v: number) => setMatThick(v),
              }),
            ),
          ),

          // Preview
          React.createElement('canvas', { ref: canvasRef, style: { width: '100%', height: 160, borderRadius: 8, border: '1px solid #1a1a2e' } }),
        );

      // Step 4: Ready
      case 4:
        return React.createElement('div', { style: { textAlign: 'center' as const, padding: '10px 0' } },
          React.createElement('div', { style: { fontSize: 48, marginBottom: 12 } }, '✅'),
          React.createElement('h2', { style: { color: '#e0e0ec', fontSize: 20, fontWeight: 700, marginBottom: 12 } }, "You're ready!"),
          React.createElement('div', { style: { background: '#0a0a14', borderRadius: 8, padding: 16, textAlign: 'left' as const, maxWidth: 320, margin: '0 auto' } },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
              React.createElement('span', { style: { color: '#8888aa', fontSize: 11 } }, 'Laser'),
              React.createElement('span', { style: { color: '#e0e0ec', fontSize: 11, fontFamily: mono } }, machineName),
            ),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
              React.createElement('span', { style: { color: '#8888aa', fontSize: 11 } }, 'Power'),
              React.createElement('span', { style: { color: '#e0e0ec', fontSize: 11, fontFamily: mono } }, machineWatts || '—'),
            ),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
              React.createElement('span', { style: { color: '#8888aa', fontSize: 11 } }, 'Laser bed'),
              React.createElement('span', { style: { color: '#e0e0ec', fontSize: 11, fontFamily: mono } }, `${bedW} × ${bedH} mm`),
            ),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
              React.createElement('span', { style: { color: '#8888aa', fontSize: 11 } }, 'Origin'),
              React.createElement('span', { style: { color: '#e0e0ec', fontSize: 11, fontFamily: mono } }, originCorner.replace(/-/g, ' ')),
            ),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
              React.createElement('span', { style: { color: '#8888aa', fontSize: 11 } }, 'Auto-home'),
              React.createElement('span', { style: { color: '#e0e0ec', fontSize: 11, fontFamily: mono } }, homingEnabled ? 'Yes' : 'No'),
            ),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
              React.createElement('span', { style: { color: '#8888aa', fontSize: 11 } }, 'S-max'),
              React.createElement('span', { style: { color: '#e0e0ec', fontSize: 11, fontFamily: mono } }, String(maxSpindle)),
            ),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
              React.createElement('span', { style: { color: '#8888aa', fontSize: 11 } }, 'Material'),
              React.createElement('span', { style: { color: matColor, fontSize: 11 } }, matName),
            ),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
              React.createElement('span', { style: { color: '#8888aa', fontSize: 11 } }, 'Material size'),
              React.createElement('span', { style: { color: '#e0e0ec', fontSize: 11, fontFamily: mono } }, `${matW} × ${matH} × ${matThick} mm`),
            ),
          ),
          React.createElement('p', { style: { color: '#555570', fontSize: 11, marginTop: 16 } },
            'Import an SVG, draw shapes, or drag files onto the canvas to get started.'
          ),
        );

      default:
        return null;
    }
  };

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0,
      background: 'rgba(0, 0, 0, 0.85)',
      backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 3000, fontFamily: font,
    },
  },
    React.createElement('div', {
      style: {
        background: '#12121e', border: '1px solid #252540', borderRadius: 16,
        width: 480, maxHeight: '90vh', overflow: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      },
    },
      // Progress bar
      React.createElement('div', {
        style: { padding: '16px 24px 0', display: 'flex', gap: 4 },
      },
        ...[0, 1, 2, 3, 4].map(i =>
          React.createElement('div', {
            key: i,
            style: {
              flex: 1, height: 3, borderRadius: 2,
              background: i <= step ? '#00d4ff' : '#252540',
              transition: 'background 0.3s ease',
            },
          }),
        ),
      ),

      // Step label
      React.createElement('div', {
        style: { padding: '8px 24px 0', fontSize: 10, color: '#555570' },
      }, step === 0 ? '' : `Step ${step} of 4`),

      // Content
      React.createElement('div', {
        style: { padding: '8px 24px 20px' },
      }, renderStep()),

      // Footer
      React.createElement('div', {
        style: {
          padding: '12px 24px 16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderTop: '1px solid #1a1a2e',
        },
      },
        // Left: skip or back
        step === 0
          ? React.createElement('button', {
              onClick: onSkip,
              style: { background: 'none', border: 'none', color: '#555570', fontSize: 11, cursor: 'pointer', fontFamily: font, padding: '6px 0' },
            }, 'Skip setup →')
          : React.createElement('button', {
              onClick: () => setStep(s => s - 1),
              style: { background: 'none', border: '1px solid #252540', borderRadius: 6, color: '#8888aa', fontSize: 12, cursor: 'pointer', fontFamily: font, padding: '7px 14px' },
            }, '← Back'),

        // Right: next or finish
        step < 4
          ? React.createElement('button', {
              onClick: () => setStep(s => s + 1),
              style: {
                padding: '8px 24px', background: 'rgba(0, 212, 255, 0.12)',
                border: '1px solid #00d4ff', borderRadius: 8,
                color: '#00d4ff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: font,
              },
            }, step === 0 ? "Let's go" : 'Next →')
          : React.createElement('button', {
              onClick: () => onComplete({
                bedWidth: bedW,
                bedHeight: bedH,
                materialType: matType,
                materialName: matName,
                materialColor: matColor,
                materialWidth: matW,
                materialHeight: matH,
                materialThickness: matThick,
                machineName: machineName || 'Custom',
                machineWatts: machineWatts || '',
                machineType: machineType || 'diode',
                controllerType: 'grbl',
                originCorner,
                homingEnabled,
                maxSpindle,
                machinePresetKey,
              }),
              style: {
                padding: '8px 28px', background: 'rgba(45, 212, 160, 0.15)',
                border: '1px solid #2dd4a0', borderRadius: 8,
                color: '#2dd4a0', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: font,
              },
            }, 'Start Creating ✨'),
      ),
    ),
  );
}
