import crypto from "node:crypto";
import type { RegisteredTool } from "../tools/registry.js";
import {
  sanitizarErrorSinSecretos,
  type LlamadaHerramientaModelo,
  type LlmAdapter,
  type MensajeConversacion,
  type RespuestaLlm,
} from "./adapter.js";

export class AnthropicAdapter implements LlmAdapter {
  readonly providerName = "anthropic";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options?: { apiKey?: string; model?: string; timeoutMs?: number }) {
    this.apiKey = (options?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "").trim();
    this.modelName = (
      options?.model ??
      process.env.LLM_MODEL ??
      "claude-3-5-haiku-latest"
    ).trim();
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
        "ANTHROPIC_API_KEY no está configurada en las variables de entorno del servidor."
      );
    }

    const anthropicMessages: Array<Record<string, unknown>> = [];
    for (const msg of mensajes) {
      if (msg.role === "user") {
        anthropicMessages.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        const blocks: Array<Record<string, unknown>> = [];
        if (msg.content) {
          blocks.push({ type: "text", text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            blocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.args,
            });
          }
        }
        anthropicMessages.push({ role: "assistant", content: blocks });
      } else if (msg.role === "tool" && msg.toolResults) {
        anthropicMessages.push({
          role: "user",
          content: msg.toolResults.map((tr) => ({
            type: "tool_result",
            tool_use_id: tr.toolCallId,
            content: tr.resultJson,
          })),
        });
      }
    }

    const tools = herramientas.map((t) => {
      const filteredProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(t.jsonSchema.properties)) {
        if (!t.jsonSchema.required.includes(k) && v.type === "object") continue;
        filteredProps[k] = v;
      }
      return {
        name: t.name,
        description: t.description,
        input_schema: {
          type: "object",
          properties: filteredProps,
          required: t.jsonSchema.required.filter((r) => r in filteredProps),
        },
      };
    });

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.modelName,
          max_tokens: 2048,
          system: systemPrompt,
          messages: anthropicMessages,
          tools,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const errTxt = await response.text();
        throw new Error(
          `Anthropic API respondió HTTP ${response.status}: ${sanitizarErrorSinSecretos(errTxt).slice(0, 350)}`
        );
      }

      const data = (await response.json()) as {
        content?: Array<{
          type: string;
          text?: string;
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const texts: string[] = [];
      const toolCalls: LlamadaHerramientaModelo[] = [];

      for (const block of data.content ?? []) {
        if (block.type === "text" && block.text) {
          texts.push(block.text);
        } else if (block.type === "tool_use" && block.name) {
          toolCalls.push({
            id: block.id ?? `call_${crypto.randomUUID().slice(0, 8)}`,
            name: block.name,
            args: block.input ?? {},
          });
        }
      }

      const inputTokens = data.usage?.input_tokens ?? 0;
      const outputTokens = data.usage?.output_tokens ?? 0;

      return {
        text: texts.join("\n").trim(),
        toolCalls,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
      };
    } catch (err) {
      throw new Error(sanitizarErrorSinSecretos(err));
    }
  }
}
