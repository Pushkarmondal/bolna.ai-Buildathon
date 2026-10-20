import { expect, test } from '@playwright/test';

test('the passcode gate refuses a wrong passcode and opens with the right one', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Enter the passcode' })).toBeVisible();

  await page.getByRole('button', { name: 'Open Bhaav' }).click();
  await expect(page.getByRole('alert')).toContainText('Type the passcode');

  await page.getByLabel('Passcode').fill('not-the-passcode');
  await page.getByRole('button', { name: 'Open Bhaav' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Passcode')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Passcode').fill(process.env.E2E_PASSCODE ?? '');
  await page.getByRole('button', { name: 'Open Bhaav' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('From every supplier.');
});

test('an ended session brings the passcode screen back, then the same page', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Passcode').fill(process.env.E2E_PASSCODE ?? '');
  await page.getByRole('button', { name: 'Open Bhaav' }).click();
  await page.getByLabel('Your business name').fill('Session Test');
  await page.getByRole('button', { name: 'Start an order' }).first().click();
  await expect(page.getByRole('heading', { name: 'Order for Session Test' })).toBeVisible();

  // The session ends (cookie gone); the draft order's next poll is refused.
  await page.evaluate(() => fetch('/api/auth', { method: 'DELETE' }));
  await expect(page.getByRole('heading', { name: 'Enter the passcode' })).toBeVisible();

  await page.getByLabel('Passcode').fill(process.env.E2E_PASSCODE ?? '');
  await page.getByRole('button', { name: 'Open Bhaav' }).click();
  await expect(page.getByRole('heading', { name: 'Order for Session Test' })).toBeVisible();
});
