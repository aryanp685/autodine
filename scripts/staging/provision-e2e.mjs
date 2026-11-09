/** Only the explicitly-approved nonproduction project. No existing row edits,
 * no production endpoint, no email sends, no destructive cleanup. */
import { createClient } from '@supabase/supabase-js';
import { randomBytes,randomUUID } from 'node:crypto';
import { appendFile,mkdir,writeFile } from 'node:fs/promises';
const ref='juwyhslzchjevqkdvwjm';
const url=process.env.STAGING_SUPABASE_URL;
const key=process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
let base,share;
try {base=new URL(process.env.STAGING_BASE_URL||'https://invalid.invalid');share=new URL(process.env.STAGING_SHARE_URL||'https://invalid.invalid');}
catch {throw new Error('Staging endpoint/share URL is invalid; refusing fixture writes.');}
if(url!==`https://${ref}.supabase.co` || !key || base.origin!=='https://new-git-arena-3711df6a-autodine-iamjarvis9896-3988s-projects.vercel.app' || share.origin!==base.origin || !share.searchParams.get('_vercel_share')) throw new Error('Missing approved staging endpoint/credentials/share access; refusing fixture writes.');
const mask=value=>{if(process.env.GITHUB_ACTIONS)console.log(`::add-mask::${value}`);};
mask(key);mask(share.href);mask(share.searchParams.get('_vercel_share'));
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const run=randomUUID();const email=`arena-${run}@example.invalid`;const password=randomBytes(32).toString('hex');mask(password);mask(email);
await mkdir('.staging-private',{recursive:true});
// Persist IDs even after a partial setup failure. Do not upload this private file.
const manifest={run,project:ref,createdUserId:null,restaurantId:null};
const save=()=>writeFile('.staging-private/fixture-manifest.json',JSON.stringify(manifest),{mode:0o600});
async function insert(table,row){const result=await admin.from(table).insert(row).select('id').single();if(result.error)throw new Error(`Staging fixture ${table} insert failed (${result.error.code||'unknown'}).`);return result.data.id;}
const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Arena isolated E2E owner',arena_fixture:run}});
if(created.error||!created.data.user)throw new Error('Staging Auth fixture creation failed.');
manifest.createdUserId=created.data.user.id;await save();
const profile=await admin.from('profiles').upsert({id:manifest.createdUserId,full_name:'Arena isolated E2E owner'},{onConflict:'id'});
if(profile.error)throw new Error('Staging fixture profile failed.');
const slug=`arena-e2e-${run}`;
manifest.restaurantId=await insert('restaurants',{slug,name:'Arena E2E disposable fixture',address:'Synthetic test fixture',tax_rate_bps:0,guest_verification_mode:'scan'});await save();
console.log('STAGING_FIXTURE_IDS',JSON.stringify({run,restaurantId:manifest.restaurantId}));
await insert('memberships',{restaurant_id:manifest.restaurantId,user_id:manifest.createdUserId,role:'owner'});
const menu=await insert('menus',{restaurant_id:manifest.restaurantId,name:'E2E menu',is_published:true});
const category=await insert('categories',{restaurant_id:manifest.restaurantId,menu_id:menu,name:'E2E mains'});
await insert('items',{restaurant_id:manifest.restaurantId,category_id:category,name:'E2E plain dish',price_paise:12500,is_available:true,is_veg:true});
const cards={};
for(const [index,spec] of ['guest-order-flow','cashier-flow','kitchen-flow','security-flow'].entries()){
 const label=`E2E-T${index+1}`;
 const table=await insert('dining_tables',{restaurant_id:manifest.restaurantId,label,seats:4});
 const card=await admin.from('table_qr_codes').select('public_token').eq('table_id',table).is('revoked_at',null).single();
 if(card.error||!card.data?.public_token)throw new Error('Staging fixture QR provisioning failed.');
 cards[`${spec}.spec.ts`]={token:card.data.public_token,label};mask(card.data.public_token);
}
const first=cards['guest-order-flow.spec.ts'];
const owner=createClient(url,process.env.STAGING_SUPABASE_PUBLISHABLE_KEY||key,{auth:{persistSession:false,autoRefreshToken:false}});
const session=await owner.auth.signInWithPassword({email,password});
if(session.error)throw new Error('Real staging fixture Auth sign-in failed.');
const verification=await owner.rpc('current_verification_code',{p_restaurant_id:manifest.restaurantId});
const code=Array.isArray(verification.data)?verification.data[0]?.code:verification.data?.code;
if(verification.error||!code)throw new Error('Staging fixture verification code could not be read.');
mask(String(code));
const env={E2E_CARDS_JSON:JSON.stringify(cards),E2E_TABLE_LABEL:first.label,E2E_BASE_URL:base.origin,E2E_SLUG:slug,E2E_QR_TOKEN:first.token,E2E_TABLE_CODE:String(code),E2E_OWNER_EMAIL:email,E2E_OWNER_PASSWORD:password};
await writeFile('.staging-private/fixture-env.json',JSON.stringify(env),{mode:0o600});
if(process.env.GITHUB_ENV)for(const [name,value]of Object.entries(env))await appendFile(process.env.GITHUB_ENV,`${name}=${value}\n`);
console.log('New isolated staging fixture provisioned; real Auth login checked. No external email sent.');
console.log('Fixtures retained by run namespace for inspection; do not delete issued invoices or existing tenant data automatically.');
