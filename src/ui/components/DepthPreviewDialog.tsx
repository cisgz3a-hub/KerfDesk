/**
 * 3D relief preview of engrave layers — heightmap from 2D rasterization, Three.js mesh.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject } from '../../core/scene/SceneObject';
import { computeObjectBounds } from '../../geometry/bounds';
import { geometryToPoints } from '../../core/job/JobCompiler';

interface DepthPreviewDialogProps {
  scene: Scene;
  /** Currently selected preset / material name */
  materialPresetName?: string;
  /** Color from the preset (e.g. '#c4956a' for birch) */
  materialPresetColor?: string;
  onClose: () => void;
}

const MATERIAL_PREVIEW_PRESETS = [
  { label: 'Birch Plywood', color: '#d4b896' },
  { label: 'Baltic Birch', color: '#e0c8a0' },
  { label: 'Walnut', color: '#5c3a1e' },
  { label: 'Cherry', color: '#8b4513' },
  { label: 'Maple', color: '#d2b48c' },
  { label: 'Oak', color: '#b8860b' },
  { label: 'Bamboo', color: '#d4c490' },
  { label: 'MDF', color: '#a08060' },
  { label: 'Poplar', color: '#c8b878' },
  { label: 'Pine', color: '#deb887' },
  { label: 'Cork', color: '#c49a6c' },
  { label: 'Leather (Tan)', color: '#8b6914' },
  { label: 'Leather (Dark)', color: '#3c1e0a' },
  { label: 'Slate', color: '#505560' },
  { label: 'Acrylic (White)', color: '#e8e8f0' },
  { label: 'Acrylic (Black)', color: '#1a1a1a' },
  { label: 'Anodized Aluminum', color: '#2a2a2e' },
  { label: 'Cardboard', color: '#b89a6a' },
] as const;

