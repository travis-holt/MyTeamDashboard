import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:3211" });

test("large synthetic roster supports searching and tab navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Password").fill("synthetic-smoke-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  const agents = page.getByRole("table", { name: "Agents" });
  await expect(agents.getByRole("button")).toHaveCount(204);
  await page.getByRole("textbox", { name: "Search agents" }).fill("Fixture199");
  await expect(
    agents.getByRole("button", { name: "Fixture199", exact: true }),
  ).toBeVisible();
  await expect(agents.locator("tbody tr")).toHaveCount(1);

  const nav = page.getByRole("navigation");
  await nav.getByRole("link", { name: "Trends", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Agent trend counts" }).locator("tbody tr"),
  ).toHaveCount(200);
  await nav.getByRole("link", { name: "Discrepancies", exact: true }).click();
  const queue = page.getByRole("table", { name: "Discrepancies" });
  await expect(queue.locator("tbody tr")).toHaveCount(400);
  await page.getByRole("textbox", { name: "Search agents" }).fill("FAKE-199");
  await expect(queue.locator("tbody tr")).toHaveCount(2);
});
