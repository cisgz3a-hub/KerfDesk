import React from 'react';

interface MachineControlsProps {
  isAlarm: boolean;
  isRunning: boolean;
  canFrame: boolean;
  isTestFiring: boolean;
  onUnlock: () => void;
  onTestFireBegin: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onTestFireEnd: () => void;
  onFrameDot: () => void;
}

const font = "'DM Sans', system-ui, sans-serif";

export function MachineControls({
  isAlarm,
  isRunning,
  canFrame,
  isTestFiring,
  onUnlock,
  onTestFireBegin,
  onTestFireEnd,
  onFrameDot,
}: MachineControlsProps) {
  const testFireDisabled = isAlarm || isRunning;

  return React.createElement('div', {
    style: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 6, minWidth: 0 },
  },
  isAlarm && React.createElement('button', {
    type: 'button',
    onClick: onUnlock,
    title: 'Clear alarm state (\u0024X)',
    style: {
      width: '100%', padding: '6px', fontSize: 10, fontWeight: 600, borderRadius: 6,
      cursor: 'pointer', fontFamily: font,
      background: 'rgba(255,212,68,0.08)', border: '1px solid rgba(255,212,68,0.3)',
      color: '#ffd444',
    },
  }, '🔓 Unlock'),
  React.createElement('button', {
    type: 'button',
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      onTestFireBegin(e);
    },
    onPointerUp: () => { onTestFireEnd(); },
    onPointerLeave: () => {
      if (isTestFiring) onTestFireEnd();
    },
    onPointerCancel: () => { onTestFireEnd(); },
    disabled: testFireDisabled,
    title: isTestFiring
      ? 'Release to stop laser (deadman)'
      : 'Hold to fire at 2% of machine max S — release to stop',
    style: {
      width: '100%', padding: '7px', fontSize: 11, fontWeight: 600, borderRadius: 6,
      cursor: testFireDisabled ? 'default' : 'pointer', fontFamily: font,
      background: isTestFiring ? 'rgba(255,68,102,0.15)' : 'rgba(255,68,102,0.05)',
      border: isTestFiring ? '1px solid #ff4466' : '1px solid rgba(255,68,102,0.2)',
      color: isTestFiring ? '#ff4466' : '#ff6680',
      opacity: testFireDisabled ? 0.4 : 1,
      animation: isTestFiring ? 'laserforgePulse 1s infinite' : 'none',
      touchAction: 'none',
      userSelect: 'none',
    } as React.CSSProperties,
  }, isTestFiring ? '🔴 FIRING — Release to stop' : '🔥 Test Fire (hold)'),
  React.createElement('button', {
    type: 'button',
    onClick: onFrameDot,
    disabled: !canFrame,
    title: 'Trace outline with low-power laser dot',
    style: {
      width: '100%', padding: '5px', fontSize: 9, borderRadius: 4,
      cursor: canFrame ? 'pointer' : 'default', fontFamily: font,
      background: 'transparent', border: '1px solid #1a1a2e', color: '#555570',
      opacity: canFrame ? 1 : 0.4,
    },
  }, '◉ Frame with Laser Dot'),
  );
}
