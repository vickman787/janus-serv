import {TransitionBCS} from '../../packages/chain/src/handover.js';
import { mkdtempSync,writeFileSync,unlinkSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64 } from '@mysten/sui/utils';
import { describe,it,expect,vi } from 'vitest';
import {applicationRoutes} from '../../apps/api/src/routes.js';
import type {IncomingMessage,ServerResponse} from 'node:http';
import { fixture,CONTROL,PROPOSAL,PACKAGE } from './fixture.js';
function child(dir:string,phase:string,mode:string){return new Promise<number|null>((resolve,reject)=>{const p=spawn(process.execPath,['--import','tsx','tests/recovery/child.ts',dir,phase,mode],{stdio:'pipe'});let error='';p.stderr.on('data',v=>error+=v);p.once('error',reject);p.once('exit',code=>{if(code!==0&&phase==='none')reject(new Error(error));else resolve(code);});});}
async function setup(){const dir=mkdtempSync(join(tmpdir(),'janus-recovery-')),wallet=Ed25519Keypair.generate(),successorWallet=Ed25519Keypair.generate(),successor=successorWallet.toSuiAddress(),admin=wallet.toSuiAddress();const f=fixture(dir,admin,successor);const input={label:'Explicit local recovery fixture',control:CONTROL,successor,expiresAtMs:'1000000',public:false};const result=await f.engine.create(input,admin,'session');const signed=await wallet.signTransaction(fromBase64(result.preparation.bytes));const config={admin,successor,input,preparation:result.preparation,signed};writeFileSync(dir+'/request.json',JSON.stringify(config));f.db.close();return{dir,config,wallet,successorWallet};}
describe('actual process termination with explicitly mocked chain and remote memory',()=>{
 it.each(['before_broadcast','after_broadcast','after_chain','after_final'])('recovers %s without repeating a business transition',async phase=>{
  const{dir,config}=await setup();await child(dir,phase,'submit');expect(readFileSync(dir+'/terminated-at','utf8')).toBe(phase);const f=fixture(dir,config.admin,config.successor);f.db.prepare('UPDATE leases SET expires=0').run();f.db.close();
  await child(dir,'none','recover');const restarted=fixture(dir,config.admin,config.successor);const count=restarted.read().count;
  if(phase==='before_broadcast'){expect(count).toBe(0);expect(restarted.engine.preparation(config.preparation.id).state).toBe('unresolved');}
  else{expect(count).toBe(1);expect(restarted.engine.preparation(config.preparation.id).state).toBe('completed');expect((await restarted.engine.restore(restarted.engine.row(config.preparation.operationId!))).stage).toBe('awaiting_acceptance');}
  restarted.db.close();
 },30000);
 it('repairs chain success after a memory outage without resubmitting',async()=>{const{dir,config}=await setup();const f=fixture(dir,config.admin,config.successor,point=>{if(point==='after_chain')writeFileSync(dir+'/memory-down','1');});const r=await f.engine.submit(config.preparation.id,config.admin,'session',config.signed) as{status:string};expect(r.status).toBe('chain_confirmed_memory_pending');expect(f.read().count).toBe(1);f.db.close();unlinkSync(dir+'/memory-down');const restarted=fixture(dir,config.admin,config.successor);await restarted.engine.recover(config.preparation.id);expect(restarted.read().count).toBe(1);expect(restarted.engine.preparation(config.preparation.id).state).toBe('completed');restarted.db.close();},30000);
 it('blocks wrong actors and changed proposals',async()=>{const{dir,config}=await setup();const f=fixture(dir,config.admin,config.successor);await f.engine.submit(config.preparation.id,config.admin,'session',config.signed);await expect(f.engine.prepare(config.preparation.operationId!,'accept',config.admin,'session')).rejects.toThrow('role');const s=f.read();s.successor=`0x${'f'.repeat(64)}`;s.revision='2';f.save(s);expect((await f.engine.view(config.preparation.operationId!,config.admin)).verdict.code).toBe('mismatch');await expect(f.engine.prepare(config.preparation.operationId!,'accept',config.successor,'s')).rejects.toThrow('mismatch');expect(f.read().count).toBe(1);f.db.close();},30000);
});

