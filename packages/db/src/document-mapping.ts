import type { DocumentRecord } from "@framekit/core";
import { FramekitError } from "@framekit/core";
import type { framekitDocuments } from "./schema.js";

export function rowToRecord(row: typeof framekitDocuments.$inferSelect): DocumentRecord {
  return {
    tenantId: row.tenantId, doctype: row.doctype, id: row.id, revision: row.revision,
    documentStatus: row.documentStatus, ownerId: row.ownerId ?? undefined, state: row.state ?? undefined,
    data: row.data, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
  };
}

export function postgresRevisionConflict(doctype: string, id: string, expectedRevision: number, actualRevision: number): FramekitError {
  return new FramekitError("REVISION_CONFLICT", `${doctype} "${id}" changed since it was read`, 409, {
    doctype, id, expectedRevision, actualRevision
  });
}