function resolveInitialMaterialColor(
  materialPresetColor: string | undefined,
  materialPresetName: string | undefined,
): string {
  const hexOk = (c: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
  if (materialPresetColor && hexOk(materialPresetColor)) {
    return materialPresetColor.trim();
  }
  if (!materialPresetName) return '#d4b896';
  const n = materialPresetName.toLowerCase();
  const byLabel = MATERIAL_PREVIEW_PRESETS.find(p =>
    p.label.toLowerCase().includes(n),
  );
  if (byLabel) return byLabel.color;
  const byName = MATERIAL_PREVIEW_PRESETS.find(p =>
    n.includes(p.label.toLowerCase()),
  );
  if (byName) return byName.color;
  const byWord = MATERIAL_PREVIEW_PRESETS.find(p => {
    const first = p.label.toLowerCase().split(/\s+/)[0] ?? '';
    return first.length > 2 && n.includes(first);
  });
  return byWord?.color ?? '#d4b896';
}

const resolution = 256; // Fixed — no need for user control

function boundsValid(b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return Number.isFinite(b.minX) && Number.isFinite(b.maxX) &&
    Number.isFinite(b.minY) && Number.isFinite(b.maxY) &&
    b.maxX > b.minX && b.maxY > b.minY;
}

function imageLocalSizeMm(g: SceneObject['geometry'] & { type: 'image' }): { w: number; h: number } {
  const dpi = 96;
  const w = ((g.cropWidth || g.originalWidth) / dpi) * 25.4;
  const h = ((g.cropHeight || g.originalHeight) / dpi) * 25.4;
  return { w, h };
}

function drawEngraveObject(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  gray: number,
): void {
  const t = obj.transform;
  const style = `rgb(${gray},${gray},${gray})`;
  ctx.save();
  ctx.setTransform(t.a, t.b, t.c, t.d, t.tx, t.ty);
  ctx.fillStyle = style;
  ctx.strokeStyle = style;

  const g = obj.geometry;

  if (g.type === 'text') {
    ctx.font = `${g.bold ? 'bold ' : ''}${g.italic ? 'italic ' : ''}${g.fontSize || 10}px ${g.fontFamily || 'sans-serif'}`;
    ctx.fillText(g.text || '', 0, g.fontSize || 10);
    ctx.restore();
    return;
  }

  if (g.type === 'image') {
    const { w, h } = imageLocalSizeMm(g);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return;
  }

  const groups = geometryToPoints(g);
  for (const group of groups) {
    if (group.points.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(group.points[0].x, group.points[0].y);
    for (let i = 1; i < group.points.length; i++) {
      ctx.lineTo(group.points[i].x, group.points[i].y);
    }
    if (group.closed) {
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.lineWidth = Math.max(0.35, (g.type === 'line' ? 1.2 : 0.8));
      ctx.stroke();
    }
  }
  ctx.restore();
}

function heightDataToDisplacementUint8(heightData: Float32Array): Uint8Array {
  const out = new Uint8Array(heightData.length);
  for (let i = 0; i < heightData.length; i++) {
    out[i] = Math.round(Math.min(1, Math.max(0, heightData[i]!)) * 255);
  }
  return out;
}

function generateNormalMap(heightData: Float32Array, width: number, height: number): THREE.DataTexture {
  const normals = new Uint8Array(width * height * 4);
  const strength = 2.0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const left = heightData[y * width + Math.max(0, x - 1)]!;
      const right = heightData[y * width + Math.min(width - 1, x + 1)]!;
      const up = heightData[Math.max(0, y - 1) * width + x]!;
      const down = heightData[Math.min(height - 1, y + 1) * width + x]!;

      const dx = (left - right) * strength;
      const dy = (up - down) * strength;
      const dz = 1.0;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

      normals[idx * 4 + 0] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
      normals[idx * 4 + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      normals[idx * 4 + 2] = Math.round(((dz / len) * 0.5 + 0.5) * 255);
      normals[idx * 4 + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(normals, width, height, THREE.RGBAFormat);
  tex.flipY = true;
  tex.needsUpdate = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function generateBurnTexture(
  heightData: Float32Array,
  width: number,
  height: number,
  baseColor: THREE.Color,
): THREE.DataTexture {
  const pixels = new Uint8Array(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const depth = heightData[i]!;

    const burnColor = new THREE.Color(baseColor);
    burnColor.multiplyScalar(1 - depth * 0.7);
    burnColor.r = burnColor.r * (1 - depth * 0.3) + depth * 0.15;
    burnColor.g = burnColor.g * (1 - depth * 0.5);
    burnColor.b = burnColor.b * (1 - depth * 0.6);

    pixels[i * 4 + 0] = Math.round(Math.min(255, burnColor.r * 255));
    pixels[i * 4 + 1] = Math.round(Math.min(255, burnColor.g * 255));
    pixels[i * 4 + 2] = Math.round(Math.min(255, burnColor.b * 255));
    pixels[i * 4 + 3] = 255;
  }

  const tex = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  tex.flipY = true;
  tex.needsUpdate = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function generateRoughnessMap(heightData: Float32Array, width: number, height: number): THREE.DataTexture {
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const depth = heightData[i]!;
    pixels[i] = Math.round((0.6 + depth * 0.35) * 255);
  }
  const tex = new THREE.DataTexture(pixels, width, height, THREE.RedFormat);
  tex.flipY = true;
  tex.needsUpdate = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function DepthPreviewDialog({
  scene,
  materialPresetName,
  materialPresetColor,
  onClose,
}: DepthPreviewDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const bgMeshRef = useRef<THREE.Mesh | null>(null);
  const frameIdRef = useRef<number>(0);

  const sphericalRef = useRef({ theta: -0.5, phi: 0.8, radius: 120 });
  const targetSphericalRef = useRef({ theta: -0.5, phi: 0.8, radius: 120 });
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const depthScaleRef = useRef(5);

  const [depthScale, setDepthScale] = useState(5);
  const [viewAngle, setViewAngle] = useState<'angle' | 'front' | 'top'>('angle');
  const [materialColor, setMaterialColor] = useState(() =>
    resolveInitialMaterialColor(materialPresetColor, materialPresetName),
  );
  const [isDragging, setIsDragging] = useState(false);

  depthScaleRef.current = depthScale;

  const font = "'DM Sans', system-ui, sans-serif";

  const generateHeightmap = useCallback((): {
    data: Float32Array;
    width: number;
    height: number;
    worldWidth: number;
    worldHeight: number;
  } | null => {
    const engraveLayers = scene.layers.filter(l => l.visible && l.settings.mode === 'engrave');
    if (engraveLayers.length === 0) return null;

    const engraveLayerIds = new Set(engraveLayers.map(l => l.id));
    const engraveObjects = scene.objects.filter(o =>
      o.visible && !o.locked && engraveLayerIds.has(o.layerId),
    );
    if (engraveObjects.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of engraveObjects) {
      const b = computeObjectBounds(obj);
      if (!boundsValid(b)) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    if (!Number.isFinite(minX)) return null;

    const worldWidth = maxX - minX;
    const worldHeight = maxY - minY;
    if (worldWidth <= 0 || worldHeight <= 0) return null;

    const res = resolution;
    const canvas = document.createElement('canvas');
    canvas.width = res;
    canvas.height = res;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, res, res);

    const scaleX = res / worldWidth;
    const scaleY = res / worldHeight;

    ctx.save();
    ctx.scale(scaleX, scaleY);
    ctx.translate(-minX, -minY);

    ctx.globalCompositeOperation = 'darken';
    for (const obj of engraveObjects) {
      const layer = engraveLayers.find(l => l.id === obj.layerId);
      const power = layer?.settings.power.max ?? 100;
      const passes = layer?.settings.passes ?? 1;
      const intensity = Math.min(1, (power / 100) * Math.sqrt(passes));
      const gray = Math.round(255 * (1 - intensity));

      drawEngraveObject(ctx, obj, gray);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    const imageData = ctx.getImageData(0, 0, res, res);
    const heightData = new Float32Array(res * res);

    for (let i = 0; i < res * res; i++) {
      const r = imageData.data[i * 4];
      const g = imageData.data[i * 4 + 1];
      const b = imageData.data[i * 4 + 2];
      const brightness = (r + g + b) / (3 * 255);
      heightData[i] = 1 - brightness;
    }

    return { data: heightData, width: res, height: res, worldWidth, worldHeight };
  }, [scene]);

  const hasEngraveObjects = useMemo(
    () =>
      scene.layers.some(l => l.visible && l.settings.mode === 'engrave') &&
      scene.objects.some(o => {
        const layer = scene.layers.find(l => l.id === o.layerId);
        return o.visible && !o.locked && layer?.visible && layer?.settings.mode === 'engrave';
      }),
    [scene],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    setIsDragging(true);
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };

    const t = targetSphericalRef.current;
    t.theta -= dx * 0.005;
    t.phi = Math.max(0.01, Math.min(Math.PI * 0.45, t.phi - dy * 0.005));
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  const setView = useCallback((view: 'angle' | 'front' | 'top') => {
    const t = targetSphericalRef.current;
    switch (view) {
      case 'angle':
        t.theta = -0.5;
        t.phi = 0.8;
        t.radius = 120;
        break;
      case 'front':
        t.theta = 0;
        t.phi = Math.PI * 0.45;
        t.radius = 140;
        break;
      case 'top':
        t.theta = 0;
        t.phi = 0.01;
        t.radius = 100;
        break;
    }
    setViewAngle(view);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasEngraveObjects) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = targetSphericalRef.current;
      t.radius = Math.max(40, Math.min(300, t.radius + e.deltaY * 0.2));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasEngraveObjects]);

  useEffect(() => {
    if (!containerRef.current || !hasEngraveObjects) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const s0 = sphericalRef.current;
    const t0 = targetSphericalRef.current;
    s0.theta = t0.theta;
    s0.phi = t0.phi;
    s0.radius = t0.radius;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a14, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const root = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    camera.up.set(0, -1, 0);
    cameraRef.current = camera;

    const hemiLight = new THREE.HemisphereLight(0xc0d0e0, 0x806040, 0.6);
    root.add(hemiLight);

    const mainLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
    mainLight.position.set(40, -30, 60);
    root.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xc0d0e0, 0.4);
    fillLight.position.set(-30, 20, 40);
    root.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.2);
    rimLight.position.set(-10, 40, -20);
    root.add(rimLight);

    const bgGeo = new THREE.PlaneGeometry(500, 500);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x12121e, side: THREE.BackSide });
    const bgMesh = new THREE.Mesh(bgGeo, bgMat);
    bgMesh.position.z = -35;
    root.add(bgMesh);
    bgMeshRef.current = bgMesh;

    const heightmap = generateHeightmap();
    const dispScale = depthScaleRef.current;

    if (heightmap) {
      const { data, width: hmW, height: hmH, worldWidth, worldHeight } = heightmap;
      const aspect = worldWidth / worldHeight;
      const planeWidth = 60 * (aspect >= 1 ? 1 : aspect);
      const planeHeight = 60 * (aspect >= 1 ? 1 / aspect : 1);

      const heightUint8 = heightDataToDisplacementUint8(data);
      const heightTexture = new THREE.DataTexture(heightUint8, hmW, hmH, THREE.RedFormat);
      heightTexture.flipY = true;
      heightTexture.needsUpdate = true;
      heightTexture.wrapS = THREE.ClampToEdgeWrapping;
      heightTexture.wrapT = THREE.ClampToEdgeWrapping;

      const normalTex = generateNormalMap(data, hmW, hmH);

      const baseCol = new THREE.Color(materialColor);
      const burnTex = generateBurnTexture(data, hmW, hmH, baseCol);

      const roughTex = generateRoughnessMap(data, hmW, hmH);

      const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, hmW - 1, hmH - 1);

      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xffffff),
        roughness: 0.85,
        metalness: 0,
        map: burnTex,
        displacementMap: heightTexture,
        displacementScale: -dispScale,
        displacementBias: 0,
        normalMap: normalTex,
        normalScale: new THREE.Vector2(1.0, 1.0),
        roughnessMap: roughTex,
        flatShading: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      root.add(mesh);
      meshRef.current = mesh;
    }

    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      const cam = cameraRef.current;
      if (!cam) return;

      const s = sphericalRef.current;
      const t = targetSphericalRef.current;
      s.theta += (t.theta - s.theta) * 0.08;
      s.phi += (t.phi - s.phi) * 0.08;
      s.radius += (t.radius - s.radius) * 0.08;

      const ds = depthScaleRef.current;
      cam.position.set(
        s.radius * Math.sin(s.phi) * Math.cos(s.theta),
        s.radius * Math.sin(s.phi) * Math.sin(s.theta),
        s.radius * Math.cos(s.phi),
      );
      cam.lookAt(0, 0, -ds * 0.3);
      cam.up.set(0, -1, 0);

      renderer.render(root, cam);
    };
    animate();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameIdRef.current);

      const m = meshRef.current;
      meshRef.current = null;
      if (m) {
        const mat = m.material as THREE.MeshStandardMaterial;
        for (const tex of [mat.map, mat.displacementMap, mat.normalMap, mat.roughnessMap]) {
          tex?.dispose();
        }
        mat.dispose();
        m.geometry?.dispose();
        root.remove(m);
      }

      const bg = bgMeshRef.current;
      bgMeshRef.current = null;
      if (bg) {
        bg.geometry?.dispose();
        (bg.material as THREE.Material).dispose();
        root.remove(bg);
      }

      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      cameraRef.current = null;
    };
  }, [generateHeightmap, depthScale, materialColor, hasEngraveObjects]);

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
      backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 2000, fontFamily: font,
    },
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
  },
    React.createElement('div', {
      style: {
        background: '#12121e', border: '1px solid #252540', borderRadius: 14,
        width: 800, height: 600, maxWidth: '95vw', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column' as const,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      },
    },
      React.createElement('div', {
        style: { padding: '10px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
      },
        React.createElement('div', null,
          React.createElement('div', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Depth Preview'),
          React.createElement('div', { style: { color: '#ffd444', fontSize: 9, marginTop: 2 } },
            '⚠ Preview is an estimate. Actual depth varies by material, focus, and settings.',
          ),
        ),
        React.createElement('button', {
          onClick: onClose,
          style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' },
        }, '×'),
      ),

      !hasEngraveObjects && React.createElement('div', {
        style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' as const, gap: 12 },
      },
        React.createElement('div', { style: { fontSize: 36 } }, '🗻'),
        React.createElement('div', { style: { color: '#8888aa', fontSize: 14 } }, 'No engrave objects to preview'),
        React.createElement('div', { style: { color: '#555570', fontSize: 11 } }, 'Set a layer mode to Engrave and add some shapes or text'),
      ),

      hasEngraveObjects && React.createElement('div', {
        style: { flex: 1, display: 'flex', overflow: 'hidden' },
      },
        React.createElement('div', {
          ref: containerRef,
          style: { flex: 1, cursor: isDragging ? 'grabbing' : 'grab', position: 'relative' as const },
          onMouseDown: handleMouseDown,
          onMouseMove: handleMouseMove,
          onMouseUp: handleMouseUp,
          onMouseLeave: handleMouseUp,
        }),

        React.createElement('div', {
          style: { width: 180, padding: '12px 14px', borderLeft: '1px solid #1a1a2e', overflowY: 'auto' as const, flexShrink: 0 },
        },
          materialPresetName && React.createElement('div', {
            style: {
              padding: '8px 10px', marginBottom: 12,
              background: 'rgba(0,212,255,0.04)', border: '1px solid #1a1a2e',
              borderRadius: 6, textAlign: 'center' as const,
            },
          },
            React.createElement('div', { style: { fontSize: 9, color: '#555570', textTransform: 'uppercase' as const } }, 'Previewing on'),
            React.createElement('div', { style: { fontSize: 12, color: '#e0e0ec', fontWeight: 600, marginTop: 2 } }, materialPresetName),
          ),

          React.createElement('div', { style: { marginBottom: 14 } },
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 4, textTransform: 'uppercase' as const } }, 'View'),
            React.createElement('div', { style: { display: 'flex', gap: 3 } },
              ...(['angle', 'front', 'top'] as const).map(v =>
                React.createElement('button', {
                  key: v,
                  onClick: () => setView(v),
                  style: {
                    flex: 1, padding: '4px', fontSize: 9, borderRadius: 4, cursor: 'pointer',
                    fontFamily: font, textTransform: 'capitalize' as const,
                    background: viewAngle === v ? 'rgba(0,212,255,0.1)' : '#0a0a14',
                    border: viewAngle === v ? '1px solid #00d4ff' : '1px solid #252540',
                    color: viewAngle === v ? '#00d4ff' : '#555570',
                  },
                }, v),
              ),
            ),
          ),

          React.createElement('div', { style: { marginBottom: 14 } },
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 4, textTransform: 'uppercase' as const } },
              `Depth: ${depthScale}×`,
            ),
            React.createElement('input', {
              type: 'range',
              min: 1, max: 20, step: 1,
              value: depthScale,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDepthScale(parseInt(e.target.value, 10)),
              style: { width: '100%', accentColor: '#00d4ff' },
            }),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#333355' } },
              React.createElement('span', null, 'Flat'),
              React.createElement('span', null, 'Deep'),
            ),
          ),

          React.createElement('div', { style: { marginBottom: 14 } },
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 6, textTransform: 'uppercase' as const } }, 'Material'),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 2, maxHeight: 180, overflowY: 'auto' as const } },
              ...MATERIAL_PREVIEW_PRESETS.map(p =>
                React.createElement('button', {
                  key: p.label,
                  type: 'button',
                  onClick: () => setMaterialColor(p.color),
                  style: {
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
                    background: materialColor === p.color ? 'rgba(0,212,255,0.06)' : 'transparent',
                    border: materialColor === p.color ? '1px solid rgba(0,212,255,0.3)' : '1px solid transparent',
                    width: '100%', textAlign: 'left' as const,
                  },
                  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
                    if (materialColor !== p.color) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  },
                  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
                    if (materialColor !== p.color) e.currentTarget.style.background = 'transparent';
                  },
                },
                  React.createElement('div', {
                    style: {
                      width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                      background: p.color, border: '1px solid rgba(255,255,255,0.1)',
                    },
                  }),
                  React.createElement('span', {
                    style: { fontSize: 10, color: materialColor === p.color ? '#e0e0ec' : '#8888aa' },
                  }, p.label),
                ),
              ),
            ),
          ),

          React.createElement('div', {
            style: { padding: '8px', background: '#08080f', borderRadius: 6, border: '1px solid #1a1a2e', marginTop: 8 },
          },
            React.createElement('div', { style: { fontSize: 8, color: '#555570', lineHeight: 1.6, whiteSpace: 'pre-line' as const } },
              'Drag to orbit\nScroll to zoom\nDarker areas = deeper burn',
            ),
          ),
        ),
      ),
    ),
  );
}
