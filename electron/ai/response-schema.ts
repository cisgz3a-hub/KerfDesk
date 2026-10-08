const text = { type: 'string' };
function object(properties: Record<string, unknown>) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
export const AI_RESPONSE_SCHEMA = object({
  title: text,
  explanation: text,
  paths: {
    type: 'array',
    items: object({
      closed: { type: 'boolean' },
      points: { type: 'array', items: object({ x: { type: 'number' }, y: { type: 'number' } }) },
    }),
  },
  matches: { type: 'array', items: object({ id: text, reason: text }) },
});
