type OrderError = { code: string; message: string; hint: string; details: string };
export function decodeOrderAttempt(value: unknown): { data: string | null; error: OrderError | null } {
  if (value && typeof value === 'object') {
    const row=value as Record<string,unknown>;
    if(typeof row.code==='string' && row.code.length>0 && row.error===null) return {data:row.code,error:null};
    if(row.code===null && row.error && typeof row.error==='object') {
      const error=row.error as Record<string,unknown>;
      if(typeof error.code==='string' && typeof error.message==='string') return {data:null,error:{code:error.code,message:error.message,hint:typeof error.hint==='string'?error.hint:'',details:''}};
    }
  }
  return {data:null,error:{code:'ORDER_RESULT_INVALID',message:'The order service returned an invalid result.',hint:'',details:''}};
}
