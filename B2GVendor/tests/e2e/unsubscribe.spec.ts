import { expect, test } from '@playwright/test';

const token = 'anonymous-unsubscribe-test-token';
const apiBase = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1');

// The page's own button (Thai or English UI); the navbar has buttons of its own.
const confirmButton = /ยืนยันการยกเลิกการรับข่าวสาร|Confirm Unsubscribe/;

test('unsubscribe link sends its token to the backend without login', async ({ page }) => {
  await page.route(`${apiBase.origin}${apiBase.pathname.replace(/\/$/, '')}/**`, route =>
    // Nobody is signed in: /auth/me answers 401, like the real API without a session.
    new URL(route.request().url()).pathname.endsWith('/auth/me')
      ? route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: '{"success":false,"error":{"code":"NOT_AUTHENTICATED","message":"You are not signed in."}}'
        })
      : route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '{"success":true,"data":{"emailNotificationsEnabled":false}}'
        })
  );

  // The token is behind the # (never sent to a server).
  await page.goto(`/unsubscribe#token=${token}`);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByRole('button', { name: confirmButton })).toBeVisible();

  const unsubscribeRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    const path = apiBase.pathname.replace(/\/$/, '');
    const requestData = `${url.href} ${request.postData() ?? ''}`;
    return url.origin === apiBase.origin
      && url.pathname.startsWith(`${path}/`)
      && !['GET', 'HEAD'].includes(request.method())
      && requestData.includes(token);
  }, { timeout: 5_000 });
  await page.getByRole('button', { name: confirmButton }).click();

  const request = await unsubscribeRequest;
  expect(new URL(request.url()).pathname).toBe(`${apiBase.pathname.replace(/\/$/, '')}/account/unsubscribe`);
  expect(request.method()).toBe('POST');
  expect(JSON.parse(request.postData() ?? '{}')).toEqual({ token });
  expect(request.headers().cookie).toBeUndefined();
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
});

test('an old /unsubscribe/<token> link moves its token behind the #', async ({ page }) => {
  await page.goto(`/unsubscribe/${token}`);
  await page.waitForURL(url => url.pathname === '/unsubscribe' && url.hash === `#token=${token}`);
  await expect(page.locator('h1')).toBeVisible();
});
