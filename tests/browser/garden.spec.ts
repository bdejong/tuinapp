import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const source = process.env.TUINAPP_GOLDEN_DB;
const hash = () => source ? createHash('sha256').update(readFileSync(source)).digest('hex') : '';
let originalHash = '';
test.beforeAll(() => { originalHash = hash(); });
test.afterAll(() => { expect(hash()).toBe(originalHash); });
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill('tuinapp-browser-test-only-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plants' })).toBeVisible();
});

test('golden records load without photo features', async ({ page }) => {
  test.skip(!source, 'Run with TUINAPP_GOLDEN_DB to test private data');
  const photoRequests: string[] = [];
  page.on('request', request => { if (/\/api\/plants\/\d+\/photos/.test(request.url())) photoRequests.push(request.url()); });
  await page.reload();
  await expect(page.locator('.plant-list tbody tr')).toHaveCount(177);
  expect(photoRequests).toHaveLength(0);
  await expect(page.getByRole('columnheader',{name:'Photo',exact:true})).toHaveCount(0);
  await page.getByText('To Order', { exact: true }).click();
  await expect(page.locator('.to-order-view tbody tr')).toHaveCount(17);
  await page.getByText('Activities', { exact: true }).first().click();
  await expect(page.locator('.activity-list tbody tr')).toHaveCount(9);
});

test('desktop create, save another, overview edit and delete', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add Plant', exact: true }).first().click();
  let dialog = page.getByRole('dialog', { name: 'Plant details' });
  await dialog.getByLabel('Name', { exact: true }).fill('Browser regression plant');
  await dialog.getByLabel('Notes', { exact: true }).fill('A desktop note');
  await dialog.getByRole('button', { name: 'Sowing Periods: early January', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save & Add Another' }).click();
  await expect(page.getByRole('dialog').getByLabel('Name', { exact: true })).toHaveValue('');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('cell', { name: 'Browser regression plant', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Plant details' });
  await expect(dialog.getByLabel('Notes', { exact: true })).toHaveValue('A desktop note');
  await dialog.getByLabel('Notes', { exact: true }).fill('Updated from overview');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('cell', { name: 'Browser regression plant', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Notes', { exact: true })).toHaveValue('Updated from overview');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, Delete' }).click();
  await expect(page.getByRole('cell', { name: 'Browser regression plant', exact: true })).toHaveCount(0);
});

test('stale edit keeps local form contents and shows a useful error', async ({ page, context }) => {
  await page.getByRole('button', { name: '+ Add Plant', exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Conflict regression plant');
  await page.getByRole('button', { name: 'Save & Close' }).click();
  await page.getByRole('cell', { name: 'Conflict regression plant', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Notes', { exact: true }).fill('Unsaved screen A note');
  const second = await context.newPage(); await second.goto('/');
  await second.getByRole('cell', { name: 'Conflict regression plant', exact: true }).click();
  await second.getByRole('dialog').getByLabel('Notes', { exact: true }).fill('Saved screen B note');
  await second.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(second.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed');
  await expect(page.getByRole('dialog').getByLabel('Notes', { exact: true })).toHaveValue('Unsaved screen A note');
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('cell', { name: 'Conflict regression plant', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Notes', { exact: true })).toHaveValue('Saved screen B note');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();await page.getByRole('button', { name: 'Yes, Delete' }).click();
  await second.close();
});

test('calendar renders all categories and prints, backups restore and download', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add Plant', exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Uncategorized calendar plant');
  await page.getByRole('button', { name: 'Sowing Periods: early January', exact: true }).click();
  await page.getByRole('button', { name: 'Save & Close' }).click();
  await page.getByText('Calendar', { exact: true }).click();
  await page.getByLabel('Calendar month').selectOption('1');
  await expect(page.getByRole('heading', { name: 'Other', exact: true }).first()).toBeVisible();
  await expect(page.getByText('Uncategorized calendar plant', { exact: true })).toBeVisible();
  const pdfDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Printable PDF', exact: true}).click();
  const pdfDownload = await pdfDownloadPromise;
  expect(pdfDownload.suggestedFilename()).toBe('garden-planner-january.pdf');
  expect(readFileSync((await pdfDownload.path())!).subarray(0,5).toString()).toBe('%PDF-');
  await expect(page.getByRole('heading', { name: 'January in the garden' })).toBeVisible();
  await page.getByText('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Test recovery' }).click();
  await expect(page.getByRole('status')).toContainText('restored into a temporary database');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toBe('tuinapp-backup.zip');
  await page.getByText('Plants', { exact: true }).first().click();
  await page.getByRole('cell', { name: 'Uncategorized calendar plant', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();await page.getByRole('button', { name: 'Yes, Delete' }).click();
});
