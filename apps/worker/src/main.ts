import { DatabaseSync } from 'node:sqlite';
import { createTatumClient } from '../../../packages/chain/src/tatum.js';
import { ChainAdapter,ZERO } from '../../../packages/chain/src/handover.js';
import { createMemoryClient } from '../../../packages/memory/src/client.js';
import { MemoryAdapter } from '../../../packages/memory/src/adapter.js';
import { Store } from '../../api/src/store.js';
import { Engine } from '../../api/src/engine.js';
const db=new DatabaseSync('.data/janus.sqlite'),store=new Store(db),provider=createTatumClient(),mem=createMemoryClient();
const configured=db.prepare('SELECT value FROM config WHERE key=?').get('packageId') as {value:string}|undefined;
const engine=new Engine(store,new ChainAdapter(provider.client,configured?.value??(process.env.JANUS_PACKAGE_ID||ZERO)),new MemoryAdapter(mem,process.env.JANUS_WRITER_KEY_PATH||'.data/writer-private.pem'));
console.log('Janus recovery worker running. It reconciles known digests; it never signs or broadcasts new transactions.');
let stopping=false;
process.once('SIGINT',()=>stopping=true);process.once('SIGTERM',()=>stopping=true);
while(!stopping){try{await engine.tick();}catch{}await new Promise(resolve=>setTimeout(resolve,20000));}
provider.close();mem.destroy();db.close();
