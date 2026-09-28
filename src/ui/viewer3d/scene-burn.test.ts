import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createBurnView, roundGeometry, type Viewer3dBurn } from './scene-burn';
import { STOCK_MATERIALS } from './scene-stock-materials';

const BURN: Viewer3dBurn = {
  originX: 10,
  originY: 20,
  mmPerCell: 0.5,
  columns: 40,
  rows: 30,
  darkness: new Uint8Array(40 * 30),
  z: 0,
};

type BurnMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

function drawn(scene: THREE.Scene, name: string): BurnMesh {
  const mesh = scene.getObjectByName(name);
  if (!(mesh instanceof THREE.Mesh)) throw new Error(`no ${name}`);
  return mesh as BurnMesh;
}

function compiled(mesh: BurnMesh): { vertexShader: string; fragmentShader: string } {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  mesh.material.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

describe('the laser burn in the 3D view (ADR-487)', () => {
  it('lays a sheet under the burned cells, just below the burn, and takes it away', () => {
    const scene = new THREE.Scene();
    const view = createBurnView(THREE, scene);
    view.set(BURN);
    const sheet = drawn(scene, 'laser-burn-sheet');
    sheet.geometry.computeBoundingBox();
    const box = sheet.geometry.boundingBox;
    expect(box?.min.x).toBeCloseTo(10);
    expect(box?.min.y).toBeCloseTo(20);
    expect(box?.min.z).toBeCloseTo(-0.02);
    expect(box?.max.x).toBeCloseTo(30);
    expect(box?.max.y).toBeCloseTo(35);
    view.set(null);
    expect(scene.getObjectByName('laser-burn-sheet')).toBeUndefined();
    expect(scene.getObjectByName('laser-burn')?.visible).toBe(false);
    view.dispose();
    expect(scene.getObjectByName('laser-burn')).toBeUndefined();
  });

  it('shades each pixel as its material burns, after three sets colour and shine', () => {
    const scene = new THREE.Scene();
    const view = createBurnView(THREE, scene);
    view.set(BURN);
    const { vertexShader, fragmentShader } = compiled(drawn(scene, 'laser-burn-sheet'));
    expect(vertexShader.indexOf('vBurnUv = uv;')).toBeLessThan(
      vertexShader.indexOf('#include <project_vertex>'),
    );
    expect(fragmentShader.indexOf('burnColour(stockColour(vStockPoint)')).toBeGreaterThan(
      fragmentShader.indexOf('#include <color_fragment>'),
    );
    expect(fragmentShader.indexOf('metalnessFactor *= 1.0 - burnHere')).toBeGreaterThan(
      fragmentShader.indexOf('#include <metalnessmap_fragment>'),
    );
    for (let kind = 0; kind < STOCK_MATERIALS.length - 1; kind += 1) {
      expect(fragmentShader).toContain(`stockKind == ${kind}`);
    }
    view.setMaterial({ material: 'laminate' });
    view.setLook('studio');
    expect(drawn(scene, 'laser-burn-sheet').material.metalness).toBe(0);
  });

  it('wraps the burn round a rotary: a closed cylinder along X, facing out, the middle row on top', () => {
    const radius = 25;
    const geometry = roundGeometry(THREE, BURN, 20, 157, radius);
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const index = geometry.getIndex();
    if (index === null) throw new Error('no index');
    const centreY = 20 + 157 / 2;
    const centreZ = -0.02 - radius;
    const at = (vertex: number) =>
      new THREE.Vector3(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
    let top = 0;
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      if (position.getZ(vertex) > position.getZ(top)) top = vertex;
    }
    expect(position.getZ(top)).toBeCloseTo(-0.02, 9);
    expect(uv.getY(top)).toBeCloseTo(0.5, 9);
    for (let face = 0; face < index.count; face += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => at(index.getX(face + k)));
      if (a === undefined || b === undefined || c === undefined) continue;
      const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      const middle = a.clone().add(b).add(c).divideScalar(3);
      const onEnd = Math.abs(a.x - b.x) < 1e-9 && Math.abs(b.x - c.x) < 1e-9;
      const out = onEnd
        ? new THREE.Vector3(a.x > 15 ? 1 : -1, 0, 0)
        : new THREE.Vector3(0, middle.y - centreY, middle.z - centreZ);
      expect(normal.dot(out)).toBeGreaterThan(0);
    }
  });
});
