import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CncTool } from '../../core/scene';
import {
  canvasFrameStyle,
  canvasStyle,
  closeStyle,
  copyStyle,
  eyebrowStyle,
  fallbackStyle,
  noteStyle,
  titleStyle,
  toastStyle,
} from './CncBitPreviewToast.styles';
import { bitPreviewGeometryIssue, bitPreviewShankDiameterMm } from './bit-preview-profile';
import {
  createBitPreviewThreeScene,
  type BitPreviewSceneFactory,
  type BitPreviewSceneHandle,
} from './bit-preview-three-scene';

export const BIT_PREVIEW_DURATION_MS = 5_000;
export const BIT_PREVIEW_LOAD_TIMEOUT_MS = 8_000;

export type CncBitPreviewToastProps = {
  readonly tool: CncTool;
  readonly onDismiss: () => void;
  readonly durationMs?: number;
  readonly createScene?: BitPreviewSceneFactory;
};

type PreviewStatus = {
  readonly toolId: string;
  readonly ready: boolean;
  readonly fallbackReason: string | null;
};

type PreviewSceneState = {
  readonly canvasRef: RefObject<HTMLCanvasElement>;
  readonly ready: boolean;
  readonly fallbackReason: string | null;
};

export function CncBitPreviewToast({
  tool,
  onDismiss,
  durationMs = BIT_PREVIEW_DURATION_MS,
  createScene = createBitPreviewThreeScene,
}: CncBitPreviewToastProps): JSX.Element {
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const { canvasRef, ready, fallbackReason } = useBitPreviewScene(tool, createScene);
  const fallbackDetail = operationalFallbackDetail(tool, fallbackReason);
  usePreviewAutoDismiss({
    durationMs,
    onDismiss,
    paused: hovered || focusWithin,
    ready,
    stateKey: fallbackReason,
    toolId: tool.id,
  });

  return (
    <section
      style={toastStyle}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setFocusWithin(false);
        }
      }}
    >
      <div style={canvasFrameStyle}>
        <canvas
          ref={canvasRef}
          width={180}
          height={132}
          style={canvasStyle}
          role="img"
          aria-hidden={!ready || fallbackReason !== null}
          aria-label={`3D modeled cutting envelope for ${tool.name}`}
        />
        {!ready ? (
          <p style={fallbackStyle}>Loading 3D preview…</p>
        ) : fallbackReason === null ? null : (
          <p style={fallbackStyle}>3D preview unavailable. Cutter details remain available.</p>
        )}
      </div>
      <div style={copyStyle}>
        <p style={eyebrowStyle}>Modeled cutting envelope</p>
        <h3 style={titleStyle}>{tool.name}</h3>
        <p style={noteStyle}>{geometryNote(tool)}</p>
        {fallbackDetail === null ? null : <p style={noteStyle}>Preview detail: {fallbackDetail}</p>}
      </div>
      <button
        type="button"
        style={closeStyle}
        onClick={onDismiss}
        aria-label={`Dismiss preview for ${tool.name}`}
        title="Dismiss preview"
      >
        ×
      </button>
    </section>
  );
}

