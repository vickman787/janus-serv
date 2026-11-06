import { chromium, type Page } from 'playwright';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
const stored=JSON.parse(readFileSync('.data/openserv-e2e-keys.json','utf8')) as {successor:string};
const keypair=Ed25519Keypair.fromSecretKey(stored.successor); const address=keypair.toSuiAddress(); const publicKey=Array.from(keypair.getPublicKey().toRawBytes());
const init=`(()=>{const address=${JSON.stringify(address)};const publicKey=new Uint8Array(${JSON.stringify(publicKey)});const account={address,publicKey,chains:['sui:testnet'],features:['sui:signPersonalMessage','sui:signTransaction']};const wallet={version:'1.0.0',name:'Janus Test Wallet',icon:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nxsAAAAASUVORK5CYII=',chains:['sui:testnet'],accounts:[account],features:{'standard:connect':{version:'1.0.0',connect:async()=>({accounts:[account]})},'standard:disconnect':{version:'1.0.0',disconnect:async()=>{}},'standard:events':{version:'1.0.0',on:()=>()=>{}},'sui:signPersonalMessage':{version:'1.0.0',signPersonalMessage:async({message})=>window.__signPersonalMessage(Array.from(message))},'sui:signTransaction':{version:'1.0.0',signTransaction:async()=>{throw new Error('not used');}}}};const register=()=>window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet',{detail:(api)=>api.register(wallet)}));window.addEventListener('wallet-standard:app-ready',register);setTimeout(register,100);})();`;
const cursor=`(()=>{const start=()=>{const s=document.createElement('style');s.textContent='#demo-cursor{position:fixed;width:18px;height:18px;border:2px solid #7d95ff;background:rgba(77,107,255,.25);border-radius:50%;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);transition:width .12s,height .12s,background .12s;box-shadow:0 0 0 3px rgba(77,107,255,.18)}#demo-click{position:fixed;border:2px solid #aab9ff;border-radius:50%;pointer-events:none;z-index:2147483646;transform:translate(-50%,-50%);animation:demoRing .5s ease-out forwards}@keyframes demoRing{from{width:10px;height:10px;opacity:1}to{width:54px;height:54px;opacity:0}}';document.head.appendChild(s);const c=document.createElement('div');c.id='demo-cursor';document.body.appendChild(c);addEventListener('mousemove',e=>{c.style.left=e.clientX+'px';c.style.top=e.clientY+'px'});addEventListener('mousedown',e=>{c.style.width='26px';c.style.height='26px';const r=document.createElement('div');r.id='demo-click';r.style.left=e.clientX+'px';r.style.top=e.clientY+'px';document.body.appendChild(r);setTimeout(()=>r.remove(),520);setTimeout(()=>{c.style.width='18px';c.style.height='18px'},150)});};if(document.body)start();else document.addEventListener('DOMContentLoaded',start);})();`;
function wire(page:Page){page.on('pageerror',e=>console.log('PAGEERROR',e.message));}
async function makePage(context:any){const page=await context.newPage();wire(page);await page.exposeFunction('__signPersonalMessage',async(message:number[])=>{const s=await keypair.signPersonalMessage(Uint8Array.from(message));return{bytes:s.bytes,signature:s.signature};});return page;}
async function authenticate(page:Page){
 await page.goto('http://127.0.0.1:4310/',{waitUntil:'networkidle'});
 await page.waitForTimeout(1500);
 if(!(await page.getByText(/Authenticated/).count())){
  const connect=page.getByRole('button',{name:/connect/i}).first();
  if(await connect.count()){await connect.click();await page.getByText('Janus Test Wallet',{exact:true}).click();}
  await page.getByRole('heading',{name:'Verify wallet ownership'}).waitFor({timeout:20000});
  await page.getByRole('button',{name:'Review authentication message'}).click();
  await page.getByRole('button',{name:'Sign authentication message'}).click();
  await page.getByText(/Wallet ownership verified/).waitFor({timeout:20000});
 }
}
async function smooth(page:Page,selector:string,offset=100,wait=5000){const loc=page.locator(selector).first();await loc.waitFor({timeout:30000});await loc.evaluate((el:Element,off:number)=>{window.scrollTo({top:(el as HTMLElement).getBoundingClientRect().top+window.scrollY-off,behavior:'smooth'});},offset);await page.waitForTimeout(wait);}
const statePath='.data/demo-storage.json';
const setupBrowser=await chromium.launch({channel:'msedge',headless:true});
{const context=await setupBrowser.newContext({viewport:{width:1920,height:1080}});await context.addInitScript({content:init});const page=await makePage(context);await authenticate(page);await context.storageState({path:statePath});await context.close();}
await setupBrowser.close();
const raw='.data/demo-raw';rmSync(raw,{recursive:true,force:true});mkdirSync(raw,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,recordVideo:{dir:raw,size:{width:1920,height:1080}},storageState:statePath});
await context.addInitScript({content:init});
const page=await makePage(context);await page.addInitScript({content:cursor});
await page.goto('http://127.0.0.1:4310/',{waitUntil:'networkidle'});
if(await page.getByText('Verify wallet ownership').count()){await authenticate(page);}
await page.getByText(/Authenticated/).waitFor({timeout:30000}).catch(()=>{});
await page.waitForTimeout(3000);
await smooth(page,'.stats',120,5000);
await smooth(page,'.table-wrap',120,5000);
const label='OpenServ isolated testnet handover';
const row=page.getByRole('row',{name:new RegExp(label)}).first();
if(await row.count()){await row.getByRole('link',{name:/Open/}).click();}else{await page.goto('http://127.0.0.1:4310/operations/487dc4e5-efdd-408b-80b0-670db9b79c43');}
await page.getByText('REMEMBERED STATE',{exact:true}).waitFor({timeout:30000});
await page.waitForTimeout(5000);
await smooth(page,'.verdict',110,8000);
await smooth(page,'section:has-text("Evidence and recovery reference")',110,8000);
await smooth(page,'section.copilot',100,4000);
await page.locator('.copilot-assessment').waitFor({timeout:60000});
await page.waitForTimeout(8000);
await page.evaluate(()=>window.scrollBy({top:650,behavior:'smooth'}));await page.waitForTimeout(8000);
await page.evaluate(()=>window.scrollBy({top:650,behavior:'smooth'}));await page.waitForTimeout(8000);
await page.locator('.copilot-history summary').click();await page.waitForTimeout(2500);
await page.locator('.copilot-history button').filter({hasText:'ready'}).first().click();
await page.locator('.copilot-stale-banner').waitFor({timeout:20000});
await page.locator('.copilot-stale-banner').evaluate((el)=>window.scrollTo({top:el.getBoundingClientRect().top+window.scrollY-180,behavior:'smooth'}));
await page.waitForTimeout(9000);
await page.locator('.copilot-history button').filter({hasText:'completed'}).first().click();await page.waitForTimeout(4000);
await smooth(page,'.copilot-footnote',150,5000);
await page.waitForTimeout(4000);
const video=page.video();await context.close();const videoPath=await video?.path();
await browser.close();
console.log(JSON.stringify({videoPath,address}));

