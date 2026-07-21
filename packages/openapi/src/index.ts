import { listDocTypes, type AppDefinition, type DocTypeDefinition, type FieldDefinition } from "@framekit/core";

export type OpenApiOptions = {
  basePath?: string;
  serverUrl?: string;
};

type JsonSchema = {
  type?: string | string[];
  format?: string;
  enum?: string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  description?: string;
  minimum?: number;
};

type Operation = {
  operationId: string;
  summary: string;
  tags: string[];
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
  security?: Array<Record<string, never[]>>;
  "x-framekit-permission"?: string;
};

export function createOpenApiDocument(app: AppDefinition, options: OpenApiOptions = {}) {
  const basePath = options.basePath ?? "/api";
  const schemas: Record<string, JsonSchema> = {
    FramekitError: {
      type: "object",
      required: ["error", "code", "message"],
      properties: {
        error: { type: "boolean" },
        code: { type: "string" },
        message: { type: "string" },
        details: {}
      }
    },
    FramekitMetadata: {
      type: "object",
      required: ["name", "version", "modules"],
      properties: {
        name: { type: "string" },
        version: { type: "string" },
        modules: { type: "array", items: { type: "object", additionalProperties: true } }
      }
    },
    FramekitDiagnostics: {
      type: "object",
      required: ["app", "repository", "mutations", "modules", "doctypes"],
      properties: {
        app: { type: "object", additionalProperties: true },
        repository: { type: "object", additionalProperties: true },
        mutations: { type: "object", additionalProperties: true },
        modules: { type: "array", items: { type: "object", additionalProperties: true } },
        doctypes: { type: "array", items: { type: "object", additionalProperties: true } },
        warnings: { type: "array", items: { type: "string" } }
      }
    },
    AuthUser: {
      type: "object",
      required: ["id", "tenantId", "email", "name", "roles", "permissions"],
      properties: {
        id: { type: "string" },
        tenantId: { type: "string" },
        email: { type: "string", format: "email" },
        name: { type: "string" },
        roles: { type: "array", items: { type: "string" } },
        permissions: { type: "array", items: { type: "string" } },
        disabledAt: { type: "string", format: "date-time" },
        lockedUntil: { type: "string", format: "date-time" }
      }
    },
    AuthRole: {
      type: "object",
      required: ["tenantId", "id", "name", "permissions"],
      properties: {
        tenantId: { type: "string" },
        id: { type: "string" },
        name: { type: "string" },
        permissions: { type: "array", items: { type: "string" } },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" }
      }
    },
    ApiToken: {
      type: "object",
      required: ["tenantId", "id", "name", "roles", "permissions", "createdAt"],
      properties: {
        tenantId: { type: "string" },
        id: { type: "string" },
        name: { type: "string" },
        userId: { type: "string" },
        roles: { type: "array", items: { type: "string" } },
        permissions: { type: "array", items: { type: "string" } },
        createdAt: { type: "string", format: "date-time" },
        expiresAt: { type: "string", format: "date-time" },
        revokedAt: { type: "string", format: "date-time" }
      }
    },
    CreatedApiToken: {
      type: "object",
      required: ["tenantId", "id", "name", "roles", "permissions", "createdAt", "token"],
      properties: {
        tenantId: { type: "string" },
        id: { type: "string" },
        name: { type: "string" },
        userId: { type: "string" },
        roles: { type: "array", items: { type: "string" } },
        permissions: { type: "array", items: { type: "string" } },
        createdAt: { type: "string", format: "date-time" },
        expiresAt: { type: "string", format: "date-time" },
        token: { type: "string" }
      }
    },
    AuthSession: {
      type: "object",
      required: ["token", "sessionId", "user", "context", "expiresAt"],
      properties: {
        token: { type: "string" },
        sessionId: { type: "string" },
        user: { type: "object", additionalProperties: true },
        context: { type: "object", additionalProperties: true },
        expiresAt: { type: "string", format: "date-time" }
      }
    },
    AuthAuditEvent: {
      type: "object",
      required: ["id", "tenantId", "action", "success", "createdAt"],
      properties: {
        id: { type: "string" },
        tenantId: { type: "string" },
        actorUserId: { type: "string" },
        targetUserId: { type: "string" },
        action: { type: "string" },
        success: { type: "boolean" },
        createdAt: { type: "string", format: "date-time" },
        details: { type: "object", additionalProperties: true }
      }
    }
  };
  const paths: Record<string, Record<string, Operation>> = {
    "/health/live": {
      get: {
        operationId: "getHealth",
        summary: "Check process liveness",
        tags: ["System"],
        responses: okResponse({ type: "object", additionalProperties: true }),
        security: []
      }
    },
    "/health/ready": {
      get: {
        operationId: "getDependencyHealth",
        summary: "Check dependency readiness",
        tags: ["System"],
        responses: okResponse({ type: "object", additionalProperties: true }),
        security: []
      }
    },
    [`${basePath}/meta`]: {
      get: {
        operationId: "getMetadata",
        summary: "Read Framekit app metadata",
        tags: ["System"],
        responses: okResponse(ref("FramekitMetadata"))
      }
    },
    [`${basePath}/diagnostics`]: {
      get: {
        operationId: "getDiagnostics",
        summary: "Read runtime diagnostics",
        tags: ["System"],
        responses: okResponse(ref("FramekitDiagnostics"))
      }
    },
    [`${basePath}/migrations`]: {
      get: {
        operationId: "listMigrations",
        summary: "List applied migration records",
        tags: ["System"],
        responses: okResponse({ type: "array", items: { type: "object", additionalProperties: true } })
      }
    },
    [`${basePath}/realtime/events`]: {
      get: {
        operationId: "listRealtimeEvents",
        summary: "List recent realtime document events",
        tags: ["System"],
        "x-framekit-permission": "framekit.realtime.read",
        parameters: [queryParam("limit", "integer"), queryParam("after", "string")],
        responses: okResponse({ type: "array", items: { type: "object", additionalProperties: true } })
      }
    },
    [`${basePath}/realtime/stream`]: {
      get: {
        operationId: "streamRealtimeEvents",
        summary: "Stream realtime document events using server-sent events",
        tags: ["System"],
        "x-framekit-permission": "framekit.realtime.read",
        parameters: [{ name: "Last-Event-ID", in: "header", required: false, schema: { type: "string" }, description: "Replay events after this durable cursor before streaming live events" }],
        responses: {
          "200": {
            description: "Realtime event stream",
            content: {
              "text/event-stream": {
                schema: { type: "string" }
              }
            }
          },
          ...errorResponses()
        }
      }
    },
    [`${basePath}/migrations/plan`]: {
      post: {
        operationId: "planMigration",
        summary: "Plan metadata migration changes",
        tags: ["System"],
        requestBody: jsonBody({
          type: "object",
          required: ["app"],
          properties: {
            app: { type: "object", additionalProperties: true }
          }
        }, true),
        responses: okResponse({ type: "object", additionalProperties: true })
      }
    },
    [`${basePath}/migrations/apply`]: {
      post: {
        operationId: "applyMigration",
        summary: "Execute and record a migration plan atomically",
        tags: ["System"],
        requestBody: jsonBody({
          type: "object",
          required: ["plan"],
          properties: {
            plan: { type: "object", additionalProperties: true },
            allowDestructive: { type: "boolean" }
          }
        }, true),
        responses: okResponse({ type: "object", additionalProperties: true })
      }
    },
    [`${basePath}/audit`]: {
      get: {
        operationId: "listAuditEvents",
        summary: "List audit events for the current tenant",
        tags: ["System"],
        parameters: [queryParam("limit", "integer")],
        responses: okResponse({
          type: "array",
          items: {
            type: "object",
            required: ["id", "tenantId", "userId", "action", "doctype", "documentId", "createdAt"],
            properties: {
              id: { type: "string" },
              tenantId: { type: "string" },
              userId: { type: "string" },
              action: { type: "string" },
              doctype: { type: "string" },
              documentId: { type: "string" },
              createdAt: { type: "string", format: "date-time" }
            }
          }
        })
      }
    },
    [`${basePath}/outbox`]: {
      get: {
        operationId: "listOutboxEvents",
        summary: "List outbox events for the current tenant",
        tags: ["System"],
        parameters: [queryParam("limit", "integer"), queryParam("status", "string")],
        responses: okResponse({
          type: "array",
          items: {
            type: "object",
            required: ["id", "tenantId", "type", "topic", "payload", "status", "attempts", "createdAt"],
            properties: {
              id: { type: "string" },
              tenantId: { type: "string" },
              type: { type: "string" },
              topic: { type: "string" },
              payload: { type: "object", additionalProperties: true },
              status: { type: "string", enum: ["pending", "dispatched", "failed"] },
              attempts: { type: "integer" },
              createdAt: { type: "string", format: "date-time" },
              processedAt: { type: "string", format: "date-time" },
              error: { type: "string" }
            }
          }
        })
      }
    },
    [`${basePath}/outbox/{id}/dispatch`]: {
      post: {
        operationId: "markOutboxDispatched",
        summary: "Mark an outbox event dispatched",
        tags: ["System"],
        parameters: [pathParam("id")],
        responses: okResponse({ type: "object", additionalProperties: true })
      }
    },
    [`${basePath}/outbox/{id}/fail`]: {
      post: {
        operationId: "markOutboxFailed",
        summary: "Mark an outbox event failed",
        tags: ["System"],
        parameters: [pathParam("id")],
        requestBody: jsonBody({
          type: "object",
          properties: {
            error: { type: "string" }
          }
        }, false),
        responses: okResponse({ type: "object", additionalProperties: true })
      }
    },
    [`${basePath}/custom-fields`]: {
      get: {
        operationId: "listCustomFields",
        summary: "List tenant custom fields",
        tags: ["Customization"],
        responses: okResponse({ type: "array", items: { type: "object", additionalProperties: true } })
      },
      post: {
        operationId: "addCustomField",
        summary: "Add a tenant custom field",
        tags: ["Customization"],
        requestBody: jsonBody({
          type: "object",
          required: ["doctype", "field"],
          properties: {
            doctype: { type: "string" },
            field: { type: "object", additionalProperties: true }
          }
        }, true),
        responses: createdResponse({ type: "object", additionalProperties: true })
      }
    },
    [`${basePath}/views`]: {
      get: {
        operationId: "listViews",
        summary: "List tenant view definitions",
        tags: ["Customization"],
        responses: okResponse({ type: "array", items: { type: "object", additionalProperties: true } })
      },
      post: {
        operationId: "upsertView",
        summary: "Create or update a tenant view definition",
        tags: ["Customization"],
        requestBody: jsonBody({
          type: "object",
          required: ["doctype", "type", "fields"],
          properties: {
            doctype: { type: "string" },
            type: { type: "string", enum: ["list", "form"] },
            fields: { type: "array", items: { type: "string" } }
          }
        }, true),
        responses: okResponse({ type: "object", additionalProperties: true })
      }
    },
    [`${basePath}/openapi.json`]: {
      get: {
        operationId: "getOpenApiDocument",
        summary: "Read this OpenAPI document",
        tags: ["System"],
        responses: okResponse({ type: "object", additionalProperties: true }),
        security: []
      }
    },
    [`${basePath}/auth/login`]: {
      post: {
        operationId: "login",
        summary: "Create a signed session token",
        tags: ["Auth"],
        requestBody: jsonBody({
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", format: "password" }
          }
        }, true),
        responses: okResponse(ref("AuthSession")),
        security: []
      }
    },
    [`${basePath}/auth/providers/{id}/login`]: {
      post: {
        operationId: "loginWithProvider",
        summary: "Create a signed session token from an external auth provider",
        tags: ["Auth"],
        parameters: [pathParam("id")],
        requestBody: jsonBody({
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string" }
          }
        }, true),
        responses: okResponse(ref("AuthSession")),
        security: []
      }
    },
    [`${basePath}/auth/providers/{id}/authorize`]: {
      get: { operationId: "beginOidcAuthorization", summary: "Redirect to an OIDC authorization endpoint using state, nonce, and PKCE", tags: ["Auth"],
        parameters: [pathParam("id"), queryParam("returnTo", "string")], responses: { "302": { description: "OIDC authorization redirect" }, ...errorResponses() }, security: [] }
    },
    [`${basePath}/auth/providers/{id}/callback`]: {
      get: { operationId: "completeOidcAuthorization", summary: "Validate the OIDC callback and establish a session", tags: ["Auth"],
        parameters: [pathParam("id"), queryParam("code", "string"), queryParam("state", "string")], responses: { "303": { description: "Same-origin post-login redirect" }, ...errorResponses() }, security: [] }
    },
    [`${basePath}/auth/invitations`]: {
      post: { operationId: "createInvitation", summary: "Create an expiring single-use tenant invitation", tags: ["Auth"],
        requestBody: jsonBody({ type: "object", required: ["email", "name", "roles", "permissions"], properties: {
          email: { type: "string", format: "email" }, name: { type: "string" }, roles: { type: "array", items: { type: "string" } },
          permissions: { type: "array", items: { type: "string" } }, expiresAt: { type: "string", format: "date-time" }
        } }, true), responses: createdResponse({ type: "object", additionalProperties: true }) }
    },
    [`${basePath}/auth/identity-links`]: {
      post: { operationId: "linkProviderIdentity", summary: "Link a provider subject to one tenant user", tags: ["Auth"],
        requestBody: jsonBody({ type: "object", required: ["providerId", "subject", "userId"], properties: {
          providerId: { type: "string" }, subject: { type: "string" }, userId: { type: "string" }, email: { type: "string", format: "email" }
        } }, true), responses: createdResponse({ type: "object", additionalProperties: true }) }
    },
    [`${basePath}/auth/invitations/accept`]: {
      post: { operationId: "acceptInvitation", summary: "Consume an invitation and create the tenant user", tags: ["Auth"], security: [],
        requestBody: jsonBody({ type: "object", required: ["token", "password"], properties: { token: { type: "string" }, password: { type: "string", format: "password" } } }, true),
        responses: okResponse(ref("AuthSession")) }
    },
    [`${basePath}/auth/password/reset/request`]: {
      post: { operationId: "requestPasswordReset", summary: "Request an expiring password reset without account enumeration", tags: ["Auth"], security: [],
        requestBody: jsonBody({ type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } }, true),
        responses: { "202": { description: "Accepted" }, ...errorResponses() } }
    },
    [`${basePath}/auth/password/reset/complete`]: {
      post: { operationId: "completePasswordReset", summary: "Consume a single-use password reset token", tags: ["Auth"], security: [],
        requestBody: jsonBody({ type: "object", required: ["token", "newPassword"], properties: { token: { type: "string" }, newPassword: { type: "string", format: "password" } } }, true),
        responses: { "204": { description: "Password reset" }, ...errorResponses() } }
    },
    [`${basePath}/auth/users/{id}/recovery`]: {
      post: { operationId: "createRecoveryToken", summary: "Create an expiring single-use recovery token", tags: ["Auth"], parameters: [pathParam("id")],
        responses: createdResponse({ type: "object", additionalProperties: true }) }
    },
    [`${basePath}/auth/me`]: {
      get: {
        operationId: "getCurrentUser",
        summary: "Read the current signed-in user",
        tags: ["Auth"],
        responses: okResponse({
          type: "object",
          required: ["user", "context", "expiresAt"],
          properties: {
            user: { type: "object", additionalProperties: true },
            context: { type: "object", additionalProperties: true },
            expiresAt: { type: "string", format: "date-time" }
          }
        })
      }
    },
    [`${basePath}/auth/refresh`]: {
      post: {
        operationId: "refreshSession",
        summary: "Rotate the current signed session token",
        tags: ["Auth"],
        responses: okResponse(ref("AuthSession"))
      }
    },
    [`${basePath}/auth/logout`]: {
      post: {
        operationId: "logout",
        summary: "Revoke the current signed session token",
        tags: ["Auth"],
        responses: { "204": { description: "Logged out" }, ...errorResponses() }
      }
    },
    [`${basePath}/auth/password/change`]: {
      post: {
        operationId: "changePassword",
        summary: "Change the current user's password",
        tags: ["Auth"],
        requestBody: jsonBody({
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string", format: "password" },
            newPassword: { type: "string", format: "password" }
          }
        }, true),
        responses: { "204": { description: "Password changed" }, ...errorResponses() }
      }
    },
    [`${basePath}/auth/audit`]: {
      get: {
        operationId: "listAuthAuditEvents",
        summary: "List authentication audit events",
        tags: ["Auth"],
        responses: okResponse({ type: "array", items: ref("AuthAuditEvent") })
      }
    },
    [`${basePath}/auth/users`]: {
      get: {
        operationId: "listAuthUsers",
        summary: "List tenant users",
        tags: ["Auth"],
        responses: okResponse({ type: "array", items: ref("AuthUser") })
      },
      post: {
        operationId: "createAuthUser",
        summary: "Create a tenant user",
        tags: ["Auth"],
        requestBody: jsonBody(userWriteSchema(true), true),
        responses: createdResponse(ref("AuthUser"))
      }
    },
    [`${basePath}/auth/users/{id}`]: {
      patch: {
        operationId: "updateAuthUser",
        summary: "Update a tenant user",
        tags: ["Auth"],
        parameters: [pathParam("id")],
        requestBody: jsonBody(userWriteSchema(false), true),
        responses: okResponse(ref("AuthUser"))
      },
      delete: {
        operationId: "deleteAuthUser",
        summary: "Delete a tenant user",
        tags: ["Auth"],
        parameters: [pathParam("id")],
        responses: { "204": { description: "Deleted" }, ...errorResponses() }
      }
    },
    [`${basePath}/auth/users/{id}/password`]: {
      post: {
        operationId: "resetUserPassword",
        summary: "Reset a tenant user's password",
        tags: ["Auth"],
        parameters: [pathParam("id")],
        requestBody: jsonBody({
          type: "object",
          required: ["newPassword"],
          properties: {
            newPassword: { type: "string", format: "password" }
          }
        }, true),
        responses: { "204": { description: "Password reset" }, ...errorResponses() }
      }
    },
    [`${basePath}/auth/roles`]: {
      get: {
        operationId: "listAuthRoles",
        summary: "List tenant roles",
        tags: ["Auth"],
        responses: okResponse({ type: "array", items: ref("AuthRole") })
      },
      post: {
        operationId: "createAuthRole",
        summary: "Create or update a tenant role",
        tags: ["Auth"],
        requestBody: jsonBody(roleWriteSchema(true), true),
        responses: createdResponse(ref("AuthRole"))
      }
    },
    [`${basePath}/auth/roles/{id}`]: {
      patch: {
        operationId: "updateAuthRole",
        summary: "Update a tenant role",
        tags: ["Auth"],
        parameters: [pathParam("id")],
        requestBody: jsonBody(roleWriteSchema(false), true),
        responses: okResponse(ref("AuthRole"))
      },
      delete: {
        operationId: "deleteAuthRole",
        summary: "Delete a tenant role",
        tags: ["Auth"],
        parameters: [pathParam("id")],
        responses: { "204": { description: "Deleted" }, ...errorResponses() }
      }
    },
    [`${basePath}/auth/tokens`]: {
      get: {
        operationId: "listApiTokens",
        summary: "List tenant API tokens",
        tags: ["Auth"],
        responses: okResponse({ type: "array", items: ref("ApiToken") })
      },
      post: {
        operationId: "createApiToken",
        summary: "Create an API token",
        tags: ["Auth"],
        requestBody: jsonBody({
          type: "object",
          required: ["name", "roles", "permissions"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            userId: { type: "string" },
            roles: { type: "array", items: { type: "string" } },
            permissions: { type: "array", items: { type: "string" } },
            expiresAt: { type: "string", format: "date-time" }
          }
        }, true),
        responses: createdResponse(ref("CreatedApiToken"))
      }
    },
    [`${basePath}/auth/tokens/{id}`]: {
      delete: {
        operationId: "revokeApiToken",
        summary: "Revoke an API token",
        tags: ["Auth"],
        parameters: [pathParam("id")],
        responses: okResponse(ref("ApiToken"))
      }
    }
  };

  for (const doctype of listDocTypes(app)) {
    const inputName = schemaName(doctype, "Input");
    const recordName = schemaName(doctype, "Record");
    const patchName = schemaName(doctype, "Patch");
    schemas[inputName] = doctypeInputSchema(doctype, false);
    schemas[patchName] = doctypeInputSchema(doctype, true);
    schemas[recordName] = documentRecordSchema(ref(inputName));

    const collectionPath = `${basePath}/doctypes/${doctype.name}`;
    const itemPath = `${collectionPath}/{id}`;
    paths[collectionPath] = {
      get: {
        operationId: `list${pascal(doctype.name)}`,
        summary: `List ${doctype.label} documents`,
        tags: [doctype.label],
        parameters: [
          queryParam("search", "string"),
          queryParam("limit", "integer"),
          queryParam("offset", "integer"),
          queryParam("cursor", "string", "Opaque x-next-cursor value from the previous page; must use the same sort."),
          queryParam("fields", "string"),
          queryParam("filters", "string"),
          queryParam("sort", "string")
        ],
        responses: listResponse({ type: "array", items: ref(recordName) })
      },
      post: {
        operationId: `create${pascal(doctype.name)}`,
        summary: `Create a ${doctype.label} document`,
        tags: [doctype.label],
        parameters: [idempotencyKeyParam()],
        requestBody: jsonBody(ref(inputName), true),
        responses: createdResponse(ref(recordName))
      }
    };
    paths[itemPath] = {
      get: {
        operationId: `get${pascal(doctype.name)}`,
        summary: `Read a ${doctype.label} document`,
        tags: [doctype.label],
        parameters: [pathParam("id")],
        responses: okResponse(ref(recordName))
      },
      patch: {
        operationId: `update${pascal(doctype.name)}`,
        summary: `Update a ${doctype.label} document`,
        tags: [doctype.label],
        parameters: [pathParam("id"), expectedRevisionParam(), idempotencyKeyParam()],
        requestBody: jsonBody(ref(patchName), true),
        responses: okResponse(ref(recordName))
      },
      delete: {
        operationId: `delete${pascal(doctype.name)}`,
        summary: `Delete a ${doctype.label} document`,
        tags: [doctype.label],
        parameters: [pathParam("id"), expectedRevisionParam(), idempotencyKeyParam()],
        responses: {
          "204": { description: "Deleted" },
          ...errorResponses()
        }
      }
    };
    if (doctype.workflow) {
      paths[`${itemPath}/transition`] = {
        post: {
          operationId: `transition${pascal(doctype.name)}`,
          summary: `Run a ${doctype.label} workflow transition`,
          tags: [doctype.label],
          parameters: [pathParam("id"), expectedRevisionParam(), idempotencyKeyParam()],
          requestBody: jsonBody({
            type: "object",
            required: ["action"],
            properties: {
              action: { type: "string", enum: doctype.workflow.transitions.map((transition) => transition.action) }
            }
          }, true),
          responses: okResponse(ref(recordName))
        }
      };
    }
    for (const operation of ["submit", "cancel"] as const) {
      paths[`${itemPath}/${operation}`] = {
        post: {
          operationId: `${operation}${pascal(doctype.name)}`,
          summary: `${operation === "submit" ? "Submit" : "Cancel"} a ${doctype.label} document`,
          tags: [doctype.label],
          parameters: [pathParam("id"), expectedRevisionParam(), idempotencyKeyParam()],
          responses: okResponse(ref(recordName))
        }
      };
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: app.name,
      version: app.version,
      summary: "Generated Framekit document API"
    },
    servers: [{ url: options.serverUrl ?? "http://localhost:3000" }],
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer"
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "framekit_session"
        }
      },
      parameters: {
        TenantId: headerParam("x-tenant-id")
      }
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }]
  };
}

