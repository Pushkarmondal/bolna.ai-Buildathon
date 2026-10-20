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
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'without a single phone call',
  );
});
