import type { Accessor } from "solid-js";

type SignInFormProps = {
  email: Accessor<string>;
  password: Accessor<string>;
  signingIn: Accessor<boolean>;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  onSubmit: (event: SubmitEvent) => Promise<void>;
};

export function SignInForm(props: SignInFormProps) {
  return <section class="signin-panel" aria-labelledby="signin-title">
    <div><p class="eyebrow">Account access</p><h2 id="signin-title">Open the<br /><em>ledger</em></h2><p>Use a Framekit account to retrieve protected customer records. Your bearer token stays only in this page’s memory.</p></div>
    <form class="signin-form" onSubmit={props.onSubmit}>
      <label>Email <input required type="email" autocomplete="email" value={props.email()} onInput={(event) => props.setEmail(event.currentTarget.value)} /></label>
      <label>Password <input required type="password" autocomplete="current-password" value={props.password()} onInput={(event) => props.setPassword(event.currentTarget.value)} /></label>
      <button class="submit-button" type="submit" disabled={props.signingIn()}>{props.signingIn() ? "Signing in…" : "Sign in"}</button>
    </form>
  </section>;
}
