import { statuses } from "../api/dto.js";
import type { Config } from "../config.js";
import type { Db } from "../db/db.js";
import { agentsOf, attendanceOf, scheduleOf } from "../db/repo.js";
import { parseAttendance } from "../parse/attendance.js";
import type { Window } from "../parse/schedule.js";
import { attendanceFindings } from "../rules/index.js";
import { coveredRange } from "./syncAttendance.js";

export function summarizeAttendance(
  db: Db,
  rows: string[][],
  config: Config,
  today: string,
  range: Window,
) {
  const agents = agentsOf(db);
  const parsed = parseAttendance(rows, config, agents, range);
  const {
    records,
    dates,
    matchedRows,
    unmatchedTeamRows,
    otherRows,
    invalidDateRows,
    dataRows,
  } = parsed;
  const recordDates = records.map((row) => row.date).sort();
  const cover = records.length ? coveredRange(dates, range) : null;
  const ruleRange = { from: range.from, to: today };
  const previous = attendanceOf(db, ruleRange);
  const next = cover
    ? [
        ...previous.filter(
          (row) => row.date < cover.from || row.date > cover.to,
        ),
        ...records.filter((row) => row.date <= today),
      ]
    : previous;
  const findings = cover
    ? attendanceFindings({
        agents,
        schedule: scheduleOf(db, ruleRange),
        attendance: next,
        scheduleMembers: null,
        today,
        from: range.from,
        attendanceEnabled: true,
      })
    : [];
  const findingsByRule = { D1: 0, D2: 0, D3: 0, D4: 0 };
  for (const finding of findings) {
    const rule = finding.ruleId;
    if (rule in findingsByRule)
      findingsByRule[rule as keyof typeof findingsByRule]++;
  }
  const sampleStatuses = new Set(records.map((row) => row.status));
  return {
    layout: config.sources.attendance.layout,
    dataRows,
    matchedRows,
    unmatchedTeamRows,
    otherRows,
    invalidDateRows,
    records: records.length,
    dateRange: recordDates.length
      ? { from: recordDates[0], to: recordDates[recordDates.length - 1] }
      : null,
    sampleStatuses: statuses.filter((status) => sampleStatuses.has(status)),
    findingsByRule,
    warnings: parsed.warnings.filter(
      (warning) => !warning.startsWith("UNMATCHED_ATTENDANCE_NAME:"),
    ),
  };
}
export type AttendancePreview = ReturnType<typeof summarizeAttendance>;
