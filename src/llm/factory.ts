import type { RegisteredTool } from "../tools/registry.js";
import type { LlmAdapter, MensajeConversacion, RespuestaLlm } from "./adapter.js";
import { AnthropicAdapter } from "./anthropic.js";
import { DeterministicFallbackAdapter } from "./deterministic.js";
import { GeminiAdapter } from "./gemini.js";
import { OpenAiCompatibleAdapter } from "./openai.js";

class ResilientFallbackAdapter implements LlmAdapter {
  private readonly primary: LlmAdapter;
  private readonly fallback: DeterministicFallbackAdapter;

  constructor(primary: LlmAdapter) {
    this.primary = primary;
    this.fallback = new DeterministicFallbackAdapter();
  }

  get providerName(): string {
    return this.primary.providerName;
  }

  get modelName(): string {
    return this.primary.modelName;
  }

  get isConfigured(): boolean {
    return this.primary.isConfigured;
  }

  async enviar(
    mensajes: MensajeConversacion[],
    herramientas: RegisteredTool[],
    systemPrompt: string
  ): Promise<RespuestaLlm> {
    try {
      return await this.primary.enviar(mensajes, herramientas, systemPrompt);
    } catch (err) {
      const fallbackHabilitado =
        (process.env.LLM_FALLBACK_DETERMINISTIC ?? "false").toLowerCase() === "true";
      if (!fallbackHabilitado) {
        throw err;
      }
      return await this.fallback.enviar(mensajes, herramientas, systemPrompt);
    }
  }
}

export function crearAdaptadorLlm(providerOverride?: string): LlmAdapter {
  const provider = (providerOverride ?? process.env.LLM_PROVIDER ?? "gemini")
    .trim()
    .toLowerCase();

  let base: LlmAdapter;
  switch (provider) {
    case "gemini":
    case "google":
      base = new GeminiAdapter();
      break;
    case "openai":
      base = new OpenAiCompatibleAdapter();
      break;
    case "anthropic":
    case "claude":
      base = new AnthropicAdapter();
      break;
    case "deterministic":
    case "local":
    case "mock":
      return new DeterministicFallbackAdapter();
    default:
      throw new Error(
        `Proveedor LLM no soportado: "${provider}". Valores válidos: gemini, openai, anthropic, deterministic.`
      );
  }

  return new ResilientFallbackAdapter(base);
}
