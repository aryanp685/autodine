/** UI-only projection. Never parse a client input as verified evidence. */
export type VerifiedIrpCopy = { tier: 'authority'; reference: string; acknowledgement: string; acknowledgedAt: string; qrImage: string };
export const IRP_PHASES = {
  queued: 'Queued', dispatching: 'Dispatch in progress', ambiguous: 'Submission uncertain',
  lookup_queued: 'Lookup queued', looking_up: 'Lookup in progress', retryable: 'Retry eligible (not submitted or confirmed absent)',
  rejected: 'Rejected — review required', accepted: 'Verified active', expired: 'Reporting window closed',
  source_unavailable: 'Saved source unavailable', cancel_queued: 'Cancellation queued', cancelling: 'Cancellation in progress',
  cancel_ambiguous: 'Cancellation uncertain', cancel_lookup_queued: 'Cancellation lookup queued', looking_up_cancel: 'Checking cancellation',
  cancelled: 'Cancellation verified',
} as const;
export type IrpPhase = keyof typeof IRP_PHASES;
export const IRP_EVENT_LABELS: Record<string,string> = {
  queued:'Queued by owner', claimed:'Worker claimed operation', lease_expired:'Worker lease expired; outcome unknown',
  owner_retry:'Retry requested', owner_lookup:'Lookup requested', owner_cancel:'Cancellation requested',
  window_expired:'Window closed before send', source_unavailable:'Saved source missing or voided', verified:'Signed evidence verified',
  declined:'Definitive rejection', duplicate:'Duplicate reported; lookup required', uncertain:'Outcome uncertain',
  invalid_reply:'Response could not be verified', invalid_request:'Request did not pass wire validation',
  confirmed_absent:'Provider confirmed no registration', not_sent:'Request not sent', cancelled:'Cancellation confirmed',
  confirmed_active:'Registration still active', cancel_blocked:'Cancellation prerequisite not met',
};
