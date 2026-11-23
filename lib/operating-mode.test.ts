import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPERATING_MODE,
  formatKotHandoffSlip,
  isModeA,
  kotHandoffLabel,
  normalizeKotHandoffStatus,
  normalizeOperatingMode,
  validateOperatingModeInput,
} from './operating-mode';

describe('operating-mode', () => {
  it('defaults to mode_b for full OS backward compatibility', () => {
    expect(DEFAULT_OPERATING_MODE).toBe('mode_b');
    expect(normalizeOperatingMode(undefined)).toBe('mode_b');
    expect(normalizeOperatingMode('invalid')).toBe('mode_b');
    expect(normalizeOperatingMode('mode_a')).toBe('mode_a');
    expect(isModeA('mode_a')).toBe(true);
    expect(isModeA('mode_b')).toBe(false);
  });

  it('normalizes KOT handoff statuses and labels', () => {
    expect(normalizeKotHandoffStatus(undefined)).toBe('pending');
    expect(normalizeKotHandoffStatus('entered_in_pos')).toBe('entered_in_pos');
    expect(normalizeKotHandoffStatus('webhook_sent')).toBe('webhook_sent');
    expect(normalizeKotHandoffStatus('webhook_failed')).toBe('webhook_failed');
    expect(kotHandoffLabel('pending')).toBe('Awaiting POS entry');
    expect(kotHandoffLabel('entered_in_pos')).toBe('Entered in POS');
  });

  it('validates Mode A POS name and SSRF-safe HTTPS webhook URLs', () => {
    expect(
      validateOperatingModeInput({
        operatingMode: 'mode_a',
        posIntegrationName: '  Petpooja  ',
        webhookUrl: 'https://pos-bridge.example.com/kot',
        webhookSecret: 'secret-123',
      }),
    ).toEqual({
      ok: true,
      value: {
        operatingMode: 'mode_a',
        posIntegrationName: 'Petpooja',
        webhookUrl: 'https://pos-bridge.example.com/kot',
        webhookSecret: 'secret-123',
      },
    });

    const httpResult = validateOperatingModeInput({
      operatingMode: 'mode_a',
      webhookUrl: 'http://pos.example.com/kot',
    });
    expect(httpResult.ok).toBe(false);

    const localResult = validateOperatingModeInput({
      operatingMode: 'mode_a',
      webhookUrl: 'https://127.0.0.1/kot',
    });
    expect(localResult.ok).toBe(false);

    const privateResult = validateOperatingModeInput({
      operatingMode: 'mode_a',
      webhookUrl: 'https://192.168.1.50/kot',
    });
    expect(privateResult.ok).toBe(false);
  });

  it('formats a structured KOT handoff slip that warns against duplicate kitchen firing', () => {
    const slip = formatKotHandoffSlip(
      {
        code: 'A-1042',
        table: 'Table 4',
        placedAt: '7:45 PM',
        note: 'Less spicy',
        items: [
          { qty: 2, name: 'Butter Chicken', portion: 'Half', addons: ['Extra butter'] },
          { qty: 1, name: 'Garlic Naan' },
        ],
      },
      'Petpooja',
    );
    expect(slip).toContain('AUTODINE KOT HANDOFF -> PETPOOJA');
    expect(slip).toContain('Ticket: A-1042 | Table: Table 4 | Time: 7:45 PM');
    expect(slip).toContain('2 x Butter Chicken (Half, Extra butter)');
    expect(slip).toContain('1 x Garlic Naan');
    expect(slip).toContain('Kitchen note: Less spicy');
    expect(slip).toContain('Billing only in POS');
  });
});