function doctypeInputSchema(doctype: DocTypeDefinition, partial: boolean): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const field of doctype.fields) {
    if (field.readOnly && partial) {
      continue;
    }
    properties[field.name] = fieldSchema(field);
    if (!partial && field.required) {
      required.push(field.name);
    }
  }
  return {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: true
  };
}

function fieldSchema(field: FieldDefinition): JsonSchema {
  const description = field.description;
  switch (field.type) {
    case "number":
    case "currency":
      return { type: "number", description };
    case "boolean":
      return { type: "boolean", description };
    case "date":
      return { type: "string", format: "date", description };
    case "datetime":
      return { type: "string", format: "date-time", description };
    case "select":
      return { type: "string", enum: field.options, description };
    case "json":
      return { description };
    default:
      return { type: "string", description };
  }
}

function userWriteSchema(creating: boolean): JsonSchema {
  return {
    type: "object",
    required: ["email", "name", "roles", "permissions", ...(creating ? ["password"] : [])],
    properties: {
      id: { type: "string" },
      email: { type: "string", format: "email" },
      name: { type: "string" },
      password: { type: "string", format: "password" },
      roles: { type: "array", items: { type: "string" } },
      permissions: { type: "array", items: { type: "string" } },
      disabledAt: { type: "string", format: "date-time" },
      lockedUntil: { type: "string", format: "date-time" }
    }
  };
}

