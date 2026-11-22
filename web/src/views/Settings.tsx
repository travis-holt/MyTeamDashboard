import { useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { Job, SyncRun, SyncStatus } from "../../../server/src/api/dto";
import { api, message } from "../api";
import { AttendancePreview } from "./AttendancePreview";
import { Backups } from "./Backups";
import { CheckSheetLink } from "./CheckSheetLink";
import {
  DataTable,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  Section,
} from "../components/ui";

function result(run: SyncRun | null | undefined) {
  if (run?.ok === true)
    return <span className="sync-badge good">Succeeded</span>;
  if (run?.ok === false) return <span className="sync-badge bad">Failed</span>;
  return (
    <span className="sync-badge waiting">{run ? "Running" : "No runs"}</span>
  );
}
export function Settings({
  status,
}: {
  status: { data?: SyncStatus; error?: string; reload: () => void };
}) {
  const [request, setRequest] = useState<Job | null>(null);
  const [error, setError] = useState("");
  if (status.error) return <ErrorNotice>{status.error}</ErrorNotice>;
  if (!status.data) return <Loading />;
  const data = status.data;
  const time = (stamp: string | null) =>
    stamp
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: data.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(stamp))
      : "—";
  async function run(job: Job) {
    setRequest(job);
    setError("");
    try {
      await api("/sync?job=" + job, "POST");
      status.reload();
    } catch (error) {
      setError(message(error));
    } finally {
      setRequest(null);
    }
  }
  return (
    <>
      <PageHeader
        title="Settings"
        description="Check source health and manage synchronization."
      />
      <Section
        title="Sync now"
        action={<span className="muted">Cairo time</span>}
      >
        <div className="button-row panel-body">
          {(["roster", "daily", "all"] as const).map((job) => (
            <button
              className={job === "all" ? "primary" : "secondary"}
              key={job}
              disabled={!!request || !!data.running}
              onClick={() => void run(job)}
            >
              <RefreshCw
                size={15}
                className={data.running === job ? "spin" : ""}
              />
              {job[0].toUpperCase() + job.slice(1)}
            </button>
          ))}
        </div>
        {error && <ErrorNotice>{error}</ErrorNotice>}
      </Section>
      <Backups />
      <CheckSheetLink />
      <AttendancePreview />
      <div className="source-cards">
        {data.sources.map((source) => {
          const status = data.jobs[source.job];
          const latest = status?.lastRun;
          return (
            <Section
              key={source.job}
              title={source.label}
              action={
                source.enabled ? (
                  result(latest)
                ) : (
                  <span className="group-tag">Disabled</span>
                )
              }
            >
              <div className="panel-body source-details">
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    Open source sheet <ExternalLink size={13} />
                  </a>
                ) : (
                  <span className="muted">Source link not configured</span>
                )}
                <dl>
                  <div>
                    <dt>Last success</dt>
                    <dd>{time(status?.lastSuccessAt ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Read / kept</dt>
                    <dd>
                      {latest?.rowsRead ?? "—"} / {latest?.rowsKept ?? "—"}
                    </dd>
                  </div>
                </dl>
                {latest?.error && <ErrorNotice>{latest.error}</ErrorNotice>}
                {!!latest?.warnings.length && (
                  <ul className="warnings">
                    {latest.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            </Section>
          );
        })}
      </div>
      <Section title="Sync log">
        {data.runs.length ? (
          <DataTable label="Recent sync runs">
            <thead>
              <tr>
                <th>Job</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Result</th>
                <th>Rows read</th>
                <th>Rows kept</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.id}>
                  <td>{run.job}</td>
                  <td className="nowrap">{time(run.startedAt)}</td>
                  <td className="nowrap">{time(run.finishedAt)}</td>
                  <td>{result(run)}</td>
                  <td>{run.rowsRead ?? "—"}</td>
                  <td>{run.rowsKept ?? "—"}</td>
                  <td>
                    {run.error ||
                      (run.warnings.length ? run.warnings.join(", ") : "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <Empty>No sync jobs have run yet.</Empty>
        )}
      </Section>
      <Section title="Source configuration">
        <details className="panel-body">
          <summary>View configuration</summary>
          <pre>
            {JSON.stringify(
              data.config,
              (_key, value) =>
                _key === "thresholds" && Object.keys(value).length === 0
                  ? "none set"
                  : value,
              2,
            )}
          </pre>
        </details>
      </Section>
    </>
  );
}
