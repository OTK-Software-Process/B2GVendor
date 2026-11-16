import { expect, test } from '@playwright/test';

const token = 'anonymous-unsubscribe-test-token';
const apiBase = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1');

test('unsubscribe link sends its token to the backend without login', async ({ page }) => {
  await page.route(`${apiBase.origin}${apiBase.pathname.replace(/\/$/, '')}/**`, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"success":true,"data":{"emailNotificationsEnabled":false}}'
    })
  );

  await page.goto(`/unsubscribe/${token}`);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByRole('button')).toBeVisible();

  const unsubscribeRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    const path = apiBase.pathname.replace(/\/$/, '');
    const requestData = `${url.href} ${request.postData() ?? ''}`;
    return url.origin === apiBase.origin
      && url.pathname.startsWith(`${path}/`)
      && !['GET', 'HEAD'].includes(request.method())
      && requestData.includes(token);
  }, { timeout: 5_000 });
  await page.getByRole('button').click();

  const request = await unsubscribeRequest;
  expect(new URL(request.url()).pathname).toBe(`${apiBase.pathname.replace(/\/$/, '')}/account/unsubscribe`);
  expect(request.method()).toBe('POST');
  expect(JSON.parse(request.postData() ?? '{}')).toEqual({ token });
  expect(request.headers().cookie).toBeUndefined();
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
});
