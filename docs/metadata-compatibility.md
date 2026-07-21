# Metadata and Document Compatibility

Framekit 1.0 treats metadata as a versioned contract shared by core, runtime, persistence, HTTP/OpenAPI, SDK, migrations, and Desk. Metadata is rejected at app definition time when an invariant cannot be represented consistently by those surfaces.

## Accepted 1.0 contract

- DocType and module identifiers are unique. Module dependencies must exist, cannot refer to themselves, and cannot form cycles.
- Select fields require unique options and valid defaults. Link fields require an existing target DocType. JSON fields cannot be unique.
- Indexes, naming fields, views, workflow fields, workflow states, transition endpoints, and hook DocType references must resolve without ambiguity.
- Tenant custom fields are checked against the same field and link invariants before persistence.
- Decimal and currency values are canonical base-10 strings with bounded precision and scale. Computed fields use an acyclic declarative dependency graph, and validators use portable length, range, fixed-pattern, or domain rules. See [Exact decimals, computed fields, and validators](./domain-fields.md).
- Every document starts as `draft`, may be submitted once, and may then be cancelled once: `draft -> submitted -> cancelled`.
- New workflow documents always persist the configured initial value in both lifecycle `state` and `data[workflow.field]`. Callers cannot select another initial value; a workflow-field default is optional, but when present it must equal the workflow initial state.
- Update, delete, and workflow transition commands only accept draft documents. Submitted and cancelled records remain readable but immutable.
- Submit and cancel are permission-checked, revision-aware, idempotency-aware atomic commands. They write the document, audit event, and outbox event together and invoke their lifecycle hooks.
- Mutation ordering is `beforeValidate`, coercion/reference/unique validation, command-specific `before*`, atomic write, then command-specific `after*`. Read-only values already stored on a document cannot be overwritten by update input.
- Existing Postgres rows gain `document_status = 'draft'` during adapter migration.
- `children` fields persist stable-ID, position-normalized rows inside their parent document transaction. `attachments` fields persist authorized metadata in the parent while bytes live behind the attachment storage port.

## Version policy

App and module metadata use semantic versions.

- Patch: documentation or validation fixes that do not intentionally change a valid persisted contract.
- Minor: additive, optional metadata and backward-compatible generated API/schema additions. A migration is required whenever durable storage changes.
- Major: removing or renaming metadata, changing field or lifecycle meaning, tightening a previously documented accepted contract, or changing generated API behavior incompatibly.

The migration planner fingerprint remains the authority for deployed DocType schema drift. Framework-owned storage migrations, such as `document_status`, are applied by the adapter and must preserve legacy data. New readers must tolerate records written by the previous minor version; new writers must not depend on a feature until all participating runtime/adapters support that version. Deprecations remain supported for at least one minor release and are removed only in a major release.

## Additional tracked primitives

The following are deliberately outside the bounded 1.0 metadata slice and have separate acceptance criteria:

| Priority | Primitive | Tracking |
| --- | --- | --- |
| Implemented | Child/repeating records and attachments | [#39](https://github.com/WilliamCorotan/FrameKit/issues/39), [policy](children-and-attachments.md) |
| Implemented | Exact decimals, computed fields, and richer validators | [#40](https://github.com/WilliamCorotan/FrameKit/issues/40), [policy](domain-fields.md) |
| Implemented | Ownership and row-level policies | [#41](https://github.com/WilliamCorotan/FrameKit/issues/41), [policy](row-permissions.md) |
| P2 | Localization and typed settings | [#42](https://github.com/WilliamCorotan/FrameKit/issues/42) |

Each primitive is accepted only when its semantics are consistent across all contract surfaces and covered by adapter-backed tests.
