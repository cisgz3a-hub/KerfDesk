// Every three module the G-code scene needs, loaded in one lazy chunk
// (ADR-102 §3). Type-only imports here are erased at compile time, so three
// itself still loads through the dynamic import() calls below.

import type * as ThreeNamespace from 'three';
import type * as LineMaterialModule from 'three/examples/jsm/lines/LineMaterial.js';
import type * as LineSegments2Module from 'three/examples/jsm/lines/LineSegments2.js';
import type * as LineSegmentsGeometryModule from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type * as CSS2DModule from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { OrbitControlsCtor } from './scene-setup';

export type ThreeModules = {
  readonly three: typeof ThreeNamespace;
  readonly OrbitControls: OrbitControlsCtor;
  readonly LineSegments2: typeof LineSegments2Module.LineSegments2;
  readonly LineSegmentsGeometry: typeof LineSegmentsGeometryModule.LineSegmentsGeometry;
  readonly LineMaterial: typeof LineMaterialModule.LineMaterial;
  readonly CSS2DRenderer: typeof CSS2DModule.CSS2DRenderer;
  readonly CSS2DObject: typeof CSS2DModule.CSS2DObject;
};

export async function loadThree(): Promise<ThreeModules> {
  const three = await import('three');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  const { LineSegments2 } = await import('three/examples/jsm/lines/LineSegments2.js');
  const { LineSegmentsGeometry } = await import('three/examples/jsm/lines/LineSegmentsGeometry.js');
  const { LineMaterial } = await import('three/examples/jsm/lines/LineMaterial.js');
  const { CSS2DRenderer, CSS2DObject } =
    await import('three/examples/jsm/renderers/CSS2DRenderer.js');
  return {
    three,
    OrbitControls,
    LineSegments2,
    LineSegmentsGeometry,
    LineMaterial,
    CSS2DRenderer,
    CSS2DObject,
  };
}
