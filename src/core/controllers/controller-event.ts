// ControllerEvent — the firmware-neutral classification of one inbound serial
// line. A superset of GRBL's response vocabulary: GRBL never produces 'busy'
// or 'resend', Marlin never produces 'setting' or 'alarm', but the store-side
// line pipeline routes on THIS union so no ui/state file needs to know which
// firmware is talking (ADR-094).

import type { StatusReport } from './grbl/status-parser';

export type ControllerEvent =
  | { readonly kind: 'ok' }
  | { readonly kind: 'error'; readonly code: number | null; readonly raw?: string }
  | { readonly kind: 'alarm'; readonly code: number }
  | { readonly kind: 'status'; readonly report: StatusReport }
  | { readonly kind: 'setting'; readonly id: number; readonly value: string }
  | { readonly kind: 'message'; readonly tag: string; readonly body: string }
  | { readonly kind: 'welcome'; readonly raw: string }
  // Marlin `echo:busy: processing` — the controller is alive but not ready
  // for the next line; senders must not treat it as an ack.
  | { readonly kind: 'busy' }
  // Marlin checksum-mode `Resend: N`. v1 senders surface this as a stream
  // error; line-number retransmission is out of scope until demanded.
  | { readonly kind: 'resend'; readonly line: number }
  | { readonly kind: 'unknown'; readonly raw: string };
