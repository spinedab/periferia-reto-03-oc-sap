import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GestorCicloAgente } from "../src/agent-loop.js";
import { DeterministicFallbackAdapter } from "../src/llm/deterministic.js";
import * as moduloOc from "../modulo/tools/oc.js";
import * as srcOc from "../src/tools/oc.js";
import {
  cargarMaestros,
  construir_payload,
  crear,
  evaluarAprobacionYTope,
  evaluarAritmeticaRC10,
  evaluarCentroSubareaRC4,
  evaluarCondicionPagoRC7,
  evaluarCotizacionRC5,
  evaluarIvaRC6,
  evaluarProveedorRC1,
  evaluarRetroactivaRC8,
  generar_evidencia,
  leer_paquete,
  validar,
} from "../src/tools/oc.js";
import type { OrdenCompra, Paquete, ResultadoValidacion, ToolContext, ToolResult } from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..");

function parseRes<T>(raw: string): ToolResult<T> {
  return JSON.parse(raw) as ToolResult<T>;
}

describe("Herramientas y Reglas de Control SAP (RC1 - RC10)", () => {
  let tempWorkspace: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "reto03-test-"));
    fs.cpSync(path.join(PROJECT_ROOT, "fixtures"), path.join(tempWorkspace, "fixtures"), {
      recursive: true,
    });
    fs.cpSync(path.join(PROJECT_ROOT, "agent"), path.join(tempWorkspace, "agent"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tempWorkspace, "src", "knowledge"), { recursive: true });
    fs.copyFileSync(
      path.join(PROJECT_ROOT, "src", "knowledge", "ordenes-compra.md"),
      path.join(tempWorkspace, "src", "knowledge", "ordenes-compra.md")
    );
    ctx = { directory: tempWorkspace, sessionId: "test-session" };
  });

  afterEach(() => {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  });

  it("sol-001: pasa todos los controles sin excepciones, crea OC 4500000001 y cumple idempotencia", async () => {
    const resVal = parseRes<ResultadoValidacion>(await validar.execute({ caso: "sol-001" }, ctx));
    expect(resVal.ok).toBe(true);
    if (!resVal.ok) return;
    expect(resVal.data.apta).toBe(true);
    expect(resVal.data.bloqueos).toHaveLength(0);
    expect(resVal.data.confirmaciones).toHaveLength(0);
    expect(resVal.data.retroactiva).toBe(false);

    const resEvid = parseRes<{ ruta: string; ruta_pdf: string; sha256: string }>(
      await generar_evidencia.execute({ caso: "sol-001" }, ctx)
    );
    expect(resEvid.ok).toBe(true);
    if (!resEvid.ok) return;
    expect(resEvid.data.sha256).toMatch(/^[a-f0-9]{64}$/);
    const pdfBytes = fs.readFileSync(path.join(tempWorkspace, resEvid.data.ruta_pdf));
    expect(pdfBytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const resCrear1 = parseRes<{ numero_oc: string; idempotente: boolean }>(
      await crear.execute({ caso: "sol-001", confirmado: false }, ctx)
    );
    expect(resCrear1.ok).toBe(true);
    if (!resCrear1.ok) return;
    expect(resCrear1.data.numero_oc).toBe("4500000001");
    expect(resCrear1.data.idempotente).toBe(false);

    // Segunda ejecución sobre el mismo solicitud_id -> idempotente
    const resCrear2 = parseRes<{ numero_oc: string; idempotente: boolean }>(
      await crear.execute({ caso: "sol-001", confirmado: false }, ctx)
    );
    expect(resCrear2.ok).toBe(true);
    if (!resCrear2.ok) return;
    expect(resCrear2.data.numero_oc).toBe("4500000001");
    expect(resCrear2.data.idempotente).toBe(true);
  });

  it("sol-002: bloquea por RC1 (proveedor NIT 901999000 inexistente en maestro)", async () => {
    const resVal = parseRes<ResultadoValidacion>(await validar.execute({ caso: "sol-002" }, ctx));
    expect(resVal.ok).toBe(true);
    if (!resVal.ok) return;
    expect(resVal.data.apta).toBe(false);
    expect(resVal.data.bloqueos.map((b) => b.codigo)).toContain("RC1");

    const intentoForzado = parseRes<unknown>(
      await crear.execute({ caso: "sol-002", confirmado: true }, ctx)
    );
    expect(intentoForzado.ok).toBe(false);
  });

  it("sol-003: bloquea por RC2 (aprobador fvargas no pertenece al centro de costo CC-2020)", async () => {
    const resVal = parseRes<ResultadoValidacion>(await validar.execute({ caso: "sol-003" }, ctx));
    expect(resVal.ok).toBe(true);
    if (!resVal.ok) return;
    expect(resVal.data.apta).toBe(false);
    expect(resVal.data.bloqueos.map((b) => b.codigo)).toContain("RC2");
  });

  it("sol-004: detecta discrepancia +6% en RC5, exige confirmación humana y trunca texto SAP a 40 chars", async () => {
    const resVal = parseRes<ResultadoValidacion>(await validar.execute({ caso: "sol-004" }, ctx));
    expect(resVal.ok).toBe(true);
    if (!resVal.ok) return;
    expect(resVal.data.apta).toBe(true);
    expect(resVal.data.confirmaciones.map((c) => c.codigo)).toEqual(["RC5"]);

    const resPayload = parseRes<{ orden_compra: OrdenCompra }>(
      await construir_payload.execute({ caso: "sol-004" }, ctx)
    );
    expect(resPayload.ok).toBe(true);
    if (!resPayload.ok) return;
    expect(resPayload.data.orden_compra.posiciones[0]?.descripcion.length).toBeLessThanOrEqual(40);
    expect(resPayload.data.orden_compra.posiciones[0]?.unidad).toBe("H");

    // Sin confirmar -> rechazado como pendiente de confirmación
    const sinConfirmar = parseRes<unknown>(
      await crear.execute({ caso: "sol-004", confirmado: false }, ctx)
    );
    expect(sinConfirmar.ok).toBe(false);
    if (!sinConfirmar.ok) {
      expect(sinConfirmar.requiere_confirmacion).toBe(true);
    }

    // Con confirmación -> crea OC
    const conConfirmar = parseRes<{ numero_oc: string }>(
      await crear.execute({ caso: "sol-004", confirmado: true }, ctx)
    );
    expect(conConfirmar.ok).toBe(true);
    if (conConfirmar.ok) {
      expect(conConfirmar.data.numero_oc).toBe("4500000001");
    }
  });

  it("sol-005: detecta compra retroactiva (RC8 factura 2026-08-10 < solicitud 2026-08-27) y registra marca en control.csv", async () => {
    const resLeer = parseRes<Paquete>(await leer_paquete.execute({ caso: "sol-005" }, ctx));
    expect(resLeer.ok).toBe(true);
    if (!resLeer.ok) return;
    expect(resLeer.data.factura?.numero).toBe("FC-88231");
    expect(resLeer.data.factura?.fecha).toBe("2026-08-10");

    const resVal = parseRes<ResultadoValidacion>(await validar.execute({ caso: "sol-005" }, ctx));
    expect(resVal.ok).toBe(true);
    if (!resVal.ok) return;
    expect(resVal.data.apta).toBe(true);
    expect(resVal.data.retroactiva).toBe(true);
    expect(resVal.data.confirmaciones.map((c) => c.codigo)).toEqual(["RC8"]);

    const creada = parseRes<{ numero_oc: string; retroactiva: boolean }>(
      await crear.execute({ caso: "sol-005", confirmado: true }, ctx)
    );
    expect(creada.ok).toBe(true);
    if (!creada.ok) return;
    expect(creada.data.retroactiva).toBe(true);

    const csv = fs.readFileSync(path.join(tempWorkspace, "out", "control.csv"), "utf-8");
    expect(csv).toContain("SOL-2026-005,CREADA,4500000001,true,,RC8");
  });

  it("sol-006: resuelve proveedor por nombre sin NIT, deriva IVA (RC6 confirmación) y condiciones de pago (RC7 informativo)", async () => {
    const resVal = parseRes<ResultadoValidacion>(await validar.execute({ caso: "sol-006" }, ctx));
    expect(resVal.ok).toBe(true);
    if (!resVal.ok) return;
    expect(resVal.data.apta).toBe(true);
    expect(resVal.data.derivados.proveedor_nit_resuelto).toBe("900555111");
    expect(resVal.data.derivados.indicador_iva).toBe("C1");
    expect(resVal.data.derivados.condiciones_pago).toBe("Z030");
    // RC6 exige confirmación; RC7 solo deriva sin pedir confirmación adicional
    expect(resVal.data.confirmaciones.map((c) => c.codigo)).toEqual(["RC6"]);
  });

  it("ejercita unitariamente casos borde RC1 inactivo, RC3 tope excedido, RC4 subárea inválida, RC9 fecha previa y RC10 aritmética", () => {
    const maestros = cargarMaestros(tempWorkspace);

    // RC1: proveedor existente pero inactivo (Consultores Ágiles S.A.S. NIT 901777888)
    const rc1Inactivo = evaluarProveedorRC1(
      { proveedor_nombre: "Consultores Ágiles S.A.S.", proveedor_nit: "901777888" },
      maestros.proveedores
    );
    expect(rc1Inactivo.valido).toBe(false);
    expect(rc1Inactivo.bloqueo?.codigo).toBe("RC1");

    // RC3 + RC9: mlopez aprueba 60M en CC-1010 (su tope es 50M) y con fecha previa a solicitud
    const rc3y9 = evaluarAprobacionYTope(
      {
        centro_costo: "CC-1010",
        valor_total: 60000000,
        moneda: "COP",
        fecha_solicitud: "2026-08-25",
      },
      {
        de: "mlopez@periferia-ficticia.com",
        fecha: "2026-08-20T10:00:00-05:00",
        aprobado: true,
        texto: "Aprobado",
      },
      maestros.centrosCosto
    );
    expect(rc3y9.bloqueoRC2).toBeNull();
    expect(rc3y9.bloqueoRC3?.codigo).toBe("RC3");
    expect(rc3y9.confirmacionRC9?.codigo).toBe("RC9");

    // RC4: subárea inexistente en CC-1010
    const rc4 = evaluarCentroSubareaRC4(
      { centro_costo: "CC-1010", subarea: "Marketing" },
      maestros.centrosCosto
    );
    expect(rc4.valido).toBe(false);
    expect(rc4.bloqueo?.codigo).toBe("RC4");

    // RC5: sin cotización -> pide confirmación
    const rc5SinCot = evaluarCotizacionRC5({ valor_total: 1000000, moneda: "COP" }, null);
    expect(rc5SinCot.confirmacion?.codigo).toBe("RC5");

    // RC6 y RC7: códigos inválidos -> bloqueo
    const provActivo = maestros.proveedores[0] ?? null;
    const rc6Inv = evaluarIvaRC6({ indicador_iva: "C99" }, provActivo, maestros.indicadoresIva);
    expect(rc6Inv.bloqueo?.codigo).toBe("RC6");
    const rc7Inv = evaluarCondicionPagoRC7(
      { condiciones_pago: "Z999" },
      provActivo,
      maestros.condicionesPago
    );
    expect(rc7Inv.bloqueo?.codigo).toBe("RC7");

    // RC8: factura posterior a solicitud NO es retroactiva
    const rc8Normal = evaluarRetroactivaRC8(
      { fecha_solicitud: "2026-08-10" },
      { numero: "FC-1", fecha: "2026-08-15", total: 1000 }
    );
    expect(rc8Normal.retroactiva).toBe(false);

    // RC10: inconsistencia aritmética
    const rc10 = evaluarAritmeticaRC10({
      cantidad: 10,
      valor_unitario: 100000,
      valor_total: 900000,
      moneda: "COP",
    });
    expect(rc10.valido).toBe(false);
    expect(rc10.bloqueo?.codigo).toBe("RC10");
  });

  it("defensa contra manipulación: oc_crear rechaza un payload cuyo monto fue alterado frente a las fuentes", async () => {
    const resPay = parseRes<{ orden_compra: OrdenCompra }>(
      await construir_payload.execute({ caso: "sol-001" }, ctx)
    );
    expect(resPay.ok).toBe(true);
    if (!resPay.ok) return;

    const adulterado: OrdenCompra = structuredClone(resPay.data.orden_compra);
    if (adulterado.posiciones[0]) {
      adulterado.posiciones[0].precio_unitario = 1000;
    }

    const resCrear = parseRes<unknown>(
      await crear.execute({ caso: "sol-001", payload: adulterado, confirmado: false }, ctx)
    );
    expect(resCrear.ok).toBe(false);
    if (!resCrear.ok) {
      expect(resCrear.error).toContain("Integridad rechazada");
    }
  });

  it("ciclo conversacional HITL completo: detiene sol-004 pidiendo confirmación y crea OC tras aprobación humana", async () => {
    const gestor = new GestorCicloAgente(tempWorkspace);
    const llm = new DeterministicFallbackAdapter();

    const turno1 = await gestor.procesarTurno(
      "ses-hitl-1",
      'Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP y no la crees hasta que yo lo confirme.',
      llm
    );
    expect(turno1.needsConfirmation).toBe(true);
    expect(turno1.pendingConfirmation?.caso).toBe("sol-004");
    expect(turno1.toolCalls.some((t) => t.name === "oc_crear")).toBe(false);

    const turno2 = await gestor.procesarTurno("ses-hitl-1", "Confirmo, crea la OC.", llm);
    expect(turno2.needsConfirmation).toBe(false);
    expect(turno2.toolCalls.some((t) => t.name === "oc_crear" && t.ok)).toBe(true);
    expect(turno2.reply).toContain("4500000001");
  });

  it("bonus sección 9.4: modulo/ comparte exactamente las mismas herramientas, prompt y conocimiento sin divergencia", () => {
    expect(moduloOc.leer_paquete).toBe(srcOc.leer_paquete);
    expect(moduloOc.validar).toBe(srcOc.validar);
    expect(moduloOc.construir_payload).toBe(srcOc.construir_payload);
    expect(moduloOc.generar_evidencia).toBe(srcOc.generar_evidencia);
    expect(moduloOc.crear).toBe(srcOc.crear);

    const promptSrc = fs.readFileSync(path.join(PROJECT_ROOT, "agent", "prompt.md"), "utf-8");
    const agentMod = fs.readFileSync(path.join(PROJECT_ROOT, "modulo", "agent.md"), "utf-8");
    const cuerpoAgentMod = agentMod.replace(/^---[\s\S]*?---\r?\n\r?\n/, "");
    expect(cuerpoAgentMod).toBe(promptSrc);

    const knowSrc = fs.readFileSync(
      path.join(PROJECT_ROOT, "src", "knowledge", "ordenes-compra.md"),
      "utf-8"
    );
    const skillMod = fs.readFileSync(
      path.join(PROJECT_ROOT, "modulo", "skill", "ordenes-compra", "SKILL.md"),
      "utf-8"
    );
    const cuerpoSkillMod = skillMod.replace(/^---[\s\S]*?---\r?\n\r?\n/, "");
    expect(cuerpoSkillMod).toBe(knowSrc);
  });
});
