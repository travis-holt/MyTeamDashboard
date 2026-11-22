import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/db.js";
import { finding } from "../rules/context.js";

const id = z.number().int().positive();
const flag = z.union([z.literal(0), z.literal(1)]);
const day = z.iso.date();
const stamp = z.iso.datetime();
const code = z.string().min(1);
const text = z.string();
const unique = <Row>(
  schema: z.ZodType<Row>,
  key: (row: Row) => string | number,
) =>
  z
    .array(schema)
    .refine(
      (rows) => new Set(rows.map(key)).size === rows.length,
      "Duplicate records",
    );

const notes = unique(
  z.strictObject({
    id,
    code,
    date: day,
    what_happened: text,
    what_was_said: text,
    next_step: text,
    follow_up_date: day.nullable(),
    done: flag,
    created_at: stamp,
  }),
  (row) => row.id,
);
const snapshots = unique(
  z.strictObject({
    week_of: day,
    code,
    dtl: text,
    tl: text,
    account: text,
  }),
  (row) => JSON.stringify([row.week_of, row.code]),
);
const events = unique(
  z.strictObject({
    id,
    date: day,
    code,
    type: z.enum(["new", "left", "moved", "rejoined"]),
    detail: text,
  }),
  (row) => row.id,
);
const discrepancies = unique(
  z
    .strictObject({
      id: text,
      code,
      date: day,
      rule_id: z.enum(["D1", "D2", "D3", "D4", "D5", "D6", "D7"]),
      state: z.enum(["open", "ack", "resolved"]),
      tl_comment: text,
      auto_cleared: flag,
      created_at: stamp,
      updated_at: stamp,
    })
    .refine(
      (row) =>
        row.id === finding(row.code, row.date, row.rule_id, "", "roster").id,
      "Invalid discrepancy ID",
    ),
  (row) => row.id,
);

const schema = z.strictObject({
  version: z.literal(1),
  createdAt: stamp,
  notes,
  rosterSnapshots: snapshots,
  rosterEvents: events,
  discrepancies,
});
type Backup = z.infer<typeof schema>;
type Rows = Omit<Backup, "version" | "createdAt">;
export const maxBackupBytes = 32 * 1024 * 1024;

function readRows(db: Db): Rows {
  return {
    notes: db
      .prepare(
        "SELECT id, code, date, what_happened, what_was_said, next_step, follow_up_date, done, created_at FROM notes ORDER BY id",
      )
      .all() as Rows["notes"],
    rosterSnapshots: db
      .prepare(
        "SELECT week_of, code, dtl, tl, account FROM roster_snapshots ORDER BY week_of, code",
      )
      .all() as Rows["rosterSnapshots"],
    rosterEvents: db
      .prepare(
        "SELECT id, date, code, type, detail FROM roster_events ORDER BY id",
      )
      .all() as Rows["rosterEvents"],
    discrepancies: db
      .prepare(
        "SELECT id, code, date, rule_id, state, tl_comment, auto_cleared, created_at, updated_at FROM discrepancies ORDER BY id",
      )
      .all() as Rows["discrepancies"],
  };
}

export function exportBackup(db: Db, now = new Date()) {
  const rows = db.transaction(() => readRows(db))();
  const content = JSON.stringify({
    version: 1,
    createdAt: now.toISOString(),
    ...rows,
  });
  if (Buffer.byteLength(content) > maxBackupBytes)
    throw new Error("Backup exceeds the supported file size");
  return content;
}

export function parseBackup(content: Buffer): Backup {
  if (!Buffer.isBuffer(content) || content.length > maxBackupBytes)
    throw new BackupError(400, "Choose a backup file up to 32 MiB");
  let data: unknown;
  try {
    data = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(content),
    );
  } catch {
    throw new BackupError(400, "Choose a valid JSON backup file");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const field = parsed.error.issues[0].path.join(".");
    throw new BackupError(
      400,
      field ? "Invalid backup field: " + field : "Invalid backup format",
    );
  }
  return parsed.data;
}

