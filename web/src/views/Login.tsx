import { useState, type FormEvent } from "react";
import { ArrowRight, Layers3, Moon, Sun } from "lucide-react";
import { api, message } from "../api";
import { ErrorNotice, Loading } from "../components/ui";

export function Login({
  onLogin,
  dark,
  toggle,
}: {
  onLogin: () => void;
  dark: boolean;
  toggle: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/login", "POST", { password });
      onLogin();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-screen">
      <button
        className="icon-button login-theme"
        onClick={toggle}
        aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      >
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <form className="login-card" onSubmit={submit}>
        <div className="brand-icon">
          <Layers3 size={25} />
        </div>
        <h1>Team Dashboard</h1>
        <p>Sign in to view schedules, attendance and roster activity.</p>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <button className="primary" disabled={busy}>
          {busy ? "Signing in…" : error ? "Retry sign in" : "Sign in"}
          <ArrowRight size={17} />
        </button>
        {busy && <Loading />}
      </form>
    </main>
  );
}