it('completes the two-wallet proposal/acceptance lifecycle against explicit fixtures',async()=>{const{dir,config,successorWallet}=await setup();const f=fixture(dir,config.admin,config.successor);await f.engine.submit(config.preparation.id,config.admin,'session',config.signed);const p=await f.engine.prepare(config.preparation.operationId!,'accept',config.successor,'successor-session');const signed=await successorWallet.signTransaction(fromBase64(p.bytes));await f.engine.submit(p.id,config.successor,'successor-session',signed);expect(f.read().admin).toBe(config.successor);expect((await f.engine.view(config.preparation.operationId!,config.successor)).verdict.code).toBe('completed');await expect(f.engine.setup('increment',config.admin,'old-session',CONTROL)).rejects.toThrow('administrator');expect(f.read().count).toBe(2);f.db.close();},30000);
it('two actual workers cannot submit the same prepared business action twice',async()=>{const{dir,config}=await setup();await Promise.allSettled([child(dir,'none','submit'),child(dir,'none','submit')]);const f=fixture(dir,config.admin,config.successor);expect(f.read().count).toBe(1);expect(f.engine.preparation(config.preparation.id).state).toBe('completed');f.db.close();},30000);
it('blocks expiry during wallet approval and changed bytes',async()=>{const{dir,config}=await setup();const f=fixture(dir,config.admin,config.successor);await expect(f.engine.submit(config.preparation.id,config.admin,'session',{...config.signed,bytes:'changed'})).rejects.toThrow('changed');const s=f.read();s.clock='1000000';f.save(s);await expect(f.engine.submit(config.preparation.id,config.admin,'session',config.signed)).rejects.toThrow('expired');expect(f.read().count).toBe(0);f.db.close();},30000);
it('missing remote checkpoint never falls back to indexed context',async()=>{const{dir,config}=await setup();writeFileSync(dir+'/remote-memory.json','{}');const f=fixture(dir,config.admin,config.successor);expect((await f.engine.view(config.preparation.operationId!,config.admin)).verdict.code).toBe('memory_unavailable');await expect(f.engine.submit(config.preparation.id,config.admin,'session',config.signed)).rejects.toThrow('Missing fixture');expect(f.read().count).toBe(0);f.db.close();},30000);

it('scopes actual stored preferences by owner, amendment revision and revocation',async()=>{const{dir,config}=await setup();const f=fixture(dir,config.admin,config.successor);await f.engine.savePreference(config.admin,false,'detailed');expect((await f.engine.preference(config.admin))?.reviewStyle).toBe('detailed');expect(await f.engine.preference(config.successor)).toBeNull();await f.engine.savePreference(config.admin,false,'concise');expect((await f.engine.preference(config.admin))?.revision).toBe(1);expect((await f.engine.preference(config.admin))?.reviewStyle).toBe('concise');await f.engine.savePreference(config.admin,true,'concise');f.db.close();const restarted=fixture(dir,config.admin,config.successor);expect(await restarted.engine.preference(config.admin)).toBeNull();restarted.db.close();},30000);

it.each(['before_intent','after_intent'])('actual worker death %s cannot cause a chain action',async phase=>{const dir=mkdtempSync(join(tmpdir(),'janus-prepare-crash-')),admin=Ed25519Keypair.generate().toSuiAddress(),successor=Ed25519Keypair.generate().toSuiAddress();const f=fixture(dir,admin,successor);f.db.close();writeFileSync(dir+'/request.json',JSON.stringify({admin,successor,input:{label:'Prepare crash fixture',control:CONTROL,successor,expiresAtMs:'1000000',public:false}}));await child(dir,phase,'create');expect(readFileSync(dir+'/terminated-at','utf8')).toBe(phase);const restarted=fixture(dir,admin,successor);expect(restarted.read().count).toBe(0);const prep=restarted.db.prepare('SELECT * FROM preparations').get() as {state:string};expect(prep.state).toBe(phase==='before_intent'?'memory_pending':'prepared');restarted.db.close();},30000);

