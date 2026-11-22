import type { Db } from "../db/db.js";
import type { AttendanceDay } from "../api/dto.js";
import type { Window } from "../parse/schedule.js";
export function coveredRange(dates: string[], window: Window): Window {
  const first = dates[0];
  const last = dates[dates.length - 1];
  return {
    from: first > window.from ? first : window.from,
    to: last < window.to ? last : window.to,
  };
}

export function replaceAttendance(
  db: Db,
  records: AttendanceDay[],
  covered: Window,
  now: string,
) {
  db.prepare("DELETE FROM attendance_days WHERE date BETWEEN ? AND ?").run(
    covered.from,
    covered.to,
  );
  const insert = db.prepare(
    "INSERT INTO attendance_days VALUES (@code,@date,@raw,@status,@missing,@now)",
  );
  for (const row of records) insert.run({ ...row, now });
}
