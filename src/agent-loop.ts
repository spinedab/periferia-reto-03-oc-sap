import fs from "node:fs";
import path from "node:path";
import {
  sanitizarErrorSinSecretos,
  type LlmAdapter,
  type MensajeConversacion,
  type ResultadoHerramientaMensaje,
  type UsoTokens,
} from "./llm/adapter.js";
import { construirRegistroHerramientas } from "./tools/registry.js";
import type { HallazgoControl } from "./types.js";

export interface TrazaLlamadaHerramienta {
  id: string;
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  resultSummary: string;
  rawResult: unknown;
  durationMs: number;
}

export interface ConfirmacionPendiente {
  caso: string;
  solicitud_id?: string;
  retroactiva: boolean;
  confirmaciones: HallazgoControl[];
  motivoGeneral: string;
}

export interface TurnoVisible {
  id: string;
  ts: string;
  userMessage: string;
  assistantReply: string;
  toolCalls: TrazaLlamadaHerramienta[];
  needsConfirmation: boolean;
  pendingConfirmation: ConfirmacionPendiente | null;
}

export interface SesionAgente {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messages: MensajeConversacion[];
  turns: TurnoVisible[];
  totalTokensUsed: number;
  pendingConfirmation: ConfirmacionPendiente | null;
  approvedCases: Set<string>;
}

export interface ResultadoTurnoAgente {
  sessionId: string;
  reply: string;
  toolCalls: TrazaLlamadaHerramienta[];
  needsConfirmation: boolean;
  pendingConfirmation: ConfirmacionPendiente | null;
  usage: UsoTokens & { sessionTotalTokens: number };
}

function resumirResultadoHerramienta(toolName: string, parsed: Record<string, unknown>): string {
  if (!parsed.ok) {
    return `Error: ${String(parsed.error ?? "fallo en ejecución")}`;
  }
  const data = (parsed.data ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "oc_leer_paquete": {
      const sol = (data.solicitud ?? {}) as Record<string, unknown>;
      return `Paquete ${String(sol.solicitud_id ?? "")} leído · Proveedor: ${String(sol.proveedor_nombre ?? "")} · Total: ${String(sol.moneda ?? "")} ${Number(sol.valor_total ?? 0).toLocaleString("es-CO")}`;
    }
    case "oc_validar": {
      const bloqueos = (data.bloqueos as Array<{ codigo: string }> | undefined) ?? [];
      const confs = (data.confirmaciones as Array<{ codigo: string }> | undefined) ?? [];
      return `apta=${String(data.apta)} · bloqueos=[${bloqueos.map((b) => b.codigo).join(",")}] · confirmaciones=[${confs.map((c) => c.codigo).join(",")}] · retroactiva=${String(data.retroactiva)}`;
    }
    case "oc_generar_evidencia":
      return `Evidencia generada (${String(data.ruta_pdf ?? data.ruta)}) · SHA-256: ${String(data.sha256 ?? "").slice(0, 16)}...`;
    case "oc_construir_payload": {
      const oc = (data.orden_compra ?? {}) as Record<string, unknown>;
      const prov = (oc.proveedor ?? {}) as Record<string, unknown>;
      return `Payload SAP preparado · Proveedor SAP ${String(prov.codigo_sap ?? "")} · Trazabilidad en ${String(data.ruta_trazabilidad ?? "")}`;
    }
    case "oc_crear":
      return `OC SAP #${String(data.numero_oc ?? "")} (${data.idempotente ? "idempotente" : "creada"}) · retroactiva=${String(data.retroactiva)}`;
    default:
      return "Ejecución exitosa";
  }
}

function esMensajeAfirmativoConfirmacion(texto: string): boolean {
  const limpio = texto.trim();
  if (/\b(no confirmo|rechaz[oa]r?|cancelar?|no crear)\b/i.test(limpio)) {
    return false;
  }
  return /^(s[ií]|confirmo|confirmar|apruebo|aprobar|procede|proceder|adelante|de acuerdo|ok,? crear|crear la oc)\b|\b(confirmo la creaci[oó]n|apruebo crear la oc)\b/i.test(
    limpio
  );
}

function esMensajeRechazoConfirmacion(texto: string): boolean {
  const limpio = texto.trim();
  if (/\bno la crees hasta que yo lo confirme\b/i.test(limpio)) {
    return false;
  }
  return /^(no|rechazo|rechazar|cancelar|detener)\b|\b(rechazo la creaci[oó]n|no crear la oc|cancela la orden)\b/i.test(
    limpio
  );
}

