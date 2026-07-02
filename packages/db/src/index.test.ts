import { describe, expect, it } from "vitest";
import { createAuditTableSql, createCustomFieldTableSql, createDocumentTableSql, createNamingSeriesTableSql, createOutboxTableSql, createUserTableSql, createViewTableSql } from "./index.js";

describe("db migration sql", () => {
  it("defines document and user tables", () => {
    expect(createDocumentTableSql()).toContain("framekit_documents");
    expect(createUserTableSql()).toContain("framekit_users");
    expect(createUserTableSql()).toContain("password_hash");
    expect(createAuditTableSql()).toContain("framekit_audit_events");
    expect(createOutboxTableSql()).toContain("framekit_outbox_events");
    expect(createCustomFieldTableSql()).toContain("framekit_custom_fields");
    expect(createViewTableSql()).toContain("framekit_views");
    expect(createNamingSeriesTableSql()).toContain("framekit_naming_series");
  });
});
