/**
 * Route-binding details of HttpServer that have no other coverage.
 *
 * `/v1/captures/{taskId}` is the first operation in the spec with a path
 * parameter, so these two behaviours were previously unexercised — and both
 * fail silently rather than loudly if they regress.
 */
import { describe, it, expect } from "vitest";
import {
  extractParamsSchema,
  toFastifyPath,
  type OperationObject,
} from "../../src/http/http-server.js";
import { OPERATIONS } from "../../src/http/generated/operations.gen.js";

describe("toFastifyPath", () => {
  // Registering the literal `{taskId}` would make every real request 404,
  // and Fastify would never complain about the braces.
  it("rewrites OpenAPI templating into Fastify's colon syntax", () => {
    expect(toFastifyPath("/v1/captures/{taskId}")).toBe("/v1/captures/:taskId");
  });

  it("leaves paths without parameters untouched", () => {
    expect(toFastifyPath("/v1/status")).toBe("/v1/status");
    expect(toFastifyPath("/v1/captures")).toBe("/v1/captures");
  });

  it("rewrites every parameter in a multi-segment path", () => {
    expect(toFastifyPath("/v1/{a}/x/{b}")).toBe("/v1/:a/x/:b");
  });

  // Guards the generated map itself: if a future operation adds a path
  // parameter, it goes through the same conversion.
  it("leaves no braces in any registered operation path", () => {
    for (const op of Object.values(OPERATIONS)) {
      expect(toFastifyPath(op.path)).not.toContain("{");
    }
  });
});

describe("extractParamsSchema", () => {
  it("returns undefined when the operation has no path parameters", () => {
    const operation: OperationObject = {
      parameters: [{ name: "pendingLimit", in: "query", schema: { type: "integer" } }],
    };
    expect(extractParamsSchema(operation)).toBeUndefined();
  });

  it("returns undefined when the operation declares no parameters at all", () => {
    expect(extractParamsSchema({})).toBeUndefined();
  });

  it("builds a strict schema with every path parameter required", () => {
    const operation: OperationObject = {
      parameters: [
        { name: "taskId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        { name: "pendingLimit", in: "query", schema: { type: "integer" } },
      ],
    };

    expect(extractParamsSchema(operation)).toEqual({
      type: "object",
      properties: { taskId: { type: "string", format: "uuid" } },
      required: ["taskId"],
      additionalProperties: false,
    });
  });
});
