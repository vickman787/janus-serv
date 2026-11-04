import { test, expect } from '@playwright/test';
for (const width of [360, 390, 430, 1280, 1440]) {
  test(`wallet integration page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/wallet-check');
    await expect(page.getByRole('heading', { name: 'Connect. Verify. Recover.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Authenticate your connected account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review authentication message' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Prepare sign-only check' })).toBeDisabled();
    await expect(page.getByText('Tatum / testnet', { exact: true })).toBeVisible({ timeout: 35000 });
    await expect(page.getByText('Walrus / mainnet', { exact: true })).toBeVisible();
    await expect(page.getByText('authenticated', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    if (width === 390 || width === 1280) await page.screenshot({ path: `.data/wallet-check-${width}.png`, fullPage: true });
  });
}
