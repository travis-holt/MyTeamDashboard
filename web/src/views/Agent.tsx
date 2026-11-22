import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowUpRight, Plus, X } from "lucide-react";
import type {
  AgentProfile,
  Note,
  NoteInput,
} from "../../../server/src/api/dto";
import { api, message, useApi } from "../api";
import {
  CardCell,
  DataTable,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  Pill,
  Section,
  tenure,
} from "../components/ui";

function NoteEditor({
  starting,
  onSave,
  onCancel,
}: {
  starting: NoteInput;
  onSave: (note: NoteInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<NoteInput>(starting);
  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => firstField.current?.focus(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave(draft);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="note-form" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Date
          <input
            type="date"
            ref={firstField}
            value={draft.date}
            required
            onChange={(event) =>
              setDraft({ ...draft, date: event.target.value })
            }
          />
        </label>
        <label>
          Follow-up date
          <input
            type="date"
            value={draft.followUpDate ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, followUpDate: event.target.value || null })
            }
          />
        </label>
      </div>
      {(
        [
          ["whatHappened", "What happened"],
          ["whatWasSaid", "What was said"],
          ["nextStep", "Agreed next step"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <textarea
            value={draft[key]}
            required={key === "whatHappened"}
            onChange={(event) =>
              setDraft({ ...draft, [key]: event.target.value })
            }
          />
        </label>
      ))}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={draft.done}
          onChange={(event) =>
            setDraft({ ...draft, done: event.target.checked })
          }
        />{" "}
        Done
      </label>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="button-row">
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save note"}
        </button>
        <button className="secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
function AgentDetails({
  code,
  today,
  drawer,
}: {
  code: string;
  today: string;
  drawer?: boolean;
}) {
  const data = useApi<AgentProfile>("/agents/" + encodeURIComponent(code));
  const [edit, setEdit] = useState<Note | "new" | null>(null);
  const [error, setError] = useState("");
  if (data.error)
    return <ErrorNotice retry={data.reload}>{data.error}</ErrorNotice>;
  if (!data.data) return <Loading />;
  const { agent, history, next7, fixedOffDays, discrepancies, notes } =
    data.data;
  const blank: NoteInput = {
    date: today || history.at(-1)?.date || "",
    whatHappened: "",
    whatWasSaid: "",
    nextStep: "",
    followUpDate: null,
    done: false,
  };
  const starting: NoteInput =
    edit && edit !== "new"
      ? {
          date: edit.date,
          whatHappened: edit.whatHappened,
          whatWasSaid: edit.whatWasSaid,
          nextStep: edit.nextStep,
          followUpDate: edit.followUpDate,
          done: edit.done,
        }
      : blank;
  async function save(note: NoteInput) {
    if (edit === "new")
      await api("/agents/" + encodeURIComponent(code) + "/notes", "POST", note);
    else if (edit) await api("/notes/" + edit.id, "PATCH", note);
    setEdit(null);
    data.reload();
  }
  async function setDone(note: Note) {
    setError("");
    try {
      await api("/notes/" + note.id, "PATCH", { done: !note.done });
      data.reload();
    } catch (error) {
      setError(message(error));
    }
  }
  return (
    <div className="agent-details">
      <PageHeader
        title={agent.firstName || agent.code}
        description={agent.fullName || undefined}
      >
        {drawer && (
          <Link
            className="secondary"
            to={"/agent/" + encodeURIComponent(code)}
            onClick={() =>
              window.dispatchEvent(new Event("dashboard:close-drawer"))
            }
          >
            Full profile <ArrowUpRight size={15} />
          </Link>
        )}
      </PageHeader>
      <dl className="agent-meta">
        {[
          ["Code", agent.code],
          ["Account", agent.account],
          ["DTL", agent.dtl],
          ["Team Leader", agent.tl],
          ["Hire date", agent.hireDate],
          ["Tenure", tenure(agent.hireDate, today || history.at(-1)!.date)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || "—"}</dd>
          </div>
        ))}
      </dl>
      <Section
        title="Next 7 days"
        action={
          fixedOffDays.length ? (
            <span className="muted">
              Fixed off days · {fixedOffDays.join(", ")}
            </span>
          ) : undefined
        }
      >
        {next7.length ? (
          <div className="day-grid">
            {next7.map((day) => (
              <div key={day.date}>
                <time>{day.date.slice(5)}</time>
                <Pill status={day.status} shift={day.shiftStart} />
              </div>
            ))}
          </div>
        ) : (
          <Empty>No upcoming schedule.</Empty>
        )}
      </Section>
      <Section title="35-day history">
        {history.some((day) => day.schedule || day.attendance) ? (
          <div className="day-grid history">
            {history.map((day) => (
              <div key={day.date}>
                <time dateTime={day.date}>{day.date.slice(5)}</time>
                {day.schedule ? (
                  <Pill
                    status={day.schedule.status}
                    shift={day.schedule.shiftStart}
                  />
                ) : (
                  <small>—</small>
                )}
                {day.attendance && <Pill status={day.attendance.status} />}
              </div>
            ))}
          </div>
        ) : (
          <Empty>No schedule or attendance history.</Empty>
        )}
      </Section>
      <Section title="Discrepancies">
        {discrepancies.length ? (
          <ul className="compact-list">
            {discrepancies.map((row) => (
              <li key={row.id}>
                <strong>{row.missing}</strong>
                <small>
                  {row.date} · {row.ruleId} · {row.state}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No discrepancies recorded.</Empty>
        )}
      </Section>
      <Section
        title="Notes log"
        action={
          <button className="secondary" onClick={() => setEdit("new")}>
            <Plus size={15} /> Add note
          </button>
        }
      >
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {edit && (
          <NoteEditor
            key={edit === "new" ? "new" : edit.id}
            starting={starting}
            onSave={save}
            onCancel={() => setEdit(null)}
          />
        )}
        {notes.length ? (
          <DataTable label="Notes" cards>
            <thead>
              <tr>
                <th>Date</th>
                <th>What happened</th>
                <th>What was said</th>
                <th>Agreed next step</th>
                <th>Follow-up date</th>
                <th>Done</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {notes.map((note) => (
                <tr role="row" key={note.id}>
                  <CardCell label="Date" className="nowrap">
                    {note.date}
                  </CardCell>
                  <CardCell label="What happened">{note.whatHappened}</CardCell>
                  <CardCell label="What was said">
                    {note.whatWasSaid || "—"}
                  </CardCell>
                  <CardCell label="Agreed next step">
                    {note.nextStep || "—"}
                  </CardCell>
                  <CardCell label="Follow-up date" className="nowrap">
                    {note.followUpDate ?? "—"}
                  </CardCell>
                  <CardCell label="Done">
                    <input
                      type="checkbox"
                      aria-label={"Mark note " + (note.done ? "open" : "done")}
                      checked={note.done}
                      onChange={() => void setDone(note)}
                    />
                  </CardCell>
                  <CardCell label="Actions">
                    <button
                      className="text-button"
                      onClick={() => setEdit(note)}
                    >
                      Edit
                    </button>
                  </CardCell>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          !edit && <Empty>No notes for this agent.</Empty>
        )}
      </Section>
    </div>
  );
}
export function Agent({
  code,
  today,
  close,
}: {
  code?: string;
  today: string;
  close?: () => void;
}) {
  const params = useParams();
  const id = code ?? params.code ?? "";
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!close || !dialog.current) return;
    const element = dialog.current;
    const trigger = document.activeElement;
    element.showModal();
    window.addEventListener("dashboard:close-drawer", close);
    return () => {
      element.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
      window.removeEventListener("dashboard:close-drawer", close);
    };
  }, [close]);
  if (!close) return <AgentDetails key={id} code={id} today={today} />;
  return (
    <dialog
      ref={dialog}
      className="drawer"
      aria-label="Agent profile"
      onCancel={close}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <div className="drawer-inner">
        <button
          className="icon-button drawer-close"
          onClick={close}
          aria-label="Close agent profile"
        >
          <X size={20} />
        </button>
        <AgentDetails code={id} today={today} drawer />
      </div>
    </dialog>
  );
}
