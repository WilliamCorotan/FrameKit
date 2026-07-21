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

`AttachmentStorage` owns bytes through `put`, `get`, `delete`, and `list`; the parent document stores `{ id, name, contentType, size, storageKey, createdAt, createdBy }`. The default in-memory adapter is for tests and development. Production deployments must provide a durable object-storage adapter.

Upload and delete require the parent DocType's update permission and a draft parent. Download requires read access to the parent. Direct CRUD writes to attachment metadata are rejected. Upload stores bytes first and compensates on metadata failure; parent deletion removes referenced objects after the document commits. Operators with `framekit.attachments.cleanup` (or `*`) can remove tenant-scoped orphan objects.

The JSON HTTP API uses base64 byte payloads:

- `POST /api/doctypes/{doctype}/{id}/attachments/{field}`
- `GET|DELETE /api/doctypes/{doctype}/{id}/attachments/{field}/{attachmentId}`
- `POST /api/attachments/cleanup`

The SDK exposes the same upload/download/delete/cleanup operations. OpenAPI emits managed attachment metadata only in record output; create and patch schemas cannot forge it. Desk provides ordered row controls and draft-only attachment upload/delete controls.

## Compatibility and migration

Adding an optional child or attachment field is additive. Removing a collection, making it required, or changing a child schema requires an operator-reviewed major metadata change. The planner emits `change_collection_schema` as destructive because existing JSONB rows may require validation or backfill; it never attempts an unsafe automatic conversion. Attachment storage keys and byte retention must remain compatible for at least the document retention window during adapter migrations.
