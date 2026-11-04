import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { Engine } from '../../apps/api/src/engine.js';
import { Store } from '../../apps/api/src/store.js';
import type { ChainAdapter } from '../../packages/chain/src/handover.js';
import { ZERO } from '../../packages/chain/src/handover.js';
import type { MemoryAdapter,MemoryRecord,MemoryRef } from '../../packages/memory/src/adapter.js';
import { sha256 } from '../../packages/memory/src/envelope.js';
export const CONTROL=`0x${'a'.repeat(64)}`,PROPOSAL=`0x${'b'.repeat(64)}`,PACKAGE=`0x${'c'.repeat(64)}`;
export function fixture(dir:string,admin:string,successor:string,fault:(phase:string)=>void=()=>{}){
 const file=dir+'/chain.json',records=dir+'/remote-memory.json';
 if(!existsSync(file))writeFileSync(file,JSON.stringify({admin,successor,revision:'0',pending:ZERO,count:0,stage:0,clock:'1000',operation:'',digest:null,preparedAction:'',preparedActor:admin}));
 if(!existsSync(records))writeFileSync(records,'{}');
 const read=()=>JSON.parse(readFileSync(file,'utf8'));
 const save=(v:unknown)=>writeFileSync(file,JSON.stringify(v));
 const control=async()=>{const s=read();return{id:CONTROL,administrator:s.admin,revision:s.revision,pending_proposal:s.pending,counter:'0',version:'1',digest:'control-digest'};};
 const proposal=async()=>{const s=read();return{id:PROPOSAL,control:CONTROL,operation_id:s.operation,administrator:admin,successor:s.successor,revision:s.revision,expires_at_ms:'1000000',stage:s.stage,version:'1',digest:'proposal-digest',previousTransaction:s.digest};};
 const chain={packageId:PACKAGE,control,proposal,clock:async()=>read().clock,
  client:{getChainIdentifier:async()=>({chainIdentifier:'fixture-chain'}),executeTransaction:async(input:{transaction:Uint8Array})=>{
   const s=read();s.count++;s.digest=await Transaction.from(input.transaction).getDigest();
   if(s.preparedAction==='propose'){s.pending=PROPOSAL;s.revision='1';s.stage=1;}
   if(s.preparedAction==='accept'){s.admin=s.successor;s.pending=ZERO;s.stage=2;}
   if(s.preparedAction==='change_successor'){s.successor=s.nextSuccessor;s.revision=String(BigInt(s.revision)+1n);}
   save(s);return{};
  }},
  build:async(actor:string,action:string,args:{operationId?:string;successor?:string})=>{const s=read();s.preparedAction=action;s.preparedActor=actor;s.nextSuccessor=args.successor;if(args.operationId)s.operation=args.operationId;save(s);const tx=new Transaction();tx.setSender(actor);tx.setGasBudget(action==='accept'?1000001:action==='change_successor'?1000002:1000000);tx.setGasPrice(1000);tx.setGasPayment([{objectId:`0x${'d'.repeat(64)}`,version:'1',digest:'11111111111111111111111111111111'}]);tx.transferObjects([tx.objectRef({objectId:`0x${'e'.repeat(64)}`,version:'1',digest:'11111111111111111111111111111111'})],successor);const bytes=await tx.build();return{bytes:toBase64(bytes),digest:await tx.getDigest(),gasBudgetMist:'1000000'};},
  transaction:async(digest:string)=>{const s=read();return s.digest===digest?{kind:'success',digest,checkpoint:'1',tx:{effects:{changedObjects:[]},objectTypes:{[PROPOSAL]:`${PACKAGE}::handover::Proposal`}}}:{kind:'unknown',digest};}
 } as unknown as ChainAdapter;
 const memory={writer:'fixture-writer',read:async(ref:MemoryRef)=>{if(existsSync(dir+'/memory-down'))throw new Error('Fixture memory unavailable');const all=JSON.parse(readFileSync(records,'utf8'));const value=all[ref.memoryId];if(!value)throw new Error('Missing fixture record');return value as MemoryRecord;},
  write:async(record:MemoryRecord)=>{if(existsSync(dir+'/memory-down'))throw new Error('Fixture memory unavailable');const all=JSON.parse(readFileSync(records,'utf8'));const id=sha256(JSON.stringify(record));all[id]=record;writeFileSync(records,JSON.stringify(all));return{namespace:'fixture',memoryId:id,blobId:id,contentHash:id};}
 } as unknown as MemoryAdapter;
 const db=new DatabaseSync(dir+'/index.sqlite');const engine=new Engine(new Store(db),chain,memory,fault);
 return{engine,read,save,db};
}
