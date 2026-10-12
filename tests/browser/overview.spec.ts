import { test, expect } from '@playwright/test';
const allPeriods=0xffffff;
for(const [day,half] of [[15,'Early'],[16,'Late']] as const) {
  test(`the overview shades only ${half.toLowerCase()} October on day ${day}`,async({page},testInfo)=>{
    await page.clock.setFixedTime(new Date(2026,9,day,12));
    await page.route('**/api/plants',route=>route.fulfill({json:[
      {id:1,name:'Nothing planned',sow_periods:0,plant_periods:0},
      {id:2,name:'Sow',sow_periods:allPeriods,plant_periods:0},
      {id:3,name:'Plant',sow_periods:0,plant_periods:allPeriods},
      {id:4,name:'Both',sow_periods:allPeriods,plant_periods:allPeriods},
    ].map(p=>({...p,sun_requirements:0,needs_reorder:false}))}));
    await page.goto('/');
    await page.getByLabel('Password',{exact:true}).fill('tuinapp-browser-test-only-password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('button',{name:'Overview',exact:true}).click();
    await expect(page.locator('th[aria-current=date]')).toHaveAccessibleName(`${half} October, current period`);
    await expect(page.locator('th.current-period')).toHaveCount(1);
    await expect(page.locator('td.current-period')).toHaveCount(4);
    await expect(page.locator('td.current-period')).toHaveText(['','S','P','S/P']);
    const columns=await page.locator('td.current-period').evaluateAll(cells=>cells.map(cell=>(cell as HTMLTableCellElement).cellIndex));
    expect(columns).toEqual(Array(4).fill(day===15?19:20));
    for(const cell of await page.locator('td.current-period').all()) {
      expect(await cell.evaluate(el=>getComputedStyle(el).boxShadow)).not.toBe('none');
    }
    expect(await page.locator('td.current-period.sow:not(.both)').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(129, 199, 132)');
    expect(await page.locator('td.current-period.plant:not(.both)').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(255, 183, 77)');
    expect(await page.locator('td.current-period.both').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
    await page.screenshot({path:testInfo.outputPath('current-period.png')});
    await page.getByLabel('Plants shown',{exact:true}).selectOption('month');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await expect(page.locator('.record-count')).toHaveText('3 of 4 plants');
    await expect(page.getByRole('button',{name:'Nothing planned',exact:true})).toHaveCount(0);
    await expect(page.locator('td.current-period')).toHaveText(['S','P','S/P']);
    await page.getByLabel('Plants shown',{exact:true}).selectOption('all');
    await expect(page.locator('tbody tr')).toHaveCount(4);
  });
}
