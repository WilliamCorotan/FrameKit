import type { DocTypeDefinition, DocumentAction, PermissionRule, RowPolicyRule, TenantContext, WorkflowTransition } from "./schema.js";
import { FramekitError } from "./errors.js";

export function hasAccess(context: TenantContext, rule: PermissionRule | WorkflowTransition | RowPolicyRule): boolean {
  const roleAllowed = context.roles.includes("*") || rule.roles.length === 0 || rule.roles.some((role) => context.roles.includes(role));
  const permissionAllowed = context.permissions.includes("*") || rule.permissions.length === 0 || rule.permissions.some((permission) => context.permissions.includes(permission));
  return roleAllowed && permissionAllowed;
}

export type RowPolicyScope = "all" | "self" | "none";

export function rowPolicyScope(context: TenantContext, doctype: DocTypeDefinition, operation: "read" | "write"): RowPolicyScope {
  if (!doctype.rowPolicy || context.roles.includes("*") || context.permissions.includes("*")) return "all";
  const matched = doctype.rowPolicy[operation].filter((rule) => hasAccess(context, rule));
  if (matched.some((rule) => rule.owner === "any")) return "all";
  return matched.some((rule) => rule.owner === "self") ? "self" : "none";
}

export function hasRowAccess(context: TenantContext, doctype: DocTypeDefinition, operation: "read" | "write", ownerId?: string): boolean {
  const scope = rowPolicyScope(context, doctype, operation);
  return scope === "all" || (scope === "self" && ownerId === context.userId);
}

export function canTransferOwnership(context: TenantContext, doctype: DocTypeDefinition): boolean {
  if (!doctype.ownership) return false;
  if (context.roles.includes("*") || context.permissions.includes("*")) return true;
  const rule = { owner: "any" as const, roles: doctype.ownership.transferRoles, permissions: doctype.ownership.transferPermissions };
  return rule.roles.length + rule.permissions.length > 0 && hasAccess(context, rule);
}

export function assertPermission(context: TenantContext, doctype: DocTypeDefinition, action: DocumentAction): void {
  const rules = doctype.permissions.filter((rule) => rule.action === action);
  if (rules.length === 0) {
    return;
  }
  if (!rules.some((rule) => hasAccess(context, rule))) {
    throw new FramekitError("FORBIDDEN", `Missing permission to ${action} ${doctype.name}`, 403);
  }
}


