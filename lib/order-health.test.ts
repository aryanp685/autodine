import { describe, expect, it } from 'vitest';
import { assessOrderReliability, summarizeOrderHealth } from './order-health';

const NOW = new Date('2026-11-20T12:30:00Z');

describe('order-health reliability assessment', () => {
  it('flags unconfirmed held tables, stalled kitchen tickets, ready delays, and failed voice alerts', () => {
    const held = assessOrderReliability(
      {
        id: 'o1',
        code: 'MA-1001',
        tableLabel: 'T2',
        placedAt: '2026-11-20T12:22:00Z', // 8m ago
        prepStatus: 'new',
        holdRequired: true,
        confirmedAt: null,
      },
      { now: NOW },
    );
    expect(held.needsAttention).toBe(true);
    expect(held.isDelayed).toBe(true);
    expect(held.summary).toContain('Table unconfirmed');

    const stalledNew = assessOrderReliability(
      {
        id: 'o2',
        code: 'MA-1002',
        tableLabel: 'T4',
        placedAt: '2026-11-20T12:05:00Z', // 25m ago -> critical
        prepStatus: 'new',
        kitchenAnnouncementStatus: 'failed',
      },
      { now: NOW },
    );
    expect(stalledNew.severity).toBe('critical');
    expect(stalledNew.reasons.map((r) => r.kind)).toEqual(['kitchen_stall_new', 'announcement_failed']);

    const readyDelay = assessOrderReliability(
      {
        id: 'o3',
        code: 'MA-1003',
        placedAt: '2026-11-20T12:00:00Z',
        updatedAt: '2026-11-20T12:15:00Z', // ready 15m ago
        prepStatus: 'ready',
      },
      { now: NOW },
    );
    expect(readyDelay.isDelayed).toBe(true);
    expect(readyDelay.summary).toContain('Ready, not served');
  });

  it('flags pending or failed Mode A POS handoffs', () => {
    const modeA = assessOrderReliability(
      {
        id: 'o4',
        code: 'MA-1004',
        placedAt: '2026-11-20T12:28:00Z',
        prepStatus: 'preparing',
        kotHandoffStatus: 'webhook_failed',
      },
      { now: NOW, operatingMode: 'mode_a' },
    );
    expect(modeA.needsAttention).toBe(true);
    expect(modeA.severity).toBe('critical');
    expect(modeA.summary).toBe('POS handoff failed');
  });

  it('keeps healthy and cancelled orders clear', () => {
    const summary = summarizeOrderHealth(
      [
        {
          id: 'o5',
          code: 'MA-1005',
          placedAt: '2026-11-20T12:27:00Z',
          prepStatus: 'new',
          kitchenAnnouncementStatus: 'announced',
        },
        {
          id: 'o6',
          code: 'MA-1006',
          placedAt: '2026-11-20T11:00:00Z',
          prepStatus: 'cancelled',
        },
      ],
      { now: NOW },
    );
    expect(summary.flaggedCount).toBe(0);
    expect(summary.flaggedOrders).toEqual([]);
  });
});
