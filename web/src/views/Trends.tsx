import { useState } from "react";
import { ArrowDownUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  statuses,
  trendStatuses,
  type Scope,
  type TrendStatus,
  type TrendsData,
} from "../../../server/src/api/dto";
import {
  trendRange,
  type TrendPeriod,
} from "../../../server/src/api/trendRange";
import { query, useApi } from "../api";
import {
  DataTable,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  Section,
  StatCard,
} from "../components/ui";
import { statusColors } from "../theme";
const presets = [
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["month", "Month to date"],
] as const;
type Sort = "name" | "discrepancies" | TrendStatus;

export function Trends({
  scope,
  today,
  openAgent,
}: {
  scope: Scope;
  today: string;
  openAgent: (code: string) => void;
}) {
  const [period, setPeriod] = useState<TrendPeriod>("30");
  const [sort, setSort] = useState<{ field: Sort; direction: number }>({
    field: "name",
    direction: 1,
  });
  const result = useApi<TrendsData>(
    "/trends" + query({ scope, ...trendRange(today, period) }),
  );
  const rows = (result.data?.agents ?? []).slice().sort((a, b) => {
    const { field, direction } = sort;
    if (field === "name")
      return a.firstName.localeCompare(b.firstName) * direction;
    const value = (row: typeof a) =>
      field === "discrepancies" ? row.discrepancies : row.counts[field];
    return (
      (value(a) - value(b)) * direction ||
      a.firstName.localeCompare(b.firstName)
    );
  });
  const sortButton = (field: Sort, label: string) => (
    <button
      className="sort"
      onClick={() =>
        setSort((old) => ({
          field,
          direction:
            old.field === field ? -old.direction : field === "name" ? 1 : -1,
        }))
      }
    >
      {label}
      <ArrowDownUp size={13} />
    </button>
  );
  const chartStatuses = statuses.filter((status) =>
    result.data?.daily.some((row) => row[status] > 0),
  );
  return (
    <>
      <PageHeader
        title="Trends"
        description="Daily attendance and schedule counts."
      />
      <div className="presets" aria-label="Date range">
        {presets.map(([value, label]) => (
          <button
            className={"secondary " + (period === value ? "active" : "")}
            key={value}
            aria-pressed={period === value}
            onClick={() => setPeriod(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {result.error && (
        <ErrorNotice retry={result.reload}>{result.error}</ErrorNotice>
      )}
      {!result.data && !result.error && <Loading />}
      {result.data && (
        <>
          <div className="stats">
            {trendStatuses.map((label) => (
              <StatCard
                key={label}
                label={label}
                count={result.data!.totals[label]}
                tone={statusColors[label]}
              />
            ))}
          </div>
          <Section title="Status by day">
            {chartStatuses.length ? (
              <div className="chart">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={result.data.daily}
                    margin={{ left: -18, right: 12, top: 8, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      minTickGap={20}
                      tickFormatter={(value: string) => value.slice(5)}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--hover)" }}
                      contentStyle={{
                        background: "var(--panel)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {chartStatuses.map((status) => (
                      <Bar
                        key={status}
                        dataKey={status}
                        stackId="status"
                        fill={statusColors[status]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty>No status data for this range.</Empty>
            )}
          </Section>
          <Section title="Per-agent totals">
            {rows.length ? (
              <DataTable label="Agent trend counts">
                <thead>
                  <tr>
                    <th>{sortButton("name", "Name")}</th>
                    {trendStatuses.map((status) => (
                      <th key={status}>{sortButton(status, status)}</th>
                    ))}
                    <th>{sortButton("discrepancies", "Discrepancies")}</th>
                    {rows.some((row) => row.badges.length > 0) && (
                      <th>Thresholds</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.code}>
                      <td>
                        <button
                          className="agent-link"
                          onClick={() => openAgent(row.code)}
                        >
                          {row.firstName || row.code}
                        </button>{" "}
                        <span className="muted mono">{row.code}</span>
                      </td>
                      {trendStatuses.map((status) => (
                        <td key={status}>{row.counts[status]}</td>
                      ))}
                      <td>{row.discrepancies}</td>
                      {rows.some((item) => item.badges.length > 0) && (
                        <td>
                          {row.badges.map((badge) => (
                            <span key={badge.status} className="group-tag">
                              {badge.status} · {badge.count} in {badge.days}{" "}
                              days
                            </span>
                          ))}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : (
              <Empty>No agents in this scope.</Empty>
            )}
            <p className="panel-foot">
              Counts only. Thresholds come from TL/SOP.
            </p>
          </Section>
        </>
      )}
    </>
  );
}
