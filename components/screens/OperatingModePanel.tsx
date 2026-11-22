import { Panel, Field, Tag, Notice, inputClass } from '@/components/owner/chrome';
import { SubmitButton } from '@/components/owner/SubmitButton';
import { saveOperatingModeAction } from '@/app/(staff)/dashboard/settings/actions';
import {
  OPERATING_MODE_META,
  POS_INTEGRATION_PRESETS,
  type OperatingMode,
} from '@/lib/operating-mode';

export function OperatingModePanel({
  operatingMode,
  posIntegrationName,
  posWebhookUrl,
  posWebhookSecretConfigured,
  canEdit,
  live,
}: {
  operatingMode: OperatingMode;
  posIntegrationName: string;
  posWebhookUrl: string;
  posWebhookSecretConfigured: boolean;
  canEdit: boolean;
  live: boolean;
}) {
  const disabled = !live || !canEdit;

  return (
    <Panel
      title="Operating path & POS handoff"
      meta={
        operatingMode === 'mode_a'
          ? 'Mode A active — alongside existing POS'
          : 'Mode B active — AutoDine primary OS'
      }
      bodyClassName="px-5 py-5"
    >
      <form action={saveOperatingModeAction} className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {(['mode_a', 'mode_b'] as const).map((mode) => {
            const meta = OPERATING_MODE_META[mode];
            const selected = operatingMode === mode;
            return (
              <label
                key={mode}
                className={[
                  'flex cursor-pointer flex-col gap-2 rounded-[var(--p-r-block)] border p-3.5 transition-colors',
                  selected ? 'border-grass bg-[var(--p-accent-wash)]' : 'border-hair bg-paper',
                  disabled ? 'cursor-not-allowed opacity-70' : '',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="operatingMode"
                      value={mode}
                      defaultChecked={selected}
                      disabled={disabled}
                      className="mt-0.5 accent-[var(--p-accent)]"
                    />
                    <span className="text-[13.5px] font-semibold text-gink">
                      {meta.code} · {meta.title}
                    </span>
                  </div>
                  {mode === 'mode_a' ? (
                    <Tag tone="live">Recommended entry</Tag>
                  ) : (
                    <Tag tone="neutral">Full stack</Tag>
                  )}
                </div>
                <p className="m-0 text-[12.5px] leading-[1.5] text-gink-64">{meta.summary}</p>
                <ul className="m-0 list-disc space-y-1 pl-4 text-[11.5px] text-gink-64">
                  {meta.capabilities.map((cap) => (
                    <li key={cap}>{cap}</li>
                  ))}
                </ul>
              </label>
            );
          })}
        </div>

        <Notice tone="plain" label="Zero-disruption switch">
          Both modes share the same menus, tables, QR codes, and kitchen board. Start in Mode A
          alongside your current billing software, and switch to Mode B anytime without rebuilding
          your setup.
        </Notice>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field
            label="Existing POS software (for Mode A)"
            htmlFor="settings-pos-name"
            hint="Shown on KOT handoff slips and the staff bar so cashiers know where bills are punched."
          >
            <input
              id="settings-pos-name"
              name="posIntegrationName"
              type="text"
              list="pos-integration-presets"
              defaultValue={posIntegrationName}
              maxLength={60}
              disabled={disabled}
              placeholder="e.g. Petpooja, Posist, Rista"
              className={inputClass}
            />
            <datalist id="pos-integration-presets">
              {POS_INTEGRATION_PRESETS.map((preset) => (
                <option key={preset} value={preset} />
              ))}
            </datalist>
          </Field>

          <Field
            label="KOT handoff webhook URL (optional, https://)"
            htmlFor="settings-pos-webhook"
            hint="When set, staff can push KOTs directly to your POS bridge via signed JSON POST."
          >
            <input
              id="settings-pos-webhook"
              name="webhookUrl"
              type="url"
              defaultValue={posWebhookUrl}
              disabled={disabled}
              placeholder="https://pos-bridge.example.com/kot"
              className={inputClass}
            />
          </Field>
        </div>

        <Field
          label="Webhook signing secret (optional)"
          htmlFor="settings-pos-secret"
          hint={
            posWebhookSecretConfigured
              ? 'A signing secret is saved. Leave blank to keep the existing secret, or enter a new one to rotate it.'
              : 'Optional HMAC-SHA256 secret sent in the X-AutoDine-Signature header.'
          }
        >
          <input
            id="settings-pos-secret"
            name="webhookSecret"
            type="password"
            defaultValue=""
            maxLength={120}
            autoComplete="new-password"
            disabled={disabled}
            placeholder={posWebhookSecretConfigured ? '•••••••• (saved — leave blank to keep)' : 'Enter signing secret'}
            className={inputClass}
          />
        </Field>

        <div>
          <SubmitButton tone="solid" disabled={disabled} pendingLabel="Saving…">
            Save operating mode
          </SubmitButton>
        </div>
      </form>
    </Panel>
  );
}
