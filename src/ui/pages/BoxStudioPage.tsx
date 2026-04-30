import React, { useCallback, useRef } from 'react';
import type { Scene } from '../../core/scene/Scene';
import type { SceneObject } from '../../core/scene/SceneObject';
import { BoxStudioWorkspace } from '../components/box-library/BoxStudioWorkspace';

interface BoxStudioPageProps {
  scene: Scene;
  onGenerate: (objects: SceneObject[]) => void;
  onBack: () => void;
}

const font = "'DM Sans', system-ui, sans-serif";

export function BoxStudioPage({ scene, onGenerate, onBack }: BoxStudioPageProps) {
  const createCurrentRef = useRef<() => void>(() => {});
  const generateCouponRef = useRef<() => void>(() => {});
  const registerCreate = useCallback((handler: () => void) => {
    createCurrentRef.current = handler;
  }, []);
  const registerGenerateCoupon = useCallback((handler: () => void) => {
    generateCouponRef.current = handler;
  }, []);

  return React.createElement('div', {
    style: {
      height: '100vh',
      width: '100vw',
      display: 'flex',
      flexDirection: 'column' as const,
      background: 'radial-gradient(circle at top left, rgba(0,212,255,0.08), transparent 32%), #0a0a14',
      color: '#e0e0ec',
      fontFamily: font,
      overflow: 'hidden',
    },
  },
    React.createElement('header', {
      style: {
        position: 'sticky' as const,
        top: 0,
        zIndex: 10,
        height: 96,
        boxSizing: 'border-box' as const,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 18,
        padding: '18px 24px',
        borderBottom: '1px solid #1a1a2e',
        background: 'rgba(10,10,20,0.94)',
        backdropFilter: 'blur(12px)',
      },
    },
      React.createElement('div', null,
        React.createElement('div', {
          style: { color: '#e0e0ec', fontSize: 24, fontWeight: 900, letterSpacing: -0.4 },
        }, 'Box Studio'),
        React.createElement('div', {
          style: { color: '#8f8faa', fontSize: 12, marginTop: 5 },
        }, 'Design precise laser-cut boxes with professional presets, visual previews, and fit-aware geometry.'),
      ),
      React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 } },
        headerButton('Back', onBack, 'secondary'),
        headerButton('Generate test coupon', () => generateCouponRef.current(), 'secondary'),
        headerButton('Create box', () => createCurrentRef.current(), 'primary'),
      ),
    ),
    React.createElement(BoxStudioWorkspace, {
      scene,
      onGenerate,
      onRegisterCreate: registerCreate,
      onRegisterGenerateTestCoupon: registerGenerateCoupon,
    }),
  );
}

function headerButton(
  label: string,
  onClick: () => void,
  tone: 'primary' | 'secondary',
): React.ReactNode {
  const primary = tone === 'primary';
  return React.createElement('button', {
    type: 'button',
    onClick,
    style: {
      padding: primary ? '10px 15px' : '9px 13px',
      borderRadius: 10,
      border: primary ? '1px solid #2dd4a0' : '1px solid #252540',
      background: primary ? 'rgba(45,212,160,0.14)' : '#12121e',
      color: primary ? '#2dd4a0' : '#c8c8dc',
      fontSize: 12,
      fontWeight: primary ? 800 : 700,
      cursor: 'pointer',
      fontFamily: font,
    },
  }, label);
}
