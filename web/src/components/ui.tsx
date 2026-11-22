import type { ReactNode, CSSProperties } from "react";
import { AlertTriangle, Inbox, Search } from "lucide-react";
import type { Status, SyncStatus } from "../../../server/src/api/dto";
import { statusColors, statusSlugs } from "../theme";

export function Pill({
  status,
  shift,
}: {
  status: Status;
  shift?: string | null;
}) {
  return (
    <span
      className={"pill " + statusSlugs[status]}
      style={{ "--status": statusColors[status] } as CSSProperties}
    >
      {status === "Unknown" ? (
        <AlertTriangle size={12} />
      ) : (
        <span className="pill-dot" />
      )}
      {status}
      {shift && " · " + shift}
    </span>
  );
}
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </header>
  );
}
export function Section({
  title,
  children,
  action,
  className = "",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={"panel " + className}>
      <header className="panel-heading">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Inbox size={20} />
      <span>{children}</span>
    </div>
  );
}
export function ErrorNotice({
  children,
  retry,
}: {
  children: ReactNode;
  retry?: () => void;
}) {
  return (
    <div className="error">
      <span role="alert">
        <AlertTriangle size={16} aria-hidden="true" />
        {children}
      </span>
      {retry && (
        <button type="button" className="secondary" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" aria-label="Loading" role="status">
      <i />
      <i />
      <i />
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  label = "Search agents",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <label className="search">
      <Search size={16} />
      <input
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
export function StatCard({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: string;
}) {
  return (
    <article className="stat" style={{ "--tone": tone } as CSSProperties}>
      <span>
        <i />
        {label}
      </span>
      <strong>{count}</strong>
    </article>
  );
}
export function DataTable({
  children,
  label,
  cards = false,
}: {
  children: ReactNode;
  label: string;
  cards?: boolean;
}) {
  return (
    <div className={cards ? "table-scroll card-table" : "table-scroll"}>
      <table aria-label={label} role="table">
        {children}
      </table>
    </div>
  );
}

export function CardCell({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <td role="cell" className={className}>
      <span className="mobile-cell-label">{label}</span>
      <span className="card-cell-value">{children}</span>
    </td>
  );
}
export function formatDay(date: string) {
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T00:00:00Z"));
}
export function dateOffset(date: string, days: number) {
  return new Date(Date.parse(date) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function tenure(hire: string | null, asOf: string) {
  if (!hire) return "—";
  const [year, month, day] = hire.split("-").map(Number);
  const [endYear, endMonth, endDay] = asOf.split("-").map(Number);
  const months = Math.max(
    0,
    (endYear - year) * 12 + endMonth - month - Number(endDay < day),
  );
  return months + " mo";
}
export function syncLabel(status: SyncStatus) {
  if (status.running)
    return { tone: "waiting", label: "Syncing " + status.running };
  if (Object.values(status.jobs).some((job) => job.lastRun?.ok === false))
    return { tone: "bad", label: "Last sync failed" };
  const roster = status.jobs.roster?.lastSuccessAt;
  const last = status.jobs.schedule?.lastSuccessAt ?? roster;
  if (!last) return { tone: "waiting", label: "Awaiting first sync" };
  if (roster) {
    const days = Math.floor((Date.now() - Date.parse(roster)) / 86400000);
    if (days > 7)
      return { tone: "waiting", label: "Roster " + days + " days old" };
  }
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: status.timezone,
    timeStyle: "short",
  }).format(new Date(last));
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: status.timezone,
    dateStyle: "short",
  }).format(new Date(last));
  return {
    tone: "good",
    label: "Synced " + time + " " + (date === status.date ? "today" : date),
  };
}
