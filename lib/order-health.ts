/**
 * Pure order reliability & delay assessment for owners and managers.
 *
 * Flags delayed kitchen stages, unconfirmed held tables, failed voice
 * announcements, and pending/failed Mode A POS handoffs so an owner can
 * spot missing or stalled orders immediately on the overview and order ledger.
 */

import type { OperatingMode } from '@/lib/operating-mode';

export const HOLD_DELAY_MINUTES = 5;
export const NEW_DELAY_MINUTES = 10;
export const PREPARING_DELAY_MINUTES = 25;
export const READY_DELAY_MINUTES = 10;
export const HANDOFF_DELAY_MINUTES = 5;

export type OrderAttentionKind =
  | 'unconfirmed_hold'
  | 'kitchen_stall_new'
  | 'kitchen_stall_preparing'
  | 'serve_delay_ready'
  | 'announcement_failed'
  | 'kot_handoff_pending';

export type OrderHealthSeverity = 'ok' | 'warn' | 'critical';

export type OrderAttentionReason = {
  kind: OrderAttentionKind;
  severity: Exclude<OrderHealthSeverity, 'ok'>;
  label: string;
};

export type OrderHealthInput = {
  id: string;
  code: string;
  tableLabel?: string | null;
  placedAt: string;
  updatedAt?: string | null;
  prepStatus: string;
  holdRequired?: boolean;
  confirmedAt?: string | null;
  kitchenAnnouncementStatus?: string | null;
  kotHandoffStatus?: string | null;
};

export type OrderHealthAssessment = {
  orderId: string;
  code: string;
  tableLabel: string;
  prepStatus: string;
  needsAttention: boolean;
  isDelayed: boolean;
  severity: OrderHealthSeverity;
  elapsedMinutes: number;
  stageElapsedMinutes: number;
  reasons: OrderAttentionReason[];
  summary: string | null;
};

export type OrderHealthSummary = {
  totalChecked: number;
  flaggedCount: number;
  delayedCount: number;
  unacknowledgedCount: number;
  criticalCount: number;
  flaggedOrders: OrderHealthAssessment[];
};

function minutesSince(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.floor((nowMs - ms) / 60_000));
}

export function assessOrderReliability(
  order: OrderHealthInput,
  options: { now?: Date; operatingMode?: OperatingMode } = {},
): OrderHealthAssessment {
  const nowMs = (options.now ?? new Date()).getTime();
  const elapsedMinutes = minutesSince(order.placedAt, nowMs);
  const stageElapsedMinutes = order.updatedAt
    ? minutesSince(order.updatedAt, nowMs)
    : elapsedMinutes;

  const reasons: OrderAttentionReason[] = [];
  const tableLabel = order.tableLabel?.trim() || 'Takeaway';
  const cancelled = order.prepStatus === 'cancelled';
  const served = order.prepStatus === 'served';

  if (!cancelled) {
    const awaitingHold = order.holdRequired === true && !order.confirmedAt;

    if (awaitingHold && elapsedMinutes >= HOLD_DELAY_MINUTES) {
      reasons.push({
        kind: 'unconfirmed_hold',
        severity: elapsedMinutes >= HOLD_DELAY_MINUTES * 2 ? 'critical' : 'warn',
        label: `Table unconfirmed · ${elapsedMinutes}m`,
      });
    } else if (!awaitingHold && order.prepStatus === 'new' && elapsedMinutes >= NEW_DELAY_MINUTES) {
      reasons.push({
        kind: 'kitchen_stall_new',
        severity: elapsedMinutes >= NEW_DELAY_MINUTES * 2 ? 'critical' : 'warn',
        label: `Waiting to start · ${elapsedMinutes}m`,
      });
    }

    if (order.prepStatus === 'preparing' && stageElapsedMinutes >= PREPARING_DELAY_MINUTES) {
      reasons.push({
        kind: 'kitchen_stall_preparing',
        severity: stageElapsedMinutes >= PREPARING_DELAY_MINUTES + 15 ? 'critical' : 'warn',
        label: `Cooking slow · ${stageElapsedMinutes}m`,
      });
    }

    if (order.prepStatus === 'ready' && stageElapsedMinutes >= READY_DELAY_MINUTES) {
      reasons.push({
        kind: 'serve_delay_ready',
        severity: stageElapsedMinutes >= READY_DELAY_MINUTES * 2 ? 'critical' : 'warn',
        label: `Ready, not served · ${stageElapsedMinutes}m`,
      });
    }

    if (
      order.kitchenAnnouncementStatus === 'failed' &&
      (order.prepStatus === 'new' || order.prepStatus === 'preparing')
    ) {
      reasons.push({
        kind: 'announcement_failed',
        severity: 'warn',
        label: 'Voice alert failed',
      });
    }

    if (options.operatingMode === 'mode_a' && !served) {
      const handoff = order.kotHandoffStatus ?? 'pending';
      if (handoff === 'webhook_failed') {
        reasons.push({
          kind: 'kot_handoff_pending',
          severity: 'critical',
          label: 'POS handoff failed',
        });
      } else if (handoff === 'pending' && elapsedMinutes >= HANDOFF_DELAY_MINUTES) {
        reasons.push({
          kind: 'kot_handoff_pending',
          severity: elapsedMinutes >= HANDOFF_DELAY_MINUTES * 2 ? 'critical' : 'warn',
          label: `POS entry pending · ${elapsedMinutes}m`,
        });
      }
    }
  }

  const hasCritical = reasons.some((r) => r.severity === 'critical');
  const severity: OrderHealthSeverity = hasCritical
    ? 'critical'
    : reasons.length > 0
      ? 'warn'
      : 'ok';

  const isDelayed = reasons.some(
    (r) =>
      r.kind === 'unconfirmed_hold' ||
      r.kind === 'kitchen_stall_new' ||
      r.kind === 'kitchen_stall_preparing' ||
      r.kind === 'serve_delay_ready',
  );

  return {
    orderId: order.id,
    code: order.code,
    tableLabel,
    prepStatus: order.prepStatus,
    needsAttention: reasons.length > 0,
    isDelayed,
    severity,
    elapsedMinutes,
    stageElapsedMinutes,
    reasons,
    summary: reasons[0]?.label ?? null,
  };
}

export function summarizeOrderHealth(
  orders: OrderHealthInput[],
  options: { now?: Date; operatingMode?: OperatingMode } = {},
): OrderHealthSummary {
  const assessed = orders.map((order) => assessOrderReliability(order, options));
  const flaggedOrders = assessed
    .filter((item) => item.needsAttention)
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return b.elapsedMinutes - a.elapsedMinutes;
    });

  return {
    totalChecked: orders.length,
    flaggedCount: flaggedOrders.length,
    delayedCount: flaggedOrders.filter((item) => item.isDelayed).length,
    unacknowledgedCount: flaggedOrders.filter((item) =>
      item.reasons.some(
        (r) =>
          r.kind === 'unconfirmed_hold' ||
          r.kind === 'announcement_failed' ||
          r.kind === 'kot_handoff_pending',
      ),
    ).length,
    criticalCount: flaggedOrders.filter((item) => item.severity === 'critical').length,
    flaggedOrders,
  };
}
