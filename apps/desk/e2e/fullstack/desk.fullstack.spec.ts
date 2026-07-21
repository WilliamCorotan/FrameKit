import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type Page, test } from "@playwright/test";

const apiOrigin = "http://127.0.0.1:45123";
const tenantHeaders = { "x-tenant-id": "default" };

test("uses real auth, restores the session, reports server errors, and signs out", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Password").fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("status")).toContainText("Invalid email or password");
  await expect(page.getByRole("heading", { name: "Metadata operations console" })).toBeVisible();

  await page.getByLabel("Password").fill("admin12345");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Customer", exact: true })).toBeVisible();
  await expect(page.evaluate(() => window.localStorage.getItem("framekit.token"))).resolves.toBeTruthy();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Customer", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("runs real document CRUD, deletion, workflow, and pagination", async ({ page, request }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const paginationMarker = `pager${crypto.randomUUID().replaceAll("-", "")}`;
  const token = await loginApi(request);
  for (let index = 0; index < 7; index += 1) {
    await createCustomer(request, token, `${paginationMarker}-${index}`);
  }

  await signIn(page);
  await page.getByLabel("Filter records").fill(paginationMarker);
  await expect(page.getByText("Page 1")).toBeVisible();
  const firstPageIds = await recordIds(page);
  expect(firstPageIds).toHaveLength(5);
  await page.locator(".list button.row").first().click();
  const updatedOwner = `Updated ${suffix}`;
  await page.getByLabel("Owner").fill(updatedOwner);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Owner")).toHaveValue(updatedOwner);
  await expect(page.locator(".list button.row").first()).toContainText(updatedOwner);
  const secondPageResponse = page.waitForResponse((response) => response.url().includes("/api/doctypes/customer?") && new URL(response.url()).searchParams.get("offset") === "5");
  await page.getByRole("button", { name: "Next page" }).click();
  await secondPageResponse;
  await expect(page.getByText("Page 2")).toBeVisible();
  await expect(page.locator(".list button.row")).toHaveCount(2);
  const secondPageIds = await recordIds(page);
  expect(secondPageIds).toHaveLength(2);
  expect(new Set([...firstPageIds, ...secondPageIds]).size).toBe(7);
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  const firstPageResponse = page.waitForResponse((response) => response.url().includes("/api/doctypes/customer?") && new URL(response.url()).searchParams.get("offset") === "0");
  await page.getByRole("button", { name: "Previous page" }).click();
  await firstPageResponse;
  await expect(page.getByText("Page 1")).toBeVisible();
  await expect(page.locator(".list button.row")).toHaveCount(5);
  expect(await recordIds(page)).toEqual(firstPageIds);
  const terminalPageResponse = page.waitForResponse((response) => response.url().includes("/api/doctypes/customer?") && new URL(response.url()).searchParams.get("offset") === "5");
  await page.getByRole("button", { name: "Next page" }).click();
  await terminalPageResponse;
  await expect(page.getByText("Page 2")).toBeVisible();
  await expect(page.locator(".list button.row")).toHaveCount(2);
  await page.locator(".list button.row").first().click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted")).toBeVisible();

  await page.getByLabel("Filter records").fill("");
  await page.getByRole("button", { name: "Deal", exact: true }).click();
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByLabel("Title *").fill(`Deal ${suffix}`);
  await page.getByLabel("Amount").fill("84000");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "qualify" }).click();
  await expect(page.getByText("Transitioned")).toBeVisible();
});

test("runs real administration and proves a least-privilege user is denied", async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  await signIn(page);
  await page.getByRole("button", { name: "Users" }).click();
  await page.getByLabel("ID").fill(`reader-${suffix}`);
  await page.getByLabel("Name").fill("Desk Reader");
  await page.getByLabel("Email").fill(`reader-${suffix}@example.test`);
  await page.getByLabel("Password").fill("reader-password-123");
  await page.getByLabel("Permissions").fill("crm.customer.read");
  await page.getByRole("button", { name: "Save Users" }).click();
  await expect(page.getByText(`reader-${suffix}@example.test`)).toBeVisible();

  await page.getByRole("button", { name: "Roles" }).click();
  await page.getByLabel("ID").fill(`role-${suffix}`);
  await page.getByLabel("Name").fill(`Role ${suffix}`);
  await page.getByLabel("Permissions").fill("crm.customer.read");
  await page.getByRole("button", { name: "Save Roles" }).click();
  await expect(page.getByText(`Role ${suffix}`)).toBeVisible();

  await page.getByRole("button", { name: "API Tokens" }).click();
  await page.getByLabel("ID").fill(`token-${suffix}`);
  await page.getByLabel("Name").fill(`Token ${suffix}`);
  await page.getByLabel("Permissions").fill("crm.customer.read");
  await page.getByRole("button", { name: "Save API Tokens" }).click();
  await expect(page.locator(".token-copy")).not.toBeEmpty();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Email").fill(`reader-${suffix}@example.test`);
  await page.getByLabel("Password").fill("reader-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Users" }).click();
  await expect(page.getByRole("status")).toContainText(/permission|forbidden|authorized/i);
});

test("meets automated accessibility, keyboard, and responsive baselines", async ({ page }) => {
  await signIn(page);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#desk-main")).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Desk sections" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Customer", exact: true })).toBeVisible();
}

async function recordIds(page: Page): Promise<string[]> {
  return page.locator(".list button.row strong").allTextContents();
}

async function loginApi(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${apiOrigin}/api/auth/login`, {
    data: { email: "admin@example.com", password: "admin12345" },
    headers: { ...tenantHeaders, origin: "http://127.0.0.1:4174" }
  });
  expect(response.ok()).toBe(true);
  return (await response.json() as { token: string }).token;
}

async function createCustomer(request: APIRequestContext, token: string, name: string): Promise<void> {
  const response = await request.post(`${apiOrigin}/api/doctypes/customer`, {
    data: { name, status: "active", owner: "Browser", annual_revenue: 1000 },
    headers: { ...tenantHeaders, authorization: `Bearer ${token}` }
  });
  expect(response.ok()).toBe(true);
}