function usuarioPideConfirmacionExplicitaEnMensaje(texto: string): boolean {
  return /\b(no la crees hasta|antes de crear|sin crear|pide confirmaci[oó]n)\b/i.test(texto);
}

export class GestorCicloAgente {
  private readonly projectRoot: string;
  private readonly sesiones = new Map<string, SesionAgente>();
  private readonly herramientas = construirRegistroHerramientas();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  cargarSystemPrompt(): string {
    const promptPath = path.join(this.projectRoot, "agent", "prompt.md");
    return fs.readFileSync(promptPath, "utf-8");
  }

  obtenerOCrearSesion(sessionId: string): SesionAgente {
    const existente = this.sesiones.get(sessionId);
    if (existente) {
      return existente;
    }
    const ahora = new Date().toISOString();
    const nueva: SesionAgente = {
      sessionId,
      createdAt: ahora,
      updatedAt: ahora,
      messages: [],
      turns: [],
      totalTokensUsed: 0,
      pendingConfirmation: null,
      approvedCases: new Set<string>(),
    };
    this.sesiones.set(sessionId, nueva);
    return nueva;
  }

  obtenerSesion(sessionId: string): SesionAgente | null {
    return this.sesiones.get(sessionId) ?? null;
  }

  eliminarSesion(sessionId: string): boolean {
    return this.sesiones.delete(sessionId);
  }

  async procesarTurno(
    sessionId: string,
    userMessage: string,
    llm: LlmAdapter
  ): Promise<ResultadoTurnoAgente> {
    const sesion = this.obtenerOCrearSesion(sessionId);
    const maxIteraciones = Math.max(1, Number(process.env.AGENT_MAX_ITERATIONS ?? 25));
    const maxTokensSesion = Math.max(1000, Number(process.env.SESSION_MAX_TOKENS ?? 120000));
    const politicaConfirmacion = (process.env.CONFIRM_POLICY ?? "prd").toLowerCase();

    if (sesion.totalTokensUsed >= maxTokensSesion) {
      const msgLimite = `Se alcanzó el límite de seguridad de tokens para esta sesión (${sesion.totalTokensUsed.toLocaleString("es-CO")} / ${maxTokensSesion.toLocaleString("es-CO")} tokens). Inicia una nueva sesión para continuar.`;
      return {
        sessionId,
        reply: msgLimite,
        toolCalls: [],
        needsConfirmation: false,
        pendingConfirmation: sesion.pendingConfirmation,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          sessionTotalTokens: sesion.totalTokensUsed,
        },
      };
    }

    // Guardia determinista HITL (Policy Enforcement Point fuera del LLM):
    // Solo un turno explícito del humano desbloquea `approvedCases` para un caso con confirmación pendiente.
    const confirmacionPrevia = sesion.pendingConfirmation;
    let rechazoExplicitoCaso: string | null = null;

    if (confirmacionPrevia && esMensajeAfirmativoConfirmacion(userMessage)) {
      sesion.approvedCases.add(confirmacionPrevia.caso);
      sesion.pendingConfirmation = null;
    } else if (confirmacionPrevia && esMensajeRechazoConfirmacion(userMessage)) {
      rechazoExplicitoCaso = confirmacionPrevia.caso;
      sesion.approvedCases.delete(confirmacionPrevia.caso);
      sesion.pendingConfirmation = null;
    }

    const pausaPedidaPorUsuario =
      usuarioPideConfirmacionExplicitaEnMensaje(userMessage) ||
      politicaConfirmacion === "always";

    sesion.messages.push({
      role: "user",
      content: userMessage,
    });

    const systemPrompt = this.cargarSystemPrompt();
    const listaHerramientas = Array.from(this.herramientas.values());
    const toolCallsTurno: TrazaLlamadaHerramienta[] = [];
    const usoTurno: UsoTokens = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    let iteracion = 0;
    let respuestaFinal = "";

