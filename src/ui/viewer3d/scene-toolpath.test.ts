import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { describe, expect, it, vi } from 'vitest';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import {
  applyRecolor,
  applyReveal,
  buildToolpathObjects,
  setToolpathTravelVisibility,
} from './scene-toolpath';
import { disposeChildren } from './scene-furniture';
import { clipObjects } from './scene-isolate';
import { resolveViewer3dTheme } from './viewer3d-theme';

function fixture(visible: Uint8Array | null = null) {
  const parsed = buildGcodeRenderModel('G21 G90\nG0 X10\nM3 S500\nG1 X110 F600\nG1 Y50');
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const built = buildToolpathObjects({
    three,
    LineMaterial,
    LineSegments2,
    LineSegmentsGeometry,
    segments: { ...parsed.model, visible },
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
  it.each([
    { mask: [1, 0, 1], segmentIndex: 1 },
    { mask: [0, 1, 1], segmentIndex: 0 },
    { mask: [0, 0, 0], segmentIndex: 1 },
  ])('keeps a filtered current move hidden for $mask', ({ mask, segmentIndex }) => {
    const f = fixture(new Uint8Array(mask));
    applyReveal(f.reveal, { segmentIndex, point: { x: 35, y: 0, z: 0 } });
    expect(f.reveal.active.object.visible).toBe(false);
    // Travel changes must not override the independent legend mask.
    setToolpathTravelVisibility(f.reveal, false);
    setToolpathTravelVisibility(f.reveal, true);
    expect(f.reveal.active.object.visible).toBe(false);
    disposeChildren(f.group);
  });

  it('retains the visible current move and clips both its strokes with the path', () => {
    const f = fixture(new Uint8Array([0, 1, 0]));
    const planes = [new three.Plane(new three.Vector3(0, 0, 1), 1)];
    clipObjects(f.group, planes);
    applyReveal(f.reveal, { segmentIndex: 1, point: { x: 35, y: 0, z: 0 } });
    expect(f.reveal.active.object.visible).toBe(true);
    for (const material of f.reveal.active.materials) {
      expect(material.clippingPlanes).toBe(planes);
    }
    disposeChildren(f.group);
  });

  it('draws only to the current point inside a long move, retaining a faint program context', () => {
    const f = fixture();
    const geometry = f.reveal.solid?.geometry;
    // Instance i is move i (ADR-485): the done rapid counts, and the shader drops it.
    applyReveal(f.reveal, { segmentIndex: 1, point: { x: 35, y: 0, z: 0 } });
    expect(f.reveal.solid?.geometry.instanceCount).toBe(1);
    expect(f.reveal.travel?.geometry.drawRange.count).toBe(2);
    expect(f.reveal.solidGhost?.visible).toBe(true);
    const drawn = f.reveal.active.positions();
    expect(drawn[0]).toBe(10);
    expect(drawn[3]).toBe(35);
    applyReveal(f.reveal, { segmentIndex: 2, point: { x: 110, y: 10, z: 0 } });
    expect(f.reveal.solid?.geometry.instanceCount).toBe(2);
    expect(f.reveal.solid?.geometry).toBe(geometry);
    applyReveal(f.reveal, null);
    expect(f.reveal.solid?.geometry.instanceCount).toBe(3);
    expect(f.reveal.solidGhost?.visible).toBe(false);
    expect(f.reveal.active.object.visible).toBe(false);
    disposeChildren(f.group);
  });

  it('does not leak a highlighted rapid through the hidden travel toggle', () => {
    const f = fixture();
    applyReveal(f.reveal, { segmentIndex: 0, point: { x: 5, y: 0, z: 0 } });
    expect(f.reveal.active.object.visible).toBe(true);
    setToolpathTravelVisibility(f.reveal, false);
    expect(f.reveal.active.object.visible).toBe(false);
    applyReveal(f.reveal, { segmentIndex: 1, point: { x: 25, y: 0, z: 0 } });
    expect(f.reveal.active.object.visible).toBe(true);
    disposeChildren(f.group);
  });

  it('keeps only the trail bold, fading it, while the ghost shows the rest', () => {
    const f = fixture();
    const trail = f.reveal.solid!.trail;
    applyReveal(f.reveal, { segmentIndex: 2, point: { x: 110, y: 25, z: 0 }, trailFrom: 2 });
    expect(f.reveal.solid?.geometry.instanceCount).toBe(2);
    expect(trail.trailStart.value).toBe(2);
    expect(trail.trailFade.value).toBeGreaterThan(0);
    expect(f.reveal.travel?.geometry.drawRange).toMatchObject({ start: 2, count: 0 });
    expect(f.reveal.solidGhost?.visible).toBe(true);
    applyReveal(f.reveal, { segmentIndex: 2, point: { x: 110, y: 25, z: 0 }, trailFrom: 0 });
    expect(trail.trailStart.value).toBe(0);
    expect(trail.trailFade.value).toBeGreaterThan(0);
    expect(f.reveal.travel?.geometry.drawRange).toMatchObject({ start: 0, count: 2 });
    applyReveal(f.reveal, { segmentIndex: 2, point: { x: 110, y: 25, z: 0 } });
    expect(trail.trailFade.value).toBe(0);
    applyReveal(f.reveal, null);
    expect(trail.trailStart.value).toBe(0);
    expect(f.reveal.solid?.geometry.instanceCount).toBe(3);
    disposeChildren(f.group);
  });

  it('draws the solid moves and their faint copy from one GPU copy of the program (ADR-485)', () => {
    const f = fixture();
    const solid = f.reveal.solid!;
    const start = solid.geometry.getAttribute('instanceStart') as three.InterleavedBufferAttribute;
    expect(start.count).toBe(3);
    const ghost = f.objects.find(
      (object) => object.renderOrder === -1 && 'isLineSegments2' in object,
    ) as LineSegments2 | undefined;
    expect(ghost?.geometry.getAttribute('instanceStart')).toBe(start);
    expect(ghost?.geometry.instanceCount).toBe(3);
    disposeChildren(f.group);
  });

  it('repaints a lens in place, without a new colour buffer (ADR-485)', () => {
    const f = fixture();
    const solid = f.reveal.solid!;
    const colors = solid.colors;
    const version = (solid.colorBuffer as three.InterleavedBuffer).version;
    expect(applyRecolor(f.reveal, () => [1, 0, 0])).toBe(true);
    expect(solid.colors).toBe(colors);
    expect([...colors.subarray(4, 8)]).toEqual([0xffff, 0, 0, 0xffff]);
    expect([...colors.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expect((solid.colorBuffer as three.InterleavedBuffer).version).toBe(version + 1);
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
