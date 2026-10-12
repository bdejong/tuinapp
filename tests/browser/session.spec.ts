import { test, expect, type Page } from '@playwright/test';
const password = 'tuinapp-browser-test-only-password';
async function signIn(page: Page) {
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}

test('a failed load appears once and disappears after a successful retry', async ({ page }) => {
  await page.route('**/api/plants', route => route.fulfill({status:503,json:{error:'Garden temporarily unavailable'}}));
  await page.goto('/'); await signIn(page);
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText('Garden temporarily unavailable');
  await page.unroute('**/api/plants'); await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.plant-list table, .plant-list .empty')).toBeVisible();
});

for (const view of ['Plants', 'Overview', 'Activities', 'Calendar', 'To Order', 'Settings']) {
  test(`sign-in recovers an expired ${view} load without another retry`, async ({ page, context }) => {
    await page.goto('/'); await signIn(page);
    await expect(page.locator('.plant-list table, .plant-list .empty')).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    if (view === 'Plants') {
      await page.getByRole('button',{name:'Activities',exact:true}).click();
      await expect(page.getByRole('status')).toHaveCount(0);
    }
    await context.clearCookies();
    await page.getByRole('button',{name:view,exact:true}).click();
    await expect(page.getByLabel('Password',{exact:true})).toBeVisible();
    const path = view === 'Activities' ? '/api/activities' : view === 'Settings' ? '/api/backups/status' : view === 'Calendar' ? '/api/months/' : '/api/plants';
    const reload = page.waitForResponse(response => response.url().includes(path) && response.request().method() === 'GET' && response.status() === 200);
    await signIn(page);
    await reload;
    await expect(page.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
    if (view === 'Overview') {
      await page.getByRole('button',{name:'Manage',exact:true}).click();
      await expect(page.locator('.plant-list table, .plant-list .empty')).toBeVisible();
    }
  });
}
