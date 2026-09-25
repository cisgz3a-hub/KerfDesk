export type TraceNotice = 'relaxed-settings' | 'preview-resolution';

const MESSAGES: Readonly<Record<TraceNotice, string>> = {
  'relaxed-settings':
    'Automatic retry used relaxed trace settings after finding no paths. Check small details in the result.',
  'preview-resolution':
    'This device could not trace the image at full resolution, so the trace uses the preview resolution.',
};

export function traceNoticeMessage(notice: TraceNotice): string {
  return MESSAGES[notice];
}
