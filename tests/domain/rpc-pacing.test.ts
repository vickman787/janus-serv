import {it,expect,vi} from 'vitest';
import {UnaryCall,type MethodInfo} from '@protobuf-ts/runtime-rpc';
import {pacedRpcRequests,isProviderRateLimit} from '../../packages/chain/src/tatum.js';
it('spaces RPC starts and invokes every call exactly once, including execution',async()=>{
 vi.useFakeTimers();try{const starts:number[]=[];const interceptor=pacedRpcRequests(600);const method={} as MethodInfo;
 const next=()=>{starts.push(Date.now());return new UnaryCall(method,{}, {},Promise.resolve({}),Promise.resolve({ok:true}),Promise.resolve({code:'OK',detail:''}),Promise.resolve({}));};
 const calls=[0,1,2].map(()=>interceptor.interceptUnary!(next,method,{},{}));
 await vi.advanceTimersByTimeAsync(0);expect(starts).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(599);expect(starts).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(1);expect(starts).toHaveLength(2);
 await vi.advanceTimersByTimeAsync(600);await Promise.all(calls.map(c=>c.response));expect(starts).toHaveLength(3);expect(starts[1]!-starts[0]!).toBe(600);expect(starts[2]!-starts[1]!).toBe(600);
 }finally{vi.useRealTimers();}
});
it('recognizes provider throttling without treating other failures as rate limits',()=>{expect(isProviderRateLimit(new Error('Received HTTP status code 429'))).toBe(true);expect(isProviderRateLimit({code:'RESOURCE_EXHAUSTED'})).toBe(true);expect(isProviderRateLimit(new Error('other failure'))).toBe(false);});
