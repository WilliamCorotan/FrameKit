export type CustomerData = {
  name?: string;
  status?: "active" | "paused" | string;
  owner?: string;
  annual_revenue?: string | number;
};

export type Customer = { id: string; revision: number; data: CustomerData };
export type CustomerForm = { name: string; status: "active" | "paused"; owner: string; annual_revenue: string };
export type LedgerMeta = { name?: string; modules?: Array<{ doctypes?: unknown[] }> };

export const emptyCustomerForm: CustomerForm = { name: "", status: "active", owner: "Sales", annual_revenue: "0.00" };

export function formatRevenue(value: CustomerData["annual_revenue"]): string {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number)
    : "—";
}
