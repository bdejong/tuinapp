import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill('tuinapp-browser-test-only-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Calendar', exact: true }).click();
});

test('downloads the original-style PDF for each selected month', async ({ page }) => {
  for (const [month, name] of [[4, 'april'], [10, 'october']] as const) {
    await page.getByLabel('Calendar month').selectOption(String(month));
    await expect(page.getByRole('button', { name: 'Printable PDF', exact: true })).toBeEnabled();
    const pendingDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Printable PDF', exact: true }).click();
    const download = await pendingDownload;
    expect(download.suggestedFilename()).toBe(`garden-planner-${name}.pdf`);
    expect(readFileSync((await download.path())!).subarray(0, 5).toString()).toBe('%PDF-');
    await expect(page.getByRole('button', { name: 'Printable PDF', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Calendar month')).toHaveValue(String(month));
  }
});

test('a slow or failed PDF preserves the calendar and supports retry', async ({ page }) => {
  await page.getByLabel('Calendar month').selectOption('10');
  await expect(page.getByRole('button', { name: 'Printable PDF', exact: true })).toBeEnabled();
  let fail!: () => void;
  const gate = new Promise<void>(resolve => { fail = resolve; });
  await page.route('**/api/months/10/pdf-data', async route => {
    await gate;
    await route.fulfill({ status: 503, json: { error: 'PDF temporarily unavailable' } });
  });
  await page.getByRole('button', { name: 'Printable PDF', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preparing PDF…' })).toBeDisabled();
  await expect(page.getByLabel('Calendar month')).toBeDisabled();
  await expect(page.locator('.monthly-view [role=status]')).toContainText('Preparing');
  fail();
  await expect(page.locator('.monthly-view [role=alert]')).toContainText('PDF temporarily unavailable');
  await expect(page.getByRole('heading', { name: 'October in the garden' })).toBeVisible();
  await page.unroute('**/api/months/10/pdf-data');
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Retry PDF', exact: true }).click();
  expect((await pendingDownload).suggestedFilename()).toBe('garden-planner-october.pdf');
  await expect(page.locator('.monthly-view [role=alert]')).toHaveCount(0);
});
