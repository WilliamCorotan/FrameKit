import { defineApp, defineDocType, defineModule } from "@framekit/core";

export const customerDocType = defineDocType({
  name: "customer",
  label: "Customer",
  description: "Companies and people you sell to.",
  naming: { field: "name" },
  fields: [
    { name: "name", label: "Name", type: "text", required: true, inList: true },
    { name: "status", label: "Status", type: "select", options: ["active", "paused"], default: "active", inList: true },
    { name: "owner", label: "Owner", type: "text", default: "Sales", inList: true },
    { name: "annual_revenue", label: "Annual Revenue", type: "currency", default: "0.00", inList: true },
    { name: "notes", label: "Notes", type: "long_text" }
  ],
  permissions: [
    { action: "create", permissions: ["crm.customer.write"] },
    { action: "read", permissions: ["crm.customer.read"] },
    { action: "update", permissions: ["crm.customer.write"] },
    { action: "delete", roles: ["administrator"] }
  ]
});

export const contactDocType = defineDocType({
  name: "contact",
  label: "Contact",
  description: "People attached to customers.",
  fields: [
    { name: "full_name", label: "Full Name", type: "text", required: true, inList: true },
    { name: "email", label: "Email", type: "text", inList: true },
    { name: "customer", label: "Customer", type: "link", linkTo: "customer", inList: true },
    { name: "is_primary", label: "Primary", type: "boolean", default: false, inList: true }
  ],
  permissions: [
    { action: "create", permissions: ["crm.contact.write"] },
    { action: "read", permissions: ["crm.contact.read"] },
    { action: "update", permissions: ["crm.contact.write"] }
  ]
});

export const dealDocType = defineDocType({
  name: "deal",
  label: "Deal",
  description: "Revenue opportunities with a workflow.",
  naming: { prefix: "DEAL", series: true, digits: 5 },
  ownership: { transferPermissions: ["crm.deal.transfer"] },
  fields: [
    { name: "title", label: "Title", type: "text", required: true, inList: true },
    { name: "customer", label: "Customer", type: "link", linkTo: "customer", inList: true },
    { name: "amount", label: "Amount", type: "currency", default: "0.00", inList: true },
    { name: "stage", label: "Stage", type: "select", options: ["open", "qualified", "won", "lost"], default: "open", readOnly: true, inList: true }
  ],
  permissions: [
    { action: "create", permissions: ["crm.deal.write"] },
    { action: "read", permissions: ["crm.deal.read"] },
    { action: "update", permissions: ["crm.deal.write"] },
    { action: "transition", permissions: ["crm.deal.write"] }
  ],
  workflow: {
    field: "stage",
    initialState: "open",
    states: ["open", "qualified", "won", "lost"],
    transitions: [
      { action: "qualify", from: ["open"], to: "qualified", permissions: ["crm.deal.write"] },
      { action: "win", from: ["open", "qualified"], to: "won", permissions: ["crm.deal.write"] },
      { action: "lose", from: ["open", "qualified"], to: "lost", permissions: ["crm.deal.write"] }
    ]
  }
});

export const crmModule = defineModule({
  id: "crm",
  name: "CRM",
  version: "0.1.0",
  description: "A compact sales workspace proving Framekit metadata, CRUD, permissions, and workflows.",
  doctypes: [customerDocType, contactDocType, dealDocType],
  permissions: ["crm.customer.read", "crm.customer.write", "crm.contact.read", "crm.contact.write", "crm.deal.read", "crm.deal.write"],
  navigation: [
    { label: "Customers", path: "/doctype/customer", icon: "building", order: 10 },
    { label: "Contacts", path: "/doctype/contact", icon: "user", order: 20 },
    { label: "Deals", path: "/doctype/deal", icon: "pipeline", order: 30 }
  ],
  hooks: {
    beforeInsert: {
      customer: [({ input }) => {
        if (input && typeof input.name === "string") input.name = input.name.trim();
      }]
    }
  }
});

export const app = defineApp({ name: "Framekit CRM", version: "0.1.0", modules: [crmModule] });
