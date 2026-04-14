import { useControllerConnection } from './useControllerConnection';

/**
 * Backwards-compatible wrapper. Prefer `useControllerConnection('grbl')`.
 */
export function useGrblConnection() {
  const connection = useControllerConnection('grbl');
  return {
    ...connection,
    grblReady: connection.controllerReady,
  };
}
