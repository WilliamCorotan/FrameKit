export type CustomerData = {
  name: string;
  status: "active" | "paused";
  owner: string;
  annual_revenue: string;
};

export type CustomerRecord = {
  id: string;
  data: CustomerData;
};

export function formatMoney(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
    : "—";
}
