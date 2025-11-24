import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
    await page.goto('/');

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle("Persona Call");
});

test('shows start call button', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Start Call/i })).toBeVisible();
});
