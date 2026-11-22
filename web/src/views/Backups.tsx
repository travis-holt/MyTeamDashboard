import { useState } from "react";
import type { BackupPreview } from "../../../server/src/backup/data";
import { api, message } from "../api";
import { ErrorNotice, Section } from "../components/ui";

const sections = {
  notes: "Notes",
  rosterSnapshots: "Roster snapshots",
  rosterEvents: "Roster events",
  discrepancies: "Discrepancy records",
} as const;

export function Backups() {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<BackupPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);

  async function run(upload: File, confirmation?: BackupPreview) {
    setBusy(true);
    setError("");
    setRestored(false);
    try {
      if (confirmation) {
        await api(
          "/backup/restore?token=" + confirmation.token,
          "POST",
          upload,
        );
        setRestored(true);
      } else {
        setPreview(await api<BackupPreview>("/backup/preview", "POST", upload));
      }
    } catch (error) {
      setError(message(error));
    } finally {
      if (confirmation) setPreview(undefined);
      setBusy(false);
    }
  }

  return (
    <Section title="Backups">
      <div className="panel-body source-details">
        <div>
          <a href="/api/backup" download>
            Download backup
          </a>
        </div>
        <label>
          Restore from backup
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => {
              setFile(event.currentTarget.files?.[0]);
              setPreview(undefined);
              setError("");
              setRestored(false);
            }}
          />
        </label>
        {file && !preview && (
          <div className="button-row">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run(file)}
            >
              {busy ? "Reading backup…" : "Preview restore"}
            </button>
          </div>
        )}
        {file && preview && (
          <div>
            <p>
              Backup created {new Date(preview.createdAt).toLocaleString()}.
            </p>
            <p>
              Confirming replaces notes and roster history and reapplies the
              saved discrepancy states and TL comments.
            </p>
            <ul>
              {(Object.keys(sections) as (keyof typeof sections)[]).map(
                (section) => {
                  const { added, updated, removed } = preview.changes[section];
                  return (
                    <li key={section}>
                      {sections[section]} · {added} added, {updated} updated,{" "}
                      {removed} removed
                    </li>
                  );
                },
              )}
            </ul>
            <div className="button-row">
              <button
                className="primary"
                disabled={busy}
                onClick={() => void run(file, preview)}
              >
                {busy ? "Restoring…" : "Confirm restore"}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setPreview(undefined)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {restored && <p role="status">Backup restored.</p>}
        {error && <ErrorNotice>{error}</ErrorNotice>}
      </div>
    </Section>
  );
}
