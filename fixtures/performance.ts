import type { Db } from "../server/src/db/db.js";
import { saveAgent } from "../server/src/db/repo.js";
import { plusDays } from "../server/src/parse/normalize.js";

export const performanceToday = "2026-11-21";
export const performanceStart = plusDays(performanceToday, -119);

export function seedPerformanceFixture(db: Db) {
  const stamp = performanceToday + "T12:00:00.000Z";
  const insertDay = db.prepare(`
    INSERT INTO schedule_days (code, date, raw, status, shift_start, synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertDiscrepancy = db.prepare(`
    INSERT INTO discrepancies (id, code, date, rule_id, severity, source, missing, created_at, updated_at)
    VALUES (?, ?, ?, 'D6', 'action', 'schedule', 'Fixture unknown shift', ?, ?)
  `);
  db.transaction(() => {
    for (let index = 0; index < 200; index++) {
      const number = String(index).padStart(3, "0");
      const code = "FAKE-" + number;
      const firstName = "Fixture" + number;
      saveAgent(
        db,
        {
          code,
          firstName,
          fullName: firstName + " Sample",
          account: "Fixture Account",
          account2: "",
          dtl: "Demo Lead",
          tl: "Fixture Lead",
          stl: "",
          title: "Fixture Agent",
          hireDate: "2025-01-01",
          lastWorkingDay: null,
          ownerGroup: "mine",
          active: true,
        },
        stamp,
      );
      for (let day = 0; day < 120; day++) {
        const date = plusDays(performanceStart, day);
        if ((day + index) % 60 === 0) {
          insertDay.run(code, date, "", "Unknown", null, stamp);
          insertDiscrepancy.run(
            code + "|" + date + "|D6",
            code,
            date,
            stamp,
            stamp,
          );
        } else if ((day + index) % 7 < 2) {
          insertDay.run(code, date, "OFF", "Off Day", null, stamp);
        } else {
          insertDay.run(code, date, "09:00", "Scheduled", "09:00", stamp);
        }
      }
    }
  })();
}
