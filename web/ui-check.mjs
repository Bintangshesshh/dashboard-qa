import { chromium } from '../node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.QA_WEB_URL||'http://127.0.0.1:3000');
 await page.getByRole('button',{name:'Connect workspace',exact:true}).click();
 await page.getByLabel('Operator token').fill(process.env.OPERATOR_TOKEN||'local-verification-token-32-characters');
 await page.getByRole('button',{name:'Connect',exact:true}).click();
 await page.getByText('Operator connected',{exact:true}).waitFor();
 await page.waitForTimeout(1200);
 console.log('Alerts:',await page.getByRole('alert').allTextContents());
 assert.equal((await page.getByRole('alert').allTextContents()).filter(Boolean).length,0);
 assert.equal(await page.getByRole('log',{name:'Live execution terminal'}).count(),1);
 await page.screenshot({path:'preview-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.reload();
 await page.getByRole('button',{name:'Toggle sidebar'}).waitFor();
 await page.getByRole('button',{name:'Toggle sidebar'}).click();
 assert.ok(await page.getByRole('complementary',{name:'Suite navigation'}).isVisible());
 await page.getByRole('button',{name:'Toggle sidebar'}).click();
 assert.equal(await page.getByRole('complementary',{name:'Suite navigation'}).isVisible(),false);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'preview-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('UI check passed: authentication, workspace, responsive layout, no browser errors.');
} finally {await browser.close();}
