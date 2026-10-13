import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const password = 'tuinapp-browser-test-only-password';
const prefix = 'UX regression ';
async function signIn(page: Page) {
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}
async function add(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Add Plant', exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(prefix + name);
}

test.beforeEach(async ({ page }) => { await page.goto('/'); await signIn(page); });
test.afterEach(async ({ page }) => {
  // Remove only records owned by these tests, in the disposable test database.
  const session = await page.request.get('/api/session');
  if (!session.ok()) return;
  const {csrf_token} = await session.json();
  for (const table of ['plants','activities']) {
    const records = await (await page.request.get(`/api/${table}`)).json();
    for (const record of records.filter((r: {name:string})=>r.name.startsWith(prefix))) {
      await page.request.delete(`/api/${table}/${record.id}`, {headers:{'X-Tuinapp-Request':'1','X-CSRF-Token':csrf_token},data:{revision:record.revision}});
    }
  }
});

test('keyboard form focus, whitespace validation, Enter save and focus return', async ({ page }) => {
  const addButton = page.getByRole('button', { name: '+ Add Plant', exact: true }).first();
  await addButton.click();
  const dialog = page.getByRole('dialog'); const name = dialog.getByLabel('Name', {exact:true});
  await expect(name).toBeFocused();
  await name.fill('   '); await name.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('enter a name');
  await name.fill(prefix+'keyboard'); await name.press('Shift+Tab');
  await expect(dialog.getByRole('button', {name:'Save & Close'})).toBeFocused();
  await page.keyboard.press('Tab'); await expect(name).toBeFocused();
  await name.press('Enter');
  await expect(dialog).toHaveCount(0); await expect(addButton).toBeFocused();
  await expect(page.getByRole('button', {name:prefix+'keyboard',exact:true})).toBeVisible();
});

test('unsaved changes can be kept or discarded with Escape', async ({ page }) => {
  await add(page,'draft');
  page.once('dialog', d=>d.dismiss()); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog').getByLabel('Name',{exact:true})).toHaveValue(prefix+'draft');
  page.once('dialog', d=>d.accept()); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:prefix+'draft',exact:true})).toHaveCount(0);
});

