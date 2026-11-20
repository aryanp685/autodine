import { createHmac, randomBytes, randomUUID } from 'node:crypto';

/** No business outcomes are seeded: identities, catalog, settings and QR cards only. */
export async function seedJourney(db) {
  const key = `sb_publishable_journey_${randomBytes(18).toString('hex')}`;
  const fakeSigner = randomBytes(32);
  const future = Math.floor(Date.now() / 1000) + 3600;
  const identities = new Map();
  const sessions = {};
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const outlets = {};
  const syntheticGstin = (body) => {
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const sum = [...body].reduce((total, c, i) => {
      const n = alphabet.indexOf(c) * (i % 2 ? 2 : 1);
      return total + Math.floor(n / 36) + n % 36;
    }, 0);
    return body + alphabet[(36 - sum % 36) % 36];
  };

  const TUNE = {
    a: { mode: 'code', dish: 'Journey thali', tables: ['A1','A2','A3','A4','A5','A6','A7','A8','A9','A10','A11','A12'], prefix: 'A' },
    b: { mode: 'scan_confirm', dish: 'Journey sibling dish', tables: ['B1','B2','B3','B4','B5'], prefix: 'B' },
    c: { mode: 'code', dish: 'Composition meal', tables: ['C1','C2','C3','C4'], prefix: 'C' },
    d: { mode: 'code', dish: 'IRP thali', tables: ['D1','D2','D3','D4'], prefix: 'D' },
    e: { mode: 'code', dish: 'Unregistered plate', tables: ['E1','E2','E3','E4'], prefix: 'E' },
  };
  for (const [kind, tune] of Object.entries(TUNE)) {
    const slug = `journey-outlet-${kind}`;
    const { id } = await one(`insert into restaurants(slug,name,address,phone,timezone,trial_started_at,guest_verification_mode,tax_rate_bps)
      values($1,$2,'1 Synthetic Test Lane','07120000000','Asia/Kolkata',now(),$3,0) returning id`,
    [slug, `Journey Kitchen ${kind.toUpperCase()}`, tune.mode]);
    const menu = await one(`insert into menus(restaurant_id,name,is_published) values($1,'Journey Menu',true) returning id`, [id]);
    const cat = await one(`insert into categories(restaurant_id,menu_id,name) values($1,$2,'Journey Mains') returning id`, [id, menu.id]);
    const dish = await one(`insert into items(restaurant_id,category_id,name,description,image_url,price_paise,is_veg,is_available,is_alcoholic,sort_order)
      values($1,$2,$3,'Roasted in the synthetic test kitchen','/img/dishes/paneer-butter-masala.jpg',10511,true,true,false,0) returning id`, [id, cat.id, tune.dish]);
    const side = await one(`insert into items(restaurant_id,category_id,name,price_paise,is_veg,is_available,is_alcoholic,sort_order)
      values($1,$2,'Journey rice',4201,true,true,false,1) returning id`, [id, cat.id]);
    const tables = {};
    for (const label of tune.tables) {
      const table = await one(`insert into dining_tables(restaurant_id,label) values($1,$2) returning id`, [id, label]);
      const card = await one(`select public_token from table_qr_codes where table_id=$1 and revoked_at is null`, [table.id]);
      tables[label] = { ...table, card: card.public_token };
    }
    outlets[kind] = { id, slug, tables, item: dish.id, side: side.id };
  }
  const a = outlets.a;
  const variant = await one(`insert into item_variants(item_id,name,price_paise) values($1,'Large',15011) returning id`, [a.item]);
  const group = await one(`insert into item_addon_groups(item_id,name,min_select,max_select) values($1,'Extras',0,1) returning id`, [a.item]);
  const addon = await one(`insert into item_addons(group_id,name,price_paise) values($1,'Extra curd',510) returning id`, [group.id]);
  const extra = await one(`insert into item_addons(group_id,name,price_paise) values($1,'Extra pickle',702) returning id`, [group.id]);
  const draft = await one(`insert into menus(restaurant_id,name,is_published) values($1,'Journey Draft',false) returning id`, [a.id]);
  const draftCat = await one(`insert into categories(restaurant_id,menu_id,name) values($1,$2,'Unpublished category') returning id`, [a.id, draft.id]);
  const draftItem = await one(`insert into items(restaurant_id,category_id,name,price_paise) values($1,$2,'Unpublished dish',33000) returning id`, [a.id, draftCat.id]);
  Object.assign(a, { variant: variant.id, addon: addon.id, extra: extra.id, draft: draftItem.id });
  const disabled = a.tables.A11;
  await db.query('update dining_tables set is_active=false where id=$1', [disabled.id]);
  await db.query('update table_qr_codes set revoked_at=now() where table_id=$1', [a.tables.A12.id]);

  // Each additional outlet has its own owner so the GST and IRP journeys run
  // with the real role, not a superuser connection.
  const HOME = { owner: 'a', manager: 'a', cashier: 'a', kitchen: 'a', waiter: 'a',
    sibling: 'b', composition: 'c', unregistered: 'e', irp: 'd', irpmanager: 'd' };
  const SEEDED_ROLE = { sibling: 'owner', composition: 'owner', unregistered: 'owner', irp: 'owner', irpmanager: 'manager' };
  for (const role of ['owner','manager','cashier','kitchen','waiter','sibling','unassigned','composition','unregistered','irp','irpmanager']) {
    const id = randomUUID();
    const email = `${role}@journey.fixture.invalid`;
    await db.query('insert into profiles(id) values ($1)', [id]);
    if (role !== 'unassigned') await db.query(`insert into memberships(restaurant_id,user_id,role) values($1,$2,$3)`,
      [outlets[HOME[role]].id, id, SEEDED_ROLE[role] ?? role]);
    const claims = Buffer.from(JSON.stringify({ sub: id, role: 'authenticated', aud: 'authenticated', exp: future })).toString('base64url');
    const unsigned = `eyJhbGciOiJIUzI1NiJ9.${claims}`;
    const token = `${unsigned}.${createHmac('sha256', fakeSigner).update(unsigned).digest('base64url')}`;
    const user = { id, email, aud: 'authenticated', role: 'authenticated' };
    identities.set(token, user);
    sessions[role] = { access_token: token, refresh_token: `local-${randomUUID()}`, expires_at: future, expires_in: 3600, token_type: 'bearer', user };
  }

  const gstin = '27AAAAA0000A1Z2'; // checksum computed below; synthetic, never used externally
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const checksum = [...gstin.slice(0, -1)].reduce((sum, c, i) => {
    const n = alphabet.indexOf(c) * (i % 2 ? 2 : 1);
    return sum + Math.floor(n / 36) + n % 36;
  }, 0);
  await db.query('begin');
  try {
    await db.query('set local role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [sessions.owner.user.id]);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const activation = (overrides = {}) => ({ confirm:true, series_confirmed:true, effective_from:today,
      premises_address:'1 Synthetic Test Lane', premises_state_code:'27', invoice_phone:'07120000000',
      series:{INV:'INV', BOS:'BOS',RBL:'RBL',CN:'CN',DN:'DN'}, external_prefixes:[], ...overrides });
    await db.query(`select save_restaurant_gst_config($1,0,$2)`, [a.id, {
      mode:'regular', registration_type:'regular', business_type:'standalone', regular_profile:'other_than_specified_premises',
      gstin: gstin.slice(0, -1) + alphabet[(36 - checksum % 36) % 36], legal_name:'Journey Synthetic Seller',
      address:'1 Synthetic Test Lane', service_sac:'996331', fssai_number:'01234567890123',
      activation: activation({ aato:{highest_prior_fy_paise:42, reference:'Synthetic prior FY review', reporting_category:'under_10cr'} }),
    }]);
    // Composition: a tax-free Bill of Supply with the required declaration.
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [sessions.composition.user.id]);
    await db.query(`select save_restaurant_gst_config($1,0,$2)`, [outlets.c.id, {
      mode:'composition', registration_type:'composition', composition_acknowledged:true, business_type:null, regular_profile:null,
      gstin: syntheticGstin('27BBBBB0000B1Z'), pan: 'BBBBB0000B', legal_name:'Journey Composition Kitchen',
      address:'1 Synthetic Test Lane', state_code:'27', service_sac:'996331', fssai_number:'01234567890123',
      activation: activation({}),
    }]);
    // A regular outlet whose PAN-wide turnover is above the e-invoice threshold,
    // so a covered B2B document is held for IRP while B2C stays untouched.
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [sessions.irp.user.id]);
    await db.query(`select save_restaurant_gst_config($1,0,$2)`, [outlets.d.id, {
      mode:'regular', registration_type:'regular', business_type:'standalone', regular_profile:'other_than_specified_premises',
      gstin: syntheticGstin('27CCCCC0000C1Z'), pan: 'CCCCC0000C', legal_name:'Journey IRP Kitchen',
      address:'1 Synthetic Test Lane', state_code:'27', service_sac:'996331', fssai_number:'01234567890123',
      einvoice_location:'Nagpur', einvoice_pincode:'440001', einvoice_hsn_sac:'996331',
      activation: activation({ aato:{highest_prior_fy_paise:6000000000, reference:'Synthetic CA prior FY review', reporting_category:'under_10cr'} }),
    }]);
    await db.query('commit');
  } catch (error) { await db.query('rollback'); throw error; }
  return { key, identities, sessions, outlets };
}
