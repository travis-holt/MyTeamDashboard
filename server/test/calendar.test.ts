import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ScheduleDay } from "../src/api/dto.js";
import { calculateTrends } from "../src/api/trends.js";
import { trendRange } from "../src/api/trendRange.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/db.js";
import { parseAttendance } from "../src/parse/attendance.js";
import { parseSchedule } from "../src/parse/schedule.js";
import { d7 } from "../src/rules/d7.js";
import { startBackupCron, startCron } from "../src/sync/cron.js";
import { createSync } from "../src/sync/service.js";
import { sampleMaster } from "./sample.js";

describe("Cairo calendar", () => {
  it.each([
    ["2026-04-23T21:59:59Z", "2026-04-23", "2026-03-19", "2026-05-07"],
    ["2026-04-23T22:00:00Z", "2026-04-24", "2026-03-20", "2026-05-08"],
    ["2026-10-29T20:59:59Z", "2026-10-29", "2026-09-24", "2026-11-12"],
    ["2026-10-29T21:00:00Z", "2026-10-29", "2026-09-24", "2026-11-12"],
    ["2026-10-29T22:00:00Z", "2026-10-30", "2026-09-25", "2026-11-13"],
    ["2026-12-31T21:59:59Z", "2026-12-31", "2026-11-26", "2027-01-14"],
    ["2026-12-31T22:00:00Z", "2027-01-01", "2026-11-27", "2027-01-15"],
  ])("maps %s to Cairo day %s and its sync window", (stamp, date, from, to) => {
    const db = openDb(":memory:");
    try {
      const sync = createSync(
        db,
        loadConfig(),
        "fixture",
        () => new Date(stamp),
      );
      expect(sync.today()).toBe(date);
      expect(sync.window()).toEqual({ from, to });
    } finally {
      db.close();
    }
  });

  it.each([
    [
      "2026-04-23T21:59:59Z",
      "2026-04-24T13:00:00.000Z",
      "2026-04-26T09:00:00.000Z",
      "2026-04-23T23:00:00.000Z",
      "backup-2026-04-24.json",
    ],
    [
      "2026-10-29T20:59:59Z",
      "2026-10-30T14:00:00.000Z",
      "2026-11-01T10:00:00.000Z",
      "2026-10-30T00:00:00.000Z",
      "backup-2026-10-30.json",
    ],
  ])(
    "fires the 16:00 job once through the DST transition from %s",
    async (clock, daily, weekly, backup, filename) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(clock));
      const db = openDb(":memory:");
      const directory = mkdtempSync(join(tmpdir(), "dashboard-cron-fixture-"));
      const config = loadConfig();
      const sync = createSync(db, config, "fixture");
      const start = vi.spyOn(sync, "start").mockResolvedValue(true);
      const [rosterTask, dailyTask] = startCron(config, sync);
      const backupTask = startBackupCron(db, directory);
      try {
        expect(dailyTask.getNextRun()?.toISOString()).toBe(daily);
        expect(rosterTask.getNextRun()?.toISOString()).toBe(weekly);
        expect(backupTask.getNextRun()?.toISOString()).toBe(backup);
        await vi.advanceTimersByTimeAsync(Date.parse(daily) - Date.now() - 1);
        expect(start).not.toHaveBeenCalled();
        expect(readdirSync(join(directory, "backups"))).toEqual([filename]);
        await vi.advanceTimersByTimeAsync(5);
        expect(start.mock.calls).toEqual([["daily"]]);
      } finally {
        await Promise.all([
          rosterTask.destroy(),
          dailyTask.destroy(),
          backupTask.destroy(),
        ]);
        vi.useRealTimers();
        db.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("keeps the original date throughout a sync that crosses Cairo midnight", async () => {
    const db = openDb(":memory:");
    try {
      const clock = vi
        .fn()
        .mockReturnValueOnce(new Date("2026-11-21T21:59:59Z"))
        .mockReturnValue(new Date("2026-11-21T22:00:00Z"));
      const sync = createSync(db, loadConfig(), "fixture", clock);
      await expect(sync.start("all")).resolves.toBe(true);
      expect(
        db.prepare("SELECT MAX(date) FROM schedule_days").pluck().get(),
      ).toBe("2026-12-05");
      expect(
        db.prepare("SELECT DISTINCT date FROM roster_events").pluck().all(),
      ).toEqual(["2026-11-21"]);
      expect(
        db
          .prepare("SELECT DISTINCT date FROM discrepancies WHERE rule_id='D7'")
          .pluck()
          .all(),
      ).toEqual(["2026-11-21"]);
    } finally {
      db.close();
    }
  });
});

const agent = sampleMaster().agents[0];
const scheduleDay = (
  date: string,
  status: ScheduleDay["status"],
): ScheduleDay => ({
  code: agent.code,
  date,
  status,
  raw: status,
  shiftStart: status === "Scheduled" ? "09:00" : null,
});

describe("month and year boundaries", () => {
  it.each([
    [
      "2026-12-30",
      ["Wednesday", "Thursday", "Friday", "Saturday"],
      ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"],
    ],
    [
      "2028-02-27",
      ["Sunday", "Monday", "Tuesday", "Wednesday"],
      ["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"],
    ],
  ])(
    "maps anchor %s across the calendar boundary",
    (anchor, weekdays, dates) => {
      const config = loadConfig();
      config.sources.schedule.anchor.date = anchor;
      const result = parseSchedule(
        [
          ["Code", "Name", "TL", "Account", "", ...weekdays, "Counter"],
          [agent.code, "Fixture", "", "", "", "OFF", "09:00", "Sick", "09:00"],
        ],
        config,
        new Set([agent.code]),
        { from: dates[1], to: dates[2] },
      );
      expect(result.dates).toEqual(dates);
      expect(result.records.map(({ date, status }) => [date, status])).toEqual([
        [dates[1], "Scheduled"],
        [dates[2], "Sick"],
      ]);
      expect(result.warnings).toEqual([]);
    },
  );

  it.each([
    ["2026-12-31", "2027-01-01"],
    ["2028-02-29", "2028-03-01"],
  ])("D7 looks from %s to %s", (yesterday, today) => {
    expect(
      d7({
        agents: [agent],
        today,
        from: yesterday,
        schedule: [
          scheduleDay(yesterday, "Sick"),
          scheduleDay(today, "Scheduled"),
        ],
        attendance: [],
        scheduleMembers: null,
        attendanceEnabled: false,
      }),
    ).toMatchObject([
      {
        date: today,
        ruleId: "D7",
        missing: "Confirm return (was Sick yesterday)",
      },
    ]);
  });

  it("trends presets and daily counts include calendar endpoints", () => {
    expect(trendRange("2027-01-01", "7")).toEqual({
      from: "2026-12-26",
      to: "2027-01-01",
    });
    expect(trendRange("2027-01-01", "30")).toEqual({
      from: "2026-12-03",
      to: "2027-01-01",
    });
    expect(trendRange("2028-03-01", "90")).toEqual({
      from: "2027-12-03",
      to: "2028-03-01",
    });
    expect(trendRange("2028-03-01", "month")).toEqual({
      from: "2028-03-01",
      to: "2028-03-01",
    });
    const totals = calculateTrends(
      [agent],
      [
        scheduleDay("2026-12-30", "Off Day"),
        scheduleDay("2026-12-31", "Sick"),
        scheduleDay("2027-01-02", "PTO"),
        scheduleDay("2027-01-03", "Off Day"),
      ],
      [],
      [],
      "2026-12-31",
      "2027-01-02",
      "2027-01-02",
      {},
    );
    expect(totals.daily.map((date) => date.date)).toEqual([
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(totals.totals).toMatchObject({ Sick: 1, PTO: 1, "Off Day": 0 });
  });

  it("wide attendance resolves Dec/Jan headers against the correct window years", () => {
    const config = loadConfig();
    config.sources.attendance.layout = "wide";
    const result = parseAttendance(
      [
        [
          "Department",
          "DTL",
          "Name",
          "12/31/2014",
          "1/1/2014",
          "Jan-2",
          "Dec-28",
        ],
        [
          "Fixture",
          "Demo Lead",
          agent.fullName,
          "Present",
          "Sick",
          "Present",
          "Absent",
        ],
      ],
      config,
      [agent],
      { from: "2026-12-30", to: "2027-01-02" },
    );
    expect(result.dates).toEqual(["2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(result.records.map(({ date, status }) => [date, status])).toEqual([
      ["2026-12-31", "Present"],
      ["2027-01-01", "Sick"],
      ["2027-01-02", "Present"],
    ]);
  });
});
