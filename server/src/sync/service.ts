import type { Config, SourceKey } from "../config.js";
import type { Env } from "../env.js";
import type { Db } from "../db/db.js";
import type { Job } from "../api/dto.js";
import {
  agentsOf,
  attendanceOf,
  lastSuccess,
  saveAgent,
  scheduleOf,
} from "../db/repo.js";
import { fetchCsv } from "../fetch/fetchCsv.js";
import { readFixture } from "../fetch/fixtures.js";
import { sourceUrl } from "../fetch/urls.js";
import { parseMaster } from "../parse/master.js";
import { localDate, plusDays, weekday } from "../parse/normalize.js";
import { parseSchedule } from "../parse/schedule.js";
import { parseAttendance } from "../parse/attendance.js";
import { runRules } from "../rules/index.js";
import { jobRunner } from "./runJob.js";
import { rosterChanges } from "./syncRoster.js";
import { replaceSchedule } from "./syncSchedule.js";
import { summarizeAttendance } from "./attendancePreview.js";
import { coveredRange, replaceAttendance } from "./syncAttendance.js";

export function createSync(
  db: Db,
  config: Config,
  mode: Env["SOURCE_MODE"],
  now = () => new Date(),
) {
  const runner = jobRunner(db, now);
  const today = () => localDate(config.timezone, now());
  const window = () => ({
    from: plusDays(today(), -config.syncWindow.pastDays),
    to: plusDays(today(), config.syncWindow.futureDays),
  });
  async function load(source: SourceKey, log = true) {
    const result =
      mode === "fixture"
        ? readFixture(
            source,
            source === "attendance" &&
              config.sources.attendance.layout === "wide"
              ? "attendance-wide"
              : source,
          )
        : await fetchCsv(sourceUrl(config.sources[source]));
    if (log)
      console.log(
        source +
          ": " +
          result.bytes +
          " bytes, " +
          result.rows.length +
          " rows",
      );
    return result.rows;
  }
  const roster = () =>
    runner.runStep("roster", async () => {
      const rows = await load("master");
      const date = today();
      const { agents, warnings } = parseMaster(rows, config, date);
      const week = plusDays(date, -weekday(date));
      db.transaction(() => {
        const updates = rosterChanges(agentsOf(db), agents);
        const stamp = now().toISOString();
        for (const agent of updates.agents) saveAgent(db, agent, stamp);
        db.prepare("DELETE FROM roster_snapshots WHERE week_of=?").run(week);
        const snapshot = db.prepare(
          "INSERT INTO roster_snapshots VALUES (@week,@code,@dtl,@tl,@account)",
        );
        for (const agent of agents)
          if (agent.active) snapshot.run({ ...agent, week });
        const insert = db.prepare(
          "INSERT INTO roster_events (date,code,type,detail) VALUES (@date,@code,@type,@detail)",
        );
        for (const event of updates.events) insert.run({ ...event, date });
      })();
      return { rowsRead: rows.length, rowsKept: agents.length, warnings };
    });
  const schedule = () =>
    runner.runStep("schedule", async () => {
      const rows = await load("schedule");
      const range = window();
      const { records, warnings, scheduledCodes, dates } = parseSchedule(
        rows,
        config,
        new Set(agentsOf(db).map((agent) => agent.code)),
        range,
      );
      if (!scheduledCodes.size) throw new Error("NO_TEAM_ROWS");
      if (!records.length) throw new Error("NO_SCHEDULE_DATES_IN_WINDOW");
      const covered = coveredRange(dates, range);
      db.transaction(() =>
        replaceSchedule(
          db,
          records,
          scheduledCodes,
          covered,
          now().toISOString(),
        ),
      )();
      return { rowsRead: rows.length, rowsKept: records.length, warnings };
    });
  const attendance = () =>
    runner.runStep("attendance", async () => {
      const rows = await load("attendance");
      const range = window();
      const { records, matchedRows, warnings, dates } = parseAttendance(
        rows,
        config,
        agentsOf(db),
        range,
      );
      if (!matchedRows) throw new Error("NO_TEAM_ROWS");
      if (!records.length) throw new Error("NO_ATTENDANCE_DATES_IN_WINDOW");
      const covered = coveredRange(dates, range);
      db.transaction(() =>
        replaceAttendance(db, records, covered, now().toISOString()),
      )();
      return { rowsRead: rows.length, rowsKept: records.length, warnings };
    });
  const rules = () =>
    runner.runStep("rules", () => {
      const date = today();
      const range = window();
      const schedule = scheduleOf(db, { ...range, to: plusDays(date, 7) });
      const attendance = attendanceOf(db, { ...range, to: date });
      const scheduleMembers = lastSuccess(db, "schedule")
        ? new Set(
            (
              db.prepare("SELECT code FROM schedule_members").all() as {
                code: string;
              }[]
            ).map((row) => row.code),
          )
        : null;
      const counts = db.transaction(() =>
        runRules(
          db,
          {
            agents: agentsOf(db),
            today: date,
            from: range.from,
            schedule,
            attendance,
            scheduleMembers,
            attendanceEnabled: config.sources.attendance.enabled,
          },
          now().toISOString(),
        ),
      )();
      return {
        rowsRead: schedule.length + attendance.length,
        rowsKept: counts,
        warnings: [],
      };
    });
  function start(job: Job) {
    return runner.start(job, async () => {
      if (job === "roster") return (await roster()) && (await rules());
      const success = lastSuccess(db, "roster");
      if (
        job === "all" ||
        !success ||
        now().getTime() - Date.parse(success) > 7 * 86400000
      ) {
        if (!(await roster())) return false;
      }
      if (!(await schedule())) return false;
      if (config.sources.attendance.enabled && !(await attendance()))
        return false;
      return rules();
    });
  }
  let previewPending: ReturnType<typeof previewAttendance> | undefined;
  async function previewAttendance() {
    if (!agentsOf(db).length)
      throw new Error("Sync the roster before the dry run");
    if (mode === "live" && !config.sources.attendance.sheetId)
      throw new Error("Configure an attendance source before the dry run");
    const rows = await load("attendance", false).catch(() => {
      throw new Error(
        "Could not read the attendance CSV. Check the source link and tab.",
      );
    });
    return db.transaction(() =>
      summarizeAttendance(db, rows, config, today(), window()),
    )();
  }
  return {
    previewAttendance() {
      previewPending ??= previewAttendance().finally(() => {
        previewPending = undefined;
      });
      return previewPending;
    },
    start,
    today,
    window,
    get active() {
      return runner.active;
    },
  };
}
export type SyncService = ReturnType<typeof createSync>;
