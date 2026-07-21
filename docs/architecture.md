# Framekit Architecture

Framekit follows the Dependency Rule: source dependencies point inward.

## Layers

1. Core metadata: DocTypes, modules, app definitions, permission and workflow contracts.
2. Runtime use cases: document commands, validation, hooks, workflows, audit events.
3. Ports: repository, auth context, queue, event bus, file storage.
4. Adapters: Nitro/H3, Postgres, BullMQ, React Desk, provider deployment outputs.

`@framekit/core` and `@framekit/runtime` do not import Nitro, React, Drizzle, BullMQ, or Redis. Those packages are replaceable details.

## Frappe-Inspired Concepts

- DocType: metadata definition for a business document.
- Module: package of DocTypes, permissions, hooks, jobs, workflows, navigation, and settings.
- Desk: generated admin UI powered by metadata.
- Hooks: lifecycle extension points around document commands.
- Workflows: controlled status transitions per DocType.
- Permissions: role and permission checks evaluated before commands.

Metadata invariants, business-document status, lifecycle ordering, and version guarantees are specified in [Metadata and Document Compatibility](./metadata-compatibility.md).
Ownership, policy composition, and adapter enforcement are specified in [Ownership and Row Permissions](./row-permissions.md).
Locale fallback, translation keys, typed setting scopes, and secret-storage boundaries are specified in [Localization and Typed Settings](./localization-settings.md).

## Hostability

Nitro is the default server engine because it builds for Node, serverless, and edge-oriented targets. Framekit still exposes a fetch-compatible boundary through the Nitro adapter and keeps business behavior in framework services.
