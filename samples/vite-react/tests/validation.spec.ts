import { test, expect } from '@playwright/test'

test.describe('Form Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('shows success with valid email', async ({ page }) => {
    await page.getByTestId('name-input').fill('John Doe')
    await page.getByTestId('email-input').fill('john@example.com')
    await page.getByTestId('age-input').fill('25')
    await page.getByTestId('submit-button').click()

    const result = page.getByTestId('result')
    await expect(result).toBeVisible()
    await expect(result).toHaveAttribute('data-result-type', 'success')
    await expect(result).toContainText('User saved: John Doe')
  })

  test('shows error with invalid email (no @)', async ({ page }) => {
    await page.getByTestId('name-input').fill('John Doe')
    await page.getByTestId('email-input').fill('invalid-email')
    await page.getByTestId('age-input').fill('25')
    await page.getByTestId('submit-button').click()

    const result = page.getByTestId('result')
    await expect(result).toBeVisible()
    await expect(result).toHaveAttribute('data-result-type', 'error')
  })
})

test.describe('API/JSON Demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'API/JSON Demo' }).click()
  })

  test('parses valid JSON successfully', async ({ page }) => {
    await page.getByTestId('json-input').fill('{"id": 42, "name": "Test User", "active": true}')
    await page.getByTestId('parse-button').click()

    const result = page.getByTestId('api-result')
    await expect(result).toBeVisible()
    await expect(result).toHaveAttribute('data-result-type', 'success')
    await expect(result).toContainText('ID: 42')
    await expect(result).toContainText('Name: Test User')
  })

  test('shows error for invalid JSON types', async ({ page }) => {
    await page.getByTestId('set-invalid').click()
    await page.getByTestId('parse-button').click()

    const result = page.getByTestId('api-result')
    await expect(result).toBeVisible()
    await expect(result).toHaveAttribute('data-result-type', 'error')
  })
})
