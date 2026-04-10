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
  onClose: () => void;
}

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

export function DepthPreviewDialog({ scene, onClose }: DepthPreviewDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const frameIdRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const rotationRef = useRef({ x: -0.6, y: 0.3 });
  const zoomRef = useRef(1.0);
  const depthScaleRef = useRef(5);

  const [depthScale, setDepthScale] = useState(5);
  const [viewAngle, setViewAngle] = useState<'angle' | 'front' | 'top'>('angle');
  const [materialColor, setMaterialColor] = useState('#c4956a');
  const [resolution, setResolution] = useState(256);
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

    for (const obj of engraveObjects) {
      const layer = engraveLayers.find(l => l.id === obj.layerId);
      const power = layer?.settings.power.max ?? 100;
      const passes = layer?.settings.passes ?? 1;
      const intensity = Math.min(1, (power / 100) * Math.sqrt(passes));
      const gray = Math.round(255 * (1 - intensity));

      drawEngraveObject(ctx, obj, gray);
    }
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
  }, [scene, resolution]);

  const hasEngraveObjects = useMemo(
    () =>
      scene.layers.some(l => l.visible && l.settings.mode === 'engrave') &&
      scene.objects.some(o => {
        const layer = scene.layers.find(l => l.id === o.layerId);
        return o.visible && !o.locked && layer?.visible && layer?.settings.mode === 'engrave';
      }),
    [scene],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasEngraveObjects) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomRef.current = Math.max(0.3, Math.min(3, zoomRef.current + e.deltaY * 0.001));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasEngraveObjects]);

  useEffect(() => {
    if (!containerRef.current || !hasEngraveObjects) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x08080f, 1);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const root = new THREE.Scene();
    sceneRef.current = root;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, -80, 60);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    root.add(new THREE.AmbientLight(0x404040, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, -50, 80);
    root.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x4488aa, 0.3);
    fillLight.position.set(-30, 30, 40);
    root.add(fillLight);

    const heightmap = generateHeightmap();
    const scale = depthScaleRef.current;

    if (heightmap) {
      const { data, width: hmW, height: hmH, worldWidth, worldHeight } = heightmap;
      const aspect = worldWidth / worldHeight;
      const planeWidth = 60 * (aspect >= 1 ? 1 : aspect);
      const planeHeight = 60 * (aspect >= 1 ? 1 / aspect : 1);

      const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, hmW - 1, hmH - 1);
      const positions = geometry.attributes.position;
      const posArr = positions.array as Float32Array;

      for (let i = 0; i < positions.count; i++) {
        const depth = data[i] ?? 0;
        posArr[i * 3 + 2] = -depth * scale;
      }
      geometry.computeVertexNormals();

      const color = new THREE.Color(materialColor);
      const material = new THREE.MeshPhongMaterial({
        color,
        shininess: 20,
        flatShading: false,
        side: THREE.DoubleSide,
      });

      const colors = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i++) {
        const depth = data[i] ?? 0;
        const burnDarken = 1 - depth * 0.6;
        colors[i * 3] = color.r * burnDarken;
        colors[i * 3 + 1] = color.g * burnDarken * 0.8;
        colors[i * 3 + 2] = color.b * burnDarken * 0.5;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      material.vertexColors = true;

      const mesh = new THREE.Mesh(geometry, material);
      root.add(mesh);
      meshRef.current = mesh;

      const edgeGeo = new THREE.EdgesGeometry(geometry, 15);
      const edgeMat = new THREE.LineBasicMaterial({ color: 0x1a1a2e, opacity: 0.15, transparent: true });
      const edges = new THREE.LineSegments(edgeGeo, edgeMat);
      mesh.add(edges);
    }

    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      if (cameraRef.current) {
        const radius = 100 * zoomRef.current;
        const rx = rotationRef.current.x;
        const ry = rotationRef.current.y;
        cameraRef.current.position.set(
          radius * Math.sin(ry) * Math.cos(rx),
          radius * Math.cos(ry) * Math.cos(rx),
          radius * Math.sin(rx) + 20,
        );
        cameraRef.current.lookAt(0, 0, 0);
      }
      renderer.render(root, camera);
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
        m.traverse(obj => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry?.dispose();
            const mat = obj.material;
            if (Array.isArray(mat)) mat.forEach(mm => mm.dispose());
            else (mat as THREE.Material)?.dispose();
          }
          if (obj instanceof THREE.LineSegments) {
            obj.geometry?.dispose();
            (obj.material as THREE.Material)?.dispose();
          }
        });
        root.remove(m);
      }
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, [generateHeightmap, depthScale, materialColor, resolution, hasEngraveObjects]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    setIsDragging(true);
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    rotationRef.current.y += dx * 0.01;
    rotationRef.current.x = Math.max(-1.5, Math.min(0.1, rotationRef.current.x + dy * 0.01));
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  const setView = useCallback((view: 'angle' | 'front' | 'top') => {
    setViewAngle(view);
    switch (view) {
      case 'angle':
        rotationRef.current = { x: -0.6, y: 0.3 };
        zoomRef.current = 1.0;
        break;
      case 'front':
        rotationRef.current = { x: -0.05, y: 0 };
        zoomRef.current = 1.2;
        break;
      case 'top':
        rotationRef.current = { x: -1.5, y: 0 };
        zoomRef.current = 0.8;
        break;
    }
  }, []);

  const materialPresets = [
    { label: 'Birch', color: '#c4956a' },
    { label: 'Walnut', color: '#5c3a1e' },
    { label: 'MDF', color: '#a08060' },
    { label: 'Plywood', color: '#d4a86a' },
    { label: 'Bamboo', color: '#d4c490' },
    { label: 'Leather', color: '#6b3a2a' },
    { label: 'Slate', color: '#505560' },
    { label: 'Acrylic', color: '#e8e8f0' },
  ];

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
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 4, textTransform: 'uppercase' as const } },
              `Detail: ${resolution}px`,
            ),
            React.createElement('input', {
              type: 'range',
              min: 64, max: 512, step: 64,
              value: resolution,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setResolution(parseInt(e.target.value, 10)),
              style: { width: '100%', accentColor: '#00d4ff' },
            }),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#333355' } },
              React.createElement('span', null, 'Fast'),
              React.createElement('span', null, 'Sharp'),
            ),
          ),

          React.createElement('div', { style: { marginBottom: 14 } },
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 6, textTransform: 'uppercase' as const } }, 'Material'),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 } },
              ...materialPresets.map(p =>
                React.createElement('button', {
                  key: p.label,
                  type: 'button',
                  onClick: () => setMaterialColor(p.color),
                  title: p.label,
                  style: {
                    width: 28, height: 28, borderRadius: 6, cursor: 'pointer',
                    background: p.color,
                    border: materialColor === p.color ? '2px solid #00d4ff' : '2px solid #252540',
                    padding: 0,
                  },
                }),
              ),
            ),
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 4 } },
              materialPresets.find(p => p.color === materialColor)?.label || 'Custom',
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
