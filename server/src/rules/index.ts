import type { Db } from "../db/db.js";
import { plusDays } from "../parse/normalize.js";
import type { RuleContext } from "./context.js";
import { d1 } from "./d1.js";
import { d2 } from "./d2.js";
import { d3 } from "./d3.js";
import { d4 } from "./d4.js";
import { d5 } from "./d5.js";
import { d6 } from "./d6.js";
import { d7 } from "./d7.js";

export function attendanceFindings(ctx: RuleContext) {
  return [d1, d2, d3, d4].flatMap((rule) => rule(ctx));
}

export function runRules(db: Db, ctx: RuleContext, now: string) {
  const attendance = ctx.attendanceEnabled ? ctx.attendance : [];
  const context = { ...ctx, attendance };
  const findings = [
    ...(ctx.attendanceEnabled ? attendanceFindings(context) : []),
    ...[d5, d6, d7].flatMap((rule) => rule(context)),
  ];
  const insert =
    db.prepare(`INSERT INTO discrepancies (id,code,date,rule_id,severity,missing,source,created_at,updated_at)
    VALUES (@id,@code,@date,@ruleId,@severity,@missing,@source,@now,@now)
    ON CONFLICT(id) DO UPDATE SET severity=excluded.severity,missing=excluded.missing,source=excluded.source,updated_at=excluded.updated_at,
    state=CASE WHEN discrepancies.rule_id='D5' AND discrepancies.auto_cleared=1 THEN 'open' ELSE discrepancies.state END,
    auto_cleared=CASE WHEN discrepancies.rule_id='D5' THEN 0 ELSE discrepancies.auto_cleared END`);
  const clear = db.prepare(
    "UPDATE discrepancies SET auto_cleared=1,state='resolved',updated_at=? WHERE id=? AND state='open'",
  );
  const existing = db
    .prepare(
      "SELECT id,code,date,rule_id AS ruleId FROM discrepancies WHERE state='open' AND (rule_id='D5' OR date BETWEEN ? AND ?)",
    )
    .all(ctx.from, plusDays(ctx.today, 7)) as {
    id: string;
    code: string;
    date: string;
    ruleId: string;
  }[];
  const ids = new Set(findings.map((row) => row.id));
  for (const row of findings) insert.run({ ...row, now });
  const agentByCode = new Map(ctx.agents.map((agent) => [agent.code, agent]));
  for (const row of existing) {
    if (ids.has(row.id)) continue;
    if (row.ruleId === "D5") {
      const agent = agentByCode.get(row.code);
      if (
        !ctx.scheduleMembers ||
        !agent ||
        agent.active !== ctx.scheduleMembers.has(row.code)
      )
        continue;
    }
    if (row.date > ctx.today && row.ruleId !== "D6") continue;
    clear.run(now, row.id);
  }
  return findings.length;
}
