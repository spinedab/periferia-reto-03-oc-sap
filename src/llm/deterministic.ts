import crypto from "node:crypto";
import type { RegisteredTool } from "../tools/registry.js";
import type { OrdenCompra, Paquete, ResultadoValidacion } from "../types.js";
import type { LlmAdapter, MensajeConversacion, RespuestaLlm } from "./adapter.js";

/**
 * Orquestador determinista de contingencia (sin LLM externo).
 * Implementa `LlmAdapter` invocando exactamente las mismas herramientas registradas (`oc_*`)
 * para garantizar continuidad operativa en caso de caída/cuota del proveedor LLM o pruebas offline.
 */
export class DeterministicFallbackAdapter implements LlmAdapter {
  readonly providerName = "deterministic";
  readonly modelName = "rule-engine-v1";
  readonly isConfigured = true;

  private extraerUltimoTurnoUsuario(mensajes: MensajeConversacion[]): {
    indice: number;
    texto: string;
  } {
    for (let i = mensajes.length - 1; i >= 0; i--) {
      const m = mensajes[i];
      if (m && m.role === "user") {
        return { indice: i, texto: m.content };
      }
    }
    return { indice: 0, texto: "" };
  }

  private detectarCasoEnHistorial(mensajes: MensajeConversacion[], desdeIndice: number): string | null {
    const actual = mensajes[desdeIndice]?.content ?? "";
    const matchDirecto = /\b(sol-\d{3})\b/i.exec(actual);
    if (matchDirecto?.[1]) {
      return matchDirecto[1].toLowerCase();
    }
    // Buscar el último caso discutido en la sesión (para turnos de "confirmo" / "aprobar")
    for (let i = desdeIndice - 1; i >= 0; i--) {
      const m = mensajes[i];
      if (!m) continue;
      const matchTexto = /\b(sol-\d{3})\b/i.exec(m.content);
      if (matchTexto?.[1]) return matchTexto[1].toLowerCase();
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          if (typeof tc.args.caso === "string") {
            return tc.args.caso.toLowerCase();
          }
        }
      }
    }
    return null;
  }

  async enviar(
    mensajes: MensajeConversacion[],
    _herramientas: RegisteredTool[],
    _systemPrompt: string
  ): Promise<RespuestaLlm> {
    const { indice: idxUser, texto: userText } = this.extraerUltimoTurnoUsuario(mensajes);
    const mensajesTurnoActual = mensajes.slice(idxUser + 1);

    const resultadosTurno = new Map<string, Record<string, unknown>>();
    for (const m of mensajesTurnoActual) {
      if (m.role === "tool" && m.toolResults) {
        for (const tr of m.toolResults) {
          try {
            resultadosTurno.set(tr.name, JSON.parse(tr.resultJson) as Record<string, unknown>);
          } catch {
            resultadosTurno.set(tr.name, { ok: false, error: tr.resultJson });
          }
        }
      }
    }

    const esRechazo = /\b(rechaz[oa]r?|cancelar?|no crear|no confirmo)\b/i.test(userText) &&
      !/\bno la crees hasta que yo lo confirme\b/i.test(userText);
    const esConfirmacion =
      !esRechazo &&
      /^(s[ií]|confirmo|confirmar|apruebo|aprobar|proceder|adelante|crear oc)\b|\b(confirmo la creaci[oó]n|apruebo crear)\b/i.test(
        userText.trim()
      );
    const usuarioPidePausaPrevia =
      /\b(no la crees hasta|antes de crear|mu[eé]strame.*no la crees|sin crear)\b/i.test(userText);

    const caso = this.detectarCasoEnHistorial(mensajes, idxUser);

    if (esRechazo && caso) {
      return {
        text: `Entendido. Se ha **cancelado** la creación de la Orden de Compra para el caso **${caso}**. Te recomiendo devolver las observaciones al solicitante para que ajuste el soporte antes de radicar nuevamente.`,
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }

    // Flujo de confirmación explícita en turno posterior
    if (esConfirmacion && caso) {
      if (!resultadosTurno.has("oc_crear")) {
        return {
          text: "",
          toolCalls: [
            {
              id: `det_${crypto.randomUUID().slice(0, 8)}`,
              name: "oc_crear",
              args: { caso, confirmado: true },
            },
          ],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      }
      const resCrear = resultadosTurno.get("oc_crear");
      if (resCrear?.ok) {
        const d = resCrear.data as {
          numero_oc: string;
          fecha: string;
          idempotente: boolean;
          retroactiva: boolean;
          solicitud_id: string;
        };
        return {
          text: [
            `### Orden de Compra Creada en SAP`,
            `- **Caso:** \`${caso}\` (\`${d.solicitud_id}\`)`,
            `- **Número de OC SAP:** **\`${d.numero_oc}\`** ${d.idempotente ? "*(recuperada por idempotencia)*" : ""}`,
            `- **Fecha de registro:** \`${d.fecha}\``,
            `- **Marca compra retroactiva:** \`${d.retroactiva}\``,
            `- **Evidencia archivada:** \`out/${caso}/aprobacion.txt\` y \`out/${caso}/aprobacion.pdf\``,
            `- **Auditoría registrada:** \`out/control.csv\` y \`out/sap/ordenes.jsonl\``,
          ].join("\n"),
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      }
      return {
        text: `No fue posible crear la OC para \`${caso}\`: ${String(resCrear?.error ?? "Error desconocido")}`,
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }

    // Si pide listar solicitudes disponibles o no menciona ningún caso específico
    if (!caso) {
      if (!resultadosTurno.has("oc_listar_casos")) {
        return {
          text: "",
          toolCalls: [
            {
              id: `det_${crypto.randomUUID().slice(0, 8)}`,
              name: "oc_listar_casos",
              args: {},
            },
          ],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      }
      const resLista = resultadosTurno.get("oc_listar_casos");
      const casos = ((resLista?.data as { casos?: Array<Record<string, unknown>> })?.casos ?? []);
      const filas = casos
        .map(
          (c) =>
            `| \`${c.caso}\` | ${c.solicitud_id} | ${c.proveedor_nombre} | ${c.centro_costo} | ${c.moneda} ${Number(c.valor_total ?? 0).toLocaleString("es-CO")} | ${c.incluye_factura ? "Sí (Factura adjunta)" : "No"} |`
        )
        .join("\n");
      return {
        text: [
          "Hola, soy el **Agente de Órdenes de Compra SAP** de Periferia IT Group.",
          "",
          "Actualmente están disponibles los siguientes paquetes en `fixtures/reto-03/solicitudes/`:",
          "",
          "| Caso | Solicitud ID | Proveedor | Centro Costo | Valor Total | Factura |",
          "|---|---|---|---|---:|---|",
          filas,
          "",
          'Indícame qué solicitud deseas procesar (por ejemplo: *"Procesa la solicitud sol-004"* o *"Procesa sol-001"*).',
        ].join("\n"),
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }

    // Secuencia determinista por herramientas para un caso específico
    if (!resultadosTurno.has("oc_leer_paquete")) {
      return {
        text: "",
        toolCalls: [
          {
            id: `det_${crypto.randomUUID().slice(0, 8)}`,
            name: "oc_leer_paquete",
            args: { caso },
          },
        ],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }

    const resLeer = resultadosTurno.get("oc_leer_paquete");
    if (!resLeer?.ok) {
      return {
        text: `No se pudo leer el paquete \`${caso}\`: **${String(resLeer?.error)}**`,
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }

    if (!resultadosTurno.has("oc_validar")) {
      return {
        text: "",
        toolCalls: [
          {
            id: `det_${crypto.randomUUID().slice(0, 8)}`,
            name: "oc_validar",
            args: { caso },
          },
        ],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }

    const resVal = resultadosTurno.get("oc_validar");
    if (!resVal?.ok) {
      return {
        text: `Error al validar \`${caso}\`: **${String(resVal?.error)}**`,
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }

    const validacion = resVal.data as ResultadoValidacion;
    const paquete = resLeer.data as Paquete;

    // Caso A: Bloqueado
    if (!validacion.apta) {
      const detalleBloqueos = validacion.bloqueos
        .map(
          (b) =>
            `- **${b.codigo} (${b.regla}):** ${b.detalle}\n  - *Acción recomendada:* ${b.accion_sugerida}`
        )
        .join("\n");
      return {
        text: [
          `### Solicitud Rechazada por Control Interno (\`${caso}\` — \`${paquete.solicitud.solicitud_id}\`)`,
          "",
          "La Orden de Compra **no puede crearse en SAP** porque fallaron controles obligatorios de bloqueo:",
          "",
          detalleBloqueos,
          "",
          "El intento bloqueado quedó registrado en `out/control.csv`.",
        ].join("\n"),
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }

    // Caso B y C: apta = true -> generar evidencia y construir payload
    if (!resultadosTurno.has("oc_generar_evidencia")) {
      return {
        text: "",
        toolCalls: [
          {
            id: `det_${crypto.randomUUID().slice(0, 8)}`,
            name: "oc_generar_evidencia",
            args: { caso },
          },
        ],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }

    if (!resultadosTurno.has("oc_construir_payload")) {
      return {
        text: "",
        toolCalls: [
          {
            id: `det_${crypto.randomUUID().slice(0, 8)}`,
            name: "oc_construir_payload",
            args: { caso },
          },
        ],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }

    const resPayload = resultadosTurno.get("oc_construir_payload");
    const oc = (resPayload?.data as { orden_compra: OrdenCompra })?.orden_compra;
    const pos = oc?.posiciones[0];

    const requiereConfirmacion =
      validacion.confirmaciones.length > 0 || usuarioPidePausaPrevia;

    if (requiereConfirmacion) {
      const listaConfirmaciones =
        validacion.confirmaciones.length > 0
          ? validacion.confirmaciones
              .map(
                (c) =>
                  `- **${c.codigo} — ${c.regla}:** ${c.detalle}\n  - *Recomendación:* ${c.accion_sugerida}`
              )
              .join("\n")
          : "- *Pausa preventiva solicitada explícitamente por la analista antes de registrar en SAP.*";

      const tablaControles = validacion.controles_evaluados
        .map((c) => `| \`${c.codigo}\` | ${c.nombre} | **${c.estado}** | ${c.detalle} |`)
        .join("\n");

      return {
        text: [
          `### Vista Previa de Orden de Compra SAP (\`${caso}\` — \`${oc.referencia.solicitud_id}\`)`,
          "",
          "| Campo SAP | Valor Preparado |",
          "|---|---|",
          `| Sociedad / Org. Compras | \`${oc.sociedad}\` / \`${oc.organizacion_compras}\` |`,
          `| Proveedor | **${oc.proveedor.nombre}** (SAP \`${oc.proveedor.codigo_sap}\` · NIT \`${oc.proveedor.nit}\`) |`,
          `| Posición \`${pos?.numero}\` | \`${pos?.descripcion}\` |`,
          `| Cantidad / Unidad | \`${pos?.cantidad} ${pos?.unidad}\` × \`${oc.moneda} ${pos?.precio_unitario.toLocaleString("es-CO")}\` |`,
          `| Valor Total Solicitud | **${oc.moneda} ${paquete.solicitud.valor_total.toLocaleString("es-CO")}** |`,
          `| Imputación | \`${pos?.centro_costo}\` / \`${pos?.subarea}\` |`,
          `| IVA / Condición de Pago | \`${pos?.indicador_iva}\` / \`${oc.condiciones_pago}\` |`,
          `| Aprobador | \`${oc.aprobador.email}\` (\`${oc.aprobador.fecha_aprobacion}\`) |`,
          `| Evidencia SHA-256 | \`${oc.aprobador.evidencia_sha256.slice(0, 24)}...\` |`,
          `| Compra Retroactiva | **${validacion.retroactiva ? "SÍ (Desvío detectado)" : "No"}** |`,
          "",
          "#### Excepciones que requieren confirmación humana",
          listaConfirmaciones,
          "",
          "<details><summary>Ver detalle completo de controles RC1–RC10</summary>\n\n| Regla | Control | Estado | Detalle |\n|---|---|---|---|\n" +
            tablaControles +
            "\n</details>",
          "",
          "**¿Confirmas la creación de esta Orden de Compra en SAP con las condiciones y excepciones indicadas?**",
        ].join("\n"),
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }

    // Caso C: Sin excepciones ni pausa pedida -> crea automáticamente (Objetivo O1 del PRD)
    if (!resultadosTurno.has("oc_crear")) {
      return {
        text: "",
        toolCalls: [
          {
            id: `det_${crypto.randomUUID().slice(0, 8)}`,
            name: "oc_crear",
            args: { caso, confirmado: false },
          },
        ],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }

    const resCrear = resultadosTurno.get("oc_crear");
    const creado = resCrear?.data as {
      numero_oc: string;
      fecha: string;
      idempotente: boolean;
      retroactiva: boolean;
    };

    return {
      text: [
        `### Orden de Compra Creada Automáticamente (\`${caso}\` — \`${oc.referencia.solicitud_id}\`)`,
        "",
        `Todos los controles internos (\`RC1\` a \`RC10\`) fueron superados sin bloqueos ni excepciones.`,
        "",
        `- **Número de OC SAP:** **\`${creado.numero_oc}\`** ${creado.idempotente ? "*(idempotente: ya existía para esta solicitud)*" : ""}`,
        `- **Proveedor:** ${oc.proveedor.nombre} (SAP \`${oc.proveedor.codigo_sap}\`)`,
        `- **Valor Total:** ${oc.moneda} ${paquete.solicitud.valor_total.toLocaleString("es-CO")}`,
        `- **Centro de Costo / Subárea:** \`${pos?.centro_costo}\` / \`${pos?.subarea}\``,
        `- **Evidencia aprobador:** \`out/${caso}/aprobacion.pdf\` (\`SHA-256: ${oc.aprobador.evidencia_sha256.slice(0, 20)}...\`)`,
        `- **Trazabilidad:** \`out/${caso}/trazabilidad.json\``,
      ].join("\n"),
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }
}
