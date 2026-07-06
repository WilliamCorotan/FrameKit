import { describe, expect, it } from "vitest";
import {
  createApiTokenTableSql,
  createAuditTableSql,
  createCustomFieldTableSql,
  createDocumentTableSql,
  createMigrationTableSql,
  createNamingSeriesTableSql,
  createOutboxTableSql,
  createRoleTableSql,
  createSessionRevocationTableSql,
  createUserTableSql,
  createViewTableSql
} from "./index.js";

describe("db migration sql", () => {
  it("defines document and user tables", () => {
    expect(createDocumentTableSql()).toContain("framekit_documents");
    expect(createUserTableSql()).toContain("framekit_users");
    expect(createUserTableSql()).toContain("password_hash");
    expect(createUserTableSql()).toContain("disabled_at");
    expect(createUserTableSql()).toContain("failed_login_attempts");
    expect(createRoleTableSql()).toContain("framekit_roles");
    expect(createApiTokenTableSql()).toContain("framekit_api_tokens");
    expect(createApiTokenTableSql()).toContain("token_hash");
    expect(createSessionRevocationTableSql()).toContain("framekit_session_revocations");
    expect(createSessionRevocationTableSql()).toContain("session_id");
    expect(createAuditTableSql()).toContain("framekit_audit_events");
    expect(createOutboxTableSql()).toContain("framekit_outbox_events");
    expect(createCustomFieldTableSql()).toContain("framekit_custom_fields");
    expect(createViewTableSql()).toContain("framekit_views");
    expect(createNamingSeriesTableSql()).toContain("framekit_naming_series");
    expect(createMigrationTableSql()).toContain("framekit_migrations");
    expect(createMigrationTableSql()).toContain("checksum");
  });
});
