import type { LedgerMeta } from "../domain/customer";

export function MarginNote({ meta }: { meta?: LedgerMeta }) {
  const doctypeCount = meta?.modules?.flatMap((module) => module.doctypes ?? []).length ?? 0;

  return <aside className="margin-note enter delay-1">
    <p>Register companies, record stewardship, and keep a small, legible account of the work ahead.</p>
    <dl>
      <div><dt>Tenant</dt><dd>default</dd></div>
      <div><dt>Doctype</dt><dd>customer</dd></div>
      <div><dt>Schema</dt><dd>{doctypeCount || "—"} entries</dd></div>
    </dl>
  </aside>;
}
