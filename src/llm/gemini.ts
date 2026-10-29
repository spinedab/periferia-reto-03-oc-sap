import crypto from "node:crypto";
import type { JsonSchemaProperty, RegisteredTool } from "../tools/registry.js";
import {
  sanitizarErrorSinSecretos,
  type LlamadaHerramientaModelo,
  type LlmAdapter,
  type MensajeConversacion,
  type RespuestaLlm,
} from "./adapter.js";

interface GeminiSchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: GeminiSchema;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: {
    name: string;
    args?: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

function convertirPropiedadGemini(prop: JsonSchemaProperty): GeminiSchema | null {
  const upperType = prop.type.toUpperCase();
  if (upperType === "OBJECT") {
    if (!prop.properties || Object.keys(prop.properties).length === 0) {
      // Gemini v1beta exige que todo nodo OBJECT declare al menos una propiedad
      return null;
    }
    const subProps: Record<string, GeminiSchema> = {};
    for (const [k, v] of Object.entries(prop.properties)) {
      const conv = convertirPropiedadGemini(v);
      if (conv) {
        subProps[k] = conv;
      }
    }
    if (Object.keys(subProps).length === 0) {
      return null;
    }
    const req = (prop.required ?? []).filter((r) => r in subProps);
    return {
      type: "OBJECT",
      properties: subProps,
      ...(req.length > 0 ? { required: req } : {}),
      ...(prop.description ? { description: prop.description } : {}),
    };
  }

  if (upperType === "ARRAY") {
    const items = prop.items ? convertirPropiedadGemini(prop.items) : { type: "STRING" };
    return {
      type: "ARRAY",
      items: items ?? { type: "STRING" },
      ...(prop.description ? { description: prop.description } : {}),
    };
  }

  return {
    type: upperType,
    ...(prop.enum ? { enum: prop.enum } : {}),
    ...(prop.description ? { description: prop.description } : {}),
  };
}

function construirDeclaracionFuncionGemini(tool: RegisteredTool): Record<string, unknown> {
  const properties: Record<string, GeminiSchema> = {};
  for (const [key, prop] of Object.entries(tool.jsonSchema.properties)) {
    // Para ahorrar tokens y evitar que el LLM re-escriba objetos grandes opcionales (paquete/payload/derivados),
    // omitimos parámetros opcionales complejos en la declaración hacia el LLM (las herramientas los leen/validan por `caso`).
    const esRequerido = tool.jsonSchema.required.includes(key);
    if (!esRequerido && prop.type === "object") {
      continue;
    }
    const conv = convertirPropiedadGemini(prop);
    if (conv) {
      properties[key] = conv;
    }
  }

  const required = tool.jsonSchema.required.filter((r) => r in properties);
  if (Object.keys(properties).length === 0) {
    return {
      name: tool.name,
      description: tool.description,
    };
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "OBJECT",
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
  };
}

export class GeminiAdapter implements LlmAdapter {
  readonly providerName = "gemini";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options?: { apiKey?: string; model?: string; timeoutMs?: number }) {
    this.apiKey = (options?.apiKey ?? process.env.GEMINI_API_KEY ?? "").trim();
    this.modelName = (options?.model ?? process.env.LLM_MODEL ?? "gemini-2.5-flash").trim();
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS ?? 30000);
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async enviar(
    mensajes: MensajeConversacion[],
    herramientas: RegisteredTool[],
    systemPrompt: string
  ): Promise<RespuestaLlm> {
    if (!this.isConfigured) {
      throw new Error(
        "GEMINI_API_KEY no está configurada en las variables de entorno del servidor. Configúrela en .env o cambie LLM_PROVIDER=deterministic para modo local sin LLM."
      );
    }

    const contents: GeminiContent[] = [];

    for (const msg of mensajes) {
      if (msg.role === "user") {
        contents.push({
          role: "user",
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === "assistant") {
        // Preserva partes crudas (incluyendo thoughtSignature en Gemini 2.5+) si existen
        const rawParts = msg.providerMeta?.geminiParts as GeminiPart[] | undefined;
        if (rawParts && Array.isArray(rawParts) && rawParts.length > 0) {
          contents.push({ role: "model", parts: rawParts });
        } else {
          const parts: GeminiPart[] = [];
          if (msg.content) {
            parts.push({ text: msg.content });
          }
          if (msg.toolCalls) {
            for (const tc of msg.toolCalls) {
              parts.push({
                functionCall: {
                  name: tc.name,
                  args: tc.args,
                },
              });
            }
          }
          if (parts.length > 0) {
            contents.push({ role: "model", parts });
          }
        }
      } else if (msg.role === "tool" && msg.toolResults) {
        const parts: GeminiPart[] = msg.toolResults.map((tr) => {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(tr.resultJson) as Record<string, unknown>;
          } catch {
            parsed = { raw: tr.resultJson };
          }
          return {
            functionResponse: {
              name: tr.name,
              response: parsed,
            },
          };
        });
        contents.push({ role: "user", parts });
      }
    }

    const body = {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      tools: [
        {
          functionDeclarations: herramientas.map(construirDeclaracionFuncionGemini),
        },
      ],
      generationConfig: {
        temperature: 0.1,
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.modelName
    )}:generateContent`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Gemini API respondió HTTP ${response.status}: ${sanitizarErrorSinSecretos(errorText).slice(0, 350)}`
        );
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: GeminiPart[] };
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };

      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const textFragments: string[] = [];
      const toolCalls: LlamadaHerramientaModelo[] = [];

      for (const part of parts) {
        if (part.thought) {
          continue;
        }
        if (typeof part.text === "string" && part.text.length > 0) {
          textFragments.push(part.text);
        }
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${crypto.randomUUID().slice(0, 8)}`,
            name: part.functionCall.name,
            args: part.functionCall.args ?? {},
          });
        }
      }

      const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
      const totalTokens = data.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens;

      return {
        text: textFragments.join("\n").trim(),
        toolCalls,
        usage: { inputTokens, outputTokens, totalTokens },
        providerMeta: { geminiParts: parts },
      };
    } catch (err) {
      throw new Error(sanitizarErrorSinSecretos(err));
    }
  }
}
