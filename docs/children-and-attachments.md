# Child Records and Attachments

Framekit models repeating rows as transactionally owned parts of a parent document and stores attachment bytes behind an explicit storage port.

```ts
defineDocType({
  name: "order",
  label: "Order",
  fields: [
    {
      name: "lines",
      label: "Lines",
      type: "children",
      fields: [
        { name: "sku", label: "SKU", type: "text", required: true },
        { name: "quantity", label: "Quantity", type: "number", required: true }
      ]
    },
    { name: "files", label: "Files", type: "attachments" }
  ]
});
```

## Child semantics

- A child row is `{ id, position, data }`. The runtime owns IDs and rewrites positions to the submitted array order.
- Updates replace the complete child collection. Existing IDs may be reordered or edited; foreign and duplicate IDs fail validation.
- Child coercion, required checks, and link validation run before the parent mutation. The parent document, child rows, audit event, and outbox event therefore commit or roll back together in memory and PostgreSQL.
- Children are stored inside the parent JSONB document. They cannot be indexed as top-level fields or exist independently of the parent.

## Attachment lifecycle

`AttachmentStorage` owns bytes through `put`, `get`, `delete`, and `list`, plus durable leases and atomic age-and-lease-guarded deletion; the parent document stores `{ id, name, contentType, size, sha256, storageKey, createdAt, createdBy }`. Downloads verify both byte length and SHA-256 before returning data. The default in-memory adapter is for tests and development. Production deployments must provide a durable object-storage adapter.

Upload and delete require the parent DocType's update permission and write row policy, checked before storage changes. Download requires read access to the parent. Direct CRUD writes to attachment metadata are rejected. Metadata mutations use the initially authorized document revision as their compare-and-swap boundary. Upload removes bytes if that mutation loses a race. Delete first persists a retryable `pendingDelete` marker, then deletes bytes, then removes metadata; a crash or storage failure leaves durable repair state for the same request to resume. Idempotency keys replay stable upload receipts and successful deletes even after later document revisions.

Storage keys are isolated by encoded tenant and app namespaces. Cleanup scans effective tenant schemas (including custom attachment fields), bypasses row-policy filtering only through the repository maintenance port, and asks storage to atomically remove only unreferenced objects older than 60 seconds and without an active durable lease. Adapters without atomic conditional deletion fail safe and cannot delete cleanup candidates. Storage-owned creation time, conditional deletion, and upload leases close cross-runtime scan/delete races.

The JSON HTTP API uses base64 byte payloads:

- `POST /api/doctypes/{doctype}/{id}/attachments/{field}`
- `GET|DELETE /api/doctypes/{doctype}/{id}/attachments/{field}/{attachmentId}`
- `POST /api/attachments/cleanup`

The SDK exposes the same upload/download/delete/cleanup operations. OpenAPI emits managed attachment metadata only in record output; create and patch schemas cannot forge it. Desk provides ordered row controls and draft-only attachment upload/delete controls.

## Compatibility and migration

Adding an optional child or attachment field is additive. Removing a collection, making it required, or changing a child schema requires an operator-reviewed major metadata change. The planner emits `change_collection_schema` as destructive because existing JSONB rows may require validation or backfill. Apply and rollback fail closed with `UNSUPPORTED_MIGRATION_CONVERSION` until an executable, reviewed validation/backfill artifact is supported. Attachment storage keys and byte retention must remain compatible for at least the document retention window during adapter migrations.