function roleWriteSchema(creating: boolean): JsonSchema {
  return {
    type: "object",
    required: ["name", "permissions", ...(creating ? ["id"] : [])],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      permissions: { type: "array", items: { type: "string" } }
    }
  };
}

function documentRecordSchema(dataSchema: JsonSchema): JsonSchema {
  return {
    type: "object",
    required: ["id", "doctype", "tenantId", "revision", "documentStatus", "data", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      doctype: { type: "string" },
      tenantId: { type: "string" },
      revision: { type: "integer" },
      documentStatus: { type: "string", enum: ["draft", "submitted", "cancelled"] },
      data: dataSchema,
      state: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };
}

function ref(name: string): JsonSchema {
  return { "$ref": `#/components/schemas/${name}` } as JsonSchema;
}

function okResponse(schema: JsonSchema): Record<string, unknown> {
  return {
    "200": { description: "OK", content: { "application/json": { schema } } },
    ...errorResponses()
  };
}

function listResponse(schema: JsonSchema): Record<string, unknown> {
  return {
    "200": {
      description: "OK",
      headers: {
        "x-next-cursor": {
          description: "Opaque cursor for the next stable keyset page. Omitted on the final page.",
          schema: { type: "string" }
        }
      },
      content: { "application/json": { schema } }
    },
    ...errorResponses()
  };
}

function createdResponse(schema: JsonSchema): Record<string, unknown> {
  return {
    "201": { description: "Created", content: { "application/json": { schema } } },
    ...errorResponses()
  };
}

function errorResponses(): Record<string, unknown> {
  return {
    "400": errorResponse("Bad request"),
    "403": errorResponse("Forbidden"),
    "404": errorResponse("Not found"),
    "409": errorResponse("Conflict"),
    "422": errorResponse("Validation failed")
  };
}

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ref("FramekitError") } } };
}

function jsonBody(schema: JsonSchema, required: boolean) {
  return { required, content: { "application/json": { schema } } };
}

function pathParam(name: string) {
  return { name, in: "path", required: true, schema: { type: "string" } };
}

function queryParam(name: string, type: string, description?: string) {
  return { name, in: "query", required: false, schema: { type }, description };
}

function headerParam(name: string) {
  return { name, in: "header", required: false, schema: { type: "string" } };
}

function expectedRevisionParam() {
  return { name: "If-Match", in: "header", required: false, schema: { type: "integer", minimum: 1 } };
}

function idempotencyKeyParam() {
  return { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string" } };
}

function schemaName(doctype: DocTypeDefinition, suffix: string): string {
  return `${pascal(doctype.name)}${suffix}`;
}

function pascal(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
}
