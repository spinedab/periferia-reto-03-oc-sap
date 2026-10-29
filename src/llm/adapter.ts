import type { RegisteredTool } from "../tools/registry.js";

export interface LlamadaHerramientaModelo {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ResultadoHerramientaMensaje {
  toolCallId: string;
  name: string;
  resultJson: string;
}

export interface MensajeConversacion {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: LlamadaHerramientaModelo[];
  toolResults?: ResultadoHerramientaMensaje[];
  /** Partes nativas del proveedor (ej. Gemini thoughtSignature) preservadas en memoria de sesión */
  providerMeta?: Record<string, unknown>;
}

export interface UsoTokens {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface RespuestaLlm {
  text: string;
  toolCalls: LlamadaHerramientaModelo[];
  usage: UsoTokens;
  providerMeta?: Record<string, unknown>;
}

/**
 * Interfaz agnóstica de proveedor LLM (Sección 6.1 del PRD).
 * Cambiar entre Gemini, OpenAI, Anthropic o modo determinista no requiere tocar el ciclo del agente.
 */
export interface LlmAdapter {
  readonly providerName: string;
  readonly modelName: string;
  readonly isConfigured: boolean;
  enviar(
    mensajes: MensajeConversacion[],
    herramientas: RegisteredTool[],
    systemPrompt: string
  ): Promise<RespuestaLlm>;
}

export function sanitizarErrorSinSecretos(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Redacta cualquier posible token o parámetro key=... que pudiera venir en una URL o traza
  return raw
    .replace(/key=[A-Za-z0-9_\-]+/gi, "key=[REDACTED]")
    .replace(/sk-[A-Za-z0-9_\-]{10,}/g, "[REDACTED]")
    .replace(/AIza[A-Za-z0-9_\-]{10,}/g, "[REDACTED]");
}
