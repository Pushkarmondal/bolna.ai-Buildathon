import { expect, type Page } from '@playwright/test';

/** A name no earlier run used, so price memory and order lists can be checked exactly. */
export const stamp = () => Date.now().toString(36);

export async function signIn(page: Page) {
  await page.goto('/');
  const passcode = page.getByLabel('Passcode');
  // The passcode screen has its own h1; wait for a page's, not that one.
  const heading = page
    .getByRole('heading', { level: 1 })
    .filter({ hasNotText: 'Enter the passcode' });
  // Wait until the app knows whether this browser is signed in: the gate or a page, never "Loading".
  await expect(passcode.or(heading)).toBeVisible();
  if (await passcode.isVisible()) {
    await passcode.fill(process.env.E2E_PASSCODE ?? '');
    await page.getByRole('button', { name: 'Open Bhaav' }).click();
  }
  await expect(heading).toBeVisible();
}

/** No element may push the page wider than the screen. */
export async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `page is ${overflow}px wider than the screen`).toBeLessThanOrEqual(0);
}

export async function addSupplier(
  page: Page,
  supplier: { name: string; phone: string; language?: 'hi' | 'kn' | 'en' },
) {
  await page.getByLabel('Name', { exact: true }).fill(supplier.name);
  await page.getByLabel('Mobile number').fill(supplier.phone);
  await page.getByLabel('Speaks').selectOption(supplier.language ?? 'hi');
  await page.getByLabel(/agreed to take a call/).check();
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await expect(page.getByText(supplier.name, { exact: true })).toBeVisible();
}
