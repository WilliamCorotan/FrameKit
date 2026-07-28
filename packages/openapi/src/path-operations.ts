export type JsonSchema = {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minimum?: number;
  [key: string]: unknown;
};

export function ref(name: string): JsonSchema {
  return { $ref: `#/components/schemas/${name}` };
}

export function okResponse(schema: JsonSchema): Record<string, unknown> {
  return { "200": { description: "OK", content: { "application/json": { schema } } }, ...errorResponses() };
}

export function listResponse(schema: JsonSchema): Record<string, unknown> {
  return {
    "200": {
      description: "OK",
      headers: { "x-next-cursor": { description: "Opaque cursor for the next stable keyset page. Omitted on the final page.", schema: { type: "string" } } },
      content: { "application/json": { schema } }
    },
    ...errorResponses()
  };
}

export function createdResponse(schema: JsonSchema): Record<string, unknown> {
  return { "201": { description: "Created", content: { "application/json": { schema } } }, ...errorResponses() };
}

export function jsonBody(schema: JsonSchema, required: boolean) {
  return { required, content: { "application/json": { schema } } };
}

export function pathParam(name: string) { return { name, in: "path", required: true, schema: { type: "string" } }; }
export function queryParam(name: string, type: string, description?: string) { return { name, in: "query", required: false, schema: { type }, description }; }
export function headerParam(name: string) { return { name, in: "header", required: false, schema: { type: "string" } }; }
export function expectedRevisionParam() { return { name: "If-Match", in: "header", required: false, schema: { type: "integer", minimum: 1 } }; }
export function idempotencyKeyParam() { return { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string" } }; }

export function errorResponses(): Record<string, unknown> {
  return {
    "400": errorResponse("Bad request"), "401": errorResponse("Unauthenticated"), "403": errorResponse("Forbidden"),
    "404": errorResponse("Not found"), "409": errorResponse("Conflict"), "422": errorResponse("Validation failed"),
    "429": errorResponse("Rate limited", true), "500": errorResponse("Internal server error")
  };
}

function errorResponse(description: string, retryAfter = false) {
  return {
    description,
    headers: { "x-request-id": { description: "Request identity preserved by SDK errors.", schema: { type: "string" } }, ...(retryAfter ? { "Retry-After": { description: "Delay before a safe retry, in seconds or HTTP-date form.", schema: { type: "string" } } } : {}) },
    content: { "application/json": { schema: ref("FramekitError") } }
  };
}
