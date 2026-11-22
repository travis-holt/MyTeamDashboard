import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { checkSheetLink } from "../src/fetch/checkLink.js";

const link =
  "https://docs.google.com/spreadsheets/d/FakeSheetToken/edit#gid=27";
const config = loadConfig();
const csv = readFileSync("fixtures/master.sample.csv", "utf8");
const csvResponse = () =>
  new Response(csv, { headers: { "content-type": "text/csv" } });
afterEach(() => vi.restoreAllMocks());

describe("check a sheet link", () => {
  it.each([
    "https://example.invalid/spreadsheets/d/FakeSheetToken/edit",
    "https://drive.google.com/spreadsheets/d/FakeSheetToken/edit",
    "https://127.0.0.1/spreadsheets/d/FakeSheetToken/edit",
    "https://docs.google.com:8080/spreadsheets/d/FakeSheetToken/edit",
    "http://docs.google.com/spreadsheets/d/FakeSheetToken/edit",
    "invalid",
  ])("rejects invalid link %s before fetching", async (invalid) => {
    const request = vi.fn(csvResponse);
    await expect(
      checkSheetLink({ link: invalid }, config, request),
    ).rejects.toThrow("Expected a Google Sheets");
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    "https://example.invalid/export/fake",
    "https://drive.google.com/export/fake",
    "https://192.0.2.1/export/fake",
    "https://doc-fake-sheets.googleusercontent.com/not-an-export",
  ])("rejects an untrusted redirect %s before following it", async (target) => {
    const request = vi.fn(() => Response.redirect(target));
    const report = await checkSheetLink({ link }, config, request);
    expect(report).toMatchObject({
      status: 302,
      error: expect.stringMatching(/unsupported export redirect/),
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "https://docs.google.com/spreadsheets/d/FakeSheetToken/export?format=csv&gid=27",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("reports only mapped headers, one date, and known mismatches", async () => {
    const mapped = structuredClone(config);
    mapped.sources.master.expectHeaders = { name: "Agent name" };
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.redirect(
          "https://doc-fake-sheets.googleusercontent.com/export/fake",
        ),
      )
      .mockImplementation(csvResponse);
    const report = await checkSheetLink(
      { link: link + "&unused=discard", gid: "42", source: "master" },
      mapped,
      request,
    );
    expect(report).toMatchObject({
      gid: "42",
      status: 200,
      contentType: "text/csv",
      mismatches: ["COLUMN_HEADER_MISMATCH:name"],
      sampleDate: "2025-01-12",
    });
    expect(report.headers).toContainEqual({
      field: "name",
      column: "C",
      header: "Name",
    });
    expect(report.headers).toHaveLength(10);
    expect(JSON.stringify(report)).not.toMatch(
      /Phone|Email|Laptop|American Name|555-0100|example\.invalid|FAKE-LAPTOP|Synthetic Alias|Avery/,
    );
    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://docs.google.com/spreadsheets/d/FakeSheetToken/export?format=csv&gid=42",
      expect.anything(),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://doc-fake-sheets.googleusercontent.com/export/fake",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("does not surface sensitive headers that shifted into mapped columns", async () => {
    const request = vi.fn(
      () => new Response(csv.replace("Hiring Date", "Phone number")),
    );
    const report = await checkSheetLink(
      { link, source: "master" },
      config,
      request,
    );
    expect(report.mismatches).toContain("COLUMN_HEADER_MISMATCH:hireDate");
    expect(report.headers[0]).toEqual({
      field: "hireDate",
      column: "A",
      header: null,
    });
  });

  it("reports status and content type when Google returns HTML", async () => {
    const request = vi.fn(
      () =>
        new Response("<html>private</html>", {
          status: 403,
          headers: { "content-type": "text/html" },
        }),
    );
    const report = await checkSheetLink(
      { link, source: "master" },
      config,
      request,
    );
    expect(report).toMatchObject({
      status: 403,
      contentType: "text/html",
      rowCount: null,
      error: expect.any(String),
    });
  });
});