    try {
      while (iteracion < maxIteraciones) {
        iteracion += 1;
        const respuestaLlm = await llm.enviar(sesion.messages, listaHerramientas, systemPrompt);

        usoTurno.inputTokens += respuestaLlm.usage.inputTokens;
        usoTurno.outputTokens += respuestaLlm.usage.outputTokens;
        usoTurno.totalTokens += respuestaLlm.usage.totalTokens;
        sesion.totalTokensUsed += respuestaLlm.usage.totalTokens;

        if (respuestaLlm.toolCalls.length === 0) {
          respuestaFinal =
            respuestaLlm.text ||
            "Proceso completado. Indícame si deseas revisar otra solicitud.";
          sesion.messages.push({
            role: "assistant",
            content: respuestaFinal,
            providerMeta: respuestaLlm.providerMeta,
          });
          break;
        }

        // Registrar llamada de herramientas del asistente en el historial
        sesion.messages.push({
          role: "assistant",
          content: respuestaLlm.text,
          toolCalls: respuestaLlm.toolCalls,
          providerMeta: respuestaLlm.providerMeta,
        });

        const resultadosParaModelo: ResultadoHerramientaMensaje[] = [];

        for (const tc of respuestaLlm.toolCalls) {
          const inicio = Date.now();
          const tool = this.herramientas.get(tc.name);

          if (!tool) {
            const errJson = JSON.stringify({
              ok: false,
              error: `La herramienta "${tc.name}" no existe en el registro autorizado.`,
            });
            resultadosParaModelo.push({
              toolCallId: tc.id,
              name: tc.name,
              resultJson: errJson,
            });
            toolCallsTurno.push({
              id: tc.id,
              name: tc.name,
              args: tc.args,
              ok: false,
              resultSummary: `Herramienta desconocida: ${tc.name}`,
              rawResult: { ok: false, error: `Herramienta desconocida: ${tc.name}` },
              durationMs: Date.now() - inicio,
            });
            continue;
          }

          // PEP Determinista sobre `oc_crear`:
          // 1. Si el usuario rechazó crear el caso, bloquear ejecución.
          // 2. Si el usuario pidió pausa explícita o el caso no está aprobado por humano en turno posterior,
          //    impedir que el LLM fuerce `confirmado: true` por su cuenta.
          const argsEjecucion: Record<string, unknown> = { ...tc.args };
          const casoArg =
            typeof argsEjecucion.caso === "string" ? argsEjecucion.caso.toLowerCase() : "";

          if (tc.name === "oc_crear" && casoArg) {
            if (rechazoExplicitoCaso === casoArg) {
              const bloqueadoRechazo = JSON.stringify({
                ok: false,
                error: `La creación de ${casoArg} fue rechazada explícitamente por la analista.`,
              });
              resultadosParaModelo.push({
                toolCallId: tc.id,
                name: tc.name,
                resultJson: bloqueadoRechazo,
              });
              toolCallsTurno.push({
                id: tc.id,
                name: tc.name,
                args: argsEjecucion,
                ok: false,
                resultSummary: "Cancelado por rechazo explícito del usuario",
                rawResult: JSON.parse(bloqueadoRechazo),
                durationMs: Date.now() - inicio,
              });
              continue;
            }

            const aprobadoPorHumano = sesion.approvedCases.has(casoArg);
            if (!aprobadoPorHumano) {
              // Impide auto-confirmación por alucinación o prompt injection
              argsEjecucion.confirmado = false;
            }

            if (pausaPedidaPorUsuario && !aprobadoPorHumano) {
              sesion.pendingConfirmation = sesion.pendingConfirmation ?? {
                caso: casoArg,
                retroactiva: false,
                confirmaciones: [],
                motivoGeneral:
                  "Confirmación previa solicitada antes de registrar la Orden de Compra en SAP.",
              };
              const pausaJson = JSON.stringify({
                ok: false,
                requiere_confirmacion: true,
                error:
                  "Pausa de confirmación humana activa: presenta la vista previa del payload SAP al usuario y espera su confirmación explícita antes de ejecutar oc_crear.",
              });
              resultadosParaModelo.push({
                toolCallId: tc.id,
                name: tc.name,
                resultJson: pausaJson,
              });
              toolCallsTurno.push({
                id: tc.id,
                name: tc.name,
                args: argsEjecucion,
                ok: false,
                resultSummary: "Detenido por guardia HITL: esperando confirmación humana",
                rawResult: JSON.parse(pausaJson),
                durationMs: Date.now() - inicio,
              });
              continue;
            }
          }

          const salidaJson = await tool.execute(argsEjecucion, {
            directory: this.projectRoot,
            sessionId: sesion.sessionId,
          });

          const parsed = JSON.parse(salidaJson) as Record<string, unknown>;
          const ok = Boolean(parsed.ok);

          // Actualizar estado de confirmación pendiente cuando `oc_validar` detecta excepciones
          // o cuando el usuario pidió pausa explícita en un caso apto
          if (tc.name === "oc_validar" && ok && casoArg) {
            const valData = parsed.data as {
              apta: boolean;
              retroactiva: boolean;
              confirmaciones: HallazgoControl[];
            };
            if (
              valData.apta &&
              (valData.confirmaciones.length > 0 || pausaPedidaPorUsuario) &&
              !sesion.approvedCases.has(casoArg)
            ) {
              sesion.pendingConfirmation = {
                caso: casoArg,
                retroactiva: valData.retroactiva,
                confirmaciones: valData.confirmaciones,
                motivoGeneral:
                  valData.confirmaciones.length > 0
                    ? `Excepciones detectadas: ${valData.confirmaciones.map((c) => c.codigo).join(", ")}`
                    : "Revisión humana previa antes de crear OC en SAP",
              };
            } else if (!valData.apta) {
              sesion.pendingConfirmation = null;
            }
          }

          // Si `oc_crear` tuvo éxito, limpiar estado pendiente de ese caso
          if (tc.name === "oc_crear" && ok && casoArg) {
            if (sesion.pendingConfirmation?.caso === casoArg) {
              sesion.pendingConfirmation = null;
            }
          }

          resultadosParaModelo.push({
            toolCallId: tc.id,
            name: tc.name,
            resultJson: salidaJson,
          });

          toolCallsTurno.push({
            id: tc.id,
            name: tc.name,
            args: argsEjecucion,
            ok,
            resultSummary: resumirResultadoHerramienta(tc.name, parsed),
            rawResult: parsed,
            durationMs: Date.now() - inicio,
          });
        }

        sesion.messages.push({
          role: "tool",
          content: "",
          toolResults: resultadosParaModelo,
        });
      }

      // Regla CA1: si alcanzó el tope de iteraciones sin cerrar respuesta textual
      if (!respuestaFinal) {
        respuestaFinal = `Se alcanzó el tope máximo de ${maxIteraciones} iteraciones herramienta → modelo en este turno (Regla CA1). Se ejecutaron ${toolCallsTurno.length} llamadas a herramientas; revisa los resultados parciales en el panel y dime cómo deseas continuar.`;
        sesion.messages.push({
          role: "assistant",
          content: respuestaFinal,
        });
      }
    } catch (err) {
      // Regla CA5: un fallo del proveedor LLM o red nunca mata la sesión
      const mensajeClaro = sanitizarErrorSinSecretos(err);
      respuestaFinal = `⚠️ **Error de comunicación con el modelo (${llm.providerName}/${llm.modelName}):** ${mensajeClaro}\n\nLa sesión sigue activa. Verifica la variable de entorno correspondiente o intenta nuevamente.`;
      sesion.messages.push({
        role: "assistant",
        content: respuestaFinal,
      });
    }

