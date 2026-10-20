// The other screens, their failure paths, and the layout at phone, tablet and laptop widths.

import { expect, test } from '@playwright/test';
import { expectNoSideScroll, signIn } from './helpers';

test('a browser call that cannot start says so on screen', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Be the supplier' }).first().click();
  await expect(page.getByRole('heading', { name: 'Be the supplier' })).toBeVisible();
  await page.getByRole('button', { name: "Take Bhaav's call" }).first().click();
  // The fake Bolna refuses browser calls, as a real outage would.
  await expect(page.getByRole('alert')).toContainText('Bolna would not start the browser call.');
  await expect(page.getByText('Did not connect')).toBeVisible();
});

test('talking to the Desk fails with a reason, and typing still works', async ({ page }) => {
  await signIn(page);
  await page.getByLabel('Your business name').fill('Desk Test Kitchen');
  await page.getByRole('button', { name: 'Start an order' }).first().click();
  await page.getByRole('button', { name: 'Talk to Bhaav' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('What to buy').fill('rice');
  await expect(page.getByLabel('What to buy')).toHaveValue('rice');
});

test('an unknown address shows a way home', async ({ page }) => {
  await signIn(page);
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to the home page' }).click();
  await expect(page).toHaveURL('/');
});

for (const [name, width, height] of [
  ['phone', 375, 812],
  ['tablet', 768, 1024],
  ['laptop', 1440, 900],
] as const) {
  test(`no page scrolls sideways on a ${name} (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await signIn(page);
    for (const path of ['/', '/prices', '/play', '/bench']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoSideScroll(page);
    }
    // The four places sit in a bottom bar on phones and in the header from 768px up.
    const bottomBar = page.getByRole('navigation', { name: 'Main' }).last();
    if (width < 768) await expect(bottomBar).toBeVisible();
    else await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
  });
}

test('every control on the home page is at least 44px tall', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button, a[href], input, select, summary')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.height < 44 && !el.closest('.sr-only');
      })
      .map(
        (el) =>
          `${el.tagName} "${el.textContent?.trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`,
      ),
  );
  expect(small).toEqual([]);
});
