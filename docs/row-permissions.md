# Ownership and Row Permissions

Framekit can assign immutable document ownership and enforce declarative row policies in memory and in PostgreSQL.

```ts
defineDocType({
  name: "private_note",
  label: "Private Note",
  ownership: { transferPermissions: ["notes.transfer"] },
  rowPolicy: {
    read: [{ owner: "self" }, { owner: "any", roles: ["manager"] }],
    write: [{ owner: "self" }, { owner: "any", permissions: ["notes.manage"] }]
  },
  fields: [{ name: "title", label: "Title", type: "text" }]
});
```

Rules compose as follows:

- DocType operation permissions are checked first; row policy is an additional boundary.
- Rules within `read` or `write` are OR alternatives.
- Within one rule, its role and permission requirements are both required. An empty role or permission list does not constrain that dimension.
- `owner: "self"` matches the authenticated `tenant.userId`; `owner: "any"` does not constrain ownership.
- A wildcard role or permission grants administrator scope.
- A DocType using a `self` rule must enable `ownership`.

The authenticated creator is always assigned as `ownerId`. Create/update input cannot set it. Ownership changes use only `transferOwner`, require a configured transfer role/permission (or wildcard administrator), and participate in optimistic revision, idempotency, audit, outbox, and atomic mutation behavior.

Ownership transfer has dedicated `beforeOwnerTransfer` and `afterOwnerTransfer` notification hooks. Each hook receives an isolated snapshot: mutations are ignored, while a thrown error aborts the transfer. The persisted repository result is the single source for the API response, audit/outbox payloads, and idempotency replay; generic update hooks cannot alter transfer data, status, state, or revision.

A caller holding transfer permission does not implicitly gain read permission. `transferOwner` therefore returns only `{ id, ownerId, revision, updatedAt }`. Its outbox and realtime events add only the DocType name to that receipt and never include document data, status, state, or the previous owner. A Desk or service that also has read permission may fetch the document separately after transfer.

Denied rows are indistinguishable from absent rows (`DOCUMENT_NOT_FOUND`). Lists filter before pagination. Link validation uses the caller's read policy, so hidden targets cannot be referenced. Uniqueness remains tenant-wide and is enforced by the durable reservation table without returning the conflicting document id.

PostgreSQL compiles the effective rule set to `true`, `false`, or a parameterized `owner_id = userId` predicate. The predicate is included in list/get SQL and in update/delete unit-of-work statements; filtering is never performed after sensitive rows are fetched.

## Compatibility and migration

Adding ownership or tightening a row policy changes authorization behavior and requires a major metadata version. The adapter migration adds nullable `owner_id` for legacy compatibility. Before enabling a self-owner policy on an existing DocType, operators must backfill every existing row with a valid tenant-local user id; unowned legacy rows intentionally match no self rule. Additive manager rules may be introduced in a minor version. Removing or narrowing a rule is a major change.
