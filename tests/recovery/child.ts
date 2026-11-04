import { readFileSync,writeFileSync } from 'node:fs';
import { fixture } from './fixture.js';
const [dir,phase,mode]=process.argv.slice(2);
const cfg=JSON.parse(readFileSync(dir+'/request.json','utf8'));
const {engine,db}=fixture(dir!,cfg.admin,cfg.successor,point=>{if(point===phase){writeFileSync(dir+'/terminated-at',point);process.kill(process.pid,'SIGKILL');}});
try{if(mode==='create')await engine.create(cfg.input,cfg.admin,'session');else if(mode==='submit')await engine.submit(cfg.preparation.id,cfg.admin,'session',cfg.signed);else await engine.recover(cfg.preparation.id);}finally{db.close();}
