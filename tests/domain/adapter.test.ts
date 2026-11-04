import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryAdapter} from '../../packages/memory/src/adapter.js';
import type {MemWal} from '@mysten-incubation/memwal';
const record={kind:'intent' as const,owner:'0x'+'1'.repeat(64),sequence:0,createdAt:'2026-10-30T00:00:00Z',data:{fixture:true}};
it('retries a timed-out recall once without repeating remember',async()=>{
 let text='',namespace='',writes=0,reads=0;
 const client={remember:async(t:string,n:string)=>{text=t;namespace=n;writes++;return{job_id:'fixture-job'};},waitForRememberJob:async()=>({id:'fixture-id',blob_id:'fixture-blob'}),recall:async()=>{reads++;if(reads===1)throw Object.assign(new Error('bounded read timeout'),{name:'MemWalRequestTimeout'});return{results:[{blob_id:'fixture-blob',text}]};}} as unknown as MemWal;
 const adapter=new MemoryAdapter(client,join(mkdtempSync(join(tmpdir(),'janus-memory-retry-')),'writer.pem'));
 const ref=await adapter.write(record);expect(ref.namespace).toBe(namespace);expect(writes).toBe(1);expect(reads).toBe(2);
});
it('never automatically retries an ambiguous remember failure',async()=>{
 let writes=0;const client={remember:async()=>{writes++;throw Object.assign(new Error('write timeout'),{name:'MemWalRequestTimeout'});}} as unknown as MemWal;
 const adapter=new MemoryAdapter(client,join(mkdtempSync(join(tmpdir(),'janus-memory-write-')),'writer.pem'));
 await expect(adapter.write(record)).rejects.toThrow('write timeout');expect(writes).toBe(1);
});
