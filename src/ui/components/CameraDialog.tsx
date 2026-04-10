import React, { useState, useEffect, useRef, useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { NumberInput } from './NumberInput';

interface CameraDialogProps {
  scene: Scene;
  onClose: () => void;
  onPositionDesign: (x: number, y: number) => void;
}

interface CalibrationPoint {
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
}

const CALIBRATION_KEY = 'laserforge_camera_calibration';

export function CameraDialog({ scene, onClose, onPositionDesign }: CameraDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);

  const [calibrationMode, setCalibrationMode] = useState(false);
  const [calibrationStep, setCalibrationStep] = useState<0 | 1 | 2>(0);
  const [calibrationPoints, setCalibrationPoints] = useState<CalibrationPoint[]>([]);
  const [pendingScreenPoint, setPendingScreenPoint] = useState<{ x: number; y: number } | null>(null);
  const [pendingWorldX, setPendingWorldX] = useState(0);
  const [pendingWorldY, setPendingWorldY] = useState(0);

  // Load saved calibration
  const [savedCalibration, setSavedCalibration] = useState<CalibrationPoint[] | null>(() => {
    try {
      const raw = localStorage.getItem(CALIBRATION_KEY);
      return raw ? JSON.parse(raw) as CalibrationPoint[] : null;
    } catch {
      return null;
    }
  });

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  // List available cameras
  useEffect(() => {
    const enumerateCameras = async () => {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach(t => t.stop());

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter(d => d.kind === 'videoinput');
        setDevices(videoDevices);
        setSelectedDeviceId(prev => {
          if (videoDevices.length === 0) return '';
          return prev || videoDevices[0].deviceId;
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Camera access denied: ${msg}`);
      }
    };

    void enumerateCameras();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Start/stop video stream
  useEffect(() => {
    if (!selectedDeviceId) return;

    const startStream = async () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: selectedDeviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        streamRef.current = stream;
        const el = videoRef.current;
        if (el) {
          el.srcObject = stream;
          await el.play();
          setIsStreaming(true);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to start camera: ${msg}`);
        setIsStreaming(false);
      }
    };

    void startStream();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      setIsStreaming(false);
    };
  }, [selectedDeviceId]);

  const screenToWorld = useCallback((screenX: number, screenY: number): { x: number; y: number } | null => {
    const points = savedCalibration;
    if (!points || points.length < 2) return null;

    const p1 = points[0];
    const p2 = points[1];

    const sxRange = p2.screenX - p1.screenX;
    const syRange = p2.screenY - p1.screenY;
    const wxRange = p2.worldX - p1.worldX;
    const wyRange = p2.worldY - p1.worldY;

    if (sxRange === 0 || syRange === 0) return null;

    const tx = (screenX - p1.screenX) / sxRange;
    const ty = (screenY - p1.screenY) / syRange;

    return {
      x: p1.worldX + tx * wxRange,
      y: p1.worldY + ty * wyRange,
    };
  }, [savedCalibration]);

  const drawCalibrationOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (savedCalibration && !calibrationMode) {
      savedCalibration.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.screenX, p.screenY, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(45, 212, 160, 0.3)';
        ctx.fill();
        ctx.strokeStyle = '#2dd4a0';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#2dd4a0';
        ctx.font = `bold 11px ${mono}`;
        ctx.fillText(`(${p.worldX.toFixed(0)}, ${p.worldY.toFixed(0)})`, p.screenX + 12, p.screenY - 8);
      });
    }

    if (calibrationMode) {
      calibrationPoints.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.screenX, p.screenY, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 212, 68, 0.4)';
        ctx.fill();
        ctx.strokeStyle = '#ffd444';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#ffd444';
        ctx.font = `bold 12px ${mono}`;
        ctx.fillText(`P${i + 1}: (${p.worldX}, ${p.worldY})`, p.screenX + 12, p.screenY - 8);
      });

      if (pendingScreenPoint) {
        ctx.beginPath();
        ctx.arc(pendingScreenPoint.x, pendingScreenPoint.y, 10, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffaa32';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  }, [savedCalibration, calibrationMode, calibrationPoints, pendingScreenPoint, mono]);

  const drawClickFeedback = useCallback((sx: number, sy: number) => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let radius = 5;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawCalibrationOverlay();
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 212, 255, ${1 - radius / 40})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      radius += 2;
      if (radius < 40) {
        requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawCalibrationOverlay();
      }
    };
    animate();
  }, [drawCalibrationOverlay]);

  const handleVideoClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (calibrationMode) {
      setPendingScreenPoint({ x: screenX, y: screenY });
    } else {
      const world = screenToWorld(screenX, screenY);
      if (world) {
        onPositionDesign(world.x, world.y);
        drawClickFeedback(screenX, screenY);
      } else {
        setError('Camera not calibrated. Click "Calibrate" to set up.');
        setTimeout(() => setError(''), 3000);
      }
    }
  }, [calibrationMode, screenToWorld, onPositionDesign, drawClickFeedback]);

  useEffect(() => {
    drawCalibrationOverlay();
  }, [drawCalibrationOverlay, isStreaming]);

  const confirmCalibrationPoint = () => {
    if (!pendingScreenPoint) return;
    const newPoint: CalibrationPoint = {
      screenX: pendingScreenPoint.x,
      screenY: pendingScreenPoint.y,
      worldX: pendingWorldX,
      worldY: pendingWorldY,
    };
    const newPoints = [...calibrationPoints, newPoint];
    setCalibrationPoints(newPoints);
    setPendingScreenPoint(null);

    if (newPoints.length === 1) {
      setPendingWorldX(scene.canvas.width);
      setPendingWorldY(scene.canvas.height);
      setCalibrationStep(2);
    } else if (newPoints.length === 2) {
      localStorage.setItem(CALIBRATION_KEY, JSON.stringify(newPoints));
      setSavedCalibration(newPoints);
      setCalibrationMode(false);
      setCalibrationStep(0);
      setCalibrationPoints([]);
    }
  };

  const startCalibration = () => {
    setCalibrationMode(true);
    setCalibrationStep(1);
    setCalibrationPoints([]);
    setPendingScreenPoint(null);
    setPendingWorldX(0);
    setPendingWorldY(0);
  };

  const cancelCalibration = () => {
    setCalibrationMode(false);
    setCalibrationStep(0);
    setCalibrationPoints([]);
    setPendingScreenPoint(null);
  };

  const clearCalibration = () => {
    localStorage.removeItem(CALIBRATION_KEY);
    setSavedCalibration(null);
  };

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 2000, fontFamily: font,
    },
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
  },
    React.createElement('div', {
      style: {
        background: '#12121e', border: '1px solid #252540', borderRadius: 14,
        width: 800, maxHeight: '92vh', display: 'flex', flexDirection: 'column' as const,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      },
    },
      React.createElement('div', {
        style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
      },
        React.createElement('div', null,
          React.createElement('div', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Camera Alignment'),
          React.createElement('div', { style: { color: '#555570', fontSize: 10, marginTop: 2 } },
            savedCalibration ? '✓ Calibrated — click on the bed to position your design' : 'Click Calibrate to set up bed alignment',
          ),
        ),
        React.createElement('button', { onClick: onClose, style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' } }, '×'),
      ),

      React.createElement('div', {
        style: { padding: '8px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 },
      },
        React.createElement('span', { style: { fontSize: 10, color: '#555570' } }, 'Camera:'),
        React.createElement('select', {
          value: selectedDeviceId,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setSelectedDeviceId(e.target.value),
          style: {
            flex: 1, padding: '4px 8px', fontSize: 11,
            background: '#0a0a14', border: '1px solid #252540', borderRadius: 4,
            color: '#e0e0ec', fontFamily: font, outline: 'none',
          },
        },
          devices.length === 0 && React.createElement('option', { value: '' }, 'No cameras found'),
          ...devices.map(d =>
            React.createElement('option', { key: d.deviceId, value: d.deviceId }, d.label || `Camera ${d.deviceId.slice(0, 6)}`),
          ),
        ),
      ),

      React.createElement('div', {
        style: { flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column' as const, minHeight: 0 },
      },
        error && React.createElement('div', {
          style: { padding: '8px 12px', marginBottom: 8, background: 'rgba(255,68,102,0.1)', border: '1px solid rgba(255,68,102,0.3)', borderRadius: 6, color: '#ff4466', fontSize: 11 },
        }, error),

        React.createElement('div', {
          style: { position: 'relative' as const, flex: 1, background: '#000', borderRadius: 8, overflow: 'hidden', minHeight: 300, cursor: calibrationMode ? 'crosshair' : 'pointer' },
          onClick: handleVideoClick,
        },
          React.createElement('video', {
            ref: videoRef,
            autoPlay: true,
            playsInline: true,
            muted: true,
            style: { width: '100%', height: '100%', display: 'block', objectFit: 'contain' as const },
          }),
          React.createElement('canvas', {
            ref: overlayRef,
            style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' as const },
          }),
        ),

        calibrationMode && React.createElement('div', {
          style: { marginTop: 12, padding: '10px 14px', background: 'rgba(255,212,68,0.06)', border: '1px solid rgba(255,212,68,0.2)', borderRadius: 8 },
        },
          React.createElement('div', { style: { fontSize: 11, color: '#ffd444', fontWeight: 600, marginBottom: 6 } },
            calibrationStep === 1
              ? 'Step 1 of 2: Click the TOP-LEFT corner of your laser bed in the video'
              : 'Step 2 of 2: Click the BOTTOM-RIGHT corner of your laser bed in the video',
          ),
          pendingScreenPoint && React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 } },
            React.createElement('span', { style: { fontSize: 10, color: '#8888aa' } }, 'World coordinates (mm):'),
            React.createElement('span', { style: { fontSize: 10, color: '#555570' } }, 'X'),
            React.createElement(NumberInput, {
              value: pendingWorldX, min: -10000, max: 10000, defaultValue: 0,
              style: { width: 70, padding: '4px 6px', background: '#0a0a14', border: '1px solid #252540', borderRadius: 4, color: '#e0e0ec', fontSize: 11, fontFamily: mono, outline: 'none' },
              onCommit: setPendingWorldX,
            }),
            React.createElement('span', { style: { fontSize: 10, color: '#555570' } }, 'Y'),
            React.createElement(NumberInput, {
              value: pendingWorldY, min: -10000, max: 10000, defaultValue: 0,
              style: { width: 70, padding: '4px 6px', background: '#0a0a14', border: '1px solid #252540', borderRadius: 4, color: '#e0e0ec', fontSize: 11, fontFamily: mono, outline: 'none' },
              onCommit: setPendingWorldY,
            }),
            React.createElement('button', {
              onClick: confirmCalibrationPoint,
              style: { padding: '4px 12px', background: 'rgba(45,212,160,0.1)', border: '1px solid #2dd4a0', borderRadius: 4, color: '#2dd4a0', fontSize: 11, cursor: 'pointer', fontFamily: font },
            }, 'Confirm'),
          ),
        ),
      ),

      React.createElement('div', {
        style: { padding: '12px 18px', borderTop: '1px solid #1a1a2e', display: 'flex', gap: 8, flexShrink: 0 },
      },
        !calibrationMode && React.createElement('button', {
          onClick: startCalibration,
          style: { padding: '8px 14px', background: 'rgba(0,212,255,0.1)', border: '1px solid #00d4ff', borderRadius: 6, color: '#00d4ff', fontSize: 12, cursor: 'pointer', fontFamily: font },
        }, savedCalibration ? 'Recalibrate' : 'Calibrate'),

        savedCalibration && !calibrationMode && React.createElement('button', {
          onClick: clearCalibration,
          style: { padding: '8px 14px', background: 'transparent', border: '1px solid #252540', borderRadius: 6, color: '#555570', fontSize: 12, cursor: 'pointer', fontFamily: font },
        }, 'Clear Calibration'),

        calibrationMode && React.createElement('button', {
          onClick: cancelCalibration,
          style: { padding: '8px 14px', background: 'transparent', border: '1px solid #252540', borderRadius: 6, color: '#8888aa', fontSize: 12, cursor: 'pointer', fontFamily: font },
        }, 'Cancel Calibration'),

        React.createElement('div', { style: { flex: 1 } }),

        React.createElement('button', {
          onClick: onClose,
          style: { padding: '8px 18px', background: '#0a0a14', border: '1px solid #252540', borderRadius: 6, color: '#8888aa', fontSize: 12, cursor: 'pointer', fontFamily: font },
        }, 'Close'),
      ),
    ),
  );
}
