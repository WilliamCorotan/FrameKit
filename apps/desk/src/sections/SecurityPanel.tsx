import { useEffect, useState } from "react";
import { errorMessage, fetchJson } from "../transport/client";

type MfaStatus = { enabled: boolean; pending: boolean; recoveryCodes: number };
export function SecurityPanel({ signOut }: { signOut: () => Promise<void> }) {
  const [mfa, setMfa] = useState<MfaStatus>();
  const [secret, setSecret] = useState<string>();
  const [code, setCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>();
  const [message, setMessage] = useState("Loading security settings…");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    void fetchJson<MfaStatus>("/api/auth/mfa/status").then((value) => {
      if (mounted) { setMfa(value); setMessage(""); }
    }).catch((error) => { if (mounted) setMessage(errorMessage(error)); });
    return () => { mounted = false; };
  }, []);
  async function begin() {
    if (busy) return;
    setBusy(true);
    try {
      const enrollment = await fetchJson<{ secret: string }>("/api/auth/mfa/enroll", { method: "POST" });
      setSecret(enrollment.secret);
      setCode("");
      setMessage("Add this setup key to your authenticator, then enter its six-digit code.");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      if (mfa?.enabled) {
        await fetchJson("/api/auth/mfa/disable", { method: "POST", body: { code, recoveryCode: useRecoveryCode } });
        await signOut();
      } else {
        const result = await fetchJson<{ recoveryCodes: string[] }>("/api/auth/mfa/confirm", { method: "POST", body: { code } });
        setSecret(undefined);
        setCode("");
        setRecoveryCodes(result.recoveryCodes);
        setMessage("Save these recovery codes somewhere secure. Each works once and they will not be shown again.");
      }
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section className="detail-panel" aria-labelledby="security-title">
    <h1 id="security-title">Account security</h1>
    {recoveryCodes ? <>
      <h2>Save your recovery codes</h2>
      <ul>{recoveryCodes.map((value) => <li key={value}><code>{value}</code></li>)}</ul>
      <button onClick={() => { setRecoveryCodes(undefined); void signOut(); }}>I saved my codes — sign in again</button>
    </> : <>
      <p>{mfa?.enabled ? `Multi-factor authentication is enabled. ${mfa.recoveryCodes} recovery codes remain.` : "Protect your account with an authenticator app."}</p>
      {mfa && !mfa.enabled && !secret ? <button onClick={() => void begin()} disabled={busy}>Set up authenticator</button> : null}
      {secret ? <p>Setup key: <code>{secret}</code></p> : null}
      {secret || mfa?.enabled ? <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className="field"><span>{useRecoveryCode ? "Recovery code" : "Authenticator code"}</span><input autoComplete="one-time-code" inputMode={useRecoveryCode ? "text" : "numeric"} pattern={useRecoveryCode ? undefined : "[0-9]{6}"} required value={code} onChange={(event) => setCode(event.target.value)} /></label>
        {mfa?.enabled ? <label className="field"><span>Use an unused recovery code</span><input type="checkbox" checked={useRecoveryCode} onChange={(event) => { setUseRecoveryCode(event.target.checked); setCode(""); }} /></label> : null}
        <button type="submit" disabled={busy}>{mfa?.enabled ? "Disable authenticator" : "Confirm authenticator"}</button>
      </form> : null}
    </>}
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
