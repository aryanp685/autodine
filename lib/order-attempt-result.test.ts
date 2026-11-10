import {describe,expect,it} from 'vitest';
import {decodeOrderAttempt} from './order-attempt-result';
describe('versioned order admission results',()=>{
 it('accepts a successful code',()=>expect(decodeOrderAttempt({code:'AD-123',error:null})).toEqual({data:'AD-123',error:null}));
 it('preserves committed rate refusals for existing guest feedback',()=>{
  const result=decodeOrderAttempt({code:null,error:{code:'P0001',message:'Too many orders right now. Please wait 60 seconds and try again.',hint:'rate-limited'}});
  expect(result.error?.hint).toBe('rate-limited');expect(result.data).toBeNull();
 });
 it('fails closed on missing, legacy or contradictory response shapes',()=>{
  for(const value of [null,'AD-123',{}, {code:'AD-123',error:{}},{code:null,error:null}]) expect(decodeOrderAttempt(value).error?.code).toBe('ORDER_RESULT_INVALID');
 });
});
