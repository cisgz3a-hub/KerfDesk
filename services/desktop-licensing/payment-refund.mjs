const ITEM = /^txnitm_[a-z0-9]{26}$/u;
const MONEY = /^(?:0|[1-9]\d{0,15})$/u;

function amount(value) {
  if (typeof value !== 'string' || !MONEY.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Bounded, non-personal facts from the authenticated adjustment's sole item. */
export function refundItemFacts(data) {
  if (!Array.isArray(data.items) || data.items.length !== 1) return null;
  const item = data.items[0];
  if (!item || typeof item !== 'object' || !ITEM.test(item.item_id ?? '')) return null;
  const text = (value) => (typeof value === 'string' && value.length <= 64 ? value : null);
  return {
    itemId: item.item_id,
    type: text(item.type),
    currency: text(data.currency_code),
    totalsCurrency: text(data.totals?.currency_code),
    subtotal: amount(data.totals?.subtotal),
    tax: amount(data.totals?.tax),
    total: amount(data.totals?.total),
    itemSubtotal: amount(item.totals?.subtotal),
    itemTax: amount(item.totals?.tax),
    itemTotal: amount(item.totals?.total),
    ...(item.amount !== undefined && item.amount !== null ? { amount: amount(item.amount) } : {}),
    ...(Object.hasOwn(item, 'price_id') ? { priceId: text(item.price_id) } : {}),
    ...(Object.hasOwn(item, 'quantity')
      ? { quantity: Number.isSafeInteger(item.quantity) ? item.quantity : null }
      : {}),
  };
}

function completeTotals(item, paidAmount) {
  const amounts = [
    item.subtotal,
    item.tax,
    item.total,
    item.itemSubtotal,
    item.itemTax,
    item.itemTotal,
  ];
  return (
    amounts.every((value) => Number.isSafeInteger(value) && value >= 0) &&
    item.subtotal === paidAmount &&
    item.itemSubtotal === paidAmount &&
    item.tax === item.itemTax &&
    item.total === item.itemTotal &&
    item.total === paidAmount + item.tax
  );
}

/** A full-item refund can use Paddle's legacy/default `partial` envelope. */
export function fullPurchaseRefund(adjustment, order) {
  if (adjustment.type === 'full') return true;
  if (!['partial', null].includes(adjustment.type)) return false;
  const item = adjustment.refundItem;
  if (!item || !['full', 'partial'].includes(item.type) || order?.operation !== 'purchase')
    return false;
  // The fulfilled order already proved exactly one quantity-one item, no discount,
  // and this subtotal/currency. Its signed, owned transaction supplies the item ID;
  // this also protects orders sold before item identities were retained locally.
  return (
    item.currency === order.currency &&
    item.totalsCurrency === order.currency &&
    (!Object.hasOwn(item, 'priceId') || item.priceId === order.priceId) &&
    (!Object.hasOwn(item, 'quantity') || item.quantity === 1) &&
    (!Object.hasOwn(item, 'amount') ||
      item.amount === item.itemTotal ||
      item.amount === item.itemSubtotal) &&
    completeTotals(item, order.amount)
  );
}
