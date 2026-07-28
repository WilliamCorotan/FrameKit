export type CustomerData = {
  name: string;
  status: "active" | "paused";
  owner: string;
  annual_revenue: string;
};

export type CustomerRecord = { id: string; data: CustomerData };

export function metadataDocTypeCount(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  const modules = (metadata as { modules?: unknown }).modules;
  if (!Array.isArray(modules)) return 0;
  return modules.reduce((count, module) => {
    if (!module || typeof module !== "object") return count;
    const doctypes = (module as { doctypes?: unknown }).doctypes;
    return count + (Array.isArray(doctypes) ? doctypes.length : 0);
  }, 0);
}

export function formatMoney(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount)
    : value;
}
