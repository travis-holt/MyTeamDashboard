import express, {
  Router,
  type Request,
  type ErrorRequestHandler,
} from "express";
import { z } from "zod";
import type { Db } from "../db/db.js";
import {
  BackupError,
  exportBackup,
  maxBackupBytes,
  parseBackup,
  previewBackup,
  restoreBackup,
} from "./data.js";
import { backupName } from "./files.js";

export function backupRoutes(db: Db) {
  const router = Router();
  const file = express.raw({
    type: "application/octet-stream",
    limit: maxBackupBytes,
    inflate: false,
  });
  function upload(req: Request) {
    if (!Buffer.isBuffer(req.body))
      throw new BackupError(400, "Upload a JSON backup file");
    return parseBackup(req.body);
  }
  router.get("/", (_req, res) => {
    const now = new Date();
    const content = exportBackup(db, now);
    res.attachment(backupName(now)).send(content);
  });
  router.post("/preview", file, (req, res) =>
    res.json(previewBackup(db, upload(req))),
  );
  router.post("/restore", file, (req, res) => {
    const query = z
      .strictObject({ token: z.string().regex(/^[0-9a-f]{64}$/) })
      .parse(req.query);
    restoreBackup(db, upload(req), query.token);
    res.sendStatus(204);
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof BackupError)
      res.status(error.status).json({ error: error.message });
    else next(error);
  };
  router.use(errors);
  return router;
}
