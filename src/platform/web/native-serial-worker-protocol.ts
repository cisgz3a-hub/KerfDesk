import type { SerialPortIdentity } from '../types';
import type { SerialWorkerRequest, SerialWorkerResponse } from './serial-worker-protocol';

/** A native worker opens its own port. Transferred window streams are never
 * accepted here: their underlying I/O still depends on the window's realm. */
export type NativeSerialWorkerRequest =
  | Exclude<SerialWorkerRequest, { readonly kind: 'attach' }>
  | { readonly kind: 'native-probe'; readonly id: number; readonly identity: SerialPortIdentity }
  | { readonly kind: 'native-open'; readonly id: number; readonly options: SerialOptions }
  | { readonly kind: 'native-start' };

export type NativeSerialWorkerResponse =
  | SerialWorkerResponse
  | { readonly kind: 'native-ready'; readonly id: number }
  | { readonly kind: 'native-unavailable'; readonly id: number; readonly reason: string }
  | { readonly kind: 'native-opened'; readonly id: number }
  /** Cleanup began. The client starts its deadline while the worker releases
   * the locks and native port; only the later closed reply confirms completion. */
  | { readonly kind: 'native-closing' }
  | { readonly kind: 'native-open-error'; readonly id: number; readonly message: string };
