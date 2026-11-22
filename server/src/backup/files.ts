import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Db } from "../db/db.js";
import { localDate } from "../parse/normalize.js";
import {
  BackupError,
  exportBackup,
  maxBackupBytes,
  parseBackup,
} from "./data.js";

export const backupTimezone = "Africa/Cairo";
export const backupName = (now: Date) =>
  "backup-" + localDate(backupTimezone, now) + ".json";

export function writeBackup(db: Db, dataDir: string, now = new Date()) {
  const directory = join(dataDir, "backups");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = join(directory, backupName(now));
  const temporary = join(directory, "." + randomUUID() + ".tmp");
  const content = exportBackup(db, now);
  const fd = openSync(temporary, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, content, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
  const old = readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(14);
  for (const name of old) rmSync(join(directory, name), { force: true });
  return destination;
}

export function readBackup(path: string) {
  const fd = openSync(path, "r");
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(64 * 1024);
      const length = readSync(fd, chunk);
      if (length === 0) return parseBackup(Buffer.concat(chunks, size));
      size += length;
      if (size > maxBackupBytes)
        throw new BackupError(400, "Choose a backup file up to 32 MiB");
      chunks.push(chunk.subarray(0, length));
    }
  } finally {
    closeSync(fd);
  }
}
