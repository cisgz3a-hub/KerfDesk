import React, { useState } from 'react';
import {
  getUserMaterials,
  saveUserMaterial,
  deleteUserMaterial,
  exportUserMaterials,
  importUserMaterials,
  createUserMaterialFromLayer,
  type UserStarterMaterial,
} from '../../core/materials/MaterialPresets';
import { type Scene } from '../../core/scene/Scene';
import { NumberInput } from './NumberInput';

interface MaterialLibraryDialogProps {
  scene: Scene;
  onClose: () => void;
  onMaterialApplied: () => void;
}

export function MaterialLibraryDialog({ scene, onClose, onMaterialApplied }: MaterialLibraryDialogProps) {
  const [materials, setMaterials] = useState<UserStarterMaterial[]>(getUserMaterials());
  const [view, setView] = useState<'list' | 'add'>('list');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add form state
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Wood');
  const [thickness, setThickness] = useState(3);
  const [cutPower, setCutPower] = useState(80);
  const [cutSpeed, setCutSpeed] = useState(300);
  const [cutPasses, setCutPasses] = useState(2);
  const [engravePower, setEngravePower] = useState(30);
  const [engraveSpeed, setEngraveSpeed] = useState(2000);
  const [engravePasses, setEngravePasses] = useState(1);
  const [notes, setNotes] = useState('');

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px',
    background: '#0a0a14', border: '1px solid #252540', borderRadius: 6,
    color: '#e0e0ec', fontSize: 12, outline: 'none', fontFamily: mono,
  };

  const handleExport = () => {
    const json = exportUserMaterials();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laserforge-materials-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setSuccess(`Exported ${materials.length} material${materials.length !== 1 ? 's' : ''}`);
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const count = importUserMaterials(text);
        setMaterials(getUserMaterials());
        setSuccess(`Imported ${count} material${count !== 1 ? 's' : ''}`);
        setError('');
        setTimeout(() => setSuccess(''), 3000);
        onMaterialApplied();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
        setSuccess('');
      }
    };
    input.click();
  };

  const handleSaveNew = () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    const machineType = scene.machine?.type || 'diode';
    const machineWatts = scene.machine?.watts || '10';
    const material = createUserMaterialFromLayer(
      name.trim(),
      category,
      thickness,
      machineType,
      machineWatts,
      { power: cutPower, speed: cutSpeed, passes: cutPasses },
      { power: engravePower, speed: engraveSpeed, passes: engravePasses },
      notes.trim() || undefined,
    );
    saveUserMaterial(material);
    setMaterials(getUserMaterials());
    setView('list');
    setName('');
    setNotes('');
    setError('');
    setSuccess(`Saved "${material.name}"`);
    setTimeout(() => setSuccess(''), 3000);
    onMaterialApplied();
  };

  const handleDelete = (id: string, matName: string) => {
    if (!confirm(`Delete material "${matName}"?`)) return;
    deleteUserMaterial(id);
    setMaterials(getUserMaterials());
    setSuccess(`Deleted "${matName}"`);
    setTimeout(() => setSuccess(''), 2000);
    onMaterialApplied();
  };

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
        width: 540, maxHeight: '85vh', display: 'flex', flexDirection: 'column' as const,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      },
    },
      // Header
      React.createElement('div', {
        style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
      },
        React.createElement('div', null,
          React.createElement('div', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Material Library'),
          React.createElement('div', { style: { color: '#555570', fontSize: 10, marginTop: 2 } },
            view === 'list' ? `${materials.length} custom material${materials.length !== 1 ? 's' : ''}` : 'Add new material',
          ),
        ),
        React.createElement('button', { onClick: onClose, style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' } }, '×'),
      ),

      // Status messages
      (error || success) && React.createElement('div', {
        style: {
          padding: '8px 18px',
          background: error ? 'rgba(255,68,102,0.08)' : 'rgba(45,212,160,0.08)',
          color: error ? '#ff4466' : '#2dd4a0',
          fontSize: 11, borderBottom: '1px solid #1a1a2e',
        },
      }, error || success),

      // Content
      view === 'list' && React.createElement('div', {
        style: { padding: '12px 18px', overflowY: 'auto' as const, flex: 1 },
      },
        materials.length === 0 && React.createElement('div', {
          style: { textAlign: 'center' as const, padding: '40px 20px', color: '#555570', fontSize: 12 },
        },
          React.createElement('div', { style: { fontSize: 32, marginBottom: 12 } }, '📦'),
          React.createElement('div', { style: { marginBottom: 4 } }, 'No custom materials yet'),
          React.createElement('div', { style: { fontSize: 10 } }, 'Save your tested settings to reuse them later'),
        ),
        ...materials.map(mat =>
          React.createElement('div', {
            key: mat.id,
            style: {
              padding: '10px 12px', marginBottom: 6,
              background: '#0a0a14', borderRadius: 6, border: '1px solid #1a1a2e',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            },
          },
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 12, color: '#e0e0ec', fontWeight: 500, marginBottom: 2 } }, mat.name),
              React.createElement('div', { style: { fontSize: 10, color: '#555570' } },
                `${mat.category} • ${mat.thickness}mm`,
                mat.notes && ` • ${mat.notes.slice(0, 30)}${mat.notes.length > 30 ? '...' : ''}`,
              ),
            ),
            React.createElement('button', {
              onClick: () => handleDelete(mat.id, mat.name),
              title: 'Delete',
              style: { background: 'none', border: 'none', color: '#555570', fontSize: 14, cursor: 'pointer', padding: '4px 8px' },
            }, '🗑'),
          ),
        ),
      ),

      // Add form
      view === 'add' && React.createElement('div', {
        style: { padding: '12px 18px', overflowY: 'auto' as const, flex: 1 },
      },
        React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 10 } },
          React.createElement('div', { style: { flex: 2 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Material Name'),
            React.createElement('input', {
              type: 'text', value: name, placeholder: 'e.g. My Walnut 4mm',
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
              style: { ...inputStyle, fontFamily: font },
            }),
          ),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Thickness (mm)'),
            React.createElement(NumberInput, { value: thickness, min: 0.1, max: 50, defaultValue: 3, style: inputStyle, onCommit: setThickness }),
          ),
        ),
        React.createElement('div', { style: { marginBottom: 10 } },
          React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Category'),
          React.createElement('select', {
            value: category,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setCategory(e.target.value),
            style: { ...inputStyle, fontFamily: font },
          },
            ...['Wood', 'Plywood', 'MDF', 'Acrylic', 'Leather', 'Paper & Card', 'Fabric', 'Cork', 'Rubber', 'Stone & Ceramic', 'Custom'].map(cat =>
              React.createElement('option', { key: cat, value: cat }, cat),
            ),
          ),
        ),

        // Cut settings
        React.createElement('div', { style: { marginTop: 12, padding: '10px 12px', background: '#0a0a14', borderRadius: 6, border: '1px solid #1a1a2e' } },
          React.createElement('div', { style: { fontSize: 10, color: '#ff4466', fontWeight: 600, marginBottom: 8 } }, 'CUT SETTINGS'),
          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'Power %'),
              React.createElement(NumberInput, { value: cutPower, min: 0, max: 100, defaultValue: 80, style: inputStyle, onCommit: setCutPower }),
            ),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'Speed mm/min'),
              React.createElement(NumberInput, { value: cutSpeed, min: 1, max: 10000, defaultValue: 300, style: inputStyle, onCommit: setCutSpeed }),
            ),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'Passes'),
              React.createElement(NumberInput, { value: cutPasses, min: 1, max: 20, defaultValue: 2, style: inputStyle, integer: true, onCommit: setCutPasses }),
            ),
          ),
        ),

        // Engrave settings
        React.createElement('div', { style: { marginTop: 8, padding: '10px 12px', background: '#0a0a14', borderRadius: 6, border: '1px solid #1a1a2e' } },
          React.createElement('div', { style: { fontSize: 10, color: '#00d4ff', fontWeight: 600, marginBottom: 8 } }, 'ENGRAVE SETTINGS'),
          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'Power %'),
              React.createElement(NumberInput, { value: engravePower, min: 0, max: 100, defaultValue: 30, style: inputStyle, onCommit: setEngravePower }),
            ),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'Speed mm/min'),
              React.createElement(NumberInput, { value: engraveSpeed, min: 1, max: 10000, defaultValue: 2000, style: inputStyle, onCommit: setEngraveSpeed }),
            ),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'Passes'),
              React.createElement(NumberInput, { value: engravePasses, min: 1, max: 20, defaultValue: 1, style: inputStyle, integer: true, onCommit: setEngravePasses }),
            ),
          ),
        ),

        // Notes
        React.createElement('div', { style: { marginTop: 10 } },
          React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Notes (optional)'),
          React.createElement('textarea', {
            value: notes,
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value),
            placeholder: 'e.g. Use air assist, mask the surface...',
            rows: 2,
            style: { ...inputStyle, fontFamily: font, resize: 'vertical' as const },
          }),
        ),

        React.createElement('div', { style: { fontSize: 9, color: '#444460', marginTop: 8 } },
          `Saved for: ${scene.machine?.type || 'diode'} ${scene.machine?.watts || '10'}W`,
        ),
      ),

      // Footer buttons
      React.createElement('div', {
        style: { padding: '12px 18px', borderTop: '1px solid #1a1a2e', flexShrink: 0, display: 'flex', gap: 6 },
      },
        view === 'list' && React.createElement(React.Fragment, null,
          React.createElement('button', {
            onClick: handleImport,
            style: { padding: '8px 14px', fontSize: 11, background: '#0a0a14', border: '1px solid #252540', borderRadius: 6, color: '#8888aa', cursor: 'pointer', fontFamily: font },
          }, '↓ Import'),
          React.createElement('button', {
            onClick: handleExport,
            disabled: materials.length === 0,
            style: { padding: '8px 14px', fontSize: 11, background: '#0a0a14', border: '1px solid #252540', borderRadius: 6, color: materials.length > 0 ? '#8888aa' : '#333355', cursor: materials.length > 0 ? 'pointer' : 'default', fontFamily: font, opacity: materials.length > 0 ? 1 : 0.5 },
          }, '↑ Export'),
          React.createElement('div', { style: { flex: 1 } }),
          React.createElement('button', {
            onClick: () => setView('add'),
            style: { padding: '8px 16px', fontSize: 12, fontWeight: 600, background: 'rgba(45,212,160,0.1)', border: '1px solid #2dd4a0', borderRadius: 6, color: '#2dd4a0', cursor: 'pointer', fontFamily: font },
          }, '+ Add Material'),
        ),
        view === 'add' && React.createElement(React.Fragment, null,
          React.createElement('button', {
            onClick: () => { setView('list'); setError(''); setName(''); },
            style: { padding: '8px 14px', fontSize: 11, background: '#0a0a14', border: '1px solid #252540', borderRadius: 6, color: '#8888aa', cursor: 'pointer', fontFamily: font },
          }, '← Back'),
          React.createElement('div', { style: { flex: 1 } }),
          React.createElement('button', {
            onClick: handleSaveNew,
            disabled: !name.trim(),
            style: { padding: '8px 18px', fontSize: 12, fontWeight: 600, background: name.trim() ? 'rgba(45,212,160,0.1)' : '#1a1a2e', border: name.trim() ? '1px solid #2dd4a0' : '1px solid #252540', borderRadius: 6, color: name.trim() ? '#2dd4a0' : '#333355', cursor: name.trim() ? 'pointer' : 'default', fontFamily: font },
          }, 'Save Material'),
        ),
      ),
    ),
  );
}
