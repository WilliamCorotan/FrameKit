export type CustomerFields = {
  name: string;
  status: "active" | "paused";
  owner: string;
  annual_revenue: string;
};

export type CustomerRecord = { id: string; data: CustomerFields };
export type MetaSummary = { name?: string; version?: string; modules?: Array<{ doctypes?: unknown[] }> };

export function createCustomerFields(): CustomerFields {
  return { name: "", status: "active", owner: "Sales", annual_revenue: "0.00" };
}

export function currency(value: string) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number)
    : value;
}
