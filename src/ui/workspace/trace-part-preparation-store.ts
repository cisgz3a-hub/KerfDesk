import { create } from 'zustand';

type PreparationStatus = {
  readonly status: 'idle' | 'preparing' | 'ready' | 'error';
  readonly message: string | null;
};

export const useTracePartPreparationStatus = create<PreparationStatus>(() => ({
  status: 'idle',
  message: null,
}));

export function setTracePartPreparationStatus(
  status: PreparationStatus['status'],
  message: string | null = null,
): void {
  const current = useTracePartPreparationStatus.getState();
  if (current.status !== status || current.message !== message) {
    useTracePartPreparationStatus.setState({ status, message });
  }
}
