import { useCallback, useEffect, useRef, useState } from 'react';
import type { LaserSecondPassSelection } from '../../../core/laser-second-pass';
import type { FramedRunPermit } from '../../state/framed-run';
import { useLaserStore } from '../../state/laser-store';
import type { ExecutionArtifactV1 } from '../../state/recovery';
import type { SecondPassTool } from './SecondPassCanvas';
import { loadSecondPassDraft, saveSecondPassDraft } from './second-pass-draft';
import type { SecondPassDrawing } from './second-pass-preview';
import { SecondPassWorkerClient, type SecondPassPreview } from './second-pass-worker-client';
import { SECOND_PASS_BUSY, secondPassExecutionActions } from './second-pass-workbench-actions';

type Strokes = LaserSecondPassSelection['strokes'];
export function useSecondPassWorkbench(source: ExecutionArtifactV1, onClose: () => void) {
  const state = useWorkbenchState(source);
  const { permitRef } = state;
  const revoke = useCallback((): void => {
    if (permitRef.current && useLaserStore.getState().framedRun === permitRef.current)
      useLaserStore.setState({ framedRun: null, frameVerification: null });
    permitRef.current = null;
  }, [permitRef]);
  useOpenSecondPassWorker(source, state, revoke);
  const change = (next: Strokes, history = true): void => {
    if (state.working.current) return;
    if (history) {
      state.setUndo((prior) => [...prior, state.strokes]);
      state.setRedo([]);
    }
    state.setStrokes(next);
    state.setPreview(null);
    state.setShowPreview(false);
    state.setError('');
    revoke();
    state.setDraftSaved(saveSecondPassDraft(source, next));
  };
  return {
    ...state,
    ...secondPassExecutionActions(source, state, revoke, onClose),
    tools: secondPassEditorTools(state, change),
    addStroke: (stroke: Strokes[number]) => {
      state.setSelected(null);
      change([...state.strokes, stroke]);
    },
    ready: state.currentPermit !== null && state.currentPermit === permitRef.current,
  };
}

function useWorkbenchState(source: ExecutionArtifactV1) {
  const worker = useRef<SecondPassWorkerClient | null>(null);
  const permitRef = useRef<FramedRunPermit | null>(null);
  const alive = useRef(true);
  const working = useRef(false);
  const [drawing, setDrawing] = useState<SecondPassDrawing | null>(null);
  const [strokes, setStrokes] = useState<Strokes>(() => loadSecondPassDraft(source));
  const [undo, setUndo] = useState<Strokes[]>([]);
  const [redo, setRedo] = useState<Strokes[]>([]);
  const [tool, setTool] = useState<SecondPassTool>('paint');
  const [diameter, setDiameter] = useState(5);
  const [power, setPower] = useState(100);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<SecondPassPreview | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState<string>(SECOND_PASS_BUSY.open);
  const [error, setError] = useState('');
  const [draftSaved, setDraftSaved] = useState(true);
  const currentPermit = useLaserStore((s) => s.framedRun);
  const connected = useLaserStore((s) => s.connection.kind === 'connected');
  return {
    worker,
    permitRef,
    alive,
    working,
    drawing,
    setDrawing,
    strokes,
    setStrokes,
    undo,
    setUndo,
    redo,
    setRedo,
    tool,
    setTool,
    diameter,
    setDiameter,
    power,
    setPower,
    selected,
    setSelected,
    preview,
    setPreview,
    showPreview,
    setShowPreview,
    busy,
    setBusy,
    error,
    setError,
    draftSaved,
    setDraftSaved,
    currentPermit,
    connected,
  };
}

export type SecondPassWorkbenchState = ReturnType<typeof useWorkbenchState>;
export type SecondPassWorkbenchModel = ReturnType<typeof useSecondPassWorkbench>;

function useOpenSecondPassWorker(
  source: ExecutionArtifactV1,
  state: SecondPassWorkbenchState,
  revoke: () => void,
): void {
  const { alive, worker, setDrawing, setDiameter, setBusy, setError } = state;
  useEffect(() => {
    alive.current = true;
    let active = true;
    let client: SecondPassWorkerClient;
    try {
      client = new SecondPassWorkerClient();
      worker.current = client;
    } catch (reason) {
      setError(String(reason));
      setBusy('');
      return;
    }
    void client
      .open(source)
      .then((value) => {
        if (!active) return;
        setDrawing(value);
        setDiameter(
          Math.max(
            0.1,
            Math.min(value.bounds.maxX - value.bounds.minX, value.bounds.maxY - value.bounds.minY) /
              12,
          ),
        );
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setBusy('');
      });
    return () => {
      active = false;
      alive.current = false;
      client.close();
      worker.current = null;
      revoke();
    };
  }, [source, alive, worker, setDrawing, setDiameter, setBusy, setError, revoke]);
}

function secondPassEditorTools(
  s: SecondPassWorkbenchState,
  change: (next: Strokes, history?: boolean) => void,
) {
  return {
    tool: s.tool,
    diameter: s.diameter,
    power: s.power,
    disabled: s.busy !== '',
    strokes: s.strokes,
    selected: s.selected,
    canUndo: s.undo.length > 0,
    canRedo: s.redo.length > 0,
    onTool: (next: SecondPassTool) => {
      s.setTool(next);
      s.setSelected(null);
      s.setShowPreview(false);
    },
    onDiameter: s.setDiameter,
    onPower: (next: number) => {
      s.setPower(next);
      if (s.selected)
        change(
          s.strokes.map((stroke) =>
            stroke.id === s.selected ? { ...stroke, powerScale: next / 100 } : stroke,
          ),
        );
    },
    onSelect: (id: string) => {
      s.setSelected(id);
      const stroke = s.strokes.find((value) => value.id === id);
      if (stroke) s.setPower(stroke.powerScale * 100);
      s.setTool('paint');
      s.setShowPreview(false);
    },
    onRemove: (id: string) => {
      change(s.strokes.filter((stroke) => stroke.id !== id));
      s.setSelected(null);
    },
    onClear: () => {
      change([]);
      s.setSelected(null);
    },
    onUndo: () => {
      const prior = s.undo.at(-1);
      if (!prior) return;
      s.setUndo(s.undo.slice(0, -1));
      s.setRedo([...s.redo, s.strokes]);
      change(prior, false);
      s.setSelected(null);
    },
    onRedo: () => {
      const next = s.redo.at(-1);
      if (!next) return;
      s.setRedo(s.redo.slice(0, -1));
      s.setUndo([...s.undo, s.strokes]);
      change(next, false);
      s.setSelected(null);
    },
  };
}
