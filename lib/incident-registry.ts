/**
 * The one in-memory incident registry for this server instance.
 *
 * Routes that report and routes that let staff acknowledge or resolve must
 * share one tracker, or an acknowledge can never find the incident the
 * logger opened. On serverless platforms each instance has its own copy —
 * that is inherent: structured log lines are the durable record, and this
 * registry lets same-instance acknowledgements work without a database.
 *
 * Nothing here leaves the process, and nothing here carries tenant data.
 */
import { InMemoryIncidentTracker } from './monitoring-incidents';

export const realtimeIncidents = new InMemoryIncidentTracker();

/**
 * Operational failures that have no realtime channel attached: transactional
 * email delivery and billing-webhook application. Same rules as above — the
 * tracker dedupes repeats into a count, and only the fixed-vocabulary log
 * line (kind/severity/count, never the dedup key) leaves the process.
 */
export const operationalIncidents = new InMemoryIncidentTracker();
