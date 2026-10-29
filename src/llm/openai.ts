import crypto from "node:crypto";
import type { RegisteredTool } from "../tools/registry.js";
import {
  sanitizarErrorSinSecretos,
  type LlamadaHerramientaModelo,
  type LlmAdapter,
  type MensajeConversacion,
  type RespuestaLlm,
} from "./adapter.js";

export class OpenAiCompatibleAdapter implements LlmAdapter {
  readonly providerName = "openai";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options?: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    timeoutMs?: number;
  }) {
    this.apiKey = (options?.apiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
    this.modelName = (options?.model ?? process.env.LLM_MODEL ?? "gpt-4o-mini").trim();
    this.baseUrl = (
      options?.baseUrl ??
      process.env.OPENAI_BASE_URL ??
      "https://api.openai.com/v1"
    ).replace(/\/+$/, "");
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
        "OPENAI_API_KEY no está configurada en las variables de entorno del servidor."
      );
    }

    const apiMessages: Array<Record<string, unknown>> = [
      { role: "system", content: systemPrompt },
    ];

    for (const msg of mensajes) {
      if (msg.role === "user") {
        apiMessages.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        const entry: Record<string, unknown> = {
          role: "assistant",
          content: msg.content || null,
        };
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          entry.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          }));
        }
        apiMessages.push(entry);
      } else if (msg.role === "tool" && msg.toolResults) {
        for (const tr of msg.toolResults) {
          apiMessages.push({
            role: "tool",
            tool_call_id: tr.toolCallId,
            content: tr.resultJson,
          });
        }
      }
    }

    const toolsPayload = herramientas.map((t) => {
      const filteredProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(t.jsonSchema.properties)) {
        if (!t.jsonSchema.required.includes(k) && v.type === "object") continue;
        filteredProps[k] = v;
      }
      return {
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: filteredProps,
            required: t.jsonSchema.required.filter((r) => r in filteredProps),
          },
        },
      };
    });

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: apiMessages,
          tools: toolsPayload,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const errTxt = await response.text();
        throw new Error(
          `OpenAI API respondió HTTP ${response.status}: ${sanitizarErrorSinSecretos(errTxt).slice(0, 350)}`
        );
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      const msg = data.choices?.[0]?.message;
      const toolCalls: LlamadaHerramientaModelo[] = (msg?.tool_calls ?? []).map((tc) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function?.arguments ?? "{}") as Record<string, unknown>;
        } catch {
          parsedArgs = {};
        }
        return {
          id: tc.id ?? `call_${crypto.randomUUID().slice(0, 8)}`,
          name: tc.function?.name ?? "",
          args: parsedArgs,
        };
      });

      const inputTokens = data.usage?.prompt_tokens ?? 0;
      const outputTokens = data.usage?.completion_tokens ?? 0;
      const totalTokens = data.usage?.total_tokens ?? inputTokens + outputTokens;

      return {
        text: (msg?.content ?? "").trim(),
        toolCalls,
        usage: { inputTokens, outputTokens, totalTokens },
      };
    } catch (err) {
      throw new Error(sanitizarErrorSinSecretos(err));
    }
  }
}
