export type Customer = {
  name?: string;
  status?: string;
  owner?: string;
  annual_revenue?: string;
};

export type CustomerFormValues = Required<Customer>;
export type CustomerRecord = { id: string; data: Customer };

export const initialCustomerForm = (): CustomerFormValues => ({
  name: "",
  status: "active",
  owner: "",
  annual_revenue: "0.00"
});

export function formatRevenue(value: string | undefined): string {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
    : "—";
}
