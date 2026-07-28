export function ErrorNotice({ detail }: { detail: string }) {
  return <div className="error-notice" role="alert"><strong>Request recorded as incomplete.</strong><span>{detail}</span></div>;
}
