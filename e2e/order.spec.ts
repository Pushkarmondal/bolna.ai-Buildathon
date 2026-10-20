// The whole buyer journey against the fake Bolna: order, suppliers, two rounds of calls, results,
// approve, the confirmation call, the WhatsApp text, and price memory.

import { expect, test } from '@playwright/test';
import { addSupplier, expectNoSideScroll, signIn, stamp } from './helpers';

test('a buyer orders, Bhaav calls and bargains, and the buyer chooses', async ({ page }) => {
  const item = `test onions ${stamp()}`;
  await signIn(page);

  // Home: the business name starts a draft order.
  await page.getByLabel('Your business name').fill('Sharma Dhaba');
  await page.getByRole('button', { name: 'Start an order' }).first().click();
  await expect(page.getByRole('heading', { name: 'Order for Sharma Dhaba' })).toBeVisible();

  // Start calling says what is missing instead of being greyed out.
  await page.getByRole('button', { name: 'Start calling' }).click();
  await expect(page.getByText(/^Not started\. Still needed:/)).toBeVisible();

  // The order card saves as you type.
  await page.getByLabel('What to buy').fill(item);
  await page.getByLabel('How much').fill('50');
  await page.getByLabel('Unit').selectOption('kg');
  await page.getByLabel('Deliver by').fill('2026-12-24');
  await expect(page.getByText('Complete', { exact: true })).toBeVisible();

  // A quantity that isn't a number is caught next to the field.
  await page.getByLabel('How much').fill('fifty');
  await expect(page.getByText('Use a number above zero, like 50.')).toBeVisible();
  await page.getByLabel('How much').fill('50');
  await expect(page.getByText('Use a number above zero, like 50.')).toBeHidden();

  // Without consent, a supplier is not added, and the error sits by the checkbox.
  await page.getByLabel('Name', { exact: true }).fill('No Consent Traders');
  await page.getByLabel('Mobile number').fill('98000 00099');
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await expect(
    page.getByText('Bhaav only calls suppliers who agreed to take its call.'),
  ).toBeVisible();

  await addSupplier(page, { name: 'Mehta & Sons', phone: '98000 00003' });
  await addSupplier(page, { name: 'Gupta Traders', phone: '98000 00001' });
  await addSupplier(page, { name: 'Lakshmi Wholesale', phone: '98000 00002', language: 'kn' });
  await expect(page.getByText('+91 98000 00002 · Kannada')).toBeVisible();

  // Calls: round 1 asks, round 2 bargains, then everything is finished.
  await page.getByRole('button', { name: 'Start calling' }).click();
  await expect(page.getByRole('heading', { name: `50 kilo ${item}` })).toBeVisible();
  await expect(page.getByText('Every call is finished.')).toBeVisible({ timeout: 90_000 });
  // Every supplier has a quote in the book, and the costlier ones were called back to bargain.
  const quoteBook = page.getByRole('table');
  for (const name of ['Mehta & Sons', 'Gupta Traders', 'Lakshmi Wholesale']) {
    await expect(quoteBook.getByRole('row').filter({ hasText: name }).first()).toBeVisible();
  }
  await expect(page.getByText('Bargain: Done').first()).toBeVisible();
  await expect(page.getByText('0 stopped')).toBeVisible();

  // Results: cheapest first, one Best, savings against the costliest quote.
  await page.getByRole('link', { name: 'See results and choose' }).click();
  await expect(page.getByRole('heading', { name: `50 kilo ${item}` })).toBeVisible();
  const ranking = page.getByRole('listitem').filter({ hasText: 'per kilo, delivered' });
  await expect(ranking).toHaveCount(3);
  await expect(ranking.first()).toContainText('Best');
  await expect(page.getByText('Saved against the costliest quote')).toBeVisible();

  // The WhatsApp text matches the screen, copies, and opens WhatsApp with it.
  const summary = page.locator('pre');
  await expect(summary).toContainText(`Bhaav quotes for 50 kilo ${item}`);
  await expect(summary).toContainText('Every price was read back to the supplier and recorded.');
  await page.getByRole('button', { name: 'Copy text' }).click();
  await expect(page.getByText('Copied.')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(await summary.textContent());
  const whatsapp = page.getByRole('link', { name: 'Open in WhatsApp' });
  expect(await whatsapp.getAttribute('href')).toBe(
    `https://wa.me/?text=${encodeURIComponent(copied)}`,
  );

  // Approve the best quote: it is marked chosen, and nobody else can be approved.
  const bestName = (await ranking.first().locator('.font-semibold').first().textContent()) ?? '';
  await ranking.first().getByRole('button', { name: 'Approve' }).click();
  await expect(ranking.first()).toContainText('Chosen');
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: `You chose ${bestName}` })).toBeVisible();
  await expect(summary).toContainText('chosen');

  // The confirmation call tells the supplier; the fake supplier keeps their quote.
  await page.getByRole('button', { name: `Ask Bhaav to tell ${bestName}` }).click();
  await expect(page.getByText('Confirmation call: Done')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('They did not change it on the call.')).toBeVisible();
  await expect(ranking.filter({ hasText: bestName })).toContainText('Chosen');

  // On a phone, neither the results nor the calls page scrolls sideways.
  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoSideScroll(page);
  await page.getByRole('link', { name: 'See the calls' }).click();
  await expect(page.getByRole('heading', { name: `50 kilo ${item}` })).toBeVisible();
  await expectNoSideScroll(page);

  // Price memory has this order's best price.
  // On a phone this is the bottom bar's link; the header's is hidden.
  await page
    .getByRole('link', { name: /^Price/ })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL('/prices');
  const card = page.locator('section').filter({ hasText: item });
  await expect(card).toContainText('One order so far');
});
