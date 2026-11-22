import { readFileSync } from "node:fs";
import bcrypt from "bcrypt";
import {
  performanceToday,
  seedPerformanceFixture,
} from "../../fixtures/performance.js";
import { loadConfig } from "../../server/dist/config.js";
import { openDb } from "../../server/dist/db/db.js";
import { createSync } from "../../server/dist/sync/service.js";
import { readEnv } from "../../server/dist/env.js";
import { createApp, startServer } from "../../server/dist/index.js";

process.env.PORT = "3210";
process.env.DATA_DIR = ":memory:";
process.env.SOURCE_MODE = "fixture";
process.env.SESSION_SECRET = "synthetic-smoke-test-secret-123456789";
process.env.DASHBOARD_PASSWORD_HASH = await bcrypt.hash(
  "synthetic-smoke-password",
  4,
);
const diagnosticUrl =
  "https://docs.google.com/spreadsheets/d/FakeSheetToken/export?format=csv&gid=27";
globalThis.fetch = async (input) =>
  String(input) === diagnosticUrl
    ? new Response(readFileSync("fixtures/master.sample.csv", "utf8"), {
        headers: { "content-type": "text/csv" },
      })
    : new Response(null, { status: 404 });

const performanceDb = openDb(":memory:");
seedPerformanceFixture(performanceDb);
const config = loadConfig();
const performanceSync = createSync(
  performanceDb,
  config,
  "fixture",
  () => new Date(performanceToday + "T12:00:00Z"),
);
createApp(readEnv(), config, performanceDb, performanceSync).listen(
  3211,
  "127.0.0.1",
);

const { sync } = startServer(() => new Date("2026-11-21T12:00:00Z"));
if (!(await sync.start("all"))) process.exit(1);
