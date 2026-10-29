import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../types.js";
import * as ocTools from "./oc.js";

export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface RegisteredTool {
  name: string;
  description: string;
  zodSchema: z.ZodObject<z.ZodRawShape>;
  jsonSchema: {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
    required: string[];
  };
  execute: (rawArgs: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

function zodFieldToJsonSchema(schema: z.ZodTypeAny): {
  prop: JsonSchemaProperty;
  optional: boolean;
} {
  let actual: z.ZodTypeAny = schema;
  let optional = false;
  const topDescription = schema.description;

  while (
    actual instanceof z.ZodOptional ||
    actual instanceof z.ZodDefault ||
    actual instanceof z.ZodNullable
  ) {
    if (actual instanceof z.ZodOptional || actual instanceof z.ZodDefault) {
      optional = true;
    }
    actual = actual._def.innerType;
  }

  const description = topDescription ?? actual.description;

  if (actual instanceof z.ZodString) {
    return { prop: { type: "string", ...(description ? { description } : {}) }, optional };
  }
  if (actual instanceof z.ZodNumber) {
    return { prop: { type: "number", ...(description ? { description } : {}) }, optional };
  }
  if (actual instanceof z.ZodBoolean) {
    return { prop: { type: "boolean", ...(description ? { description } : {}) }, optional };
  }
  if (actual instanceof z.ZodEnum) {
    return {
      prop: {
        type: "string",
        enum: actual._def.values as string[],
        ...(description ? { description } : {}),
      },
      optional,
    };
  }
  if (actual instanceof z.ZodLiteral) {
    return {
      prop: {
        type: typeof actual._def.value === "number" ? "number" : "string",
        ...(typeof actual._def.value === "string" ? { enum: [actual._def.value] } : {}),
        ...(description ? { description } : {}),
      },
      optional,
    };
  }
  if (actual instanceof z.ZodArray) {
    const inner = zodFieldToJsonSchema(actual._def.type);
    return {
      prop: {
        type: "array",
        items: inner.prop,
        ...(description ? { description } : {}),
      },
      optional,
    };
  }
  if (actual instanceof z.ZodObject) {
    const shape = actual._def.shape() as z.ZodRawShape;
    const properties: Record<string, JsonSchemaProperty> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      const converted = zodFieldToJsonSchema(v);
      properties[k] = converted.prop;
      if (!converted.optional) {
        required.push(k);
      }
    }
    return {
      prop: {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        ...(description ? { description } : {}),
      },
      optional,
    };
  }

  // Fallback para tipos compuestos/nullable (ej. Paquete opcional ya leído en sesión)
  return {
    prop: {
      type: "object",
      ...(description ? { description } : {}),
    },
    optional,
  };
}

function esToolDefinition(candidato: unknown): candidato is ToolDefinition {
  if (!candidato || typeof candidato !== "object") return false;
  const obj = candidato as Record<string, unknown>;
  return (
    typeof obj.description === "string" &&
    typeof obj.args === "object" &&
    obj.args !== null &&
    typeof obj.execute === "function"
  );
}

export function registrarLogHerramienta(
  projectRoot: string,
  evento: {
    sessionId: string;
    tool: string;
    args: Record<string, unknown>;
    ok: boolean;
    durationMs: number;
    summary: string;
  }
): void {
  const logPath = path.join(projectRoot, "out", "log.jsonl");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const linea = JSON.stringify({
    ts: new Date().toISOString(),
    ...evento,
  });
  fs.appendFileSync(logPath, `${linea}\n`, "utf-8");
}

/**
 * Construye el catálogo de herramientas aplicando la convención obligatoria de la sección 6.2:
 * cada export válido en `src/tools/oc.ts` se publica hacia el LLM como `oc_<export>`.
 */
export function construirRegistroHerramientas(): Map<string, RegisteredTool> {
  const mapa = new Map<string, RegisteredTool>();

  for (const [exportName, exportVal] of Object.entries(ocTools)) {
    if (!esToolDefinition(exportVal)) {
      continue;
    }

    const toolName = `oc_${exportName}`;
    const zodSchema = z.object(exportVal.args);
    const properties: Record<string, JsonSchemaProperty> = {};
    const required: string[] = [];

    for (const [argKey, argSchema] of Object.entries(exportVal.args)) {
      const converted = zodFieldToJsonSchema(argSchema);
      properties[argKey] = converted.prop;
      if (!converted.optional) {
        required.push(argKey);
      }
    }

    mapa.set(toolName, {
      name: toolName,
      description: exportVal.description,
      zodSchema,
      jsonSchema: {
        type: "object",
        properties,
        required,
      },
      async execute(rawArgs, ctx) {
        const inicio = Date.now();
        const validado = zodSchema.safeParse(rawArgs ?? {});
        if (!validado.success) {
          const detalleError = validado.error.issues
            .map((i) => `${i.path.join(".") || "args"}: ${i.message}`)
            .join("; ");
          const respuestaError = JSON.stringify({
            ok: false,
            error: `Argumentos inválidos para ${toolName}: ${detalleError}`,
          });
          registrarLogHerramienta(ctx.directory, {
            sessionId: ctx.sessionId,
            tool: toolName,
            args: rawArgs,
            ok: false,
            durationMs: Date.now() - inicio,
            summary: detalleError,
          });
          return respuestaError;
        }

        const salida = await exportVal.execute(validado.data, ctx);
        let ok = true;
        let summary = "ok";
        try {
          const parsed = JSON.parse(salida) as { ok?: boolean; error?: string };
          ok = Boolean(parsed.ok);
          if (!ok && parsed.error) {
            summary = parsed.error.slice(0, 180);
          }
        } catch {
          ok = false;
          summary = "Salida JSON no parseable";
        }

        registrarLogHerramienta(ctx.directory, {
          sessionId: ctx.sessionId,
          tool: toolName,
          args: rawArgs,
          ok,
          durationMs: Date.now() - inicio,
          summary,
        });

        return salida;
      },
    });
  }

  return mapa;
}
