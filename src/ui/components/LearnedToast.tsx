import React, { useState, useEffect, useRef } from 'react';
import { type MaterialSuggestion } from '../../core/materials/MaterialFeedback';

interface LearnedToastProps {
  suggestion: MaterialSuggestion;
  materialName: string;
  onApply: (power: number, speed: number, passes: number) => void;
  onDismiss: () => void;
}

export function LearnedToast({ suggestion, materialName, onApply, onDismiss }: LearnedToastProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";
  const isLearned = suggestion.confidence > 0;

  const handleDismiss = () => {
    if (autoDismissRef.current) {
      clearTimeout(autoDismissRef.current);
      autoDismissRef.current = null;
    }
    setExiting(true);
    setTimeout(() => onDismiss(), 300);
  };

  const handleApply = () => {
    if (autoDismissRef.current) {
      clearTimeout(autoDismissRef.current);
      autoDismissRef.current = null;
    }
    onApply(suggestion.power, suggestion.speed, suggestion.passes);
    setExiting(true);
    setTimeout(() => onDismiss(), 300);
  };

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    autoDismissRef.current = setTimeout(() => {
      autoDismissRef.current = null;
      handleDismiss();
    }, 8000);
    return () => {
      if (autoDismissRef.current) {
        clearTimeout(autoDismissRef.current);
        autoDismissRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only auto-dismiss
  }, []);

  return React.createElement('div', {
    style: {
      position: 'fixed',
      bottom: visible && !exiting ? 24 : -100,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 3000,
      transition: 'bottom 0.3s ease',
      fontFamily: font,
    },
  },
    React.createElement('div', {
      style: {
        background: '#1a1a2e',
        border: `1px solid ${isLearned ? 'rgba(45,212,160,0.3)' : 'rgba(255,212,68,0.3)'}`,
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        maxWidth: 480,
      },
    },
      React.createElement('div', {
        style: {
          width: 36, height: 36, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, flexShrink: 0,
          background: isLearned ? 'rgba(45,212,160,0.1)' : 'rgba(255,212,68,0.1)',
          border: `1px solid ${isLearned ? 'rgba(45,212,160,0.2)' : 'rgba(255,212,68,0.2)'}`,
        },
      }, isLearned ? '🧠' : '⚡'),

      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', {
          style: { fontSize: 12, fontWeight: 600, color: '#e0e0ec', marginBottom: 2 },
        }, isLearned
          ? `Learned settings for ${materialName}`
          : `Suggested adjustment for ${materialName}`),
        React.createElement('div', {
          style: { fontSize: 11, color: '#8888aa', display: 'flex', gap: 12 },
        },
          React.createElement('span', { style: { fontFamily: mono } },
            `${suggestion.power}%`),
          React.createElement('span', { style: { fontFamily: mono } },
            `${suggestion.speed} mm/min`),
          React.createElement('span', { style: { fontFamily: mono } },
            `${suggestion.passes}×`),
          React.createElement('span', {
            style: { color: isLearned ? '#2dd4a0' : '#ffd444', fontSize: 10 },
          }, isLearned
            ? `${suggestion.confidence}% confident · ${suggestion.sampleCount} jobs`
            : `${suggestion.sampleCount} job${suggestion.sampleCount > 1 ? 's' : ''} tried`),
        ),
      ),

      React.createElement('button', {
        onClick: handleApply,
        style: {
          padding: '6px 14px', fontSize: 11, fontWeight: 600,
          background: isLearned ? 'rgba(45,212,160,0.15)' : 'rgba(255,212,68,0.15)',
          border: `1px solid ${isLearned ? '#2dd4a0' : '#ffd444'}`,
          borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' as const,
          color: isLearned ? '#2dd4a0' : '#ffd444',
          fontFamily: font,
        },
      }, 'Apply'),

      React.createElement('button', {
        onClick: handleDismiss,
        style: {
          background: 'none', border: 'none', color: '#555570',
          fontSize: 16, cursor: 'pointer', padding: '0 4px',
        },
      }, '×'),
    ),
  );
}
