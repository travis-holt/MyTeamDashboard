import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  exportBackup,
  parseBackup,
  previewBackup,
  restoreBackup,
} from "../src/backup/data.js";
import { readBackup, writeBackup } from "../src/backup/files.js";
import { openDb, type Db } from "../src/db/db.js";

const now = new Date("2026-11-21T22:00:00Z");
let db: Db;
let directory: string;
beforeEach(() => {
  db = openDb(":memory:");
  directory = mkdtempSync(join(tmpdir(), "dashboard-backups-"));
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

function seed() {
  db.exec(`
    INSERT INTO notes VALUES (1, 'FAKE-1', '2026-11-21', 'Example note', '', '', NULL, 0, '2026-11-21T12:00:00Z');
    INSERT INTO roster_snapshots VALUES ('2026-11-16', 'FAKE-1', 'Fixture Lead', '', 'Fixture Account');
    INSERT INTO roster_events VALUES (1, '2026-11-21', 'FAKE-1', 'new', 'First sync');
    INSERT INTO discrepancies VALUES
      ('FAKE-1|D5', 'FAKE-1', '2026-11-21', 'D5', 'action', 'Sheet finding details',
       'roster', 'ack', 'Synthetic comment', 0, '2026-11-21T12:00:00Z', '2026-11-21T12:00:00Z');
    INSERT INTO schedule_days VALUES ('FAKE-1', '2026-11-21', '09:00', 'Scheduled', '09:00', '2026-11-21T12:00:00Z');
    INSERT INTO attendance_days VALUES ('FAKE-1', '2026-11-21', 'Fixture present', 'Present', NULL, '2026-11-21T12:00:00Z');
  `);
}

describe("backups", () => {
  it("round trips protected records without exporting or changing source rows", () => {
    seed();
    const path = writeBackup(db, directory, now);
    const exported = readFileSync(path, "utf8");
    expect(exported).not.toMatch(
      /Sheet finding details|Fixture present|09:00|attendance_days|schedule_days/,
    );
    const backup = readBackup(path);
    db.exec(
      "DELETE FROM notes; DELETE FROM roster_snapshots; DELETE FROM roster_events; DELETE FROM discrepancies;",
    );
    const preview = previewBackup(db, backup);
    expect(Object.values(preview.changes)).toEqual(
      Array.from({ length: 4 }, () => ({ added: 1, updated: 0, removed: 0 })),
    );
    restoreBackup(db, backup, preview.token);
    expect(exportBackup(db, now)).toBe(exported);
    expect(db.prepare("SELECT raw FROM schedule_days").pluck().get()).toBe(
      "09:00",
    );
    expect(db.prepare("SELECT raw FROM attendance_days").pluck().get()).toBe(
      "Fixture present",
    );
  });

  it("preserves current finding details, even when restored states differ", () => {
    seed();
    const file = parseBackup(Buffer.from(exportBackup(db, now)));
    db.exec(
      "UPDATE discrepancies SET missing='New sheet details', state='open', tl_comment=''",
    );
    expect(previewBackup(db, file).changes.discrepancies).toEqual({
      added: 0,
      updated: 1,
      removed: 0,
    });
    restoreBackup(db, file);
    expect(
      db.prepare("SELECT missing, state, tl_comment FROM discrepancies").get(),
    ).toEqual({
      missing: "New sheet details",
      state: "ack",
      tl_comment: "Synthetic comment",
    });
  });

  it("rejects malformed, unrecognized, and duplicate records", () => {
    seed();
    expect(() => parseBackup(Buffer.from("{"))).toThrow("valid JSON");
    expect(() => parseBackup(Buffer.from('{"version":2}'))).toThrow(
      "Invalid backup",
    );
    const file = parseBackup(Buffer.from(exportBackup(db, now)));
    file.notes.push(file.notes[0]);
    expect(() => parseBackup(Buffer.from(JSON.stringify(file)))).toThrow(
      "notes",
    );
    expect(db.prepare("SELECT COUNT(*) FROM notes").pluck().get()).toBe(1);
  });

  it("rejects a stale confirmation without replacing notes", () => {
    seed();
    const file = parseBackup(Buffer.from(exportBackup(db, now)));
    const preview = previewBackup(db, file);
    db.exec("UPDATE notes SET what_happened='New note'");
    expect(() => restoreBackup(db, file, preview.token)).toThrow(
      "Data changed since",
    );
    expect(db.prepare("SELECT what_happened FROM notes").pluck().get()).toBe(
      "New note",
    );
  });

  it("keeps the 14 newest Cairo dates and leaves unrelated files alone", () => {
    for (let index = 1; index <= 16; index++)
      writeBackup(db, directory, new Date(Date.UTC(2026, 10, index, 22)));
    const backups = join(directory, "backups");
    writeFileSync(join(backups, "other.json"), "");
    const latest = writeBackup(db, directory, new Date("2026-11-16T23:00:00Z"));
    expect(readdirSync(backups).sort()).toEqual([
      ...Array.from(
        { length: 14 },
        (_, index) =>
          "backup-2026-11-" + String(index + 4).padStart(2, "0") + ".json",
      ),
      "other.json",
    ]);
    expect(statSync(latest).mode & 0o777).toBe(0o600);
  });
});
