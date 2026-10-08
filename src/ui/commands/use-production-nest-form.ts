import { useState } from 'react';
import type {
  ProductionNestDefinition,
  ProductionNestPart,
  ProductionNestStock,
} from '../../core/nesting/production-nest';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import {
  freeProductionId,
  initialProductionDefinition,
  initialProductionStock,
  productionSelectionPart,
} from './production-nest-form';

export function useProductionNestForm() {
  const [definition, setDefinition] = useState(() => {
    const state = useStore.getState();
    return initialProductionDefinition(state.project, selectedIds());
  });
  const pushToast = useToastStore((state) => state.pushToast);
  const change = (patch: Partial<ProductionNestDefinition>): void =>
    setDefinition((current) => ({ ...current, ...patch }));
  const partChange = (part: ProductionNestPart): void =>
    change({ parts: definition.parts.map((current) => (current.id === part.id ? part : current)) });
  const stockChange = (stock: ProductionNestStock): void =>
    change({
      sheets: definition.sheets.map((current) => (current.id === stock.id ? stock : current)),
    });
  const addSelection = (): void => {
    const project = useStore.getState().project;
    const stock = definition.sheets[0] ?? initialProductionStock(project, 'stock-1');
    const part = productionSelectionPart(
      project,
      selectedIds(),
      freeProductionId(
        'part-',
        definition.parts.map((part) => part.id),
      ),
      stock,
    );
    if (part.kind === 'invalid') pushToast(part.reason, 'error');
    else change({ parts: [...definition.parts, part.value] });
  };
  const addSheet = (): void => {
    const id = freeProductionId(
      'stock-',
      definition.sheets.map((stock) => stock.id),
    );
    const base =
      definition.sheets.at(-1) ?? initialProductionStock(useStore.getState().project, id);
    change({ sheets: [...definition.sheets, { ...base, id, stockId: id, name: 'Stock ' + id }] });
  };
  const save = (): void => {
    const result = useStore.getState().saveProductionNestDefinition(definition);
    pushToast(
      result.kind === 'invalid'
        ? result.reason
        : 'Production quantities and stock definitions saved with the project.',
      result.kind === 'invalid' ? 'error' : 'success',
    );
  };
  return { definition, change, partChange, stockChange, addSelection, addSheet, save };
}
function selectedIds(): ReadonlyArray<string> {
  const state = useStore.getState();
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
}
