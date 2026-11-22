import { useState, type FormEvent } from "react";
import type { LinkReport } from "../../../server/src/fetch/checkLink";
import type { SourceKey } from "../../../server/src/config";
import { api, message } from "../api";
import { DataTable, ErrorNotice, Section } from "../components/ui";

export function CheckSheetLink() {
  const [link, setLink] = useState("");
  const [gid, setGid] = useState("");
  const [source, setSource] = useState<SourceKey>("master");
  const [report, setReport] = useState<LinkReport>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setReport(undefined);
    setError("");
    try {
      setReport(
        await api<LinkReport>("/check-link", "POST", {
          link,
          gid: gid.trim() || undefined,
          source,
        }),
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Check a link">
      <form
        className="panel-body source-details"
        onSubmit={(event) => void check(event)}
      >
        <label>
          Google Sheets link
          <input
            type="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            required
            maxLength={2048}
            disabled={busy}
          />
        </label>
        <label>
          Tab GID (optional)
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={20}
            value={gid}
            onChange={(event) => setGid(event.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Column mapping
          <select
            value={source}
            onChange={(event) => setSource(event.target.value as SourceKey)}
            disabled={busy}
          >
            <option value="master">Master roster</option>
            <option value="schedule">Schedule</option>
            <option value="attendance">Attendance</option>
          </select>
        </label>
        <div className="button-row">
          <button className="secondary" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Check link"}
          </button>
        </div>
      </form>
      {(error || report?.error) && (
        <ErrorNotice>{error || report?.error}</ErrorNotice>
      )}
      {report && (
        <div className="panel-body source-details" aria-live="polite">
          <dl>
            <div>
              <dt>HTTP status</dt>
              <dd>{report.status ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Content type</dt>
              <dd>{report.contentType ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Rows</dt>
              <dd>{report.rowCount ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Sample date ({report.dateOrder})</dt>
              <dd>{report.sampleDate ?? "Unavailable"}</dd>
            </div>
          </dl>
          {!!report.mismatches.length && (
            <ul className="warnings">
              {report.mismatches.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {!!report.headers.length && (
            <DataTable label="Mapped headers">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Column</th>
                  <th>Header</th>
                </tr>
              </thead>
              <tbody>
                {report.headers.map(({ field, column, header }) => (
                  <tr key={field}>
                    <td>{field}</td>
                    <td>{column}</td>
                    <td>{header ?? "Unavailable"}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      )}
    </Section>
  );
}
