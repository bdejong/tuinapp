// Local, private visual review of the disposable browser-test server.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const out = '.local/visual-review'; await mkdir(out, {recursive:true});
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('http://127.0.0.1:4173');
  await page.getByLabel('Password',{exact:true}).fill('tuinapp-browser-test-only-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.locator('.plant-list tbody tr').first().waitFor();
  await page.screenshot({path:`${out}/plants.png`});
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  await page.locator('.grid-container').waitFor();
  await page.screenshot({path:`${out}/overview.png`});
  await page.getByRole('navigation').getByRole('button',{name:'Calendar',exact:true}).click();
  await page.getByLabel('Calendar month').selectOption('4');
  await page.locator('.month-sections').waitFor();
  await page.screenshot({path:`${out}/calendar.png`});
  await page.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByText('Latest successful backup').waitFor();
  await page.screenshot({path:`${out}/backups.png`});
  await page.getByRole('navigation').getByRole('button',{name:'+ Add Plant',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.locator('.plant-list tbody tr').first().waitFor();
  await page.screenshot({path:`${out}/plant-form.png`});
  console.log(`Saved desktop screenshots in ${out}`);
} finally {await browser.close();}
