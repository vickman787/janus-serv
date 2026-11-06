import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { address, uint } from '../../../packages/domain/src/models.js';
import { workflowSchema } from '../../../packages/domain/src/workflow.js';
import { ZERO } from '../../../packages/chain/src/handover.js';
import { Engine, WorkflowError, type Preparation } from './engine.js';
import { CopilotError } from '../../../packages/copilot/src/errors.js';
import type { CopilotService } from '../../../packages/copilot/src/analyze.js';
import { disabledCapabilities } from '../../../packages/copilot/src/config.js';
export function applicationRoutes(engine:Engine, session:(req:IncomingMessage)=>string, actor:(req:IncomingMessage)=>string|undefined, sessionHash:(req:IncomingMessage)=>string,
  body:(req:IncomingMessage)=>Promise<unknown>,reply:(res:ServerResponse,status:number,value:unknown)=>void, copilot?:CopilotService) {
  return async(req:IncomingMessage,res:ServerResponse):Promise<boolean>=>{
    const url=new URL(req.url??'/', 'http://localhost');const path=url.pathname;
    if(req.method==='GET'&&path==='/api/config') {reply(res,200,{network:'testnet',memoryNetwork:process.env.WALRUS_MEMORY_NETWORK??'mainnet',packageId:engine.chain.packageId===ZERO?null:engine.chain.packageId,
      packageCompiled:(existsSync('.data/package.json')||existsSync('contracts/janus_handover/compiled/package.json')),walletApprovalRequired:true,writerFingerprint:engine.memory.writer,localDevelopment:true,
      copilot:copilot?.capabilities()??disabledCapabilities('Recovery Copilot is disabled because the server did not construct a copilot service')});return true;}
    if(req.method==='GET'&&(path==='/api/operations'||path==='/api/public/operations')){reply(res,200,{operations:engine.list(actor(req),path.includes('/public/'))});return true;}
    if(req.method==='GET'&&path==='/api/controls') {const who=actor(req);reply(res,200,{controls:who?engine.db.prepare('SELECT * FROM controls WHERE creator=? ORDER BY created DESC').all(who):[]});return true;}
    const controlMatch=path.match(/^\/api\/controls\/(0x[0-9a-f]{64})$/);
    if(req.method==='GET'&&controlMatch){reply(res,200,await engine.chain.control(controlMatch[1]!));return true;}
    if(req.method==='GET'&&path==='/api/preparations') {const who=session(req);const rows=engine.db.prepare("SELECT * FROM preparations WHERE actor=? AND state NOT IN ('completed','discarded','failed') ORDER BY created DESC").all(who) as Preparation[];reply(res,200,{preparations:rows.map(p=>({...engine.publicPreparation(p),sameSession:p.session_hash===sessionHash(req)}))});return true;}
    const copilotMatch=path.match(/^\/api\/operations\/([0-9a-f-]{36})\/copilot\/(assess|assessments|jobs)(?:\/([0-9a-f-]{36}))?$/);
    if(copilotMatch){
      const id=copilotMatch[1]!,kind=copilotMatch[2]!,resourceId=copilotMatch[3];
      if(!copilot)throw new CopilotError('Recovery Copilot is not configured',503,'not_configured');
      if(req.method==='POST'&&kind==='assess'&&!resourceId){const who=session(req);z.object({approved:z.literal(true)}).strict().parse(await body(req));const result=await copilot.enqueue(id,who);void copilot.tick().catch(()=>{});reply(res,202,result);return true;}
      if(req.method==='GET'&&kind==='assessments'&&!resourceId){const who=session(req);reply(res,200,copilot.listAssessments(id,who));return true;}
      if(req.method==='GET'&&kind==='assessments'&&resourceId){const who=session(req);reply(res,200,copilot.getAssessment(id,who,resourceId));return true;}
      if(req.method==='GET'&&kind==='jobs'&&resourceId){const who=session(req);reply(res,200,copilot.getJob(id,who,resourceId));return true;}
    }
    const match=path.match(/^\/api\/operations\/([0-9a-f-]{36})(?:\/(revalidate|evidence|recovery-reference|approve-live|prepare-(?:propose|accept|cancel|change_successor|expire)))?$/);
    if(match){const id=match[1]!,action=match[2];
      if(req.method==='GET'){
        if(action==='recovery-reference'){const row=engine.row(id);engine.allowed(row,actor(req));if(!row.ref)throw new WorkflowError('No checkpoint reference yet');reply(res,200,{version:1,operationId:id,network:'testnet',memoryNetwork:process.env.WALRUS_MEMORY_NETWORK??'mainnet',ref:JSON.parse(row.ref),writerFingerprint:engine.memory.writer});return true;}
        const view=await engine.view(id,actor(req));reply(res,200,action==='evidence'?{checkpoint:view.checkpoint,reference:view.operation.ref?JSON.parse(view.operation.ref):null,journal:view.journal}:view);return true;
      }
      if(req.method==='POST') {const who=session(req);
        if(action==='revalidate'){engine.allowed(engine.row(id),who); if([engine.row(id).administrator,engine.row(id).successor].includes(who))await engine.repairMemory(id,who);const pending=engine.db.prepare("SELECT id FROM preparations WHERE operation_id=? AND state IN ('submitting','unresolved','confirmed_memory_pending')").all(id) as {id:string}[];for(const p of pending)await engine.recover(p.id);let result=await engine.view(id,who); if(result.checkpoint&&!engine.db.prepare('SELECT key FROM config WHERE key=?').get('import-readonly:'+id)&&[result.operation.administrator,result.operation.successor].includes(who)){engine.store.log(id,who,'evaluated',result.verdict.code+': '+result.verdict.message);try{await engine.persist('decision:'+id+':'+crypto.randomUUID(),{kind:'journal',owner:result.operation.administrator,operationId:id,sequence:0,createdAt:new Date().toISOString(),data:{checkpointSequence:result.operation.sequence,verdict:result.verdict,liveFetchedAt:result.live?.fetchedAt??null}});}catch{engine.store.log(id,who,'journal_pending','Decision made from evidence; journal memory synchronization pending.');}}if(result.live&&Date.now()-Date.parse(result.live.fetchedAt)>10000)result=await engine.view(id,who);reply(res,200,{...result,journal:engine.journal(id)});return true;}
        if(action==='approve-live'){z.object({approve:z.literal(true)}).strict().parse(await body(req));reply(res,200,await engine.approveLive(id,who));return true;}
        if(action?.startsWith('prepare-')){const input=z.object({successor:address.optional()}).strict().parse(await body(req));const step=z.enum(['propose','accept','cancel','change_successor','expire']).parse(action.slice(8));reply(res,200,await engine.prepare(id,step,who,sessionHash(req),input.successor));return true;}
      }
    }
    if(req.method==='POST'&&path==='/api/operations') {const who=session(req);const input=z.object({label:z.string().max(100),control:address,successor:address,expiresAtMs:uint,public:z.boolean()}).strict().parse(await body(req));reply(res,201,await engine.create(input,who,sessionHash(req)));return true;}
    if(req.method==='POST'&&path==='/api/operations/restore') {const who=session(req);const input=z.object({version:z.literal(1),operationId:z.string().uuid(),network:z.literal('testnet'),memoryNetwork:z.string(),ref:z.object({namespace:z.string().regex(/^janus-openserv-record-[0-9a-f-]{36}$/),blobId:z.string(),memoryId:z.string(),contentHash:z.string().regex(/^[0-9a-f]{64}$/)}).strict(),writerFingerprint:z.string()}).strict().parse(await body(req));
      if(input.writerFingerprint!==engine.memory.writer||input.memoryNetwork!==(process.env.WALRUS_MEMORY_NETWORK??'mainnet'))throw new WorkflowError('Recovery reference writer or network is not trusted');
      const record=await engine.memory.read(input.ref);const cp=workflowSchema.parse(record.data);if(cp.operationId!==input.operationId||cp.packageId!==engine.chain.packageId||record.owner!==cp.administrator||![cp.administrator,cp.successor].includes(who))throw new WorkflowError('Recovery reference participant or identity mismatch',403);
      const exists=engine.db.prepare('SELECT id FROM operations WHERE id=?').get(cp.operationId);
      if(!exists){engine.db.prepare('INSERT INTO operations VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(cp.operationId,cp.label,cp.administrator,cp.successor,cp.controlObjectId,cp.proposalId??null,cp.proposalRevision,cp.stage,0,JSON.stringify(input.ref),record.sequence,new Date().toISOString());engine.db.prepare('INSERT INTO config VALUES (?,?)').run(`import-readonly:${cp.operationId}`,'true');}
      reply(res,200,{id:cp.operationId,readOnlyImport:!exists});return true;}
    if(req.method==='POST'&&path==='/api/setup/prepare') {const who=session(req);const input=z.object({action:z.enum(['publish','create','increment']),control:address.optional()}).strict().parse(await body(req));reply(res,200,await engine.setup(input.action,who,sessionHash(req),input.control));return true;}
    if(req.method==='POST'&&path==='/api/transactions/submit'){const who=session(req);const input=z.object({id:z.string().uuid(),bytes:z.string().max(200000),signature:z.string().min(1).max(8192)}).strict().parse(await body(req));reply(res,200,await engine.submit(input.id,who,sessionHash(req),input));return true;}
    const prepMatch=path.match(/^\/api\/preparations\/([0-9a-f-]{36})\/(discard|recover|retry-memory)$/);
    if(req.method==='POST'&&prepMatch){const who=session(req);const p=engine.preparation(prepMatch[1]!);if(p.actor!==who)throw new WorkflowError('Preparation belongs to another actor',403);reply(res,200,prepMatch[2]==='discard'?await engine.discard(p.id,who):prepMatch[2]==='retry-memory'?await engine.retrySetupMemory(p.id,who,sessionHash(req)):await engine.recover(p.id));return true;}
    if(path==='/api/preferences'){
      if(req.method==='GET'){reply(res,200,{preference:await engine.preference(actor(req))});return true;}
      if(req.method==='POST'){const who=session(req);const input=z.object({approved:z.literal(true),revoked:z.boolean(),reviewStyle:z.enum(['detailed','concise']).default('detailed')}).strict().parse(await body(req));reply(res,200,await engine.savePreference(who,input.revoked,input.reviewStyle));return true;}
    }
    if(req.method==='GET'&&path==='/api/memories') {const who=actor(req)??'';const rows=engine.db.prepare(`SELECT m.* FROM memories m LEFT JOIN operations o ON o.id=m.operation_id WHERE m.owner=? OR o.public=1 OR o.administrator=? OR o.successor=? ORDER BY m.created DESC LIMIT 100`).all(who,who,who);reply(res,200,{memories:rows});return true;}
    const memoryMatch=path.match(/^\/api\/memories\/([^/]+)$/);
    if(req.method==='GET'&&memoryMatch){const row=engine.db.prepare('SELECT * FROM memories WHERE id=?').get(memoryMatch[1]!) as {owner:string;operation_id:string|null;ref:string}|undefined;if(!row)throw new WorkflowError('Memory not found',404);if(row.operation_id)engine.allowed(engine.row(row.operation_id),actor(req));else if(row.owner!==session(req))throw new WorkflowError('Memory not authorized',403);reply(res,200,{record:await engine.memory.read(JSON.parse(row.ref)),ref:JSON.parse(row.ref)});return true;}
    if(req.method==='POST'&&path==='/api/memories/search'){const who=session(req);const input=z.object({query:z.string().min(1).max(300)}).strict().parse(await body(req));const rows=engine.db.prepare(`SELECT m.* FROM memories m LEFT JOIN operations o ON o.id=m.operation_id WHERE m.owner=? OR o.administrator=? OR o.successor=? ORDER BY m.created DESC LIMIT 5`).all(who,who,who) as {id:string;ref:string;kind:string}[];
      const results=[];for(const row of rows){const ref=JSON.parse(row.ref);const found=await engine.memory.client.recall({query:input.query,namespace:ref.namespace,limit:1});const hit=found.results.find(r=>r.blob_id===ref.blobId);if(hit)results.push({id:row.id,kind:row.kind,distance:hit.distance,record:await engine.memory.read(ref)});}reply(res,200,{scope:'Five most recent authorized records; semantic matches are not a complete listing.',results});return true;}
    return false;
  };
}