    sesion.updatedAt = new Date().toISOString();
    const needsConfirmation = sesion.pendingConfirmation !== null;

    const turnoVisible: TurnoVisible = {
      id: `turn_${sesion.turns.length + 1}`,
      ts: sesion.updatedAt,
      userMessage,
      assistantReply: respuestaFinal,
      toolCalls: toolCallsTurno,
      needsConfirmation,
      pendingConfirmation: sesion.pendingConfirmation,
    };
    sesion.turns.push(turnoVisible);
    this.persistirSesionEnDisco(sesion);

    return {
      sessionId: sesion.sessionId,
      reply: respuestaFinal,
      toolCalls: toolCallsTurno,
      needsConfirmation,
      pendingConfirmation: sesion.pendingConfirmation,
      usage: {
        ...usoTurno,
        sessionTotalTokens: sesion.totalTokensUsed,
      },
    };
  }

  private persistirSesionEnDisco(sesion: SesionAgente): void {
    try {
      const dir = path.join(this.projectRoot, "out", "sessions");
      fs.mkdirSync(dir, { recursive: true });
      const safeId = sesion.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const serializable = {
        sessionId: sesion.sessionId,
        createdAt: sesion.createdAt,
        updatedAt: sesion.updatedAt,
        totalTokensUsed: sesion.totalTokensUsed,
        pendingConfirmation: sesion.pendingConfirmation,
        approvedCases: Array.from(sesion.approvedCases),
        turns: sesion.turns,
      };
      fs.writeFileSync(
        path.join(dir, `${safeId}.json`),
        JSON.stringify(serializable, null, 2),
        "utf-8"
      );
    } catch {
      // No interrumpir flujo conversacional si el sistema de archivos es efímero
    }
  }
}
