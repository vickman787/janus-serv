import { isProviderRateLimit } from '../../../packages/chain/src/tatum.js';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import { fromBase64 } from '@mysten/sui/utils';
import { Store } from './store.js';
import { ChainAdapter, ZERO, ControlCreatedBCS, TransitionBCS, type Action } from '../../../packages/chain/src/handover.js';
import { MemoryAdapter, type MemoryRef, type MemoryRecord } from '../../../packages/memory/src/adapter.js';
import { workflowSchema, type Workflow, type OperationRow } from '../../../packages/domain/src/workflow.js';
import { verifyApprovedBytes } from '../../../packages/chain/src/approved-bytes.js';
import { sha256 } from '../../../packages/memory/src/envelope.js';
export class WorkflowError extends Error { constructor(message: string, readonly status = 409, readonly operationId?: string) { super(message); } }
export type Preparation = { id: string; operation_id: string | null; actor: string; session_hash: string; action: Action; bytes: string; digest: string; conditions: string; ref: string | null; state: string; expires: number; created: string; error: string | null };
const nowIso = () => new Date().toISOString();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export class Engine {
  constructor(readonly store: Store, readonly chain: ChainAdapter, readonly memory: MemoryAdapter, readonly fault:(phase:string)=>void=()=>{}) {}
  get db() { return this.store.db; }
  private insertPreparation(...values: (string | number | null)[]) {
    // Identical unsigned bytes can be prepared again after explicit discard.
    // Rotate the preparation ID/session; never replace a possibly submitted digest.
    const inserted = this.db.prepare(`INSERT INTO preparations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(digest) DO UPDATE SET id=excluded.id,session_hash=excluded.session_hash,
      bytes=excluded.bytes,conditions=excluded.conditions,ref=excluded.ref,state=excluded.state,
      expires=excluded.expires,created=excluded.created,error=excluded.error
      WHERE preparations.state='discarded' AND preparations.actor=excluded.actor
      AND preparations.operation_id IS excluded.operation_id AND preparations.action=excluded.action
      RETURNING id`).get(...values);
    if (!inserted) throw new WorkflowError('Resolve the existing transaction digest before preparing another approval');
  }

  row(id: string): OperationRow { const row = this.db.prepare('SELECT * FROM operations WHERE id=?').get(id) as OperationRow | undefined; if (!row) throw new WorkflowError('Operation not found',404); return row; }
  allowed(row: OperationRow, actor?: string) { if (row.public || row.administrator === actor || row.successor === actor) return; throw new WorkflowError('Connect and authenticate an operation participant to inspect this record',403); }
  list(actor?: string, publicOnly = false) { return publicOnly || !actor ? this.db.prepare('SELECT * FROM operations WHERE public=1 ORDER BY updated DESC').all() : this.db.prepare('SELECT * FROM operations WHERE administrator=? OR successor=? OR public=1 ORDER BY updated DESC').all(actor,actor); }
  async persist(scope: string, record: MemoryRecord): Promise<MemoryRef> {
    const existing = this.db.prepare('SELECT value FROM config WHERE key=?').get(`record:${scope}`) as { value: string } | undefined;
    if (existing) { const ref = JSON.parse(existing.value) as MemoryRef; const saved = await this.memory.read(ref); if (!same(saved.data,record.data)) throw new WorkflowError('Memory revision conflicts with an existing write'); return ref; }
    const job = this.db.prepare('SELECT * FROM memory_jobs WHERE scope=? AND status=? ORDER BY rowid DESC LIMIT 1').get(scope,'pending') as { id: string; namespace: string; hash: string } | undefined;
    let ref: MemoryRef;
    if (job) {
      const status=await this.memory.client.getRememberStatus(job.id);
      if(status.status==='failed'){this.db.prepare('UPDATE memory_jobs SET status=? WHERE id=?').run('failed',job.id);return this.persist(scope,record);}
      const result = await this.memory.client.waitForRememberJob(job.id,{timeoutMs:45000});
      ref = { namespace: job.namespace, memoryId: result.id, blobId: result.blob_id, contentHash: job.hash };
      const restored = await this.memory.read(ref); if (!same(restored.data,record.data) || restored.owner !== record.owner || restored.kind !== record.kind) throw new WorkflowError('Pending memory job does not match this action');
    } else ref = await this.memory.write(record,(id,namespace,hash) => this.db.prepare('INSERT INTO memory_jobs VALUES (?,?,?,?,?)').run(id,namespace,hash,scope,'pending'));
    this.db.prepare('INSERT INTO config VALUES (?,?) ON CONFLICT(key) DO NOTHING').run(`record:${scope}`,JSON.stringify(ref));
    this.db.prepare("UPDATE memory_jobs SET status=? WHERE scope=? AND status='pending'").run('done',scope);
    this.db.prepare('INSERT OR IGNORE INTO memories VALUES (?,?,?,?,?,?,?)').run(ref.memoryId,record.operationId ?? null,record.owner,record.kind,JSON.stringify(ref),record.sequence,record.createdAt);
    return ref;
  }
  async checkpoint(row: OperationRow, value: Workflow, kind: MemoryRecord['kind'] = 'checkpoint') {
    const previous = row.ref ? JSON.parse(row.ref) as MemoryRef : undefined;
    const sequence = row.sequence + 1;
    const ref = await this.persist(`operation:${row.id}:${sequence}`, { kind, owner: row.administrator, operationId: row.id, sequence,
      ...(previous ? { previousId: previous.memoryId, previousHash: previous.contentHash } : {}), createdAt: nowIso(), data: value });
    const changed = this.db.prepare('UPDATE operations SET ref=?,sequence=?,proposal=?,revision=?,successor=?,status=?,updated=? WHERE id=? AND sequence=?')
      .run(JSON.stringify(ref),sequence,value.proposalId ?? null,value.proposalRevision,value.successor,value.stage,nowIso(),row.id,row.sequence);
    if (changed.changes !== 1) throw new WorkflowError('Another worker advanced this memory revision. Reload.');
    return ref;
  }
  async restore(row: OperationRow): Promise<Workflow> {
    if (!row.ref) throw new WorkflowError('No retrievable checkpoint yet. Prepare the proposal before continuing.');
    const record = await this.memory.read(JSON.parse(row.ref));
    const cp = workflowSchema.parse(record.data);
    if (record.operationId !== row.id || record.owner !== row.administrator || record.sequence !== row.sequence || cp.operationId !== row.id || cp.controlObjectId !== row.control || cp.packageId !== this.chain.packageId || cp.network !== 'testnet' || cp.administrator !== row.administrator) throw new WorkflowError('Checkpoint identity or latest revision validation failed');
    const chainId = await this.chain.client.getChainIdentifier();
    if (cp.chainIdentifier !== chainId.chainIdentifier) throw new WorkflowError('Checkpoint belongs to a different Sui chain');
    return cp;
  }
  async observe(cp: Workflow) {
    const [control,clock,proposal] = await Promise.all([this.chain.control(cp.controlObjectId),this.chain.clock(),cp.proposalId ? this.chain.proposal(cp.proposalId) : Promise.resolve(null)]);
    if (proposal && (proposal.control !== cp.controlObjectId || proposal.operation_id !== cp.operationId)) throw new WorkflowError('Live proposal identity mismatch');
    return { control,proposal,clock,fetchedAt:nowIso() };
  }
  async view(id: string, actor?: string) {
    const row = this.row(id); this.allowed(row,actor);
    let cp: Workflow | null = null; let live: Awaited<ReturnType<Engine['observe']>> | null = null;
    let verdict: { code: string; message: string; differences: {field:string;remembered:unknown;live:unknown}[]; nextAction?:string } = { code:'memory_unavailable',message:'Memory could not be restored. No action is permitted.',differences:[] };
    try { cp = await this.restore(row); } catch { return { operation:row,checkpoint:cp,live,verdict,journal:this.journal(id),preference:null }; }
    const preference = await this.preference(actor);
    try { live = await this.observe(cp); } catch { return { operation:row,checkpoint:cp,live,verdict:{...verdict,code:'chain_unavailable',message:'Tatum evidence unavailable. Revalidate before continuing.'},journal:this.journal(id),preference }; }
    const pending = this.db.prepare("SELECT * FROM preparations WHERE operation_id=? AND state IN ('prepared','submitting','unresolved','confirmed_memory_pending','memory_pending') ORDER BY created DESC LIMIT 1").get(id) as Preparation | undefined;
    const p = live.proposal;
    const differences: {field:string;remembered:unknown;live:unknown}[] = [];
    if (p) for (const [field,a,b] of [['successor',cp.successor,p.successor],['proposalRevision',cp.proposalRevision,p.revision],['expiresAtMs',cp.expiresAtMs,p.expires_at_ms]] as const) if (a!==b) differences.push({field,remembered:a,live:b});
    if (!p && live.control.administrator !== cp.administrator) differences.push({field:'administrator',remembered:cp.administrator,live:live.control.administrator});
    verdict = {code:'waiting_actor',message:'Waiting for the nominated successor to authenticate.',differences};
    if (differences.length) verdict = {code:'mismatch',message:'Live proposal differs from remembered intent. Stale actions are blocked.',differences};
    else if (pending && ['submitting','unresolved','confirmed_memory_pending'].includes(pending.state)) verdict={code:pending.state==='confirmed_memory_pending'?'memory_sync_pending':'unresolved',message:pending.state==='confirmed_memory_pending'?'Chain outcome verified; checkpoint synchronization pending. No repeat transaction is needed.':'Inspecting the known transaction digest. A replacement transaction is blocked.',differences};
    else if (p?.stage === 2) {
      const receipt = p.previousTransaction ? await this.chain.transaction(p.previousTransaction) : {kind:'unknown'};
      verdict={code:receipt.kind==='success'?'completed':'unresolved',message:receipt.kind==='success'?'Acceptance effects and final proposal verified on Sui.':'Accepted proposal observed; effects verification remains unavailable.',differences};
    } else if (p?.stage === 3) verdict={code:'cancelled',message:'Proposal cancelled on Sui.',differences};
    else if (p && (p.stage===4 || BigInt(live.clock)>=BigInt(p.expires_at_ms))) verdict={code:'expired',message:'Proposal expired according to the Sui Clock.',differences};
    else if (pending) verdict={code:'waiting_approval',message:'A preparation is waiting for wallet approval. Resume it or explicitly discard it.',differences};
    else if (!p) verdict={code:actor===cp.administrator?'ready_proposal':'waiting_actor',message:'Intent restored. The administrator can prepare the proposal.',differences,nextAction:actor===cp.administrator?'propose':undefined};
    else if (actor===cp.successor) verdict={code:'ready',message:'Remembered intent and live proposal agree. Review and sign acceptance.',differences,nextAction:'accept'};
    return {operation:row,checkpoint:cp,live,verdict,journal:this.journal(id),preference};
  }
  journal(id: string) { return this.db.prepare('SELECT * FROM journal WHERE operation_id=? ORDER BY id DESC LIMIT 100').all(id); }
  async preference(actor?:string) {
    if (!actor) return null;
    const pointer = this.db.prepare('SELECT * FROM preferences WHERE owner=?').get(actor) as {id:string;revision:number;revoked:number;ref:string} | undefined;
    if (!pointer || pointer.revoked) return null;
    try { const record = await this.memory.read(JSON.parse(pointer.ref)); const p = z.object({id:z.string(),owner:z.string(),revision:z.number(),revoked:z.boolean(),kind:z.literal('successor_change_review'),reviewStyle:z.enum(['detailed','concise']).default('detailed')}).strict().parse(record.data);
      if (record.kind!=='preference' || record.owner!==actor || p.owner!==actor || p.id!==pointer.id || p.revision!==pointer.revision || p.revoked) return null;
      return {...p,ref:JSON.parse(pointer.ref),explanation:'Applied your saved review preference: compare successor changes side by side and review the checklist.'};
    } catch { return null; }
  }
  async savePreference(actor:string, revoked:boolean, reviewStyle:'detailed'|'concise'='detailed') { return this.store.lease(`preference:${actor}`,async()=>{
    const previous=this.db.prepare('SELECT * FROM preferences WHERE owner=?').get(actor) as {id:string;revision:number;ref:string} | undefined;
    const value={id:previous?.id ?? randomUUID(),owner:actor,revision:(previous?.revision??-1)+1,revoked,kind:'successor_change_review' as const,reviewStyle};
    const ref=await this.persist(`preference:${actor}:${value.revision}`,{kind:'preference',owner:actor,sequence:value.revision,createdAt:nowIso(),data:value,...(previous?{previousId:(JSON.parse(previous.ref) as MemoryRef).memoryId,previousHash:(JSON.parse(previous.ref) as MemoryRef).contentHash}:{})});
    this.db.prepare('INSERT INTO preferences VALUES (?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision,revoked=excluded.revoked,ref=excluded.ref,updated=excluded.updated').run(actor,value.id,value.revision,revoked?1:0,JSON.stringify(ref),nowIso());
    return {...value,ref};
  }); }
  async create(input:{label:string;control:string;successor:string;expiresAtMs:string;public:boolean},actor:string,sessionHash:string) {
    const control=await this.chain.control(input.control);
    if (control.administrator!==actor || input.successor===actor || control.pending_proposal!==ZERO) throw new WorkflowError('Current administrator, empty pending proposal and a different successor are required');
    const clock=await this.chain.clock(); if(BigInt(input.expiresAtMs)<=BigInt(clock) || BigInt(input.expiresAtMs)-BigInt(clock)>2592000000n) throw new WorkflowError('Expiry must be in the next 30 days');
    const id=randomUUID();
    this.db.prepare('INSERT INTO operations VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.label||'Administrative handover',actor,input.successor,input.control,null,control.revision,'draft',input.public?1:0,null,-1,nowIso());
    try {
    const chainId=await this.chain.client.getChainIdentifier();
    const cp:Workflow={schemaVersion:1,operationId:id,label:input.label||'Administrative handover',network:'testnet',chainIdentifier:chainId.chainIdentifier,packageId:this.chain.packageId,controlObjectId:input.control,administrator:actor,successor:input.successor,proposalRevision:control.revision,expiresAtMs:input.expiresAtMs,stage:'draft',confirmedTransactions:[]};
    await this.store.lease(id,()=>this.checkpoint(this.row(id),cp,'intent'));
    this.store.log(id,actor,'intent','Operation intent stored and retrieved from Walrus.');
    return {id,preparation:await this.prepare(id,'propose',actor,sessionHash)};
    } catch (error) {
      throw new WorkflowError(isProviderRateLimit(error) ? 'Tatum rate limit reached. Your draft is saved; wait before revalidating and reviewing this operation again.' : error instanceof WorkflowError ? error.message : 'Your draft was saved, but memory retrieval or chain preparation is unavailable. Open this operation and revalidate before reviewing the proposal.',isProviderRateLimit(error) ? 429 : error instanceof WorkflowError ? error.status : 503,id);
    }
  }
  async prepare(id:string,action:Action,actor:string,sessionHash:string,successor?:string) {return this.store.lease(id,async()=>{
    const row=this.row(id); this.allowed(row,actor); if(this.db.prepare('SELECT key FROM config WHERE key=?').get('import-readonly:'+id))throw new WorkflowError('Imported reference is inspection-only until the authoritative latest discovery index is provisioned.'); const cp=await this.restore(row); const live=await this.observe(cp);
    if(this.db.prepare("SELECT id FROM preparations WHERE operation_id=? AND state IN ('prepared','memory_pending','submitting','unresolved','confirmed_memory_pending')").get(id)) throw new WorkflowError('Resolve or discard the current preparation first');
    const p=live.proposal;
    if(action==='propose') { if(p || actor!==cp.administrator || live.control.administrator!==actor || live.control.pending_proposal!==ZERO || live.control.revision!==cp.proposalRevision) throw new WorkflowError('Proposal preconditions changed'); }
    else {
      if(!p || p.stage!==1 || p.revision!==cp.proposalRevision || p.successor!==cp.successor || p.expires_at_ms!==cp.expiresAtMs) throw new WorkflowError('Proposal mismatch. Review live changes before preparing another action.');
      if(action==='accept' ? actor!==p.successor : action!=='expire' && actor!==live.control.administrator) throw new WorkflowError('Connected wallet does not have this role',403);
      if(action==='change_successor' && (!successor || successor===live.control.administrator || successor===ZERO)) throw new WorkflowError('A different valid successor is required');
    }
    if(action!=='expire' && BigInt(live.clock)>=BigInt(cp.expiresAtMs)) throw new WorkflowError('Proposal expired');
    const built=await this.chain.build(actor,action,{control:row.control,proposal:cp.proposalId,revision:cp.proposalRevision,successor:successor??cp.successor,expiresAtMs:cp.expiresAtMs,operationId:id});
    const prepId=randomUUID(), expires=Date.now()+120000;
    const conditions={control:live.control,proposal:p,expiresAtMs:cp.expiresAtMs,nextSuccessor:successor??cp.successor,estimatedGasMist:built.estimatedGasMist};
    this.insertPreparation(prepId,id,actor,sessionHash,action,built.bytes,built.digest,JSON.stringify(conditions),null,'memory_pending',expires,nowIso(),null);
    const intent={...cp,stage:'prepared' as const,action,preparedDigest:built.digest,...(action==='change_successor'?{intendedSuccessor:successor!}:{})};
    this.fault('before_intent');
    const ref=await this.checkpoint(row,intent,'intent');
    this.db.prepare('UPDATE preparations SET ref=?,state=?,expires=? WHERE id=?').run(JSON.stringify(ref),'prepared',Date.now()+120000,prepId);
    this.fault('after_intent');
    this.store.log(id,actor,'prepared',`${action}: exact transaction identity persisted and retrieved before signing.`);
    return this.publicPreparation(this.preparation(prepId));
  });}
  preparation(id:string) { const row=this.db.prepare('SELECT * FROM preparations WHERE id=?').get(id) as Preparation|undefined; if(!row)throw new WorkflowError('Preparation not found',404); return row; }
  publicPreparation(p:Preparation) {return {id:p.id,operationId:p.operation_id,actor:p.actor,action:p.action,bytes:p.bytes,digest:p.digest,network:'testnet',expiresAt:p.expires,state:p.state,memoryIssue:p.error,gasBudgetMist:p.action==='publish'?'200000000':'30000000',estimatedGasMist:JSON.parse(p.conditions).estimatedGasMist??null,conditions:JSON.parse(p.conditions)};}
  async discard(id:string,actor:string) { const prep=this.preparation(id); return this.store.lease(prep.operation_id??`setup:${actor}`,async()=>{
    if(prep.actor!==actor || !['prepared','memory_pending'].includes(prep.state)) throw new WorkflowError('Only a preparation that has never entered submission can be discarded');
    if(prep.operation_id) {const row=this.row(prep.operation_id),cp=await this.restore(row); const restored={...cp,stage:cp.proposalId?'awaiting_acceptance' as const:'draft' as const}; delete restored.preparedDigest; delete restored.action; await this.checkpoint(row,restored);}
    this.db.prepare('UPDATE preparations SET state=? WHERE id=? AND state IN (?,?)').run('discarded',id,'prepared','memory_pending');
    return {status:'discarded'};
  });}
  async submit(id:string,actor:string,sessionHash:string,signed:{bytes:string;signature:string}) {
    const first=this.preparation(id); return this.store.lease(first.operation_id??(first.action==='publish'?'package-publish':`setup:${actor}`),async()=>{
      const prep=this.preparation(id);
      if(prep.actor!==actor||prep.session_hash!==sessionHash)throw new WorkflowError('Preparation belongs to a different authenticated wallet session',403);
      if(prep.state!=='prepared')return this.recoverUnlocked(prep);
      if(prep.expires<=Date.now())throw new WorkflowError('Preparation expired. Discard and prepare fresh bytes.');
      await verifyApprovedBytes({bytes:prep.bytes,digest:prep.digest,actor},signed,{client:this.chain.client});
      const record=await this.memory.read(JSON.parse(prep.ref!));
      if(record.operationId!==prep.operation_id && prep.operation_id)throw new WorkflowError('Prepared memory identity mismatch');
      if(prep.operation_id) {
        const cp=workflowSchema.parse(record.data), live=await this.observe(cp), expected=JSON.parse(prep.conditions);
        if(!same(live.control,expected.control)||!same(live.proposal,expected.proposal))throw new WorkflowError('Chain inputs changed while waiting for approval. Discard and review a new preparation.');
        if(prep.action!=='expire' && BigInt(live.clock)>=BigInt(cp.expiresAtMs))throw new WorkflowError('Proposal expired while awaiting wallet approval.');
      }
      if(!prep.operation_id){const data=record.data as {packageId:string;control:string|null};if(prep.action==='publish'&&this.chain.packageId!==ZERO)throw new WorkflowError('Package already configured; discard this stale publication');if(prep.action==='increment'&&(!data.control||(await this.chain.control(data.control)).administrator!==actor))throw new WorkflowError('Administrator changed while awaiting approval');}
      const claimed=this.db.prepare("UPDATE preparations SET state='submitting' WHERE id=? AND state='prepared' AND expires>?").run(id,Date.now());
      if(claimed.changes!==1)throw new WorkflowError('Preparation no longer available');
      this.fault('before_broadcast');
      this.store.log(prep.operation_id,actor,'submitting',`Submitting the known digest ${prep.digest} through Tatum.`);
      try { await this.chain.client.executeTransaction({transaction:fromBase64(signed.bytes),signatures:[signed.signature],include:{effects:true}}); this.fault('after_broadcast'); }
      catch { this.db.prepare('UPDATE preparations SET state=? WHERE id=?').run('unresolved',id); }
      return this.recoverUnlocked(this.preparation(id));
    });
  }
  async recover(id:string) {const prep=this.preparation(id);return this.store.lease(prep.operation_id??`setup:${prep.actor}`,()=>this.recoverUnlocked(this.preparation(id)));}
  async recoverUnlocked(prep:Preparation):Promise<unknown> {
    if(['prepared','memory_pending','discarded','completed','failed'].includes(prep.state))return {status:prep.state,digest:prep.digest,operationId:prep.operation_id};
    const outcome=await this.chain.transaction(prep.digest);
    if(outcome.kind==='unknown'){this.db.prepare('UPDATE preparations SET state=? WHERE id=?').run('unresolved',prep.id);return {status:'unresolved',digest:prep.digest,operationId:prep.operation_id};}
    if(outcome.kind==='failure'){
      if(prep.operation_id){const row=this.row(prep.operation_id),cp=await this.restore(row);const restored={...cp,stage:cp.proposalId?'awaiting_acceptance' as const:'draft' as const};delete restored.preparedDigest;delete restored.action;await this.checkpoint(row,restored);}
      this.db.prepare('UPDATE preparations SET state=? WHERE id=?').run('failed',prep.id);this.store.log(prep.operation_id,prep.actor,'failed','Sui verified execution failure; a new review is required.');return {status:'failed',digest:prep.digest,operationId:prep.operation_id};
    }
    this.fault('after_chain');
    this.db.prepare('UPDATE preparations SET state=? WHERE id=?').run('confirmed_memory_pending',prep.id);
    try {
      if(!prep.operation_id) {
        if(prep.action==='publish') {const published=outcome.tx.effects!.changedObjects.find(o=>o.outputState==='PackageWrite');if(!published)throw new WorkflowError('Published package missing from effects');this.chain.packageId=published.objectId;this.db.prepare('INSERT INTO config VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('packageId',published.objectId);}
        if(prep.action==='create') {for(const [objectId,type]of Object.entries(outcome.tx.objectTypes??{}))if(type===`${this.chain.packageId}::handover::Control`)this.db.prepare('INSERT OR IGNORE INTO controls VALUES (?,?,?)').run(objectId,prep.actor,nowIso());for(const event of outcome.tx.events??[])if(event.eventType===`${this.chain.packageId}::handover::ControlCreated`){const created=ControlCreatedBCS.parse(event.bcs);if(created.administrator===prep.actor)this.db.prepare('INSERT OR IGNORE INTO controls VALUES (?,?,?)').run(created.control,prep.actor,nowIso());}}
        const ref=await this.persist(`setup-outcome:${prep.id}`,{kind:'outcome',owner:prep.actor,sequence:0,createdAt:nowIso(),data:{action:prep.action,digest:prep.digest,checkpoint:outcome.checkpoint,status:'success',packageId:this.chain.packageId}});
        this.db.prepare('UPDATE preparations SET state=? WHERE id=?').run('completed',prep.id);return {status:'completed',digest:prep.digest,packageId:this.chain.packageId,ref};
      }
      const intentRecord=await this.memory.read(JSON.parse(prep.ref!));const intent=workflowSchema.parse(intentRecord.data);let proposalId=intent.proposalId;
      if(prep.action==='propose')for(const[objectId,type]of Object.entries(outcome.tx.objectTypes??{}))if(type===`${this.chain.packageId}::handover::Proposal`)proposalId=objectId;
      if(!proposalId)for(const event of outcome.tx.events??[])if(event.eventType===`${this.chain.packageId}::handover::Transition`){const e=TransitionBCS.parse(event.bcs);if(e.control===intent.controlObjectId&&e.operation_id===intent.operationId)proposalId=e.proposal;}
      if(!proposalId)throw new WorkflowError('Proposal identity missing from verified transaction effects');
      const proposal=await this.chain.proposal(proposalId);const control=await this.chain.control(intent.controlObjectId);
      if(proposal.operation_id!==intent.operationId||proposal.control!==intent.controlObjectId)throw new WorkflowError('Verified proposal identity differs from intent');
      if(prep.action==='change_successor'&&proposal.successor!==intent.intendedSuccessor)throw new WorkflowError('Live successor does not match the signed change intent');
      if(prep.action==='accept'&&(proposal.stage!==2||control.administrator!==proposal.successor))throw new WorkflowError('Acceptance effects did not establish expected authority');
      const final:Workflow={...intent,proposalId,proposalRevision:prep.action==='change_successor'?intent.proposalRevision:proposal.revision,successor:prep.action==='change_successor'?intent.successor:proposal.successor,expiresAtMs:proposal.expires_at_ms,
        stage:proposal.stage===2?'completed':proposal.stage===3?'cancelled':proposal.stage===4?'expired':'awaiting_acceptance',
        confirmedTransactions:[...intent.confirmedTransactions.filter(t=>t.digest!==prep.digest),{digest:prep.digest,action:prep.action,checkpoint:outcome.checkpoint}]};delete final.preparedDigest;delete final.action;
      const row=this.row(prep.operation_id); const latest=await this.restore(row); if(latest.confirmedTransactions.some(t=>t.digest===prep.digest)){this.db.prepare('UPDATE preparations SET state=? WHERE id=?').run('completed',prep.id);return {status:'completed',operationId:prep.operation_id,digest:prep.digest};} await this.checkpoint(row,final,final.stage==='completed'?'outcome':'checkpoint');
      this.fault('after_final');
      this.db.prepare('UPDATE preparations SET state=? WHERE id=?').run('completed',prep.id);this.store.log(prep.operation_id,prep.actor,'verified',`${prep.action} effects and business state verified; checkpoint synchronized.`);
      return {status:'completed',operationId:prep.operation_id,digest:prep.digest};
    }catch {this.db.prepare('UPDATE operations SET status=? WHERE id=?').run('memory_sync_pending',prep.operation_id??'');return {status:'chain_confirmed_memory_pending',operationId:prep.operation_id,digest:prep.digest};}
  }
  async setup(action:'publish'|'create'|'increment',actor:string,sessionHash:string,control?:string){return this.store.lease(action==='publish'?'package-publish':`setup:${actor}`,async()=>{
    if(this.db.prepare("SELECT id FROM preparations WHERE actor=? AND operation_id IS NULL AND state IN ('prepared','memory_pending','submitting','unresolved','confirmed_memory_pending')").get(actor))throw new WorkflowError('Resolve or discard the previous setup preparation first');
    let artifact:{modules:string[];dependencies:string[]}|undefined;
    if(action==='publish'){if(this.db.prepare("SELECT id FROM preparations WHERE action='publish' AND state IN ('prepared','memory_pending','submitting','unresolved','confirmed_memory_pending')").get())throw new WorkflowError('Resolve the current package publication first');if(this.chain.packageId!==ZERO)throw new WorkflowError('A supported package is already configured');const artifactPath=existsSync('contracts/janus_handover/compiled/package.json')?'contracts/janus_handover/compiled/package.json':'.data/package.json';if(!existsSync(artifactPath))throw new WorkflowError('Compile the Move package before publishing');artifact=JSON.parse(readFileSync(artifactPath,'utf8'));}
    else if(this.chain.packageId===ZERO)throw new WorkflowError('Publish the supported handover package first');
    if(action==='increment'&&(!control||(await this.chain.control(control)).administrator!==actor))throw new WorkflowError('Only the current administrator can increment the demonstration counter',403);
    const built=await this.chain.build(actor,action,{control,...artifact});const id=randomUUID();
    this.insertPreparation(id,null,actor,sessionHash,action,built.bytes,built.digest,JSON.stringify({control:control??null,estimatedGasMist:built.estimatedGasMist}),null,'memory_pending',Date.now()+120000,nowIso(),null);
    let ref: MemoryRef;
    try { ref=await this.persist(`setup-intent:${id}`,{kind:'intent',owner:actor,sequence:0,createdAt:nowIso(),data:{action,actor,control:control??null,digest:built.digest,network:'testnet',packageId:this.chain.packageId}}); }
    catch { throw new WorkflowError('Walrus intent storage or retrieval is unavailable. This preparation is unsigned and no transaction was submitted. The pending preparation has been retained.',503); }
    this.db.prepare('UPDATE preparations SET ref=?,state=?,expires=? WHERE id=?').run(JSON.stringify(ref),'prepared',Date.now()+120000,id);return this.publicPreparation(this.preparation(id));
  });}
  async retrySetupMemory(id:string,actor:string,sessionHash:string) {
    return this.store.lease('setup:'+actor,async()=>{
      const prep=this.preparation(id);
      if(prep.actor!==actor || prep.operation_id || !['memory_pending','prepared'].includes(prep.state))
        throw new WorkflowError('Only your unsigned setup preparation can be recovered for review',403);
      const scope='setup-intent:'+id;
      const pointer=this.db.prepare('SELECT value FROM config WHERE key=?').get('record:'+scope) as {value:string}|undefined;
      let ref:MemoryRef|undefined=prep.ref?JSON.parse(prep.ref):pointer?JSON.parse(pointer.value):undefined;
      if(!ref){
        const job=this.db.prepare('SELECT * FROM memory_jobs WHERE scope=? ORDER BY rowid DESC LIMIT 1').get(scope) as {id:string;namespace:string;hash:string;status:string}|undefined;
        if(!job)throw new WorkflowError('No acknowledged memory job is available. Discard this unsigned preparation before preparing again.');
        const failed=(message:string):never=>{
          this.db.prepare("UPDATE memory_jobs SET status='failed' WHERE id=?").run(job.id);
          this.db.prepare('UPDATE preparations SET error=? WHERE id=?').run(message,id);
          throw new WorkflowError(message,503);
        };
        if(job.status==='failed')failed(prep.error??'Walrus upload failed. No app transaction was submitted. Wait for the storage provider before discarding and preparing again.');
        const status=await this.memory.client.getRememberStatus(job.id);
        if(status.status==='failed')failed(String(status.error??'').includes('disallowed')
          ? 'Walrus upload was rejected by its storage sponsor because contract calls are disallowed. The provider must correct sponsorship. No app transaction was submitted.'
          : 'Walrus upload failed at the storage provider. No app transaction was submitted. Wait for the provider before preparing again.');
        let result: Awaited<ReturnType<typeof this.memory.client.waitForRememberJob>>;
        try {result=await this.memory.client.waitForRememberJob(job.id,{timeoutMs:60000});}
        catch(error){if(error instanceof Error&&error.name==='MemWalRememberJobFailed')failed('Walrus upload failed at the storage provider. No app transaction was submitted. Wait for the provider before preparing again.');throw error;}

        ref={namespace:job.namespace,memoryId:result.id,blobId:result.blob_id,contentHash:job.hash};
      }
      const record=await this.memory.read(ref);
      const data=record.data as {action:string;actor:string;control:string|null;digest:string;network:string;packageId:string};
      const control=JSON.parse(prep.conditions).control??null;
      if(record.kind!=='intent'||record.owner!==actor||record.operationId||data.actor!==actor||data.action!==prep.action||data.digest!==prep.digest||data.control!==control||data.network!=='testnet'||data.packageId!==this.chain.packageId)
        throw new WorkflowError('Stored setup intent does not match this preparation');
      if(prep.action==='publish'&&this.chain.packageId!==ZERO)throw new WorkflowError('Package already configured; discard this stale publication');
      if(prep.action==='increment'&&(!control||(await this.chain.control(control)).administrator!==actor))throw new WorkflowError('Only the current administrator can review this counter action',403);
      // A fresh ID invalidates the old review; renewal starts only on this explicit request.
      const nextId=randomUUID();
      this.db.prepare('INSERT INTO config VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('record:setup-intent:'+nextId,JSON.stringify(ref));
      this.db.prepare('INSERT OR IGNORE INTO memories VALUES (?,?,?,?,?,?,?)').run(ref.memoryId,null,record.owner,record.kind,JSON.stringify(ref),record.sequence,record.createdAt);
      this.db.prepare("UPDATE memory_jobs SET status='done' WHERE scope=? AND status='pending'").run(scope);
      this.db.prepare("UPDATE preparations SET id=?,ref=?,state='prepared',session_hash=?,expires=?,error=NULL WHERE id=?").run(nextId,JSON.stringify(ref),sessionHash,Date.now()+120000,id);
      return this.publicPreparation(this.preparation(nextId));
    });
  }
  async approveLive(id:string,actor:string){return this.store.lease(id,async()=>{if(this.db.prepare('SELECT key FROM config WHERE key=?').get('import-readonly:'+id))throw new WorkflowError('Imported references are inspection-only without the latest discovery index');const row=this.row(id);if(actor!==row.administrator)throw new WorkflowError('Administrator approval required',403);if(this.db.prepare("SELECT id FROM preparations WHERE operation_id=? AND state IN ('submitting','unresolved','confirmed_memory_pending')").get(id))throw new WorkflowError('Resolve the prior transaction first');const cp=await this.restore(row);const live=await this.observe(cp);if(!live.proposal||live.proposal.stage!==1)throw new WorkflowError('Only a pending proposal can be reviewed');const value={...cp,successor:live.proposal.successor,proposalRevision:live.proposal.revision,expiresAtMs:live.proposal.expires_at_ms,stage:'awaiting_acceptance' as const};delete value.preparedDigest;delete value.action;delete value.intendedSuccessor;await this.checkpoint(row,value);this.db.prepare("UPDATE preparations SET state='discarded' WHERE operation_id=? AND state IN ('prepared','memory_pending')").run(id);this.store.log(id,actor,'reviewed','Administrator explicitly approved the current live proposal as the new remembered intent.');return {status:'reviewed'};});}
  async repairMemory(id:string,actor:string) { return this.store.lease(id,async()=>{
    const row=this.row(id); if(![row.administrator,row.successor].includes(actor))throw new WorkflowError('Participant authentication required',403);
    const scope='operation:'+id+':'+(row.sequence+1);
    const pointer=this.db.prepare('SELECT value FROM config WHERE key=?').get('record:'+scope) as {value:string}|undefined;
    let ref:MemoryRef|undefined=pointer?JSON.parse(pointer.value):undefined;
    if(!ref){const job=this.db.prepare('SELECT * FROM memory_jobs WHERE scope=? AND status=?').get(scope,'pending') as {id:string;namespace:string;hash:string}|undefined;
      if(!job)return;const result=await this.memory.client.waitForRememberJob(job.id,{timeoutMs:45000});ref={namespace:job.namespace,memoryId:result.id,blobId:result.blob_id,contentHash:job.hash};}
    const record=await this.memory.read(ref);const cp=workflowSchema.parse(record.data);
    if(cp.operationId!==id||cp.administrator!==row.administrator||cp.controlObjectId!==row.control||cp.packageId!==this.chain.packageId)throw new WorkflowError('Pending memory identity rejected');
    await this.checkpoint(row,cp,record.kind);
    if(cp.preparedDigest)this.db.prepare('UPDATE preparations SET ref=?,state=? WHERE operation_id=? AND digest=? AND state=?').run(JSON.stringify(ref),'prepared',id,cp.preparedDigest,'memory_pending');
  });}
  async tick(){const rows=this.db.prepare("SELECT id FROM preparations WHERE state IN ('submitting','unresolved','confirmed_memory_pending') ORDER BY created LIMIT 10").all() as {id:string}[];for(const row of rows)try{await this.recover(row.id);}catch{}this.db.prepare('INSERT INTO config VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('workerHeartbeat',nowIso()); const configured=this.db.prepare('SELECT value FROM config WHERE key=?').get('packageId') as {value:string}|undefined;if(configured)this.chain.packageId=configured.value;}
}
