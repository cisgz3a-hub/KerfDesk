import { useState } from 'react';
import type { CncTool, Layer } from '../../../core/scene';
import {
  cncStartupOperationDraft,
  type CncStartupOperationDraft,
} from '../../state/cnc-startup-setup';

export type CncStartupWizardDraft = {
  readonly operationDrafts: ReadonlyArray<CncStartupOperationDraft>;
  readonly customTools: ReadonlyArray<CncTool>;
  readonly materialApplyRequested: boolean;
  readonly applyMaterial: (materialKey: string | null) => void;
  readonly changeOperation: (draft: CncStartupOperationDraft) => void;
  readonly changeCustomTools: (tools: ReadonlyArray<CncTool>) => void;
  readonly removeTool: (toolId: string) => void;
};

export function useCncStartupWizardDraft(
  layers: ReadonlyArray<Layer>,
  initialCustomTools: ReadonlyArray<CncTool>,
): CncStartupWizardDraft {
  const [operationDrafts, setOperationDrafts] = useState(() =>
    layers.map(cncStartupOperationDraft),
  );
  const [customTools, setCustomTools] = useState(initialCustomTools);
  const [materialApplyRequested, setMaterialApplyRequested] = useState(false);
  const applyMaterial = (materialKey: string | null): void => {
    setMaterialApplyRequested(true);
    setOperationDrafts((drafts) => drafts.map((draft) => ({ ...draft, materialKey })));
  };
  const changeOperation = (next: CncStartupOperationDraft): void => {
    setOperationDrafts((drafts) =>
      drafts.map((draft) => (draft.layerId === next.layerId ? next : draft)),
    );
  };
  const removeTool = (toolId: string): void => {
    setOperationDrafts((drafts) =>
      drafts.map((draft) => ({
        ...draft,
        ...(draft.toolId === toolId ? { toolId: null } : {}),
        ...(draft.vClearToolId === toolId ? { vClearToolId: null } : {}),
        ...(draft.pocketRoughToolId === toolId ? { pocketRoughToolId: null } : {}),
        ...(draft.reliefFinishToolId === toolId ? { reliefFinishToolId: null } : {}),
      })),
    );
  };
  return {
    operationDrafts,
    customTools,
    materialApplyRequested,
    applyMaterial,
    changeOperation,
    changeCustomTools: setCustomTools,
    removeTool,
  };
}
