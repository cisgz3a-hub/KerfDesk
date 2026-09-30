// Every path this service answers. The router, the per-request log line and the
// admin audit records all name routes from this one list, so a log line can never
// carry a path a caller made up (ADR-523 Amendment 3).
export const ROUTE = Object.freeze({
  config: '/v1/public/config',
  health: '/v1/public/health',
  webhook: '/v1/payments/webhook',
  trial: '/v1/trials/start',
  activate: '/v1/licenses/activate',
  activations: '/v1/licenses/activations',
  releaseWithKey: '/v1/licenses/deactivate',
  refresh: '/v1/activations/refresh',
  deactivate: '/v1/activations/deactivate',
  checkout: '/v1/checkout',
  claim: '/v1/orders/claim',
  developerGrants: '/v1/admin/developer-grants',
  orders: '/v1/admin/orders',
  reconcileOrder: '/v1/admin/orders/reconcile',
  licenseStatus: '/v1/admin/licenses/status',
  lookup: '/v1/admin/licenses/lookup',
  rekey: '/v1/admin/licenses/rekey',
  export: '/v1/admin/export',
  deleteCustomer: '/v1/admin/customers/delete',
});

export const ROUTES = new Set(Object.values(ROUTE));
