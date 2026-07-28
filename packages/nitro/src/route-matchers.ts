import { FramekitError } from "@framekit/core";

/** Route matching is isolated from handler policy and runtime operations. */
export function matchDocumentPath(path: string, basePath: string): { doctype: string; id?: string; operation?: string } | undefined {
  const prefix = `${basePath}/doctypes/`;
  if (!path.startsWith(prefix)) return undefined;
  const segments = path.slice(prefix.length).split("/").filter(Boolean).map(decodePathSegment);
  if (segments.length === 1) return { doctype: segments[0]! };
  if (segments.length === 2) return { doctype: segments[0]!, id: segments[1]! };
  if (segments.length === 3 && ["transition", "submit", "cancel", "owner"].includes(segments[2]!)) return { doctype: segments[0]!, id: segments[1]!, operation: segments[2]! };
  return undefined;
}

export function matchCommandPath(path: string, basePath: string): string | undefined {
  const prefix = `${basePath}/commands/`;
  return path.startsWith(prefix) && path.slice(prefix.length).split("/").length === 1 ? decodePathSegment(path.slice(prefix.length)) : undefined;
}

export function matchAttachmentPath(path: string, basePath: string): { doctype: string; id: string; field: string; attachmentId?: string } | undefined {
  const prefix = `${basePath}/doctypes/`;
  if (!path.startsWith(prefix)) return undefined;
  const encoded = path.slice(prefix.length).split("/");
  if ((encoded.length !== 4 && encoded.length !== 5) || encoded.some((part) => !part)) return undefined;
  const [doctype, id, resource, field, attachmentId] = encoded.map(decodePathSegment);
  if (resource === "attachments") return { doctype: doctype!, id: id!, field: field!, ...(attachmentId ? { attachmentId } : {}) };
  return undefined;
}

export function matchOutboxPath(path: string, basePath: string): { id: string; action: "dispatch" | "fail" } | undefined {
  const prefix = `${basePath}/outbox/`;
  if (!path.startsWith(prefix)) return undefined;
  const parts = path.slice(prefix.length).split("/").filter(Boolean).map(decodePathSegment);
  return parts.length === 2 && (parts[1] === "dispatch" || parts[1] === "fail") ? { id: parts[0]!, action: parts[1] } : undefined;
}

export function matchAuthManagementPath(path: string, basePath: string): { resource: "users" | "roles" | "tokens"; id?: string } | undefined {
  const prefix = `${basePath}/auth/`;
  if (!path.startsWith(prefix)) return undefined;
  const parts = path.slice(prefix.length).split("/").filter(Boolean).map(decodePathSegment);
  return (parts.length === 1 || parts.length === 2) && (parts[0] === "users" || parts[0] === "roles" || parts[0] === "tokens") ? { resource: parts[0], id: parts[1] } : undefined;
}

export function matchProviderLoginPath(path: string, basePath: string): { providerId: string } | undefined {
  const match = new RegExp(`^${escapeRegExp(basePath)}/auth/providers/([^/]+)/login$`).exec(path);
  return match ? { providerId: decodePathSegment(match[1]!) } : undefined;
}

export function matchProviderAuthorizationPath(path: string, basePath: string): { providerId: string; action: "authorize" | "callback" } | undefined {
  const match = new RegExp(`^${escapeRegExp(basePath)}/auth/providers/([^/]+)/(authorize|callback)$`).exec(path);
  return match ? { providerId: decodePathSegment(match[1]!), action: match[2]! as "authorize" | "callback" } : undefined;
}

export function matchUserPasswordPath(path: string, basePath: string): { userId: string } | undefined {
  const match = new RegExp(`^${escapeRegExp(basePath)}/auth/users/([^/]+)/password$`).exec(path);
  return match ? { userId: decodePathSegment(match[1]!) } : undefined;
}

export function matchUserRecoveryPath(path: string, basePath: string): { userId: string } | undefined {
  const match = new RegExp(`^${escapeRegExp(basePath)}/auth/users/([^/]+)/recovery$`).exec(path);
  return match ? { userId: decodePathSegment(match[1]!) } : undefined;
}

function decodePathSegment(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.includes("\0")) throw new Error("invalid segment");
    return decoded;
  } catch {
    throw new FramekitError("INVALID_PATH", "Request path contains a malformed identifier.", 400);
  }
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
