import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  performanceStart,
  performanceToday,
  seedPerformanceFixture,
} from "../../fixtures/performance.js";
import { loadConfig } from "../src/config.js";
import { openDb, type Db } from "../src/db/db.js";
import { createApp } from "../src/index.js";
import { createSync } from "../src/sync/service.js";

let db: Db;
let server: Server;
let base: string;
let cookie: string;
const password = "fixture-api-password";
const current = () => new Date(performanceToday + "T12:00:00Z");
const clock = vi.fn(current);

beforeAll(async () => {
  db = openDb(":memory:");
  const config = loadConfig();
  const sync = createSync(db, config, "fixture", clock);
  const app = createApp(
    {
      PORT: 3000,
      DATA_DIR: ":memory:",
      SOURCE_MODE: "fixture",
      TZ: "Africa/Cairo",
      DASHBOARD_PASSWORD_HASH: await bcrypt.hash(password, 4),
      SESSION_SECRET: "fixture-api-test-session-secret-1234",
    },
    config,
    db,
    sync,
  );
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/api";
  const login = await fetch(base + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  expect(login.status).toBe(204);
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  db.close();
});

function request(method: string, path: string, body?: unknown) {
  return fetch(base + path, {
    method,
    headers: {
      Cookie: cookie,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("API request validation", () => {
  it.each([
    ["GET", "/health?unexpected=1", undefined, "query"],
    ["POST", "/login", { password: 12 }, "body.password"],
    ["POST", "/logout", { unexpected: 1 }, "body"],
    ["GET", "/me?scope=mine", undefined, "query"],
    ["GET", "/today?date=2026-02-30", undefined, "query.date"],
    ["GET", "/discrepancies?rule=D9", undefined, "query.rule"],
    ["GET", "/discrepancies/export?ids=invalid", undefined, "query.ids.0"],
    [
      "PATCH",
      "/discrepancies/bulk",
      { ids: ["FAKE-1|D5"], state: "closed" },
      "body.state",
    ],
    ["PATCH", "/discrepancies/invalid", {}, "params.id"],
    ["GET", "/agents?scope=mine&scope=all", undefined, "query.scope"],
    ["GET", "/agents/%00", undefined, "params.code"],
    ["POST", "/agents/FAKE-1/notes", { done: "yes" }, "body.done"],
    ["PATCH", "/notes/1.5", { done: true }, "params.id"],
    ["GET", "/roster/events?since=tomorrow", undefined, "query.since"],
    ["GET", "/trends?from=2026-13-01", undefined, "query.from"],
    ["GET", "/sync/status?limit=10", undefined, "query"],
    ["POST", "/sync?job=unknown", undefined, "query.job"],
    ["POST", "/sync/attendance-preview", { enabled: true }, "body"],
    ["POST", "/check-link", { link: "https://example.invalid/" }, "body.link"],
    ["GET", "/backup?file=other", undefined, "query"],
    ["POST", "/backup/preview", {}, "body"],
    ["POST", "/backup/restore?token=bad", {}, "query.token"],
  ])(
    "%s %s returns a field-specific 400",
    async (method, path, body, field) => {
      const response = await request(method, path, body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain(field + ":");
    },
  );

  it("rejects a binary body on a bodyless route", async () => {
    const response = await fetch(base + "/logout", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/octet-stream" },
      body: Buffer.from("fixture"),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "body: Unsupported request format",
    });
  });

  it("rejects malformed JSON", async () => {
    const response = await fetch(base + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "body: Invalid JSON" });
  });
});

it("versions sync status by one Cairo date during a UTC-to-Cairo midnight crossing", async () => {
  clock
    .mockReturnValueOnce(new Date("2026-12-31T21:59:59Z"))
    .mockReturnValue(new Date("2026-12-31T22:00:00Z"));
  try {
    const response = await request("GET", "/sync/status");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      date: "2026-12-31",
      window: { from: "2026-11-26", to: "2027-01-14" },
    });
  } finally {
    clock.mockReset().mockImplementation(current);
  }
});

describe("generated 200-agent, 120-day fixture", () => {
  it("keeps Today, Trends, and Discrepancies below 300 ms", async () => {
    seedPerformanceFixture(db);
    expect(db.prepare("SELECT COUNT(*) FROM schedule_days").pluck().get()).toBe(
      24_000,
    );
    const paths = [
      "/today?date=" + performanceToday,
      "/trends?from=" + performanceStart + "&to=" + performanceToday,
      "/discrepancies?state=all",
    ];
    for (const path of paths) {
      const durations: number[] = [];
      for (let sample = 0; sample < 12; sample++) {
        const start = performance.now();
        const response = await request("GET", path);
        expect(response.status).toBe(200);
        const result = await response.json();
        durations.push(performance.now() - start);
        if (path.startsWith("/today")) expect(result.agents).toHaveLength(200);
        if (path.startsWith("/trends")) expect(result.daily).toHaveLength(120);
        if (path.startsWith("/discrepancies")) expect(result).toHaveLength(400);
      }
      const worst = Math.max(...durations);
      console.info(
        path.split("?")[0] + " worst of 12: " + worst.toFixed(1) + " ms",
      );
      expect(worst).toBeLessThan(300);
    }
  });
});
