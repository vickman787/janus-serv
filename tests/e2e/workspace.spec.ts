import { test,expect } from '@playwright/test';
const pages=[['/','Resume with evidence.'],['/operations','Operations'],['/operations/new','New administrative handover'],['/memory','Memory explorer'],['/status','System status'],['/guide','Guide']];
for(const width of [360,390,430,1280,1440])test(`complete workspace routes and safe disconnected controls at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const[path,heading]of pages){await page.goto(path!);await expect(page.getByRole('heading',{name:heading!,exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(path==='/operations/new')await expect(page.getByRole('button',{name:'Review handover',exact:true})).toBeDisabled();if(path==='/memory')await expect(page.getByRole('button',{name:'Approve and save preference'})).toBeDisabled();}
 expect(errors).toEqual([]);await page.goto('/');await expect(page.getByRole('heading',{name:'Resume with evidence.'})).toBeVisible();if(width===390||width===1440)await page.screenshot({path:`.data/full-app-${width}.png`,fullPage:true});
});
test('private operation direct URL fails closed without a session',async({page})=>{await page.goto('/operations/550e8400-e29b-41d4-a716-446655440000');await expect(page.getByText('No safe action is enabled.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Review acceptance'})).toHaveCount(0);});

test('refresh does not revoke a valid session while wallet reconnect is pending',async({page})=>{
 let logoutRequests=0,sessionRequests=0;
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/auth/logout'){logoutRequests++;await route.fulfill({json:{status:'logged_out'}});return;}
  if(path==='/api/session'){sessionRequests++;await route.fulfill({json:{actor:`0x${'1'.repeat(64)}`,expiresAt:Date.now()+1800000,network:'testnet'}});return;}
  const values:Record<string,unknown>={'/api/config':{packageId:null,packageCompiled:false,memoryNetwork:'mainnet'},'/api/health':{tatum:{status:'fixture'},walrus:{status:'fixture'},worker:{status:'fixture'}},'/api/operations':{operations:[]}};
  await route.fulfill({json:values[path]??{}});
 });
 await page.goto('/operations/new');await page.waitForLoadState('networkidle');
 expect(sessionRequests).toBeGreaterThan(0);expect(logoutRequests).toBe(0);
 await expect(page.getByRole('button',{name:'Review handover',exact:true})).toBeDisabled();
 const previousRequests=sessionRequests;
 await page.reload();await page.waitForLoadState('networkidle');
 expect(sessionRequests).toBeGreaterThan(previousRequests);expect(logoutRequests).toBe(0);
 await expect(page.getByRole('button',{name:'Review handover',exact:true})).toBeDisabled();
});
