/** No application/route imports this module. Only disposable PostgreSQL
 * rehearsals exercise the persisted provider protocol. No transport, DSN,
 * credential resolver, public executor or provider_live implementation. */
import type { Inv01 } from './inv01';
import type { IrpJobStore, ProviderJob } from './provider';

export type RehearsalSql = (sql: string, params: unknown[]) => Promise<unknown>;
type PostgresRehearsalStore = IrpJobStore & { load(jobId: string): Promise<ProviderJob | null> };

export function postgresRehearsalStore(queryValue: RehearsalSql, ids: { preflightId: string; outletId: string }): PostgresRehearsalStore {
  if (process.env.NODE_ENV !== 'test') throw new Error('PostgreSQL IRP rehearsal is test-only.');
  return {
    async load(jobId) {
      const record = await queryValue('select public.load_gst_irp_rehearsal($1,$2) as value',[ids.outletId,jobId]);
      return record && typeof record === 'object' && 'jobId' in record ? record as ProviderJob : null;
    },
    async reserve(job: ProviderJob, request: Inv01) {
      if (job.environment !== 'provider_test') throw new Error('Live dispatch storage is not enabled.');
      const record = await queryValue('select public.reserve_gst_irp_rehearsal($1,$2,$3,$4,$5,$6) as value',[
        ids.preflightId,ids.outletId,job.documentKey,job.providerId,job.payloadSha256,JSON.stringify(request),
      ]);
      if (!record || typeof record !== 'object' || !('jobId' in record)) throw new Error('No durable rehearsal job.');
      return record as ProviderJob;
    },
    async compareAndSwap(previous, next) {
      if (!previous.jobId || previous.environment !== 'provider_test' || next.environment !== 'provider_test'
        || next.acknowledgement || next.operation !== 'generate' || next.cancelledAt !== undefined
        || next.jobId !== previous.jobId || next.documentKey !== previous.documentKey || next.providerId !== previous.providerId
        || next.payloadSha256 !== previous.payloadSha256 || next.revision !== previous.revision + 1) {
        throw new Error('Rehearsal requires an unchanged synthetic generation identity and cannot persist acknowledgements or cancellation.');
      }
      return await queryValue('select public.cas_gst_irp_rehearsal($1,$2,$3,$4,$5,$6,$7,$8,$9) as value',[
        previous.jobId,ids.outletId,previous.documentKey,previous.providerId,previous.payloadSha256,
        previous.revision,previous.state,next.state,JSON.stringify({operation:next.operation,issue:next.issue,
          responseSha256:next.responseSha256,result:next.result}),
      ]) === true;
    },
  };
}