it('retries storage only after a memory job is confirmed failed',async()=>{const{dir,config}=await setup();const f=fixture(dir,config.admin,config.successor);Object.assign(f.engine.memory,{client:{getRememberStatus:async()=>({status:'failed'})}});f.db.prepare('INSERT INTO memory_jobs VALUES (?,?,?,?,?)').run('failed-job','fixture','hash','failed-job-scope','pending');const record={kind:'journal' as const,owner:config.admin,sequence:0,createdAt:new Date().toISOString(),data:{fixture:'known terminal storage failure'}};const before=Object.keys(JSON.parse(readFileSync(dir+'/remote-memory.json','utf8'))).length;await f.engine.persist('failed-job-scope',record);expect((f.db.prepare('SELECT status FROM memory_jobs WHERE id=?').get('failed-job') as {status:string}).status).toBe('failed');expect(Object.keys(JSON.parse(readFileSync(dir+'/remote-memory.json','utf8')))).toHaveLength(before+1);expect(f.read().count).toBe(0);f.db.close();},30000);
it('does not replace an unknown accepted memory job',async()=>{const{dir,config}=await setup();const f=fixture(dir,config.admin,config.successor);Object.assign(f.engine.memory,{client:{getRememberStatus:async()=>({status:'not_found'}),waitForRememberJob:async()=>{throw new Error('Unknown job, still unresolved');}}});f.db.prepare('INSERT INTO memory_jobs VALUES (?,?,?,?,?)').run('unknown-job','fixture','hash','unknown-job-scope','pending');const before=readFileSync(dir+'/remote-memory.json','utf8');await expect(f.engine.persist('unknown-job-scope',{kind:'journal',owner:config.admin,sequence:0,createdAt:new Date().toISOString(),data:{fixture:'unknown'}})).rejects.toThrow('unresolved');expect(readFileSync(dir+'/remote-memory.json','utf8')).toBe(before);f.db.close();},30000);

it('keeps a changed proposal blocked until explicit review and applies saved memory in a fresh engine',async()=>{const{dir,config,wallet}=await setup();const f=fixture(dir,config.admin,config.successor);await f.engine.submit(config.preparation.id,config.admin,'session',config.signed);await f.engine.savePreference(config.admin,false,'detailed');const next=Ed25519Keypair.generate().toSuiAddress();const p=await f.engine.prepare(config.preparation.operationId!,'change_successor',config.admin,'session',next);const signed=await wallet.signTransaction(fromBase64(p.bytes));await f.engine.submit(p.id,config.admin,'session',signed);expect(f.read().successor).toBe(next);f.db.close();const restarted=fixture(dir,config.admin,config.successor);const view=await restarted.engine.view(config.preparation.operationId!,config.admin);expect(view.verdict.code).toBe('mismatch');expect(view.verdict.differences.some(d=>d.field==='successor')).toBe(true);expect(view.preference?.owner).toBe(config.admin);await restarted.engine.approveLive(config.preparation.operationId!,config.admin);const reviewed=await restarted.engine.view(config.preparation.operationId!,next);expect(reviewed.verdict.code).toBe('ready');expect(restarted.read().count).toBe(2);restarted.db.close();},30000);

it('uses typed event evidence when object-type discovery is unavailable',async()=>{const{dir,config}=await setup();const f=fixture(dir,config.admin,config.successor);const original=f.engine.chain.transaction.bind(f.engine.chain);f.engine.chain.transaction=async digest=>{const result=await original(digest);if(result.kind!=='unknown'){result.tx.objectTypes={};result.tx.events=[{packageId:PACKAGE,module:'handover',sender:config.admin,eventType:PACKAGE+'::handover::Transition',json:null,bcs:TransitionBCS.serialize({control:CONTROL,proposal:PROPOSAL,operation_id:config.preparation.operationId!,revision:'1',administrator:config.admin,successor:config.successor,expires_at_ms:'1000000',stage:1}).toBytes()}];}return result;};await f.engine.submit(config.preparation.id,config.admin,'session',config.signed);expect(f.engine.preparation(config.preparation.id).state).toBe('completed');expect((await f.engine.restore(f.engine.row(config.preparation.operationId!))).proposalId).toBe(PROPOSAL);expect(f.read().count).toBe(1);f.db.close();},30000);


