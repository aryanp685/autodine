import { generateKeyPairSync } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { addToCart, cartCheckout, d, finishSitting, outletRole, place, scan, sql, staffContext, tickets, venueCode, verify } from './flow';
import { IrpWorker, postgresExecutionStore } from '../../lib/gst/irp/execution/worker';
import { simulationAdapter, type SimRegistration, type SimulationRegistry } from '../../lib/gst/irp/execution/simulator';
import { signerId } from '../../lib/gst/irp/execution/verification';
import { SYNTHETIC_BUYER } from '../../lib/gst/test-fixtures';

/**
 * Journey C — the owner-facing IRP workflow against a synthetic provider.
 *
 * The provider is a local simulator process driven by this test; nothing is
 * sent to GST or any vendor. Every assertion about "accepted" evidence also
 * asserts that no legal IRN, printable tax invoice or hold release followed.
 */
const url = process.env.JOURNEY_DB_URL!;
if (!url) throw new Error('The IRP simulation journey runs only inside the local harness.');
const BUYER = { type: 'registered' as const, name: 'Synthetic B2B Kitchen', gstin: SYNTHETIC_BUYER,
  address: '9 Synthetic Trade Lane', city: 'Bengaluru', pincode: '560001' };

let admin: pg.Client;
let keyPair: ReturnType<typeof generateKeyPairSync>;
let outlet: string;
let route: string;
const fresh = async () => { const client = new pg.Client({ connectionString: url }); await client.connect(); return client; };
const val = async (client: pg.Client, text: string, args: unknown[] = []) => (await client.query(text, args)).rows[0]?.value;
async function as<T>(role: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await fresh();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claim.sub','',true)");
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) { await client.query('rollback'); throw error; } finally { await client.end(); }
}
const workerStore = () => postgresExecutionStore((text, params) =>
  as('irp_local_worker_fixture', client => val(client, text, params)));
function registry(): SimulationRegistry {
  const provider = <T>(work: (client: pg.Client) => Promise<T>) => as('irp_local_provider_fixture', work);
  const lookup = (clause: 'document_key' | 'reference', id: string) => provider(client =>
    val(client, `select record as value from irp_fixture.registry where ${clause}=$1`, [id])).then(r => r as SimRegistration ?? null);
  return {
    findByKey: key => lookup('document_key', key), findByReference: ref => lookup('reference', ref),
    async insertIfAbsent(entry) {
      return provider(async client => (await client.query(`insert into irp_fixture.registry values($1,$2,$3)
        on conflict(document_key) do nothing`, [entry.documentKey, entry.reference, entry])).rowCount === 1);
    },
    async cancelUnlessCancelled(ref, at) {
      return provider(async client => await val(client, `update irp_fixture.registry set record=record||jsonb_build_object('cancelledAt',$2::text)
        where reference=$1 and record->>'cancelledAt' is null returning record as value`, [ref, at]) ?? null);
    },
  };
}
const run = (job: string, behavior: Parameters<typeof simulationAdapter>[0]['behavior'] = {}) =>
  new IrpWorker(workerStore(), [simulationAdapter({ keyPair, registry: registry(), behavior })], 10_000).one(outlet, route, job);
/** Advance the schedule only inside the fixture; no public retry override. */
const due = async (job: string) => {
  await admin.query("update irp_dispatches set next_action_at=clock_timestamp()-interval '1 second' where id=$1", [job]);
  await admin.query("update irp_routes set next_slot='-infinity' where id=$1", [route]);
};
/** Wait for the committed request, not for a notice that the previous action already showed. */
const waitPhase = (job: string, phase: string) => expect.poll(async () =>
  (await sql<{ phase: string }>('select phase::text as phase from irp_dispatches where id=$1', [job]))[0]?.phase,
  { timeout: 20_000 }).toBe(phase);
/** The dispatch raised for one specific invoice, never "the latest one". */
const dispatchId = async (invoice: string) => (await sql<{ id: string }>(`select d.id from irp_dispatches d
  join restaurant_irp_jobs j on j.id=d.preflight_id where d.outlet_id=$1 and j.invoice_id=$2`, [outlet, invoice]))[0]?.id;

