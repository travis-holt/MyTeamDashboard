import { useState } from "react";
import type { AttendancePreview as Preview } from "../../../server/src/sync/attendancePreview";
import { api, message } from "../api";
import { ErrorNotice, Section } from "../components/ui";

export function AttendancePreview() {
  const [result, setResult] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      setResult(await api<Preview>("/sync/attendance-preview", "POST"));
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Attendance dry run">
      <div className="panel-body source-details" aria-live="polite">
        <div className="button-row">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? "Reading attendance…" : "Dry-run attendance"}
          </button>
        </div>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {result && (
          <>
            <p>Preview based on the current roster and schedule.</p>
            <dl>
              <div>
                <dt>Layout</dt>
                <dd>{result.layout}</dd>
              </div>
              <div>
                <dt>Source rows</dt>
                <dd>{result.dataRows}</dd>
              </div>
              <div>
                <dt>Matched team rows</dt>
                <dd>{result.matchedRows}</dd>
              </div>
              <div>
                <dt>Unmatched team rows</dt>
                <dd>
                  {result.layout === "wide"
                    ? result.unmatchedTeamRows
                    : "Unavailable by code"}
                </dd>
              </div>
              <div>
                <dt>Other keyed rows</dt>
                <dd>{result.otherRows}</dd>
              </div>
              <div>
                <dt>Team rows with an invalid date</dt>
                <dd>{result.invalidDateRows}</dd>
              </div>
              <div>
                <dt>Records that would be stored</dt>
                <dd>{result.records}</dd>
              </div>
              <div>
                <dt>Date range</dt>
                <dd>
                  {result.dateRange
                    ? result.dateRange.from + " to " + result.dateRange.to
                    : "None"}
                </dd>
              </div>
              <div>
                <dt>Sample statuses</dt>
                <dd>{result.sampleStatuses.join(", ") || "None"}</dd>
              </div>
              <div>
                <dt>Discrepancies by rule</dt>
                <dd>
                  {Object.entries(result.findingsByRule)
                    .map(([rule, count]) => rule + " " + count)
                    .join(", ")}
                </dd>
              </div>
            </dl>
            {!!result.warnings.length && (
              <ul className="warnings">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Section>
  );
}
