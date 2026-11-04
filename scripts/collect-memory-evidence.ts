import {DatabaseSync} from 'node:sqlite';
import {writeFile} from 'node:fs/promises';
import {createMemoryClient} from '../packages/memory/src/client.js';
import {MemoryAdapter} from '../packages/memory/src/adapter.js';
const network=process.env.WALRUS_MEMORY_NETWORK??'mainnet';
const db=new DatabaseSync('.data/janus.sqlite',{readOnly:true}),client=createMemoryClient(),memory=new MemoryAdapter(client,process.env.JANUS_WRITER_KEY_PATH||'.data/writer-private.pem',false);
try {
 const rows=db.prepare('SELECT * FROM memories ORDER BY created').all() as {id:string;operation_id:string|null;owner:string;kind:string;ref:string;sequence:number;created:string}[];
 const manifest=[];
 for(const row of rows){
  const ref=JSON.parse(row.ref);let restored=false,action:string|null=null;
  try{const record=await memory.read(ref);restored=record.kind===row.kind&&(record.operationId??null)===row.operation_id&&record.owner===row.owner&&record.sequence===row.sequence;const data=record.data as {action?:unknown};if(typeof data?.action==='string')action=data.action;}catch{}
  const meaningful=['intent','checkpoint','outcome','preference'].includes(row.kind)&&Boolean(row.operation_id||row.kind==='preference');
  manifest.push({memoryId:row.id,operationId:row.operation_id,category:row.kind,sequence:row.sequence,network,blobId:ref.blobId,contentHash:ref.contentHash,action,meaningful,restored,verifiedAt:new Date().toISOString()});
  if(manifest.length%10===0||manifest.length===rows.length)console.log(JSON.stringify({checked:manifest.length,total:rows.length,restored:manifest.filter(r=>r.restored).length}));
  await new Promise(r=>setTimeout(r,2200));
 }
 const value={network,verifiedAt:new Date().toISOString(),verification:'Fresh-process remote recall with exact blob, SHA-256, trusted writer signature, kind, owner, operation and sequence validation. SQLite supplies discovery pointers only; record payloads come from Walrus.',recordsStored:rows.length,recordsRetrievable:manifest.filter(r=>r.restored).length,meaningfulRecordsRetrievable:manifest.filter(r=>r.restored&&r.meaningful).length,qualification:'Intent, checkpoint and outcome records linked to actual operations, plus explicit preferences; setup-only records, journals and probes excluded from the meaningful minimum.',probeRecordsExcluded:true,records:manifest};
 await writeFile('docs/mainnet-memory-manifest.json',JSON.stringify(value,null,2));console.log(JSON.stringify({recordsStored:value.recordsStored,recordsRetrievable:value.recordsRetrievable,meaningfulRecordsRetrievable:value.meaningfulRecordsRetrievable,file:'docs/mainnet-memory-manifest.json'}));
}finally{client.destroy();db.close();}