function useBitPreviewScene(tool: CncTool, createScene: BitPreviewSceneFactory): PreviewSceneState {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometryIssue = bitPreviewGeometryIssue(tool);
  const [status, setStatus] = useState<PreviewStatus>({
    toolId: tool.id,
    ready: geometryIssue !== null,
    fallbackReason: geometryIssue,
  });
  useEffect(() => {
    if (geometryIssue !== null) {
      setStatus({ toolId: tool.id, ready: true, fallbackReason: geometryIssue });
      return;
    }
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let cancelled = false;
    let sceneHandle: BitPreviewSceneHandle | null = null;
    let runtimeFailureReason: string | null = null;
    const loadTimeout = globalThis.setTimeout(() => {
      if (!cancelled) {
        setStatus({
          toolId: tool.id,
          ready: true,
          fallbackReason: '3D preview loading timed out.',
        });
      }
    }, BIT_PREVIEW_LOAD_TIMEOUT_MS);
    const reportRuntimeFailure = (reason: string): void => {
      runtimeFailureReason = reason;
      globalThis.clearTimeout(loadTimeout);
      sceneHandle?.dispose();
      if (!cancelled) {
        setStatus({ toolId: tool.id, ready: true, fallbackReason: reason });
      }
    };
    void createScene(canvas, tool, reportRuntimeFailure)
      .then((result) => {
        globalThis.clearTimeout(loadTimeout);
        if (cancelled) {
          if (result.kind === 'ok') result.handle.dispose();
          return;
        }
        if (result.kind === 'ok') {
          sceneHandle = result.handle;
          if (runtimeFailureReason === null) {
            setStatus({ toolId: tool.id, ready: true, fallbackReason: null });
          } else {
            result.handle.dispose();
          }
        } else {
          setStatus({ toolId: tool.id, ready: true, fallbackReason: result.reason });
        }
      })
      .catch((error: unknown) => {
        globalThis.clearTimeout(loadTimeout);
        if (!cancelled) {
          setStatus({
            toolId: tool.id,
            ready: true,
            fallbackReason: previewErrorMessage(error),
          });
        }
      });
    return () => {
      cancelled = true;
      globalThis.clearTimeout(loadTimeout);
      sceneHandle?.dispose();
    };
  }, [createScene, geometryIssue, tool]);
  if (geometryIssue !== null) {
    return { canvasRef, ready: true, fallbackReason: geometryIssue };
  }
  return {
    canvasRef,
    ready: status.toolId === tool.id && status.ready,
    fallbackReason: status.toolId === tool.id ? status.fallbackReason : null,
  };
}

function usePreviewAutoDismiss(params: {
  readonly durationMs: number;
  readonly onDismiss: () => void;
  readonly paused: boolean;
  readonly ready: boolean;
  readonly stateKey: string | null;
  readonly toolId: string;
}): void {
  const { durationMs, onDismiss, paused, ready, stateKey, toolId } = params;
  useEffect(() => {
    if (!ready || paused) return;
    const timeout = globalThis.setTimeout(onDismiss, durationMs);
    return () => globalThis.clearTimeout(timeout);
  }, [durationMs, onDismiss, paused, ready, stateKey, toolId]);
}

function geometryNote(tool: CncTool): string {
  const geometryIssue = bitPreviewGeometryIssue(tool);
  const shankDiameterMm = bitPreviewShankDiameterMm(tool);
  if (geometryIssue !== null) {
    const action =
      tool.kind === 'v-bit'
        ? "Enter the cutter's actual included angle before V-carving."
        : 'Verify the cutter profile and operation settings before cutting.';
    const shankMetadata =
      shankDiameterMm === null
        ? 'Shank diameter is unknown.'
        : `Catalog shank: ${formatMillimeters(shankDiameterMm)} mm (metadata only).`;
    return `${geometryIssue} ${action} ${shankMetadata} No cutting envelope or display stub was rendered. Flutes, coating, and cutting length are not modeled.`;
  }
  const shankNote =
    shankDiameterMm === null
      ? 'Shank diameter is unknown; the vertical stub is a display aid at cutter diameter.'
      : `Catalog shank: ${formatMillimeters(shankDiameterMm)} mm (metadata only; its transition is not modeled).`;
  return `Cutting shape and diameter follow the CAM model. ${shankNote} Flutes, coating, and cutting length are not modeled.`;
}

function operationalFallbackDetail(tool: CncTool, fallbackReason: string | null): string | null {
  if (fallbackReason === null || fallbackReason === bitPreviewGeometryIssue(tool)) return null;
  return fallbackReason;
}

function formatMillimeters(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function previewErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '3D preview could not be created.';
}
