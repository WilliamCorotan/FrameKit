import { expect, test } from "@playwright/test";
test("loads packaged Desk under /desk using runtime API configuration", async ({ page }) => {
  await page.route("http://127.0.0.1:45124/**", async (route) => route.fulfill({ status: route.request().url().endsWith("/api/auth/me") ? 401 : 200, contentType: "application/json", body: JSON.stringify([]) }));
  await page.goto("/desk/");
  await expect(page.getByRole("heading", { name: "Metadata operations console" })).toBeVisible();
  await page.getByLabel("Password").fill("admin12345");
  const request = page.waitForRequest("http://127.0.0.1:45124/api/auth/login");
  await page.getByRole("button", { name: "Sign in" }).click();
  await request;
});
