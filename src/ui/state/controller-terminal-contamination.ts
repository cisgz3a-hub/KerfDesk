export type UnexpectedTerminalResponse = {
  readonly kind: 'ok' | 'error';
  readonly raw: string;
  readonly observedAt: number;
};
