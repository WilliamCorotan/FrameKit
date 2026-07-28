import { expect, test } from "@playwright/test";
import { crossOriginPort, templates } from "../playwright.config";

for (const [framework, , port] of templates) {
  test(`${framework} signs in and creates a customer`, async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port}`);
    await expect(page.getByText(/sign in/i).first()).toBeVisible();

    await page.getByLabel("Password").fill("admin12345");
    await page.getByRole("button", { name: /open ledger|open register|sign in/i }).click();
    await expect(page.getByText("Acme Manufacturing")).toBeVisible();

    const customerName = `${framework} browser ${Date.now()}-${test.info().retry}`;
    await page.getByLabel("Name").fill(customerName);
    await page.getByLabel("Owner").fill("Template browser test");
    await page.getByLabel(/Annual revenue/).fill("7250.00");
    const createResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().includes("/api/doctypes/customer")
    );
    await page.getByRole("button", { name: /add to ledger|record customer|post to ledger/i }).click();

    const createResponse = await createResponsePromise;
    expect(createResponse.ok()).toBe(true);
    await expect(page.getByText(customerName, { exact: true })).toBeVisible();

    await page.route("**/api/doctypes/customer?**", async (route) => {
      if (route.request().method() === "GET") {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      await route.continue();
    });
    await page.getByRole("button", { name: /refresh/i }).click();
    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page.getByRole("button", { name: /open ledger|open register|sign in/i })).toBeVisible();
    if (framework === "vanilla") {
      await expect(page.getByText("Signed out. No credentials were stored.")).toBeVisible();
    }
    await page.waitForTimeout(400);
    await expect(page.getByText("Acme Manufacturing")).toHaveCount(0);
  });
}

test("React supports a direct cross-origin Framekit API", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${crossOriginPort}`);
  await page.getByLabel("Password").fill("admin12345");
  await page.getByRole("button", { name: "Open ledger" }).click();
  await expect(page.getByText("Acme Manufacturing")).toBeVisible();
});
