/** Only the explicitly-approved nonproduction project. No existing row edits,
 * no production endpoint, no email sends, no destructive cleanup. */
import { createClient } from '@supabase/supabase-js';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
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
const manifest={run,project:ref,createdUserId:null,restaurantId:null,otherRestaurantId:null,otherOrderId:null,expiredSessionId:null,revokedCardId:null};
const save=()=>writeFile('.staging-private/fixture-manifest.json',JSON.stringify(manifest),{mode:0o600});
async function insert(table,row){const result=await admin.from(table).insert(row).select('id').single();if(result.error)throw new Error(`Staging fixture ${table} insert failed (${result.error.code||'unknown'}).`);return result.data.id;}
const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Arena isolated E2E owner',arena_fixture:run}});
if(created.error||!created.data.user)throw new Error('Staging Auth fixture creation failed.');
manifest.createdUserId=created.data.user.id;await save();
const profile=await admin.from('profiles').upsert({id:manifest.createdUserId,full_name:'Arena isolated E2E owner'},{onConflict:'id'});
if(profile.error)throw new Error('Staging fixture profile failed.');
const slug=`arena-e2e-${run}`;
manifest.restaurantId=await insert('restaurants',{slug,name:'Arena E2E disposable fixture',address:'Synthetic test fixture',tax_rate_bps:0,guest_verification_mode:'scan',upi_id:'autodine-synthetic@invalid',upi_payee_name:'Synthetic E2E NO TRANSFER'});await save();
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
const owner=createClient(url,process.env.STAGING_SUPABASE_PUBLISHABLE_KEY||key,{auth:{persistSession:false,autoRefreshToken:false}});
const session=await owner.auth.signInWithPassword({email,password});
if(session.error)throw new Error('Real staging fixture Auth sign-in failed.');
// Deliberately dead card: permanent printed cards revoke, they do not expire.
const deadTable=await insert('dining_tables',{restaurant_id:manifest.restaurantId,label:'E2E-DEAD'});
const revokedToken=randomBytes(32).toString('hex');mask(revokedToken);
manifest.revokedCardId=await insert('table_qr_codes',{restaurant_id:manifest.restaurantId,table_id:deadTable,public_token:revokedToken,revoked_at:new Date().toISOString()});await save();
// A database-expired session whose browser cookie will deliberately claim a
// future expiry. The database, not cookie timestamps, must decide access.
const staleToken=randomBytes(32).toString('hex');mask(staleToken);
const liveStaleCard=await admin.from('table_qr_codes').select('id').eq('table_id',deadTable).is('revoked_at',null).single();
if(liveStaleCard.error)throw new Error('Expired session live card setup failed.');
manifest.expiredSessionId=await insert('table_verification_sessions',{restaurant_id:manifest.restaurantId,table_id:deadTable,qr_code_id:liveStaleCard.data.id,token_hash:createHash('sha256').update(staleToken).digest('hex'),created_at:new Date(Date.now()-7200000).toISOString(),expires_at:new Date(Date.now()-3660000).toISOString()});await save();
// A real second-tenant order, deliberately without membership for our owner.
const otherSlug=`arena-other-${run}`;
manifest.otherRestaurantId=await insert('restaurants',{slug:otherSlug,name:'Arena other tenant',address:'Synthetic fixture',tax_rate_bps:0,guest_verification_mode:'scan'});await save();
const otherMenu=await insert('menus',{restaurant_id:manifest.otherRestaurantId,name:'Other menu',is_published:true});
const otherCategory=await insert('categories',{restaurant_id:manifest.otherRestaurantId,menu_id:otherMenu,name:'Other mains'});
const otherItem=await insert('items',{restaurant_id:manifest.otherRestaurantId,category_id:otherCategory,name:'Other private dish',price_paise:12500,is_available:true});
const otherTable=await insert('dining_tables',{restaurant_id:manifest.otherRestaurantId,label:'OTHER-T1'});
const otherCard=await admin.from('table_qr_codes').select('public_token').eq('table_id',otherTable).is('revoked_at',null).single();
if(otherCard.error)throw new Error('Other tenant card provisioning failed.');
mask(otherCard.data.public_token);
const opened=await owner.rpc('open_table_session',{p_public_token:otherCard.data.public_token,p_ip_hash:createHash('sha256').update(run).digest('hex')});
const otherSession=opened.data?.[0]?.session_token;
if(opened.error||!otherSession)throw new Error('Other tenant session provisioning failed.');mask(otherSession);
const otherGuest=randomUUID();mask(otherGuest);
const placedOther=await owner.rpc('place_public_order',{p_slug:otherSlug,p_lines:[{itemId:otherItem,qty:1}],p_note:'Private other tenant fixture',p_session_token:otherSession,p_guest_token:otherGuest,p_ip_hash:null});
if(placedOther.error||!placedOther.data)throw new Error('Other tenant order provisioning failed.');
const otherRead=await owner.rpc('get_public_order',{p_slug:otherSlug,p_code:placedOther.data,p_token:otherGuest});
if(otherRead.error||!otherRead.data?.id)throw new Error('Other tenant real order verification failed.');
manifest.otherOrderId=otherRead.data.id;await save();
const first=cards['guest-order-flow.spec.ts'];
const verification=await owner.rpc('current_verification_code',{p_restaurant_id:manifest.restaurantId});
const code=Array.isArray(verification.data)?verification.data[0]?.code:verification.data?.code;
if(verification.error||!code)throw new Error('Staging fixture verification code could not be read.');
mask(String(code));
const env={E2E_OTHER_ORDER_ID:manifest.otherOrderId,E2E_REVOKED_QR_TOKEN:revokedToken,E2E_EXPIRED_SESSION_TOKEN:staleToken,E2E_CARDS_JSON:JSON.stringify(cards),E2E_TABLE_LABEL:first.label,E2E_BASE_URL:base.origin,E2E_SLUG:slug,E2E_QR_TOKEN:first.token,E2E_TABLE_CODE:String(code),E2E_OWNER_EMAIL:email,E2E_OWNER_PASSWORD:password};
await writeFile('.staging-private/fixture-env.json',JSON.stringify(env),{mode:0o600});
if(process.env.GITHUB_ENV)for(const [name,value]of Object.entries(env))await appendFile(process.env.GITHUB_ENV,`${name}=${value}\n`);
console.log('New isolated staging fixture provisioned; real Auth login checked. No external email sent.');
console.log('Fixtures retained by run namespace for inspection; do not delete issued invoices or existing tenant data automatically.');