it('re-prepares identical discarded setup bytes with fresh approval identity and session',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'janus-discard-retry-')),admin=Ed25519Keypair.generate().toSuiAddress(),successor=Ed25519Keypair.generate().toSuiAddress();
 const f=fixture(dir,admin,successor);
 try {
  const first=await f.engine.setup('create',admin,'old-session');
  await f.engine.discard(first.id,admin);
  const next=await f.engine.setup('create',admin,'new-session');
  expect(next.digest).toBe(first.digest);expect(next.id).not.toBe(first.id);
  expect(()=>f.engine.preparation(first.id)).toThrow();
  expect(f.engine.preparation(next.id).session_hash).toBe('new-session');
  expect(f.engine.preparation(next.id).state).toBe('prepared');
  expect(next.expiresAt).toBeGreaterThan(Date.now());
  await expect(f.engine.submit(next.id,admin,'old-session',{bytes:next.bytes,signature:'unused'})).rejects.toThrow();
  expect(f.read().count).toBe(0);
 } finally {f.db.close();}
});
it.each(['submitting','unresolved','confirmed_memory_pending'])('never replaces a %s setup digest',async state=>{
 const dir=mkdtempSync(join(tmpdir(),'janus-live-digest-')),admin=Ed25519Keypair.generate().toSuiAddress(),successor=Ed25519Keypair.generate().toSuiAddress();
 const f=fixture(dir,admin,successor);
 try {const p=await f.engine.setup('create',admin,'session');f.db.prepare('UPDATE preparations SET state=? WHERE id=?').run(state,p.id);
 await expect(f.engine.setup('create',admin,'another-session')).rejects.toThrow('Resolve');
 expect(f.engine.preparation(p.id).state).toBe(state);expect(f.read().count).toBe(0);
 }finally{f.db.close();}
});

it('reports Walrus setup failure separately and retains the unsigned preparation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'janus-setup-memory-')),admin=Ed25519Keypair.generate().toSuiAddress(),successor=Ed25519Keypair.generate().toSuiAddress();const f=fixture(dir,admin,successor);
 try{writeFileSync(dir+'/memory-down','1');await expect(f.engine.setup('create',admin,'session')).rejects.toThrow('Walrus intent storage or retrieval');const p=f.db.prepare('SELECT state FROM preparations').get() as {state:string};expect(p.state).toBe('memory_pending');expect(f.read().count).toBe(0);}
 finally{f.db.close();}
});

it('returns the saved draft identity after preparation failure without exposing provider errors',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'janus-draft-resume-')),admin=Ed25519Keypair.generate().toSuiAddress(),successor=Ed25519Keypair.generate().toSuiAddress();const f=fixture(dir,admin,successor);
 try{f.engine.prepare=async()=>{throw new Error('sensitive upstream detail');};let error:unknown;try{await f.engine.create({label:'Resume draft fixture',control:CONTROL,successor,expiresAtMs:'1000000',public:false},admin,'session');}catch(e){error=e;}
 const e=error as {operationId:string;message:string};expect(e.operationId).toMatch(/^[0-9a-f-]{36}$/);expect(e.message).not.toContain('sensitive upstream');expect(f.engine.row(e.operationId).status).toBe('draft');expect((await f.engine.restore(f.engine.row(e.operationId))).stage).toBe('draft');expect(f.read().count).toBe(0);
 }finally{f.db.close();}
});

it('recovers the accepted setup memory job with a fresh review and no new write or broadcast',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'janus-setup-job-recovery-')),admin=Ed25519Keypair.generate().toSuiAddress(),successor=Ed25519Keypair.generate().toSuiAddress();const f=fixture(dir,admin,successor);
 try{const p=await f.engine.setup('create',admin,'old-session');const ref=JSON.parse(f.engine.preparation(p.id).ref!);f.db.prepare('DELETE FROM config WHERE key=?').run('record:setup-intent:'+p.id);f.db.prepare("UPDATE preparations SET state='memory_pending',ref=NULL WHERE id=?").run(p.id);f.db.prepare('INSERT INTO memory_jobs VALUES (?,?,?,?,?)').run('accepted-job',ref.namespace,ref.contentHash,'setup-intent:'+p.id,'pending');
 let polls=0;Object.assign(f.engine.memory,{client:{getRememberStatus:async()=>({status:'processing'}),waitForRememberJob:async(id:string)=>{expect(id).toBe('accepted-job');polls++;return{id:ref.memoryId,blob_id:ref.blobId};}},write:async()=>{throw new Error('Unexpected duplicate memory write');}});
 const recovered=await f.engine.retrySetupMemory(p.id,admin,'new-session');expect(polls).toBe(1);expect(recovered.id).not.toBe(p.id);expect(()=>f.engine.preparation(p.id)).toThrow();expect(recovered.digest).toBe(p.digest);expect(recovered.state).toBe('prepared');expect(recovered.expiresAt).toBeGreaterThan(Date.now());expect(f.engine.preparation(recovered.id).session_hash).toBe('new-session');expect(f.read().count).toBe(0);
 }finally{f.db.close();}
});
it.each(['submitting','unresolved','confirmed_memory_pending'])('never refreshes approval for a %s transaction',async state=>{
 const dir=mkdtempSync(join(tmpdir(),'janus-review-guard-')),admin=Ed25519Keypair.generate().toSuiAddress(),successor=Ed25519Keypair.generate().toSuiAddress();const f=fixture(dir,admin,successor);try{const p=await f.engine.setup('create',admin,'session');f.db.prepare('UPDATE preparations SET state=? WHERE id=?').run(state,p.id);await expect(f.engine.retrySetupMemory(p.id,admin,'session')).rejects.toThrow('unsigned');expect(f.engine.preparation(p.id).state).toBe(state);expect(f.read().count).toBe(0);}finally{f.db.close();}
});
it('refuses storage recovery by another wallet',async()=>{const dir=mkdtempSync(join(tmpdir(),'janus-review-owner-')),admin=Ed25519Keypair.generate().toSuiAddress(),successor=Ed25519Keypair.generate().toSuiAddress();const f=fixture(dir,admin,successor);try{const p=await f.engine.setup('create',admin,'session');await expect(f.engine.retrySetupMemory(p.id,successor,'session')).rejects.toThrow('your unsigned');expect(f.read().count).toBe(0);}finally{f.db.close();}});

