import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "../db/db.js";
import {
  agentsOf,
  attendanceOf,
  discrepanciesOf,
  eventsOf,
  lastRun,
  lastSuccess,
  notesOf,
  recentRuns,
  scheduleOf,
} from "../db/repo.js";
import type { Config, SourceKey } from "../config.js";
import type { SyncService } from "../sync/service.js";
import type {
  Agent,
  AgentProfile,
  DiscrepancyRow,
  Scope,
  SyncStatus,
  TodayData,
} from "./dto.js";
import { parseDate, plusDays, weekday, weekdays } from "../parse/normalize.js";
import { excluded } from "../parse/status.js";
import { exportDiscrepancies } from "./export.js";
import { calculateTrends } from "./trends.js";

const day = z
  .string()
  .regex(/^\d{4}-\d\d-\d\d$/)
  .refine((value) => parseDate(value) !== null, "Invalid date");
const scopes = z.enum(["mine", "covered", "all"]);
const state = z.enum(["open", "ack", "resolved"]);
const rules = z.enum(["D1", "D2", "D3", "D4", "D5", "D6", "D7"]);
const filters = z.object({
  scope: scopes.optional(),
  state: z.union([state, z.literal("all")]).optional(),
  rule: rules.optional(),
  from: day.optional(),
  to: day.optional(),
  code: z.string().optional(),
  q: z.string().trim().optional(),
  ids: z.string().optional(),
});
const discrepancyPatch = z
  .object({
    state: state.optional(),
    tlComment: z.string().max(10_000).optional(),
  })
  .strict();
const noteValues = z
  .object({
    date: day,
    whatHappened: z.string().min(1).max(10_000),
    whatWasSaid: z.string().max(10_000),
    nextStep: z.string().max(10_000),
    followUpDate: day.nullable(),
    done: z.boolean(),
  })
  .strict();
const isInScope = (agent: Agent, scope: Scope) =>
  scope !== "mine" || agent.ownerGroup === "mine";
