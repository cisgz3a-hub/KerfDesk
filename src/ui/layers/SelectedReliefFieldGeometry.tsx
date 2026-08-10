import type { ReliefObject } from '../../core/scene';
import { ReliefFieldGeometry } from './ReliefFieldGeometry';

/** Integrates canonical field geometry while preserving the legacy-mesh properties surface. */
export function SelectedReliefFieldGeometry(props: {
  readonly relief: ReliefObject;
}): JSX.Element | null {
  return props.relief.reliefSource.kind === 'heightfield-v1' ? (
    <ReliefFieldGeometry source={props.relief.reliefSource} transform={props.relief.transform} />
  ) : null;
}
