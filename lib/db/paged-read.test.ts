import { describe, expect, it, vi } from 'vitest';
import { readAllRows } from './paged-read';
describe('complete PostgREST reads', () => {
  it('does not silently truncate at the server row cap', async () => {
    const rows=Array.from({length:1201},(_,id)=>({id}));
    const page=vi.fn(async(from:number,to:number)=>({data:rows.slice(from,to+1),error:null}));
    const result=await readAllRows(page);
    expect(result.data).toHaveLength(1201);expect(page).toHaveBeenCalledTimes(3);
  });
  it('returns query failures without partial-success data',async()=>{
    const error={code:'42501',message:'Denied'};
    expect(await readAllRows(async()=>({data:null,error}))).toEqual({data:null,error});
  });
});

describe('paged read safety',()=>{
  it('rejects an invalid page size instead of spinning forever',async()=>{
    await expect(readAllRows(async()=>({data:[],error:null}),0)).rejects.toThrow('Invalid page size');
  });
  it('fails explicitly rather than returning a silently truncated large view',async()=>{
    await expect(readAllRows(async()=>({data:Array.from({length:500},(_,id)=>({id})),error:null}))).rejects.toThrow('safe read size');
  });
});