export class BackupError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function changes<Row>(
  before: Row[],
  after: Row[],
  key: (row: Row) => string | number,
) {
  const prior = new Map(before.map((row) => [key(row), JSON.stringify(row)]));
  let added = 0;
  let updated = 0;
  for (const row of after) {
    const previous = prior.get(key(row));
    if (previous === undefined) added++;
    else if (previous !== JSON.stringify(row)) updated++;
    prior.delete(key(row));
  }
  return { added, updated, removed: prior.size };
}

const snapshotKey = (row: Rows["rosterSnapshots"][number]) =>
  JSON.stringify([row.week_of, row.code]);

function preview(current: Rows, file: Backup) {
  const hash = createHash("sha256")
    .update(JSON.stringify(current))
    .update(JSON.stringify(file));
  const discrepancyChanges = changes(
    current.discrepancies.map(({ id, state, tl_comment, auto_cleared }) => ({
      id,
      state,
      tl_comment,
      auto_cleared,
    })),
    file.discrepancies.map(({ id, state, tl_comment, auto_cleared }) => ({
      id,
      state,
      tl_comment,
      auto_cleared,
    })),
    (row) => row.id,
  );
  return {
    token: hash.digest("hex"),
    createdAt: file.createdAt,
    changes: {
      notes: changes(current.notes, file.notes, (row) => row.id),
      rosterSnapshots: changes(
        current.rosterSnapshots,
        file.rosterSnapshots,
        snapshotKey,
      ),
      rosterEvents: changes(
        current.rosterEvents,
        file.rosterEvents,
        (row) => row.id,
      ),
      discrepancies: { ...discrepancyChanges, removed: 0 },
    },
  };
}
export type BackupPreview = ReturnType<typeof preview>;

export function previewBackup(db: Db, file: Backup) {
  return db.transaction(() => preview(readRows(db), file))();
}

export function restoreBackup(db: Db, file: Backup, token?: string) {
  db.transaction(() => {
    if (token !== undefined && token !== preview(readRows(db), file).token)
      throw new BackupError(
        409,
        "Data changed since the preview. Preview the file again.",
      );
    db.exec(
      "DELETE FROM notes; DELETE FROM roster_snapshots; DELETE FROM roster_events",
    );
    const note = db.prepare(`INSERT INTO notes
      (id, code, date, what_happened, what_was_said, next_step, follow_up_date, done, created_at)
      VALUES (@id, @code, @date, @what_happened, @what_was_said, @next_step, @follow_up_date, @done, @created_at)`);
    const snapshot =
      db.prepare(`INSERT INTO roster_snapshots (week_of, code, dtl, tl, account)
      VALUES (@week_of, @code, @dtl, @tl, @account)`);
    const event =
      db.prepare(`INSERT INTO roster_events (id, date, code, type, detail)
      VALUES (@id, @date, @code, @type, @detail)`);
    const discrepancy = db.prepare(`INSERT INTO discrepancies
      (id, code, date, rule_id, severity, missing, source, state, tl_comment, auto_cleared, created_at, updated_at)
      VALUES (@id, @code, @date, @rule_id, @severity, '', @source, @state, @tl_comment, @auto_cleared, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state, tl_comment=excluded.tl_comment,
        auto_cleared=excluded.auto_cleared
      WHERE state<>excluded.state OR tl_comment<>excluded.tl_comment OR auto_cleared<>excluded.auto_cleared`);
    for (const row of file.notes) note.run(row);
    for (const row of file.rosterSnapshots) snapshot.run(row);
    for (const row of file.rosterEvents) event.run(row);
    for (const row of file.discrepancies)
      discrepancy.run({
        ...row,
        severity: row.rule_id === "D7" ? "info" : "action",
        source:
          row.rule_id === "D5"
            ? "roster"
            : row.rule_id < "D5"
              ? "attendance"
              : "schedule",
      });
  }).immediate();
}
