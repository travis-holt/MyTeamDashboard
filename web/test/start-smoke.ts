import { readFileSync } from "node:fs";
import bcrypt from "bcrypt";
import { startServer } from "../../server/dist/index.js";

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

const { sync } = startServer(() => new Date("2026-11-21T12:00:00Z"));
if (!(await sync.start("all"))) process.exit(1);
