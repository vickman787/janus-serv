import { readFile,stat } from 'node:fs/promises';
import { resolve,extname,sep } from 'node:path';
import type { IncomingMessage,ServerResponse } from 'node:http';
const root=resolve('dist/web');
export async function serveWeb(req:IncomingMessage,res:ServerResponse){
 try{const path=decodeURIComponent(new URL(req.url??'/', 'http://localhost').pathname);let file=resolve(root,'.'+path);
 if(file!==root&&!file.startsWith(root+sep))return false;
 try{if(!(await stat(file)).isFile())file=resolve(root,'index.html');}catch{file=resolve(root,'index.html');}
 const data=await readFile(file);const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
 res.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream','x-content-type-options':'nosniff','cache-control':file.endsWith('index.html')?'no-cache':'public, max-age=3600','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://fullnode.testnet.sui.io:443 https://fullnode.testnet.sui.io; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});res.end(data);return true;
 }catch{return false;}
}