function summary(agent: Agent) {
  const { fullName, ...rest } = agent;
  void fullName;
  return rest;
}
export function createRoutes(db: Db, config: Config, sync: SyncService) {
  const router = Router();
  const scopeFor = (req: Request) =>
    scopes.optional().parse(req.query.scope) ?? config.me.defaultScope;
  const findAgent = (code: string) =>
    agentsOf(db).find((agent) => agent.code === code);
  function filtered(req: Request) {
    const query = filters.parse(req.query);
    const where: string[] = [];
    const values: string[] = [];
    if ((query.scope ?? config.me.defaultScope) === "mine")
      where.push("a.owner_group='mine'");
    for (const [column, value] of [
      ["d.state", query.state === "all" ? undefined : query.state],
      ["d.rule_id", query.rule],
      ["d.code", query.code],
    ]) {
      if (value) {
        where.push(column + "=?");
        values.push(value);
      }
    }
    if (query.from) {
      where.push("d.date>=?");
      values.push(query.from);
    }
    if (query.to) {
      where.push("d.date<=?");
      values.push(query.to);
    }
    const rows = discrepanciesOf(db, where.join(" AND ") || "1=1", values);
    const ids = query.ids ? new Set(query.ids.split(",")) : null;
    const q = query.q?.toLowerCase();
    return rows.filter(
      (row) =>
        (!ids || ids.has(row.id)) &&
        (!q || (row.firstName + " " + row.code).toLowerCase().includes(q)),
    );
  }
  router.get("/me", (_req, res) => res.json(config.me));
  router.get("/today", (req, res) => {
    const date = day.optional().parse(req.query.date) ?? sync.today();
    const scope = scopeFor(req);
    const agents = agentsOf(db).filter(
      (agent) =>
        isInScope(agent, scope) &&
        (agent.active ||
          (!!agent.lastWorkingDay && agent.lastWorkingDay > date)),
    );
    const codeSet = new Set(agents.map((agent) => agent.code));
    const range = { from: date, to: date };
    const schedule = new Map(
      scheduleOf(db, range).map((row) => [row.code, row]),
    );
    const attendanceEnabled = config.sources.attendance.enabled;
    const attendance = new Map(
      (attendanceEnabled ? attendanceOf(db, range) : []).map((row) => [
        row.code,
        row,
      ]),
    );
    const counts: TodayData["counts"] = {
      scheduled: 0,
      present: 0,
      off: 0,
      leave: 0,
      unplanned: 0,
      excluded: 0,
      unknown: 0,
      notOnSchedule: 0,
    };
    const coverage = new Map<string, number>();
    const rows = agents.map((agent) => {
      const plan = schedule.get(agent.code) ?? null;
      const actual = attendance.get(agent.code) ?? null;
      const isExcluded = excluded(plan?.status) || excluded(actual?.status);
      if (!isExcluded && actual?.status === "Present") counts.present++;
      if (!plan) counts.notOnSchedule++;
      else if (isExcluded) counts.excluded++;
      else {
        switch (plan.status) {
          case "Scheduled":
            counts.scheduled++;
            if (plan.shiftStart)
              coverage.set(
                plan.shiftStart,
                (coverage.get(plan.shiftStart) ?? 0) + 1,
              );
            break;
          case "Off Day":
            counts.off++;
            break;
          case "PTO":
          case "UPL":
            counts.leave++;
            break;
          case "Sick":
          case "Casual":
          case "Absent":
            counts.unplanned++;
            break;
          default:
            counts.unknown++;
        }
      }
      return { agent: summary(agent), schedule: plan, attendance: actual };
    });
    const discrepancies = discrepanciesOf(
      db,
      "d.state='open' AND (d.date=? OR (d.rule_id='D5' AND d.date<=?))",
      [date, date],
    ).filter(
      (row) =>
        codeSet.has(row.code) ||
        (row.ruleId === "D5" &&
          !!findAgent(row.code) &&
          isInScope(findAgent(row.code)!, scope)),
    );
    const response: TodayData = {
      date,
      attendanceEnabled,
      counts,
      agents: rows,
      coverage: [...coverage]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([shiftStart, count]) => ({ shiftStart, count })),
      openActions: discrepancies.filter((row) => row.severity === "action"),
      confirmReturn: discrepancies.filter((row) => row.ruleId === "D7"),
      followUpsDue: notesOf(db, "follow_up_date<=? AND done=0", [date]).filter(
        (note) => codeSet.has(note.code),
      ),
    };
    res.json(response);
  });
  router.get("/discrepancies", (req, res) => res.json(filtered(req)));
  router.get("/discrepancies/export", (req, res) =>
    res.json(exportDiscrepancies(filtered(req))),
  );
  router.patch("/discrepancies/bulk", (req, res) => {
    const input = z
      .object({ ids: z.array(z.string()).max(500), state })
      .strict()
      .parse(req.body);
    const update = db.prepare(
      "UPDATE discrepancies SET state=?,auto_cleared=0,updated_at=? WHERE id=?",
    );
    const now = new Date().toISOString();
    db.transaction(() => {
      for (const id of input.ids) update.run(input.state, now, id);
    })();
    res.sendStatus(204);
  });
  router.patch("/discrepancies/:id", (req, res) => {
    const input = discrepancyPatch.parse(req.body);
    const row = discrepanciesOf(db, "d.id=?", [req.params.id])[0];
    if (!row) {
      res.status(404).json({ error: "Discrepancy not found" });
      return;
    }
    db.prepare(
      "UPDATE discrepancies SET state=?,tl_comment=?,updated_at=?,auto_cleared=CASE WHEN ? THEN 0 ELSE auto_cleared END WHERE id=?",
    ).run(
      input.state ?? row.state,
      input.tlComment ?? row.tlComment,
      new Date().toISOString(),
      Number(input.state !== undefined),
      row.id,
    );
    res.json(discrepanciesOf(db, "d.id=?", [row.id])[0]);
  });
  router.get("/agents", (req, res) =>
    res.json(
      agentsOf(db)
        .filter((agent) => isInScope(agent, scopeFor(req)))
        .map(summary),
    ),
  );
  router.get("/agents/:code", (req, res) => {
    const agent = findAgent(req.params.code);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    const today = sync.today();
    const historyRange = { from: plusDays(today, -34), to: today };
    const schedule = new Map(
      scheduleOf(db, historyRange, agent.code).map((row) => [row.date, row]),
    );
    const attendance = new Map(
      (config.sources.attendance.enabled
        ? attendanceOf(db, historyRange, agent.code)
        : []
      ).map((row) => [row.date, row]),
    );
    const history = Array.from({ length: 35 }, (_, index) => {
      const date = plusDays(historyRange.from, index);
      return {
        date,
        schedule: schedule.get(date) ?? null,
        attendance: attendance.get(date) ?? null,
      };
    });
    const days = Array(7).fill(0) as number[];
    for (const row of history.slice(-28))
      if (row.schedule?.status === "Off Day") days[weekday(row.date)]++;
    const result: AgentProfile = {
      agent,
      history,
      fixedOffDays: weekdays.filter((_, index) => days[index] >= 3),
      next7: scheduleOf(
        db,
        { from: today, to: plusDays(today, 6) },
        agent.code,
      ),
      discrepancies: discrepanciesOf(db, "d.code=?", [agent.code]),
      notes: notesOf(db, "code=?", [agent.code]),
    };
    res.json(result);
  });
  router.post("/agents/:code/notes", (req, res) => {
    if (!findAgent(req.params.code)) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    const input = noteValues.parse(req.body);
    const result = db
      .prepare(
        "INSERT INTO notes (code,date,what_happened,what_was_said,next_step,follow_up_date,done,created_at) VALUES (@code,@date,@whatHappened,@whatWasSaid,@nextStep,@followUpDate,@done,@now)",
      )
      .run({
        ...input,
        code: req.params.code,
        done: Number(input.done),
        now: new Date().toISOString(),
      });
    res
      .status(201)
      .json(notesOf(db, "id=?", [Number(result.lastInsertRowid)])[0]);
  });
  router.patch("/notes/:id", (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const previous = notesOf(db, "id=?", [id])[0];
    if (!previous) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const input = { ...previous, ...noteValues.partial().parse(req.body) };
    db.prepare(
      "UPDATE notes SET date=@date,what_happened=@whatHappened,what_was_said=@whatWasSaid,next_step=@nextStep,follow_up_date=@followUpDate,done=@done WHERE id=@id",
    ).run({ ...input, done: Number(input.done) });
    res.json(notesOf(db, "id=?", [id])[0]);
  });
  router.get("/roster/events", (req, res) => {
    const since =
      day.optional().parse(req.query.since) ?? plusDays(sync.today(), -7);
    const scope = scopeFor(req);
    const codes = new Set(
      agentsOf(db)
        .filter((agent) => isInScope(agent, scope))
        .map((agent) => agent.code),
    );
    res.json(eventsOf(db, since).filter((row) => codes.has(row.code)));
  });
  router.get("/trends", (req, res) => {
    const today = sync.today();
    const from = day.optional().parse(req.query.from) ?? plusDays(today, -29);
    const to = day.optional().parse(req.query.to) ?? today;
    if (from > to || to > plusDays(from, 365)) {
      res
        .status(400)
        .json({ error: "Choose a valid date range up to one year" });
      return;
    }
    const scope = scopeFor(req);
    const agents = agentsOf(db).filter((agent) => isInScope(agent, scope));
    const thresholdDays = Math.max(
      1,
      ...Object.values(config.thresholds).map((value) => value.days),
    );
    const thresholdFrom = plusDays(today, 1 - thresholdDays);
    const range = {
      from: from < thresholdFrom ? from : thresholdFrom,
      to: to > today ? to : today,
    };
    const discrepancies: DiscrepancyRow[] = discrepanciesOf(
      db,
      "d.date BETWEEN ? AND ?",
      [from, to],
    );
    res.json(
      calculateTrends(
        agents,
        scheduleOf(db, range),
        config.sources.attendance.enabled ? attendanceOf(db, range) : [],
        discrepancies,
        from,
        to,
        today,
        config.thresholds,
      ),
    );
  });
  router.get("/sync/status", (_req, res) => {
    const jobs = ["roster", "schedule", "attendance", "rules"];
    const keys = ["master", "schedule", "attendance"] as SourceKey[];
    const result: SyncStatus = {
      jobs: Object.fromEntries(
        jobs.map((job) => [
          job,
          { lastRun: lastRun(db, job), lastSuccessAt: lastSuccess(db, job) },
        ]),
      ),
      sources: keys.map((key) => {
        const source = config.sources[key];
        const url = source.sheetId
          ? "https://docs.google.com/spreadsheets/d/" +
            source.sheetId +
            "/edit#gid=" +
            source.gid
          : null;
        return {
          job: key === "master" ? "roster" : key,
          label: source.label,
          url,
          enabled: key !== "attendance" || config.sources.attendance.enabled,
        };
      }),
      running: sync.active,
      runs: recentRuns(db),
      timezone: config.timezone,
      config,
      date: sync.today(),
      window: sync.window(),
    };
    res.json(result);
  });
  router.post("/sync/attendance-preview", (_req, res) => {
    void sync.previewAttendance().then(
      (report) => res.json(report),
      (error: unknown) =>
        res.status(422).json({
          error:
            error instanceof Error
              ? error.message
              : "Attendance preview failed",
        }),
    );
  });
  router.post("/sync", (req, res) => {
    const job = z.enum(["roster", "daily", "all"]).parse(req.query.job);
    if (!sync.start(job)) {
      res.status(409).json({ error: "A sync is already running" });
      return;
    }
    res.status(202).json({ job });
  });
  router.use((_req, res) =>
    res.status(404).json({ error: "API route not found" }),
  );
  return router;
}
