export type TraceNotice = 'relaxed-settings';

const MESSAGES: Readonly<Record<TraceNotice, string>> = {
  'relaxed-settings':
    'Automatic retry used relaxed trace settings after finding no paths. Check small details in the result.',
};

export function traceNoticeMessage(notice: TraceNotice): string {
  return MESSAGES[notice];
}
