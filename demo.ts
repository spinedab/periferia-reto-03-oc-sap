import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  construir_payload,
  crear,
  generar_evidencia,
  leer_paquete,
  validar,
} from "./src/tools/oc.js";
import type {
  OrdenCompra,
  Paquete,
  ResultadoValidacion,
  ToolContext,
  ToolResult,
} from "./src/types.js";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.dirname(__filename);

const CASOS = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"] as const;

interface ResumenCasoDemo {
  caso: string;
  solicitudId: string;
  apta: boolean;
  retroactiva: boolean;
  estadoInicial:
    | "APROBADA (OC CREADA)"
    | "RECHAZADA (BLOQUEADA)"
    | "REQUIERE CONFIRMACIÓN"
    | "RETROACTIVA / REQUIERE CONFIRMACIÓN";
  bloqueos: string;
  confirmaciones: string;
  derivados: string;
  numeroOcInicial: string;
  motivoPrincipal: string;
}

function parseToolOutput<T>(raw: string): ToolResult<T> {
  return JSON.parse(raw) as ToolResult<T>;
}

async function ejecutarDemoDeterminista(): Promise<void> {
  // Requisito §8 PRD: limpiar out/ al inicio para garantizar determinismo entre corridas
  const outDir = path.join(PROJECT_ROOT, "out");
  fs.rmSync(outDir, { recursive: true, force: true });

  const ctx: ToolContext = {
    directory: PROJECT_ROOT,
    sessionId: "demo-determinista-sin-llm",
  };

  console.log("================================================================================");
  console.log("  PERIFERIA IT GROUP · RETO 03 — VERIFICACIÓN DETERMINISTA SIN LLM (demo.ts)");
  console.log("================================================================================\n");

  const tablaResumen: ResumenCasoDemo[] = [];

  // ---------------------------------------------------------------------------
  // FASE 1: Evaluación determinista inicial de los 6 casos (sin confirmación humana)
  // ---------------------------------------------------------------------------
  for (const caso of CASOS) {
    console.log(`────────────────────────────────────────────────────────────────────────────────`);
    console.log(`▶ PROCESANDO CASO: ${caso.toUpperCase()}`);
    console.log(`────────────────────────────────────────────────────────────────────────────────`);

    const resLeer = parseToolOutput<Paquete>(await leer_paquete.execute({ caso }, ctx));
    if (!resLeer.ok) {
      console.log(`  [ERROR LECTURA] ${resLeer.error}\n`);
      continue;
    }
    const paquete = resLeer.data;

    console.log(
      `  Solicitud:  ${paquete.solicitud.solicitud_id} | Solicitante: ${paquete.solicitud.solicitante}`
    );
    console.log(
      `  Proveedor:  ${paquete.solicitud.proveedor_nombre} (NIT solicitud: ${paquete.solicitud.proveedor_nit ?? "AUSENTE"})`
    );
    console.log(
      `  Imputación: ${paquete.solicitud.centro_costo} / ${paquete.solicitud.subarea} | Total: ${paquete.solicitud.moneda} ${paquete.solicitud.valor_total.toLocaleString("es-CO")}`
    );

    const resValidar = parseToolOutput<ResultadoValidacion>(
      await validar.execute({ caso, paquete }, ctx)
    );
    if (!resValidar.ok) {
      console.log(`  [ERROR VALIDACIÓN] ${resValidar.error}\n`);
      continue;
    }
    const val = resValidar.data;

    console.log(`  Controles evaluados (RC1–RC10):`);
    for (const ctrl of val.controles_evaluados) {
      const icono =
        ctrl.estado === "APROBADO"
          ? "✓"
          : ctrl.estado === "DERIVADO"
            ? "ℹ"
            : ctrl.estado === "CONFIRMACION"
              ? "⚠"
              : "✖";
      console.log(`    ${icono} [${ctrl.codigo}] (${ctrl.estado}) ${ctrl.detalle}`);
    }

    const codigosBloqueo = val.bloqueos.map((b) => b.codigo).join(", ") || "Ninguno";
    const codigosConf = val.confirmaciones.map((c) => c.codigo).join(", ") || "Ninguna";

    const derivadosRelevantes: string[] = [];
    if (val.derivados.metodo_resolucion_proveedor === "nombre_normalizado") {
      derivadosRelevantes.push(`NIT=${val.derivados.proveedor_nit_resuelto}`);
    }
    if (val.derivados.indicador_iva_origen === "maestro.proveedores") {
      derivadosRelevantes.push(`IVA=${val.derivados.indicador_iva}`);
    }
    if (val.derivados.condiciones_pago_origen === "maestro.proveedores") {
      derivadosRelevantes.push(`Pago=${val.derivados.condiciones_pago}`);
    }
    const resumenDerivados = derivadosRelevantes.join(", ") || "Ninguno";

    if (!val.apta) {
      const motivo = val.bloqueos.map((b) => `${b.codigo}: ${b.detalle}`).join(" | ");
      console.log(`\n  ➤ RESULTADO:   RECHAZADA (BLOQUEADA)`);
      console.log(`  ➤ apta:        false | retroactiva: ${val.retroactiva}`);
      console.log(`  ➤ Bloqueos:    ${codigosBloqueo}`);
      console.log(`  ➤ Motivo:      ${motivo}`);
      console.log(`  ➤ Acción:      ${val.bloqueos[0]?.accion_sugerida ?? ""}`);
      console.log(`  ➤ Número OC:   NO CREADA\n`);

      tablaResumen.push({
        caso,
        solicitudId: paquete.solicitud.solicitud_id,
        apta: false,
        retroactiva: val.retroactiva,
        estadoInicial: "RECHAZADA (BLOQUEADA)",
        bloqueos: codigosBloqueo,
        confirmaciones: codigosConf,
        derivados: resumenDerivados,
        numeroOcInicial: "—",
        motivoPrincipal: val.bloqueos.map((b) => b.codigo).join("+"),
      });
      continue;
    }

    // Si es apta, generamos evidencia (TXT + PDF + SHA-256) y construimos payload SAP
    const resEvidencia = parseToolOutput<{ ruta: string; ruta_pdf: string; sha256: string }>(
      await generar_evidencia.execute({ caso }, ctx)
    );
    const resPayload = parseToolOutput<{ orden_compra: OrdenCompra; ruta_trazabilidad: string }>(
      await construir_payload.execute({ caso, paquete, derivados: val.derivados }, ctx)
    );

    if (resEvidencia.ok) {
      console.log(
        `  Evidencia:  ${resEvidencia.data.ruta} | ${resEvidencia.data.ruta_pdf} (SHA-256: ${resEvidencia.data.sha256.slice(0, 16)}...)`
      );
    }

    const payloadOc = resPayload.ok ? resPayload.data.orden_compra : undefined;

    // Intento sin confirmación humana (`confirmado: false`)
    const resCrear = parseToolOutput<{
      numero_oc: string;
      fecha: string;
      idempotente: boolean;
      retroactiva: boolean;
    }>(await crear.execute({ caso, payload: payloadOc, confirmado: false }, ctx));

    if (resCrear.ok) {
      console.log(`\n  ➤ RESULTADO:   APROBADA (OC CREADA AUTOMÁTICAMENTE)`);
      console.log(`  ➤ apta:        true | retroactiva: ${val.retroactiva}`);
      console.log(`  ➤ Número OC:   ${resCrear.data.numero_oc} (idempotente=${resCrear.data.idempotente})\n`);

      tablaResumen.push({
        caso,
        solicitudId: paquete.solicitud.solicitud_id,
        apta: true,
        retroactiva: val.retroactiva,
        estadoInicial: "APROBADA (OC CREADA)",
        bloqueos: codigosBloqueo,
        confirmaciones: codigosConf,
        derivados: resumenDerivados,
        numeroOcInicial: resCrear.data.numero_oc,
        motivoPrincipal: "Flujo limpio sin excepciones (O1)",
      });
    } else {
      const etiquetaEstado = val.retroactiva
        ? "RETROACTIVA / REQUIERE CONFIRMACIÓN"
        : "REQUIERE CONFIRMACIÓN";
      const motivo = val.confirmaciones.map((c) => `${c.codigo}: ${c.detalle}`).join(" | ");

      console.log(`\n  ➤ RESULTADO:   ${etiquetaEstado}`);
      console.log(`  ➤ apta:        true | retroactiva: ${val.retroactiva}`);
      console.log(`  ➤ Excepciones: ${codigosConf} | Derivados: ${resumenDerivados}`);
      console.log(`  ➤ Motivo:      ${motivo}`);
      console.log(`  ➤ Número OC:   PENDIENTE DE CONFIRMACIÓN HUMANA\n`);

      tablaResumen.push({
        caso,
        solicitudId: paquete.solicitud.solicitud_id,
        apta: true,
        retroactiva: val.retroactiva,
        estadoInicial: etiquetaEstado,
        bloqueos: codigosBloqueo,
        confirmaciones: codigosConf,
        derivados: resumenDerivados,
        numeroOcInicial: "PENDIENTE",
        motivoPrincipal: val.confirmaciones.map((c) => c.codigo).join("+"),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // FASE 2: Demostración obligatoria de Idempotencia en `sol-001` (PRD §6.6)
  // ---------------------------------------------------------------------------
  console.log("================================================================================");
  console.log("  VERIFICACIÓN DE IDEMPOTENCIA Y CONFIRMACIÓN HUMANA EXPLÍCITA (PRD §6.6)");
  console.log("================================================================================");

  const reintentoSol001 = parseToolOutput<{
    numero_oc: string;
    fecha: string;
    idempotente: boolean;
  }>(await crear.execute({ caso: "sol-001", confirmado: false }, ctx));

  if (reintentoSol001.ok) {
    console.log(
      `  1) Reintento idempotente de sol-001 → OC #${reintentoSol001.data.numero_oc} | idempotente=${reintentoSol001.data.idempotente} (sin duplicar registro en SAP)`
    );
  }

  // ---------------------------------------------------------------------------
  // FASE 3: Confirmación explícita de `sol-004` (PRD §6.6) y `sol-005` retroactiva (PRD §3.1 O4)
  // ---------------------------------------------------------------------------
  const confirmacionSol004 = parseToolOutput<{
    numero_oc: string;
    fecha: string;
    idempotente: boolean;
    retroactiva: boolean;
  }>(await crear.execute({ caso: "sol-004", confirmado: true }, ctx));

  if (confirmacionSol004.ok) {
    console.log(
      `  2) Confirmación explícita de sol-004 (RC5 cotización +6%) → OC #${confirmacionSol004.data.numero_oc} creada exitosamente`
    );
  }

  const confirmacionSol005 = parseToolOutput<{
    numero_oc: string;
    fecha: string;
    idempotente: boolean;
    retroactiva: boolean;
  }>(await crear.execute({ caso: "sol-005", confirmado: true }, ctx));

  if (confirmacionSol005.ok) {
    console.log(
      `  3) Confirmación explícita de sol-005 (RC8 factura previa) → OC #${confirmacionSol005.data.numero_oc} creada con retroactiva=${confirmacionSol005.data.retroactiva}`
    );
  }

  // ---------------------------------------------------------------------------
  // FASE 4: Resumen Ejecutivo Tabular y Auditoría CSV
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("  RESUMEN CONSOLIDADO DE LOS 6 CASOS (EVALUACIÓN INICIAL SIN FORZAR)");
  console.log("================================================================================");
  console.table(
    tablaResumen.map((r) => ({
      Caso: r.caso,
      Solicitud: r.solicitudId,
      Apta: r.apta,
      Retroactiva: r.retroactiva,
      Resultado: r.estadoInicial,
      Bloqueos: r.bloqueos,
      Confirmaciones: r.confirmaciones,
      Derivados: r.derivados,
      OC_Inicial: r.numeroOcInicial,
    }))
  );

  const rutaControlCsv = path.join(PROJECT_ROOT, "out", "control.csv");
  if (fs.existsSync(rutaControlCsv)) {
    console.log("\nBitácora de Auditoría Generada (out/control.csv):");
    console.log(fs.readFileSync(rutaControlCsv, "utf-8"));
  }
}

ejecutarDemoDeterminista().catch((err) => {
  console.error("Fallo inesperado en demo.ts:", err);
  process.exit(1);
});
