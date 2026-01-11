import { test, expect } from '@playwright/test'

test.describe('Typical Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('shows validation error for invalid email in form', async ({ page }) => {
    await page.getByTestId('form-name').fill('Test User')
    await page.getByTestId('form-email').fill('not-an-email')
    await page.getByTestId('form-submit').click()

    await expect(page.getByTestId('form-error')).toBeVisible()
  })

  test('shows validation error for invalid API response', async ({ page }) => {
    await page.getByTestId('json-example-select').selectOption('Invalid - Bad Email in User')
    await page.getByTestId('json-validate').click()

    await expect(page.getByTestId('json-error')).toBeVisible()
  })
})
