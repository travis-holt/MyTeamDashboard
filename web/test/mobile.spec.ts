import { expect, test } from "@playwright/test";
import { expectAccessible } from "./accessibility";

test("390 px layouts, keyboard controls, and recovery from a failed load", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let interrupt = true;
  await page.route(/\/api\/today(?:\?|$)/, (route) => {
    if (!interrupt) return route.continue();
    return route.fulfill({
      status: 503,
      json: { error: "Fixture connection interrupted" },
    });
  });
  await page.goto("/");
  await page.getByLabel("Password").fill("synthetic-smoke-password");
  await page.getByRole("button", { name: "Sign in" }).press("Enter");
  await expect(page.getByRole("alert")).toHaveText(
    "Fixture connection interrupted",
  );
  interrupt = false;
  await page.getByRole("button", { name: "Retry", exact: true }).press("Enter");

  const width = () => page.evaluate(() => document.documentElement.scrollWidth);
  async function screenshot(view: string) {
    expect(await width()).toBe(390);
    await expectAccessible(page);
    await page.screenshot({
      path: testInfo.outputPath(view + "-390px.png"),
      animations: "disabled",
      fullPage: true,
    });
  }

  const agents = page.getByRole("table", { name: "Agents" });
  await expect(agents.getByRole("row").first()).toHaveCSS("display", "grid");
  await expect(page.getByLabel("Sort agents")).toBeVisible();
  await screenshot("today");

  const agent = agents.getByRole("button", { name: "Riley", exact: true });
  await agent.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Agent profile" });
  await expect(
    drawer.getByRole("button", { name: "Close agent profile" }),
  ).toBeFocused();
  await expect(drawer.getByRole("heading", { name: "Riley" })).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(agent).toBeFocused();

  await agent.press("Enter");
  await drawer.getByRole("button", { name: "Add note" }).press("Enter");
  await expect(drawer.getByLabel("Date", { exact: true })).toBeFocused();
  await drawer.getByLabel("What happened").fill("Synthetic phone layout note");
  await drawer.getByRole("button", { name: "Save note" }).press("Enter");
  await expect(drawer.getByText("Synthetic phone layout note")).toBeVisible();
  await drawer.getByRole("link", { name: "Full profile" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Riley" })).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Notes" }).getByRole("row").first(),
  ).toHaveCSS("display", "grid");
  await screenshot("agent");

  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Discrepancies" })
    .press("Enter");
  const queue = page.getByRole("table", { name: "Discrepancies" });
  await expect(queue.getByRole("row").first()).toHaveCSS("display", "grid");
  await expect(
    page.getByRole("checkbox", { name: "Select all visible" }),
  ).toBeVisible();
  await screenshot("discrepancies");
});
