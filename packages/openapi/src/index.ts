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
};

type Operation = {
  operationId: string;
  summary: string;
  tags: string[];
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
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
      required: ["app", "repository", "modules", "doctypes"],
      properties: {
        app: { type: "object", additionalProperties: true },
        repository: { type: "object", additionalProperties: true },
        modules: { type: "array", items: { type: "object", additionalProperties: true } },
        doctypes: { type: "array", items: { type: "object", additionalProperties: true } },
        warnings: { type: "array", items: { type: "string" } }
      }
    }
  };
  const paths: Record<string, Record<string, Operation>> = {
    "/health": {
      get: {
        operationId: "getHealth",
        summary: "Check app health",
        tags: ["System"],
        responses: okResponse({ type: "object", additionalProperties: true })
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
        responses: okResponse({ type: "object", additionalProperties: true })
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
        responses: okResponse({
          type: "object",
          required: ["token", "user", "context", "expiresAt"],
          properties: {
            token: { type: "string" },
            user: { type: "object", additionalProperties: true },
            context: { type: "object", additionalProperties: true },
            expiresAt: { type: "string", format: "date-time" }
          }
        })
      }
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
          queryParam("limit", "integer")
        ],
        responses: okResponse({ type: "array", items: ref(recordName) })
      },
      post: {
        operationId: `create${pascal(doctype.name)}`,
        summary: `Create a ${doctype.label} document`,
        tags: [doctype.label],
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
        parameters: [pathParam("id")],
        requestBody: jsonBody(ref(patchName), true),
        responses: okResponse(ref(recordName))
      },
      delete: {
        operationId: `delete${pascal(doctype.name)}`,
        summary: `Delete a ${doctype.label} document`,
        tags: [doctype.label],
        parameters: [pathParam("id")],
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
          parameters: [pathParam("id")],
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
        }
      },
      parameters: {
        TenantId: headerParam("x-tenant-id"),
        UserId: headerParam("x-user-id"),
        Roles: headerParam("x-roles"),
        Permissions: headerParam("x-permissions")
      }
    },
    security: [{ bearerAuth: [] }]
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

function documentRecordSchema(dataSchema: JsonSchema): JsonSchema {
  return {
    type: "object",
    required: ["id", "doctype", "tenantId", "data", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      doctype: { type: "string" },
      tenantId: { type: "string" },
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

function queryParam(name: string, type: string) {
  return { name, in: "query", required: false, schema: { type } };
}

function headerParam(name: string) {
  return { name, in: "header", required: false, schema: { type: "string" } };
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
