/** Populated forward-upgrade guard, called only inside verify-database's
 * randomly created, loopback-only database. Never a hosted migration runner. */
import assert from 'node:assert/strict';
export async function financialFingerprint(db) {
  const tables=(await db.query(`select n.nspname,c.relname,c.relacl::text,c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','auth','storage') and c.relkind='r' order by 1,2`)).rows;
  const content=[];
  const quote=s=>'"'+s.replaceAll('"','""')+'"';
  for(const table of tables) {
    const row=(await db.query(`select count(*)::text n,
      md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash
      from ${quote(table.nspname)}.${quote(table.relname)} t`)).rows[0];
    content.push({...table,...row});
  }
  const policies=(await db.query(`select schemaname,tablename,policyname,roles,cmd,qual,with_check
    from pg_policies where schemaname='public' order by tablename,policyname`)).rows;
  const functions=(await db.query(`select p.oid::regprocedure::text signature,p.proacl::text acl,
    p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on p.pronamespace=n.oid
    where n.nspname='public' order by 1`)).rows;
  return {content,policies,functions};
}
export async function prepareFinancialUpgrade(db) {
  await db.query(`do $$
  declare actor uuid:=gen_random_uuid(); rid uuid; tid uuid; mid uuid; cid uuid; iid uuid;
    token text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
    guest text; ticket text; oid uuid; sitting uuid;
  begin
    insert into profiles(id) values(actor);
    insert into restaurants(slug,name,address,tax_rate_bps,guest_verification_mode)
      values('financial-upgrade-fixture','Upgrade fixture','Local test address',0,'scan') returning id into rid;
    insert into memberships(restaurant_id,user_id,role) values(rid,actor,'owner');
    insert into menus(restaurant_id,name,is_published) values(rid,'Main',true) returning id into mid;
    insert into categories(restaurant_id,menu_id,name) values(rid,mid,'Food') returning id into cid;
    insert into items(restaurant_id,category_id,name,price_paise,is_available)
      values(rid,cid,'Dish',12500,true) returning id into iid;
    insert into dining_tables(restaurant_id,label) values(rid,'Upgrade T1') returning id into tid;
    insert into table_qr_codes(restaurant_id,table_id,public_token) values(rid,tid,token);
    select session_token into guest from open_table_session(token,repeat('b',64));
    ticket:=place_public_order('financial-upgrade-fixture',jsonb_build_array(jsonb_build_object('itemId',iid,'qty',2)),null,guest,gen_random_uuid(),null);
    select id,order_session_id into oid,sitting from orders where restaurant_id=rid and code=ticket;
    perform set_config('request.jwt.claim.sub',actor::text,true);
    -- Issue unpaid first, then collect: preserve both invoice and supplemental receipt.
    perform close_order_session_and_issue_receipt(sitting);
    perform record_counter_payment('financial-upgrade-fixture',oid,'cash',25000,gen_random_uuid());
  end $$;`);
  const snapshot=await financialFingerprint(db);
  for(const name of ['orders','order_items','payments','payment_audit_events','restaurant_invoices','restaurant_payment_receipts']) {
    assert.ok(Number(snapshot.content.find(t=>t.relname===name)?.n)>0, `Missing populated ${name}`);
  }
  return snapshot;
}
export async function checkFinancialUpgrade(db,before) {
  assert.deepEqual(await financialFingerprint(db),before,
    'Financial upgrade must preserve row content, table ACL/RLS, policies and function security settings');
  console.log('FINANCIAL_FORWARD_UPGRADE_PRESERVED',JSON.stringify({tables:before.content.length,
    policies:before.policies.length,functions:before.functions.length,productionClaim:false}));
}