it('reports a sponsor-rejected storage job without polling, rewriting or broadcasting',async()=>{const dir=mkdtempSync(join(tmpdir(),'janus-sponsor-rejection-')),admin=Ed25519Keypair.generate().toSuiAddress(),successor=Ed25519Keypair.generate().toSuiAddress();const f=fixture(dir,admin,successor);try{const p=await f.engine.setup('create',admin,'session');f.db.prepare('DELETE FROM config WHERE key=?').run('record:setup-intent:'+p.id);f.db.prepare("UPDATE preparations SET state='memory_pending',ref=NULL WHERE id=?").run(p.id);f.db.prepare('INSERT INTO memory_jobs VALUES (?,?,?,?,?)').run('failed-sponsored-job','fixture','hash','setup-intent:'+p.id,'pending');Object.assign(f.engine.memory,{client:{getRememberStatus:async()=>({status:'failed',error:'MoveCall to disallowed function'}),waitForRememberJob:async()=>{throw new Error('Should not poll a terminal failure');}},write:async()=>{throw new Error('Should not write another memory');}});await expect(f.engine.retrySetupMemory(p.id,admin,'session')).rejects.toThrow('storage sponsor');expect(f.engine.preparation(p.id).state).toBe('memory_pending');expect(f.engine.preparation(p.id).error).toContain('provider must correct sponsorship');expect((f.db.prepare('SELECT status FROM memory_jobs WHERE id=?').get('failed-sponsored-job') as {status:string}).status).toBe('failed');expect(f.read().count).toBe(0);}finally{f.db.close();}});


it('revalidates chain evidence after a slow journal upload',async()=>{
 const {dir,config}=await setup();const f=fixture(dir,config.admin,config.successor);
 await f.engine.submit(config.preparation.id,config.admin,'session',config.signed);
 vi.useFakeTimers();vi.setSystemTime(new Date());
 try {
  const originalPersist=f.engine.persist.bind(f.engine);
  vi.spyOn(f.engine,'persist').mockImplementation(async(scope,record)=>{const ref=await originalPersist(scope,record);if(scope.startsWith('decision:'))vi.setSystemTime(Date.now()+45000);return ref;});
  const observed=vi.spyOn(f.engine,'observe');let response:Awaited<ReturnType<typeof f.engine.view>>|undefined;
  const handler=applicationRoutes(f.engine,()=>config.admin,()=>config.admin,()=> 'session',async()=>({}),(_res,status,value)=>{expect(status).toBe(200);response=value as typeof response;});
  await handler({method:'POST',url:'/api/operations/'+config.preparation.operationId+'/revalidate'} as IncomingMessage,{} as ServerResponse);
  expect(observed).toHaveBeenCalledTimes(2);expect(response?.verdict.code).toBe('waiting_actor');
  expect(Date.now()-Date.parse(response!.live!.fetchedAt)).toBeLessThan(1000);
  expect(f.read().count).toBe(1);
 } finally {vi.useRealTimers();vi.restoreAllMocks();f.db.close();}
},30000);
