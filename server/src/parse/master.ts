import type { Agent } from "../api/dto.js";
import type { Config } from "../config.js";
import { checkColumns, indexOf, pick } from "./columns.js";
import { codeOf, labelOf, parseDate } from "./normalize.js";

export const sensitiveHeader = (header: string) =>
  /phone|email|laptop|american/i.test(header);

export function masterHeaderMismatches(rows: string[][], config: Config) {
  const { columns, headerRows, expectHeaders } = config.sources.master;
  if (headerRows === 0) return [];
  return (Object.keys(columns) as (keyof typeof columns)[]).filter((field) => {
    const header = labelOf(rows[0]?.[indexOf(columns[field])]);
    const expected = expectHeaders?.[field];
    return (
      sensitiveHeader(header) ||
      (expected !== undefined && header !== labelOf(expected))
    );
  });
}

export function parseMaster(rows: string[][], config: Config, today: string) {
  const { columns, headerRows } = config.sources.master;
  const [mismatch] = masterHeaderMismatches(rows, config);
  if (mismatch) throw new Error("COLUMN_HEADER_MISMATCH:" + mismatch);
  const warnings = checkColumns(
    rows,
    {
      code: columns.code,
      name: columns.name,
      dtl: columns.dtl,
      tl: columns.tl,
    },
    headerRows,
  );
  const seen = new Set<string>();
  const agents: Agent[] = [];
  const own = labelOf(config.me.rosterName);
  const cover = new Set(config.me.alsoCover.map(labelOf));
  let dropped = 0;
  for (const row of rows.slice(headerRows)) {
    const raw = pick(row, columns);
    const code = codeOf(raw.code);
    if (!code) continue;
    if (seen.has(code)) {
      dropped++;
      continue;
    }
    seen.add(code);
    const leads = [labelOf(raw.dtl), labelOf(raw.tl)];
    const ownerGroup = leads.includes(own)
      ? "mine"
      : leads.some((lead) => cover.has(lead))
        ? "covered"
        : null;
    if (!ownerGroup) continue;
    const lastWorkingDay = parseDate(raw.lastWorkingDay, {
      dateOrder: config.dateOrder,
    });
    agents.push({
      code,
      ownerGroup,
      firstName: raw.name.split(/\s+/)[0],
      fullName: raw.name,
      account: raw.account,
      account2: raw.account2,
      dtl: raw.dtl,
      tl: raw.tl,
      stl: raw.stl,
      title: raw.title,
      hireDate: parseDate(raw.hireDate, { dateOrder: config.dateOrder }),
      lastWorkingDay,
      active: !lastWorkingDay || lastWorkingDay > today,
    });
  }
  if (dropped) warnings.push("DUPLICATE_CODES_DROPPED:" + dropped);
  return { agents, warnings };
}
