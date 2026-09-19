import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { describe, expect, it, vi } from 'vitest';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import { applyReveal, buildToolpathObjects, setToolpathTravelVisibility } from './scene-toolpath';
import { disposeChildren } from './scene-furniture';
import { resolveViewer3dTheme } from './viewer3d-theme';

function fixture() {
  const parsed = buildGcodeRenderModel('G21 G90\nG0 X10\nM3 S500\nG1 X110 F600\nG1 Y50');
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const built = buildToolpathObjects({
    three,
    LineMaterial,
    LineSegments2,
    LineSegmentsGeometry,
    segments: parsed.model,
    theme: resolveViewer3dTheme(),
    viewWidth: 800,
    viewHeight: 600,
    travelVisible: true,
  });
  const group = new three.Group();
  group.add(...built.objects);
  return { ...built, group };
}

describe('toolpath progress geometry', () => {
  it('draws only to the current point inside a long move, retaining a faint program context', () => {
    const f = fixture();
    const geometry = f.reveal.solid?.geometry;
    applyReveal(f.reveal, { segmentIndex: 1, point: { x: 35, y: 0, z: 0 } });
    expect(f.reveal.solid?.geometry.instanceCount).toBe(0);
    expect(f.reveal.travel?.geometry.drawRange.count).toBe(2);
    expect(f.reveal.solidGhost?.visible).toBe(true);
    const position = f.reveal.active.geometry.getAttribute('position');
    expect(position.getX(0)).toBe(10);
    expect(position.getX(1)).toBe(35);
    applyReveal(f.reveal, { segmentIndex: 2, point: { x: 110, y: 10, z: 0 } });
    expect(f.reveal.solid?.geometry.instanceCount).toBe(1);
    expect(f.reveal.solid?.geometry).toBe(geometry);
    applyReveal(f.reveal, null);
    expect(f.reveal.solid?.geometry.instanceCount).toBe(2);
    expect(f.reveal.solidGhost?.visible).toBe(false);
    expect(f.reveal.active.visible).toBe(false);
    disposeChildren(f.group);
  });

  it('does not leak a highlighted rapid through the hidden travel toggle', () => {
    const f = fixture();
    applyReveal(f.reveal, { segmentIndex: 0, point: { x: 5, y: 0, z: 0 } });
    expect(f.reveal.active.visible).toBe(true);
    setToolpathTravelVisibility(f.reveal, false);
    expect(f.reveal.active.visible).toBe(false);
    applyReveal(f.reveal, { segmentIndex: 1, point: { x: 25, y: 0, z: 0 } });
    expect(f.reveal.active.visible).toBe(true);
    disposeChildren(f.group);
  });

  it('disposes nested travel buffers and materials with the scene', () => {
    const f = fixture();
    const disposeGeometry = vi.spyOn(f.reveal.travel!.geometry, 'dispose');
    const disposeGhost = vi.spyOn(f.reveal.travelGhost!.material, 'dispose');
    disposeChildren(f.group);
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeGhost).toHaveBeenCalledOnce();
    expect(f.group.children).toHaveLength(0);
  });
});
