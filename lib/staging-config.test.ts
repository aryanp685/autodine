import { describe,expect,it } from 'vitest';
import { assertExpectedProject } from './staging-config';
const ref='juwyhslzchjevqkdvwjm';
describe('staging project isolation',()=>{
 it('does not change non-staging configuration',()=>expect(()=>assertExpectedProject('','',undefined)).not.toThrow());
 it('accepts the designated project',()=>expect(()=>assertExpectedProject(`https://${ref}.supabase.co`,'sb_secret_example',ref)).not.toThrow());
 it.each(['https://otherproject.supabase.co','http://juwyhslzchjevqkdvwjm.supabase.co','not-a-url'])('refuses wrong or unsafe URL: %s',url=>expect(()=>assertExpectedProject(url,'',ref)).toThrow());
 it('rejects an inherited production JWT without exposing it',()=>{
 const key='a.'+btoa(JSON.stringify({ref:'different'}))+'.c';
 expect(()=>assertExpectedProject(`https://${ref}.supabase.co`,key,ref)).toThrow('credential project mismatch');
 });
});