test('complete plant fields survive save, reload, edit and ordering', async ({ page }) => {
  await add(page,'round trip'); const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Vegetable',exact:false}).click();
  await dialog.getByRole('button',{name:'Full Sun',exact:false}).click();
  await dialog.getByRole('button',{name:'Half Sun',exact:false}).click();
  await dialog.getByRole('button',{name:'Sowing Periods: early January',exact:true}).click();
  await dialog.getByRole('button',{name:'Sowing Periods: late December',exact:true}).click();
  await dialog.getByRole('button',{name:'Planting Periods: late June',exact:true}).click();
  await dialog.getByLabel('Notes',{exact:true}).fill('Keep 30 cm apart.\nSecond line: café 🌱');
  await dialog.getByLabel('Needs to be reordered').check();
  await dialog.getByRole('button',{name:'Save & Close'}).click(); await page.reload();
  await page.getByRole('button',{name:prefix+'round trip',exact:true}).click();
  await expect(dialog.getByLabel('Notes',{exact:true})).toHaveValue('Keep 30 cm apart.\nSecond line: café 🌱');
  for (const button of ['Sowing Periods: early January','Sowing Periods: late December','Planting Periods: late June']) await expect(dialog.getByRole('button',{name:button,exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(dialog.getByLabel('Needs to be reordered')).toBeChecked();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('navigation').getByRole('button',{name:'To Order',exact:true}).click();
  const row=page.getByRole('row').filter({hasText:prefix+'round trip'});
  await row.getByRole('button',{name:'Ordered',exact:false}).click(); await expect(row).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button',{name:'Plants',exact:true}).click();
  await page.getByRole('button',{name:prefix+'round trip',exact:true}).click();
  await expect(dialog.getByLabel('Needs to be reordered')).not.toBeChecked();
  await expect(dialog.getByLabel('Notes',{exact:true})).toHaveValue('Keep 30 cm apart.\nSecond line: café 🌱');
});

test('search trims spaces, ignores case, reports no matches and clears', async ({ page }) => {
  await add(page,'Search Basil'); await page.getByRole('button',{name:'Save & Close'}).click();
  const search=page.getByRole('textbox',{name:'Search plants'}); await search.fill('  SEARCH basil  ');
  await expect(page.locator('.plant-list tbody tr')).toHaveCount(1);
  await search.fill('no-such-plant-12345'); await expect(page.getByText('No plants match your search.')).toBeVisible();
  await search.fill(''); await expect(page.getByRole('button',{name:prefix+'Search Basil',exact:true})).toBeVisible();
});

test('list request failure has a recoverable retry', async ({ page }) => {
  await page.route('**/api/plants', route=>route.fulfill({status:503,json:{error:'Garden temporarily unavailable'}}));
  await page.reload(); await expect(page.locator('.load-error')).toContainText('Garden temporarily unavailable');
  await page.unroute('**/api/plants'); await page.getByRole('button',{name:'Try again'}).click();
  await expect(page.locator('.load-error')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Plants'})).toBeVisible();
});

test('failed save preserves input and retry creates exactly one plant', async ({ page }) => {
  await add(page,'retry'); const dialog=page.getByRole('dialog'); await dialog.getByLabel('Notes',{exact:true}).fill('Keep this draft');
  await page.route('**/api/plants', route=>route.request().method()==='POST' ? route.fulfill({status:503,json:{error:'Please retry saving'}}) : route.continue());
  await dialog.getByRole('button',{name:'Save & Close'}).click();
  await expect(page.getByRole('alert')).toContainText('Please retry saving');
  await expect(dialog.getByLabel('Notes',{exact:true})).toHaveValue('Keep this draft');
  await page.unroute('**/api/plants'); await dialog.getByRole('button',{name:'Save & Close'}).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByRole('button',{name:prefix+'retry',exact:true})).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('session expiry asks for sign in and preserves the open draft', async ({ page, context }) => {
  await add(page,'session draft'); await context.clearCookies();
  await page.getByRole('button',{name:'Save & Close'}).click();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await signIn(page);
  await expect(page.getByRole('dialog').getByLabel('Name',{exact:true})).toHaveValue(prefix+'session draft');
  await expect(page.getByRole('dialog').getByLabel('Name',{exact:true})).toBeFocused();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button',{name:'Save & Close'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('activity quick add, save another reset, calendar periods and edit', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button',{name:'+ Add Activity',exact:true}).click();
  const dialog=page.getByRole('dialog'); await dialog.getByLabel('Name',{exact:true}).fill(prefix+'mulch');
  await dialog.getByLabel('Description',{exact:true}).fill('Use leaf mould');
  await dialog.getByRole('button',{name:'Periods: late December',exact:false}).click();
  await dialog.getByRole('button',{name:'Save & Add Another'}).click();
  await expect(page.getByRole('dialog').getByLabel('Name',{exact:true})).toHaveValue('');
  await expect(page.getByRole('dialog').getByLabel('Description',{exact:true})).toHaveValue('');
  await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  const activityRow=page.locator('.activity-list tbody tr').filter({has:page.getByRole('button',{name:prefix+'mulch',exact:true})});
  await expect(activityRow.locator('.activity-months')).toHaveText('December');
  await page.getByRole('button',{name:prefix+'mulch',exact:true}).click();
  await expect(page.getByRole('dialog').getByLabel('Description',{exact:true})).toHaveValue('Use leaf mould');
  await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('navigation').getByRole('button',{name:'Calendar',exact:true}).click();
  await page.getByLabel('Calendar month').selectOption('12'); await expect(page.getByText(prefix+'mulch',{exact:true})).toBeVisible();
});

test('sun symbols match the colored screen assets and plant forms have no photo features', async ({ page }) => {
  await add(page,'sun icons');
  const dialog=page.getByRole('dialog');
  for (const label of ['Full Sun','Half Sun','Shade']) {
    const choice=dialog.getByRole('button',{name:label,exact:true});
    await expect(choice).toHaveAttribute('aria-pressed','false');
    await choice.click(); await expect(choice).toHaveAttribute('aria-pressed','true');
  }
  await expect(dialog).not.toContainText(/photo|camera|upload/i);
  await expect(dialog.locator('input[type=file]')).toHaveCount(0);
  await dialog.getByRole('button',{name:'Save & Close'}).click();
  const row=page.locator('tr').filter({has:page.getByRole('button',{name:prefix+'sun icons',exact:true})});
  await expect(row.getByRole('img')).toHaveCount(3);
  for (const [label,file] of [['Full Sun','full-sun'],['Half Sun','half-sun'],['Shade','shade']]) {
    const icon=row.getByRole('img',{name:label,exact:true});
    await expect(icon).toHaveAttribute('src',`/icons/${file}.svg`);
    await expect.poll(()=>icon.evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
  }
  await expect(page.getByRole('columnheader',{name:'Photo',exact:true})).toHaveCount(0);
  await row.getByRole('button').click();
  await expect(dialog).not.toContainText(/photo|camera|upload/i);
  await expect(dialog.locator('input[type=file]')).toHaveCount(0);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.locator('.settings-view')).not.toContainText(/photo|camera/i);
});

test('Settings lists automatic R2 backups and a guarded SQL restore form', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Settings & backups'})).toBeVisible();
  await expect(page.locator('.settings-view')).not.toContainText(/spreadsheet|import|TSV/i);
  await expect(page.locator('input[type=file]')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'Restore from a SQL dump'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Restore garden'})).toBeDisabled();
  await expect(page.getByRole('button',{name:/Back up now|Test recovery/})).toHaveCount(0);
  await expect(page.getByRole('link',{name:/Download backup from/}).first()).toBeVisible();
  await expect(page.getByText('Changes are checked daily.',{exact:false})).toBeVisible();
});

test('backup status failure is explicit and retry recovers', async ({ page }) => {
  await page.route('**/api/backups/status',r=>r.fulfill({status:503,json:{error:'Status unavailable'}}));
  await page.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.locator('.settings-view').getByRole('alert')).toContainText('Status unavailable');
  await page.unroute('**/api/backups/status'); await page.getByRole('button',{name:'Try again'}).click();
  await expect(page.locator('.settings-view').getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Latest successful backup')).toBeVisible();
});

test('desktop pages and dialogs pass accessibility checks', async ({ page }) => {
  for (const view of ['Plants','Activities','Calendar','To Order','Settings']) {
    await page.getByRole('navigation').getByRole('button',{name:view,exact:true}).click();
    await expect(page.getByRole('heading',{level:1})).toBeVisible();
    const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(result.violations, JSON.stringify(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))).toEqual([]);
  }
  await add(page,'accessible');
  const result=await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
});

for (const size of [{width:1280,height:800},{width:1920,height:1080}]) {
  test(`desktop layout and save controls at ${size.width}×${size.height}`,async ({page},testInfo)=>{
    await page.setViewportSize(size); await add(page,'layout');
    const dialog=page.getByRole('dialog'); const box=await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x+box!.width).toBeLessThanOrEqual(size.width); expect(box!.height).toBeLessThanOrEqual(size.height);
    await dialog.getByRole('button',{name:'Save & Close'}).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('button',{name:'Save & Close'})).toBeInViewport();
    await page.screenshot({path:testInfo.outputPath('plant-form.png')});
    await dialog.getByRole('button',{name:'Save & Close'}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  });
}

test('failed backup download keeps Settings open and allows retry', async ({page})=>{
  await page.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();
  await page.route('**/api/backups/*/download',r=>r.fulfill({status:503,json:{error:'Backup storage unavailable'}}));
  await page.getByRole('link',{name:/Download backup from/}).first().click();
  await expect(page.getByRole('alert')).toContainText('Backup storage unavailable');
  await expect(page.getByRole('heading',{name:'Settings & backups'})).toBeVisible();
  await page.unroute('**/api/backups/*/download');
  const pending=page.waitForEvent('download'); await page.getByRole('link',{name:/Download backup from/}).first().click();
  expect((await pending).suggestedFilename()).toMatch(/^tuinapp-.*\.sql$/);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('SQL restore needs explicit replacement confirmation and reports success', async ({page})=>{
  let requestWasProtected=false;
  await page.route('**/api/backups/restore',async route=>{
    requestWasProtected=route.request().method()==='POST' && route.request().headers()['x-tuinapp-restore-confirm']==='replace' && route.request().headers()['content-type']==='application/sql';
    await route.fulfill({status:200,json:{ok:true}});
  });
  await page.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles({name:'garden.sql',mimeType:'application/sql',buffer:Buffer.from('INSERT INTO plants(name) VALUES (\'Basil\');')});
  await expect(page.getByRole('button',{name:'Restore garden'})).toBeDisabled();
  await page.getByLabel('I understand this replaces my current garden.').check();
  await expect(page.getByRole('button',{name:'Restore garden'})).toBeEnabled();
  await page.getByRole('button',{name:'Restore garden'}).click();
  await expect(page.locator('.restore-banner')).toContainText('Garden restored');
  expect(requestWasProtected).toBe(true);
  await expect(page.getByRole('heading',{name:'Plants'})).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(0);
});

test('failed SQL restore keeps the selected dump and confirmation for retry',async ({page})=>{
  await page.route('**/api/backups/restore',r=>r.fulfill({status:400,json:{error:'Dump is invalid'}}));
  await page.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles({name:'garden.sql',mimeType:'application/sql',buffer:Buffer.from('invalid')});
  await page.getByLabel('I understand this replaces my current garden.').check();
  await page.getByRole('button',{name:'Restore garden'}).click();
  await expect(page.locator('.settings-view').getByRole('alert')).toContainText('Dump is invalid');
  await expect(page.getByText('Selected: garden.sql')).toBeVisible();
  await expect(page.getByLabel('I understand this replaces my current garden.')).toBeChecked();
  await expect(page.getByRole('button',{name:'Restore garden'})).toBeEnabled();
});

test('sign out hides private data and signing back in reopens the garden', async ({page})=>{
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await expect(page.locator('.plant-list')).toHaveCount(0);
  await signIn(page); await expect(page.getByRole('heading',{name:'Plants'})).toBeVisible();
});

test('annual overview keeps its legend and month headers visible while scrolling', async ({page})=>{
  await page.setViewportSize({width:1280,height:800});
  await add(page,'overview'); await page.getByRole('button',{name:'Sowing Periods: early January',exact:true}).click();
  await page.getByRole('button',{name:'Save & Close'}).click();
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  await expect(page.getByText('S = Sow',{exact:true})).toBeInViewport();
  const region=page.getByRole('region',{name:'Annual plant schedule'});
  await region.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await expect(page.getByRole('columnheader',{name:'January',exact:true})).toBeInViewport();
  const cell=page.getByRole('cell',{name:prefix+'overview, early January: sow',exact:true});
  await expect(cell).toHaveText('S');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
