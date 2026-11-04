import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
const cli=process.env.SUI_CLI_PATH??(process.platform==='win32'?'.tools/sui/sui.exe':'sui');
const result=spawnSync(cli,['move','build','--path','contracts/janus_handover','--dump-bytecode-as-base64'],{encoding:'utf8',maxBuffer:8*1024*1024});
if(result.status!==0){console.error('Move build failed. Run the Sui CLI build directly for compiler diagnostics.');process.exit(1);}
let artifact;try{artifact=JSON.parse(result.stdout);}catch{console.error('Move build did not return a parseable package artifact.');process.exit(1);}
if(!Array.isArray(artifact.modules)||!artifact.modules.length||!Array.isArray(artifact.dependencies))throw new Error('Invalid compiled package');
mkdirSync('.data',{recursive:true});writeFileSync('.data/package.json',JSON.stringify(artifact));mkdirSync('contracts/janus_handover/compiled',{recursive:true});writeFileSync('contracts/janus_handover/compiled/package.json',JSON.stringify(artifact));const provenance={compiler:spawnSync(cli,['--version'],{encoding:'utf8'}).stdout.trim(),sourceSha256:createHash('sha256').update(readFileSync('contracts/janus_handover/sources/handover.move')).digest('hex'),artifactSha256:createHash('sha256').update(JSON.stringify(artifact)).digest('hex'),builtAt:new Date().toISOString(),publicationPerformedByCompile:false};writeFileSync('contracts/janus_handover/compiled/provenance.json',JSON.stringify(provenance,null,2));console.log(`Compiled ${artifact.modules.length} module(s); wallet publication artifact: .data/package.json`);
