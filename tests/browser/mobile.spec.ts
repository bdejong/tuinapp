import { test, expect, type Page } from '@playwright/test';

const password = 'tuinapp-browser-test-only-password';
const widths = [320, 375, 390];
const prefix = 'Mobile regression ';

async function signIn(page: Page) {
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}

async function expectNoPageOverflow(page: Page, width: number) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    content: document.querySelector('.content')?.scrollWidth ?? 0,
    contentViewport: document.querySelector('.content')?.clientWidth ?? 0,
  }));
  expect(dimensions.viewport).toBe(width);
  expect(dimensions.document, `document wider than ${width}px`).toBeLessThanOrEqual(width);
  expect(dimensions.body, `body wider than ${width}px`).toBeLessThanOrEqual(width);
  expect(dimensions.content, `main content wider than its viewport at ${width}px`).toBeLessThanOrEqual(dimensions.contentViewport);
}

for (const width of widths) {
  test(`mobile garden flows fit ${width}px screens`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.goto('/');
    await signIn(page);
    await expectNoPageOverflow(page, width);

    const navigation = page.getByRole('navigation');
    const navBox = await navigation.boundingBox();
    expect(navBox?.x).toBe(0);
    expect(navBox?.width).toBeGreaterThanOrEqual(width - 1);
    expect((navBox?.y ?? 0) + (navBox?.height ?? 0)).toBeLessThanOrEqual(780);
    await expect(navigation.getByRole('button', { name: 'Plants', exact: true })).toBeVisible();
    for (const label of ['Plants', 'Activities', 'Calendar', 'To Order', 'Settings', 'Sign out']) {
      await expect(navigation.getByRole('button', { name: label, exact: true })).toHaveCSS('white-space', 'nowrap');
    }
    for (const label of ['Plants', 'Activities', 'Calendar', 'To Order', 'Settings', 'Sign out']) {
      const box = await navigation.getByRole('button', { name: label, exact: true }).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    }

    const plantName = `${prefix}${width} ${'Basilicum'.repeat(25)}`;
    await page.getByRole('button', { name: '+ Add Plant', exact: true }).first().click();
    let dialog = page.getByRole('dialog');
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox?.width).toBeLessThanOrEqual(width);
    expect(dialogBox?.x).toBeGreaterThanOrEqual(0);
    const plantNameField = dialog.getByLabel('Name', { exact: true });
    expect((await plantNameField.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expect.poll(() => dialog.locator('.period-grid').first().evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await plantNameField.fill(plantName);
    await dialog.getByRole('button', { name: 'Sowing Periods: early January', exact: true }).click();
    await dialog.getByLabel('Needs to be reordered').check();
    await dialog.getByRole('button', { name: 'Save & Close', exact: true }).click();
    await expect(page.getByRole('button', { name: plantName, exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: plantName, exact: true }).first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Notes', { exact: true }).fill('Saved from a narrow screen');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoPageOverflow(page, width);

    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Plant Overview', exact: true })).toBeVisible();
    const grid = page.getByRole('region', { name: 'Annual plant schedule' });
    const stickyName = grid.locator('tbody .plant-name').first();
    expect((await stickyName.boundingBox())?.width).toBeLessThanOrEqual(121);
    const lastMonth = grid.locator('thead .month-header').last();
    await grid.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect.poll(async () => {
      const box = await lastMonth.boundingBox();
      const viewport = await grid.boundingBox();
      return !!box && !!viewport && box.x < viewport.x + viewport.width && box.x + box.width > viewport.x;
    }).toBe(true);
    await grid.evaluate(element => { element.scrollLeft = 0; });
    await expectNoPageOverflow(page, width);
    await navigation.getByRole('button', { name: 'To Order', exact: true }).click();
    const orderRow = page.getByRole('row').filter({ hasText: plantName });
    await expect(orderRow).toBeVisible();
    await expectNoPageOverflow(page, width);
    await orderRow.getByRole('button', { name: 'Ordered', exact: true }).click();
    await expect(orderRow).toHaveCount(0);
    await navigation.getByRole('button', { name: 'Plants', exact: true }).click();
    await page.getByRole('button', { name: 'Manage', exact: true }).click();

    const activityName = `${prefix}${width} activity`;
    await navigation.getByRole('button', { name: 'Activities', exact: true }).click();
    await page.getByRole('button', { name: '+ Add Activity', exact: true }).click();
    dialog = page.getByRole('dialog');
    expect((await dialog.getByLabel('Name', { exact: true }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await dialog.getByLabel('Name', { exact: true }).fill(activityName);
    await dialog.getByLabel('Description', { exact: true }).fill('Check the plants');
    await dialog.getByRole('button', { name: 'Periods: late December', exact: false }).click();
    await dialog.getByRole('button', { name: 'Save & Close', exact: true }).click();
    await expect(page.getByRole('button', { name: activityName, exact: true })).toBeVisible();
    await page.getByRole('button', { name: activityName, exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Description', { exact: true }).fill('Edited on mobile');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expectNoPageOverflow(page, width);

    await navigation.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(page.getByRole('heading', { name: /in the garden/ })).toBeVisible();
    await expect(page.locator('.month-sections section')).toHaveCount(4);
    await expectNoPageOverflow(page, width);

    await navigation.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings & backups' })).toBeVisible();
    await expect(page.locator('input[type=file]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Restore/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Download backup from/ }).first()).toBeVisible();
    const downloadLink = page.getByRole('link', { name: /Download backup from/ }).first();
    expect((await downloadLink.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    const download = page.waitForEvent('download');
    await downloadLink.click();
    expect((await download).suggestedFilename()).toMatch(/^tuinapp-.*\.json$/);
    await expectNoPageOverflow(page, width);

    const sessionResponse = await page.request.get('/api/session');
    if (sessionResponse.ok()) {
      const { csrf_token } = await sessionResponse.json();
      const plants = await (await page.request.get('/api/plants')).json();
      const activities = await (await page.request.get('/api/activities')).json();
      for (const plant of plants.filter((row: { name: string }) => row.name === plantName)) {
        await page.request.delete(`/api/plants/${plant.id}`, { headers: { 'X-Tuinapp-Request': '1', 'X-CSRF-Token': csrf_token }, data: { revision: plant.revision } });
      }
      for (const activity of activities.filter((row: { name: string }) => row.name === activityName)) {
        await page.request.delete(`/api/activities/${activity.id}`, { headers: { 'X-Tuinapp-Request': '1', 'X-CSRF-Token': csrf_token }, data: { revision: activity.revision } });
      }
    }
    await navigation.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  });
}
