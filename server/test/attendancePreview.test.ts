import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDb, type Db } from "../src/db/db.js";
import { saveAgent } from "../src/db/repo.js";
import { parseSchedule } from "../src/parse/schedule.js";
import { summarizeAttendance } from "../src/sync/attendancePreview.js";
import { createSync } from "../src/sync/service.js";
import { replaceSchedule } from "../src/sync/syncSchedule.js";
import { sample, sampleMaster, today, window } from "./sample.js";

const clock = () => new Date("2026-11-21T12:00:00Z");
let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
  const agents = sampleMaster().agents;
  for (const agent of agents) saveAgent(db, agent, clock().toISOString());
  const schedule = parseSchedule(
    sample("schedule"),
    loadConfig(),
    new Set(agents.map((agent) => agent.code)),
    window,
  );
  replaceSchedule(
    db,
    schedule.records,
    schedule.scheduledCodes,
    window,
    clock().toISOString(),
  );
});
afterEach(() => db.close());

describe("attendance dry run", () => {
  it("dedupes long records and explains invalid dates without writing", () => {
    const before = db.serialize();
    const config = loadConfig();
    const result = summarizeAttendance(
      db,
      sample("attendance-dry-run-long"),
      config,
      today,
      window,
    );
    expect(config.sources.attendance.enabled).toBe(false);
    expect(result).toMatchObject({
      dataRows: 8,
      matchedRows: 6,
      unmatchedTeamRows: 0,
      otherRows: 1,
      invalidDateRows: 1,
      records: 4,
      dateRange: { from: "2026-11-20", to: today },
      sampleStatuses: ["Sick", "Present", "Unknown"],
      findingsByRule: { D4: 1 },
    });
    expect(JSON.stringify(result)).not.toMatch(/Avery|99001|Fixture missing/);
    expect(db.serialize()).toEqual(before);
  });

  it("infers the wide year, counts unmatched team rows separately, and hides names", () => {
    const before = db.serialize();
    const config = loadConfig();
    config.sources.attendance.layout = "wide";
    const result = summarizeAttendance(
      db,
      sample("attendance-dry-run-wide"),
      config,
      today,
      window,
    );
    expect(result).toMatchObject({
      layout: "wide",
      dataRows: 6,
      matchedRows: 3,
      unmatchedTeamRows: 2,
      otherRows: 1,
      records: 5,
      dateRange: { from: "2026-11-20", to: "2026-11-22" },
      sampleStatuses: ["Casual", "Present", "Unknown"],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /Missing Fixture|Unmatched Sample|Avery|99001/,
    );
    expect(db.serialize()).toEqual(before);
  });

  it("dispatches a preview with attendance disabled and leaves the sync log alone", async () => {
    const before = db.serialize();
    const config = loadConfig();
    config.sources.attendance.layout = "wide";
    const sync = createSync(db, config, "fixture", clock);
    await expect(sync.previewAttendance()).resolves.toMatchObject({
      layout: "wide",
      records: 3,
    });
    expect(db.serialize()).toEqual(before);
  });
});
