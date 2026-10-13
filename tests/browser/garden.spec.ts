import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill('tuinapp-browser-test-only-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plants' })).toBeVisible();
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

test('calendar prints all categories and saved backups download', async ({ page }) => {
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
  await expect(page.getByText('Changes are checked daily.', { exact: false })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: /Download backup from/ }).first().click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toMatch(/^tuinapp-.*\.sql$/);
  await page.getByText('Plants', { exact: true }).first().click();
  await page.getByRole('cell', { name: 'Uncategorized calendar plant', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();await page.getByRole('button', { name: 'Yes, Delete' }).click();
});

test('keeps SQL backups downloadable without exposing a browser restore workflow', async ({ page }) => {
  await page.getByText('Settings', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings & backups' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Restore from a SQL dump' })).toHaveCount(0);
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Restore garden' })).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: /Download backup from/ }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^tuinapp-.*\.sql$/);
  const dump = readFileSync((await download.path())!);
  expect(dump.toString()).toContain('tuinapp-backup-v1');
});