test.describe('IRP simulation (owner workflow)', () => {
  /** Each test is independent: save the local simulation route (idempotent). */
  async function ensureRoute(page: import('@playwright/test').Page) {
    await page.goto('/dashboard/reports/irp');
    const select = page.getByLabel('Approved local route');
    await expect(select).toBeVisible({ timeout: 20_000 });
    await select.selectOption(route);
    await page.getByRole('button', { name: 'Save route' }).click();
    await expect(page.getByText('A local simulation route is selected.')).toBeVisible();
  }

  test.beforeAll('irp fixture provisioning', async () => {
    test.setTimeout(120_000);
    admin = await fresh();
    keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    outlet = d.id;
    const gstin = await val(admin, 'select gstin as value from restaurant_gst_config where restaurant_id=$1', [outlet]);
    expect(gstin).toMatch(/^27C/);
    route = await val(admin, `insert into irp_routes(outlet_id,seller_gstin,tier,provider_key,api_version,schema_version,signer_fingerprint,available,interval_ms)
      values($1,$2,'simulation','sim-local','synthetic-1','1.1',$3,true,50) returning id value`, [outlet, gstin, signerId(keyPair.publicKey)]);
    await admin.query(`create schema if not exists irp_fixture;
      create table if not exists irp_fixture.registry(document_key text primary key,reference text unique,record jsonb not null);
      do $$ begin
        if not exists (select 1 from pg_roles where rolname='irp_local_provider_fixture') then create role irp_local_provider_fixture nologin; end if;
        if not exists (select 1 from pg_roles where rolname='irp_local_worker_fixture') then create role irp_local_worker_fixture nologin; end if;
      end $$;
      grant usage on schema irp_fixture to irp_local_provider_fixture;
      grant select,insert,update(record) on irp_fixture.registry to irp_local_provider_fixture;
      grant usage on schema public to irp_local_worker_fixture;
      grant execute on function public.claim_irp_dispatch(uuid,uuid,uuid),public.sweep_irp_leases(uuid,uuid),
        public.finish_irp_dispatch(uuid,uuid,text,integer,text,jsonb) to irp_local_worker_fixture;`);
  });
  test.afterAll(async () => { await admin?.end(); });

  test('eligibility, offline preparation, simulated response, lookup recovery and cancellation', async ({ browser }) => {
    test.setTimeout(240_000);
    const ownerCtx = await staffContext(browser, outletRole(d));
    const managerCtx = await staffContext(browser, 'irpmanager');
    try {
      const owner = await ownerCtx.newPage();
      await owner.goto('/dashboard/reports/irp');
      await expect(owner.getByRole('heading', { name: 'E-invoice / IRP register' })).toBeVisible();
      await expect(owner.getByText('Turnover test met for covered supplies.')).toBeVisible();
      await expect(owner.getByText('No live IRP is enabled.')).toBeVisible();
      // The route choice is owner-only and simulation-only.
      const routeMissing = await owner.getByText('No compatible simulation route selected.').isVisible();
      if (routeMissing) {
        await owner.getByLabel('Approved local route').selectOption(route);
        await owner.getByRole('button', { name: 'Save route' }).click();
        await expect(owner.getByRole('status')).toContainText('Local route preference saved');
      }
      await expect(owner.getByText('A local simulation route is selected.')).toBeVisible();

      const manager = await managerCtx.newPage();
      await manager.goto('/dashboard/reports/irp');
      await expect(manager.getByText('Read only. Routing is managed by an entitled owner')).toBeVisible();
      await expect(manager.getByRole('button', { name: 'Save route' })).toHaveCount(0);

      // A covered B2B document: guest order, registered buyer, counter tender.
      const guest = await ownerCtx.browser()!.newPage();
      await scan(guest, d, 'D1');
      await guest.getByRole('button', { name: 'Add IRP thali', exact: true }).click();
      await cartCheckout(guest);
      await verify(guest, await venueCode(d));
      await place(guest).click();
      await expect(guest).toHaveURL(/\/menu\/order\?/);
      const [ticket] = await tickets(d, 'D1');
      await owner.goto(`/cashier?order=${ticket.id}`);
      await owner.getByRole('button', { name: /Record cash/ }).click();
      await expect(owner.getByRole('status').filter({ hasText: /cash .*recorded/i })).toBeVisible();
      const saved = await finishSitting(owner, ticket, BUYER, { print: false });
      expect(saved).toMatchObject({ document_type: 'gst_tax_invoice', irp_status: 'pending' });
      expect(saved.customer_snapshot).toMatchObject({ gstin: SYNTHETIC_BUYER });

      // Held: no printable tax document and no shareable copy.
      await expect(owner.getByText(/IRN pending — not a final tax invoice/)).toBeVisible();
      await expect(owner.getByRole('button', { name: 'Print / Save PDF' })).toHaveCount(0);
      await expect(owner.getByRole('button', { name: 'Create 24-hour link' })).toHaveCount(0);
      expect(await val(admin, 'select irn value from restaurant_invoices where id=$1', [saved.id])).toBeNull();
      expect((await sql<{ n: number }>('select count(*)::int n from restaurant_invoice_share_links where invoice_id=$1', [saved.id]))[0].n).toBe(0);

      // Offline INV-01 preparation is explicit and repeatable without submission.
      await owner.getByRole('button', { name: 'Validate IRP payload offline' }).click();
      await expect(owner.getByRole('status')).toContainText('Not submitted; the IRN hold remains');
      await owner.getByRole('button', { name: 'Validate IRP payload offline' }).click();
      await expect(owner.getByRole('status')).toContainText('Identical preparation already recorded');

      // The register lists the held document and the unqueued preparation.
      await owner.goto('/dashboard/reports/irp');
      // The prepared document moves from "before dispatch" to the draft list.
      await expect(owner.getByRole('link', { name: saved.invoice_number, exact: true })).toHaveCount(1);
      const draft = owner.locator('li').filter({ has: owner.getByRole('link', { name: saved.invoice_number, exact: true }) });
      await draft.getByRole('button', { name: 'Queue simulation' }).click();
      await expect(owner.getByText('Simulation — not filed with GST')).toBeVisible();
      const job = await dispatchId(saved.id);
      expect(job).toBeTruthy();
      await expect(owner.getByText(/Claims: 0 generate/)).toBeVisible();

      // The synthetic provider accepts; the app must never call it legal.
      await due(job);
      expect(await run(job)).toBe('recorded');
      await owner.reload();
      await expect(owner.getByText('Verified synthetic evidence — not an IRN').first()).toBeVisible();
      await expect(owner.getByText('Simulation reference').first()).toBeVisible();
      await expect(owner.getByText(/Verified simulation · legal hold remains/).first()).toBeVisible();
      expect(await val(admin, 'select irn value from restaurant_invoices where id=$1', [saved.id])).toBeNull();
      expect(await val(admin, 'select irp_status::text value from restaurant_invoices where id=$1', [saved.id])).toBe('pending');
      await expect(owner.getByRole('button', { name: 'Print / Save PDF' })).toHaveCount(0);

      // Local void needs the IRP evidence reconciled first, even after acceptance.
      const voidAttempt = await sql('select id from restaurant_invoices where id=$1', [saved.id]);
      expect(voidAttempt).toHaveLength(1);
      const refusal = await as('authenticated', async client => {
        await client.query("select set_config('request.jwt.claim.sub',$1,true)", [(await admin.query(
          "select user_id from memberships where restaurant_id=$1 and role='owner' limit 1", [outlet])).rows[0].user_id]);
        try {
          await val(client, 'select public.void_restaurant_invoice($1,$2)', [saved.id, 'Synthetic void attempt']);
          return null;
        } catch (error) { return error as { code?: string; message: string }; }
      });
      expect(refusal?.code).toBe('P0001');
      expect(refusal?.message).toMatch(/Reconcile IRP evidence/i);

      // Cancellation: requested in the UI, confirmed by the simulated provider.
      await owner.getByLabel('Simulation cancellation reason').selectOption('1');
      await owner.getByRole('button', { name: 'Queue simulation cancellation' }).click();
      await expect(owner.getByRole('status')).toContainText('No IRN or cancellation was issued by this action');
      await waitPhase(job, 'cancel_queued');
      await due(job);
      expect(await run(job)).toBe('recorded');
      await owner.reload();
      await expect(owner.getByText('Simulation cancellation confirmed').first()).toBeVisible();
      await expect(owner.getByText(/Cancellation recorded at/).first()).toBeVisible();
      expect(await val(admin, 'select irn value from restaurant_invoices where id=$1', [saved.id])).toBeNull();
      expect(await val(admin, 'select irp_status::text value from restaurant_invoices where id=$1', [saved.id])).toBe('pending');
      await guest.close();
      await manager.close();
      await owner.close();
    } finally { await ownerCtx.close(); await managerCtx.close(); }
  });

  test('a lost response is looked up, never resent, and B2C stays untouched', async ({ browser }) => {
    test.setTimeout(240_000);
    const ownerCtx = await staffContext(browser, outletRole(d));
    const guest = await ownerCtx.browser()!.newPage();
    const owner = await ownerCtx.newPage();
    try {
      await ensureRoute(owner);
      // Same flow, but the first provider answer is lost after acceptance.
      await scan(guest, d, 'D2');
      await addToCart(guest, 'IRP thali');
      await cartCheckout(guest);
      await verify(guest, await venueCode(d));
      await place(guest).click();
      await expect(guest).toHaveURL(/\/menu\/order\?/);
      const [ticket] = await tickets(d, 'D2');
      await owner.goto(`/cashier?order=${ticket.id}`);
      await owner.getByRole('button', { name: /Record cash/ }).click();
      await expect(owner.getByRole('status').filter({ hasText: /cash .*recorded/i })).toBeVisible();
      const saved = await finishSitting(owner, ticket, BUYER, { print: false });
      await owner.getByRole('button', { name: 'Validate IRP payload offline' }).click();
      await expect(owner.getByRole('status')).toContainText('Not submitted; the IRN hold remains');
      await owner.goto('/dashboard/reports/irp');
      const draft = owner.locator('li').filter({ has: owner.getByRole('link', { name: saved.invoice_number, exact: true }) });
      await draft.getByRole('button', { name: 'Queue simulation' }).click();
      await expect(owner.getByText('Simulation — not filed with GST')).toBeVisible();
      const job = await dispatchId(saved.id);
      await due(job);
      expect(job).toBeTruthy();
      const first = await run(job, { generate: 'accept_then_timeout' });
      expect(first, await val(admin, 'select phase::text value from irp_dispatches where id=$1', [job])).toBe('recorded');
      await owner.reload();
      await expect(owner.getByText('Simulation reference')).toHaveCount(0);
      await expect(owner.getByRole('button', { name: 'Request lookup' })).toBeVisible();
      await expect(owner.getByRole('button', { name: 'Queue retry' })).toHaveCount(0);
      expect(await val(admin, 'select irn value from restaurant_invoices where id=$1', [saved.id])).toBeNull();
      // The lookup finds the accepted synthetic document; no second submission.
      await owner.getByRole('button', { name: 'Request lookup' }).click();
      await expect(owner.getByRole('status')).toContainText('No IRN or cancellation was issued by this action');
      await waitPhase(job, 'lookup_queued');
      await due(job);
      expect(await run(job)).toBe('recorded');
      await owner.reload();
      await expect(owner.getByText('Verified synthetic evidence — not an IRN').first()).toBeVisible();
      await expect(owner.getByText(/Claims: 1 generate · 1 lookup/)).toBeVisible();
      expect(await val(admin, 'select irn value from restaurant_invoices where id=$1', [saved.id])).toBeNull();

      // Ordinary B2C at the same outlet is printable, shareable and not held.
      const guest2 = await ownerCtx.browser()!.newPage();
      await scan(guest2, d, 'D3');
      await addToCart(guest2, 'IRP thali');
      await cartCheckout(guest2);
      await verify(guest2, await venueCode(d));
      await place(guest2).click();
      await expect(guest2).toHaveURL(/\/menu\/order\?/);
      const [walkIn] = await tickets(d, 'D3');
      await owner.goto(`/cashier?order=${walkIn.id}`);
      await owner.getByRole('button', { name: /Record cash/ }).click();
      await expect(owner.getByRole('status').filter({ hasText: /cash .*recorded/i })).toBeVisible();
      const b2c = await finishSitting(owner, walkIn);
      expect(b2c).toMatchObject({ document_type: 'gst_tax_invoice', irp_status: 'not_required' });
      await expect(owner.getByRole('button', { name: 'Print / Save PDF' })).toBeVisible();
      await expect(owner.getByText(/IRN pending/)).toHaveCount(0);
      await owner.getByRole('button', { name: 'Create 24-hour link' }).click();
      const link = new URL(await owner.getByLabel('New secure receipt link').inputValue());
      const shared = await ownerCtx.browser()!.newPage();
      await shared.goto(link.pathname);
      await expect(shared.locator('[data-invoice-sheet]')).toContainText(b2c.invoice_number);
      await shared.close();
      await guest2.close();
    } finally { await guest.close(); await owner.close(); await ownerCtx.close(); }
  });
});
