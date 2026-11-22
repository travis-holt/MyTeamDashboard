import type { Agent, AttendanceDay } from "../api/dto.js";
import type { Config } from "../config.js";
import { checkColumns, indexOf } from "./columns.js";
import { clean, codeOf, labelOf, nameOf, parseDate } from "./normalize.js";
import type { Window } from "./schedule.js";
import { parseStatus } from "./status.js";

export function parseAttendance(
  rows: string[][],
  config: Config,
  agents: Agent[],
  window: Window,
) {
  const source = config.sources.attendance;
  const codes = new Set(agents.map((agent) => agent.code));
  const names = new Map<string, string | null>();
  for (const agent of agents) {
    const name = nameOf(agent.fullName);
    if (name) names.set(name, names.has(name) ? null : agent.code);
  }
  const records = new Map<string, AttendanceDay>();
  const missingByDay = new Map<string, Set<string>>();
  const unmatched = new Set<string>();
  const dates = new Set<string>();
  const warnings: string[] = [];
  let matchedRows = 0;
  let unmatchedTeamRows = 0;
  let otherRows = 0;
  let invalidDateRows = 0;
  let dataStart = source.headerRows;
  const add = (
    code: string,
    date: string,
    raw: string,
    missing: string | null,
  ) => {
    const key = code + "|" + date;
    const previous = records.get(key);
    if (!previous || (!clean(previous.raw) && clean(raw)))
      records.set(key, {
        code,
        date,
        raw,
        status: parseStatus(raw, config.statusMap).status,
        missing: null,
      });
    if (missing) {
      const values = missingByDay.get(key) ?? new Set<string>();
      values.add(missing);
      missingByDay.set(key, values);
    }
  };
  if (source.layout === "long") {
    const { columns } = source.long;
    const { code, date, status, missing } = columns;
    warnings.push(
      ...checkColumns(rows, { code, date, status }, source.headerRows),
    );
    const [codeIndex, dateIndex, statusIndex] = [code, date, status].map(
      indexOf,
    );
    const missingIndex = missing ? indexOf(missing) : -1;
    for (const row of rows.slice(source.headerRows)) {
      const rowCode = codeOf(row[codeIndex]);
      if (!codes.has(rowCode)) {
        if (rowCode) otherRows++;
        continue;
      }
      const day = parseDate(row[dateIndex] ?? "", {
        window,
        dateOrder: config.dateOrder,
      });
      if (!day) {
        invalidDateRows++;
        continue;
      }
      matchedRows++;
      dates.add(day);
      if (day < window.from || day > window.to) continue;
      const missingValue = row[missingIndex];
      add(
        rowCode,
        day,
        row[statusIndex]?.trim() ?? "",
        clean(missingValue) ? missingValue : null,
      );
    }
  } else {
    const { keyColumn, dtlColumn, keyType, firstDateColumn, dateHeaderRow } =
      source.wide;
    const header = rows[dateHeaderRow - 1] ?? [];
    const keyIndex = indexOf(keyColumn);
    const leadIndex = indexOf(dtlColumn);
    const teamLeads = new Set(
      [config.me.rosterName, ...config.me.alsoCover].map(labelOf),
    );
    const start = indexOf(firstDateColumn);
    dataStart = Math.max(source.headerRows, dateHeaderRow);
    warnings.push(...checkColumns(rows, { key: keyColumn }, dataStart));
    if (!header.slice(start).some((value) => value.trim()))
      throw new Error("MISSING_REQUIRED_COLUMN:attendance dates");
    const days = header.slice(start).map((value, offset) => ({
      date: parseDate(value, {
        window,
        ignoreYear: true,
        dateOrder: config.dateOrder,
      }),
      index: start + offset,
    }));
    for (const { date } of days) if (date) dates.add(date);
    for (const row of rows.slice(dataStart)) {
      const rawKey = clean(row[keyIndex]);
      if (!rawKey) continue;
      const code =
        keyType === "name" ? names.get(nameOf(rawKey)) : codeOf(rawKey);
      if (!code || !codes.has(code)) {
        if (teamLeads.has(labelOf(row[leadIndex]))) {
          unmatchedTeamRows++;
          if (keyType === "name") unmatched.add(rawKey);
        } else otherRows++;
        continue;
      }
      matchedRows++;
      for (const { date, index } of days) {
        const raw = row[index]?.trim() ?? "";
        if (date && raw) add(code, date, raw, null);
      }
    }
  }
  if (unmatched.size)
    warnings.push(
      ...[...unmatched]
        .sort()
        .map((name) => "UNMATCHED_ATTENDANCE_NAME:" + name),
    );
  for (const [key, values] of missingByDay) {
    records.get(key)!.missing = [...values].join("\n");
  }
  return {
    records: [...records.values()],
    matchedRows,
    unmatchedTeamRows,
    otherRows,
    invalidDateRows,
    dataRows: rows
      .slice(dataStart)
      .filter((row) => row.some((cell) => cell.trim())).length,
    warnings,
    dates: [...dates].sort(),
  };
}
