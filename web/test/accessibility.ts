import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations
      .filter(
        (violation) =>
          violation.impact === "serious" ||
          violation.impact === "critical" ||
          violation.id === "color-contrast",
      )
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.map((node) => node.target),
      })),
  ).toEqual([]);

  const placeholders = await page
    .locator("input[placeholder], textarea[placeholder]")
    .evaluateAll((nodes) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      const pixel = () => context.getImageData(0, 0, 1, 1).data;
      const luminance = (rgb: Uint8ClampedArray) =>
        [0.2126, 0.7152, 0.0722].reduce((total, weight, index) => {
          const value = rgb[index] / 255;
          return (
            total +
            weight *
              (value <= 0.04045
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4)
          );
        }, 0);
      return nodes
        .filter((node) => node.checkVisibility())
        .map((node) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = getComputedStyle(node).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          const background = luminance(pixel());
          const style = getComputedStyle(node, "::placeholder");
          context.fillStyle = style.color;
          context.globalAlpha = Number(style.opacity);
          context.fillRect(0, 0, 1, 1);
          context.globalAlpha = 1;
          const foreground = luminance(pixel());
          return {
            label: node.getAttribute("placeholder"),
            ratio:
              (Math.max(foreground, background) + 0.05) /
              (Math.min(foreground, background) + 0.05),
          };
        });
    });
  expect(placeholders.filter(({ ratio }) => ratio < 4.5)).toEqual([]);
}
