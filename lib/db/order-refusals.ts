// Known, fixed business refusals. PostgREST's P0001 alone does not say that
// MESSAGE_TEXT is safe: a trigger or stale deployment could include row data.
const orderRefusals = new Set([
  'That order could not be found.',
  'An online payment is in progress for this order. Please wait for it to finish or ask staff.',
  'This order has already been paid. A refund has to be handled at the counter.',
  'This order has already been served.',
  'The kitchen has already started this order. Please ask the staff.',
  'This order is more than ten minutes old. Please ask the staff to cancel it.',
  'This order has been cancelled.',
  'The kitchen has already started this order. Please ask the staff to change it.',
  'This order has already been paid. Ask the counter to change it.',
  'There was nothing to change.',
  'An order needs at least one dish. Cancel it instead.',
]);

export function orderRefusal(error: { code?: string; message: string }): string | undefined {
  return error.code === 'P0001' && orderRefusals.has(error.message) ? error.message : undefined;
}
