import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import type { SapAdapter } from "../sap/adapter.js";
import { MockSapAdapter, normalizarNitBase } from "../sap/mock.js";
import {
  CentroCostoMaestroSchema,
  CondicionPagoMaestroSchema,
  DerivadosSchema,
  IndicadorIvaMaestroSchema,
  OrdenCompraSchema,
  PaqueteSchema,
  ProveedorMaestroSchema,
  SolicitudSchema,
  type AprobacionNormalizada,
  type CentroCostoMaestro,
  type CondicionPagoMaestro,
  type CotizacionNormalizada,
  type Derivados,
  type FacturaNormalizada,
  type HallazgoControl,
  type IndicadorIvaMaestro,
  type MaestrosCorporativos,
  type OrdenCompra,
  type Paquete,
  type ProveedorMaestro,
  type ResultadoValidacion,
  type Solicitud,
  type ToolDefinition,
} from "../types.js";
import { leerFilasXlsx } from "../utils/xlsx-reader.js";

// ============================================================================
// Funciones Auxiliares Puras y Deterministas
// ============================================================================

export function normalizarTextoComparacion(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parsearMontoMonetario(raw: string): number {
  const limpio = raw.trim().replace(/\s+/g, "");
  // Formato colombiano en fixtures: puntos de miles (ej. "11.400.000") y coma decimal opcional
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(limpio)) {
    const normalizado = limpio.replace(/\./g, "").replace(",", ".");
    return Number(normalizado);
  }
  const normalizado = limpio.replace(/,/g, "");
  return Number(normalizado);
}

function sumarDiasFechaIso(fechaYmd: string, dias: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaYmd);
  if (!match) return null;
  const anio = Number(match[1]);
  const mes = Number(match[2]) - 1;
  const dia = Number(match[3]);
  const fechaUtc = new Date(Date.UTC(anio, mes, dia + dias));
  return fechaUtc.toISOString().slice(0, 10);
}

export function inferirUnidadMedida(descripcion: string): "UN" | "H" | "MES" {
  if (/\b(horas?|hrs?)\b/i.test(descripcion)) {
    return "H";
  }
  if (/\b(mensualidad|servicio mensual|arrendamiento mensual|suscripci[oó]n mensual)\b/i.test(descripcion)) {
    return "MES";
  }
  return "UN";
}

export function parsearCotizacionTxt(texto: string): CotizacionNormalizada {
  const refMatch = /^COTIZACI[OÓ]N\s+([^\r\n]+)/im.exec(texto);
  const fechaMatch = /^Fecha:\s*(\d{4}-\d{2}-\d{2})/im.exec(texto);
  const provMatch = /^Proveedor:\s*(.+)$/im.exec(texto);
  const nitMatch = /^NIT:\s*([0-9.\-\s]+)$/im.exec(texto);
  const totalMatch = /^TOTAL[^:\r\n]*:\s*(COP|USD)\s*([0-9.,]+)/im.exec(texto);
  const validezMatch = /^Validez de la oferta:\s*(\d+)\s*d[ií]as/im.exec(texto);

  const fecha = fechaMatch?.[1]?.trim() ?? null;
  const diasValidez = validezMatch?.[1] ? Number.parseInt(validezMatch[1], 10) : null;
  const validez_hasta =
    fecha && diasValidez !== null ? sumarDiasFechaIso(fecha, diasValidez) : null;

  return {
    referencia: refMatch?.[1]?.trim() ?? null,
    fecha,
    proveedor: provMatch?.[1]?.trim() ?? "Desconocido",
    nit: nitMatch?.[1] ? normalizarNitBase(nitMatch[1]) : null,
    total: totalMatch?.[2] ? parsearMontoMonetario(totalMatch[2]) : 0,
    moneda: totalMatch?.[1]?.trim() ?? "COP",
    validez_hasta,
    texto,
  };
}

export function parsearFacturaTxt(texto: string): FacturaNormalizada {
  const numMatch = /FACTURA[^\r\n]*?(?:No\.|Nro\.|#)\s*([A-Z0-9\-]+)/i.exec(texto);
  const fechaMatch = /Fecha(?:\s+de\s+emisi[oó]n)?:\s*(\d{4}-\d{2}-\d{2})/i.exec(texto);
  const totalMatch = /^TOTAL[^:\r\n]*:\s*(?:COP|USD)?\s*([0-9.,]+)/im.exec(texto);

  return {
    numero: numMatch?.[1]?.trim() ?? "SIN-NUMERO",
    fecha: fechaMatch?.[1]?.trim() ?? "",
    total: totalMatch?.[1] ? parsearMontoMonetario(totalMatch[1]) : 0,
  };
}

function resolverDirectorioCasoSeguro(projectRoot: string, caso: string): string {
  const casoLimpio = caso.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(casoLimpio)) {
    throw new Error(
      `Identificador de caso inválido "${caso}". Use únicamente letras, números, guiones o guiones bajos (ej. "sol-001").`
    );
  }
  const baseSolicitudes = path.resolve(projectRoot, "fixtures", "reto-03", "solicitudes");
  const rutaCaso = path.resolve(baseSolicitudes, casoLimpio);
  if (!rutaCaso.startsWith(baseSolicitudes + path.sep)) {
    throw new Error(`Acceso denegado fuera del directorio de solicitudes para "${caso}".`);
  }
  return rutaCaso;
}

export function cargarMaestros(projectRoot: string): MaestrosCorporativos {
  const baseMaestros = path.resolve(projectRoot, "fixtures", "reto-03", "maestros");
  const proveedores = z
    .array(ProveedorMaestroSchema)
    .parse(JSON.parse(fs.readFileSync(path.join(baseMaestros, "proveedores.json"), "utf-8")));
  const centrosCosto = z
    .array(CentroCostoMaestroSchema)
    .parse(JSON.parse(fs.readFileSync(path.join(baseMaestros, "centros-costo.json"), "utf-8")));
  const indicadoresIva = z
    .array(IndicadorIvaMaestroSchema)
    .parse(JSON.parse(fs.readFileSync(path.join(baseMaestros, "indicadores-iva.json"), "utf-8")));
  const condicionesPago = z
    .array(CondicionPagoMaestroSchema)
    .parse(JSON.parse(fs.readFileSync(path.join(baseMaestros, "condiciones-pago.json"), "utf-8")));

  return { proveedores, centrosCosto, indicadoresIva, condicionesPago };
}

export function leerPaqueteDesdeDisco(projectRoot: string, caso: string): Paquete {
  const dirCaso = resolverDirectorioCasoSeguro(projectRoot, caso);
  if (!fs.existsSync(dirCaso)) {
    throw new Error(
      `No existe el caso "${caso}" en fixtures/reto-03/solicitudes/. Casos válidos: sol-001 a sol-006.`
    );
  }

  const rutaCorreo = path.join(dirCaso, "correo.json");
  const rutaSolicitud = path.join(dirCaso, "solicitud.json");
  if (!fs.existsSync(rutaCorreo)) {
    throw new Error(`Paquete incompleto en "${caso}": falta correo.json.`);
  }
  if (!fs.existsSync(rutaSolicitud)) {
    throw new Error(`Paquete incompleto en "${caso}": falta solicitud.json.`);
  }

  const correoRaw = JSON.parse(fs.readFileSync(rutaCorreo, "utf-8")) as Record<string, unknown>;
  const solicitudRaw = JSON.parse(fs.readFileSync(rutaSolicitud, "utf-8")) as unknown;
  const solicitud = SolicitudSchema.parse(solicitudRaw);

  const adjuntos_faltantes: string[] = [];

  const rutaCotizacion = path.join(dirCaso, "cotizacion.txt");
  let cotizacion: CotizacionNormalizada | null = null;
  if (fs.existsSync(rutaCotizacion)) {
    cotizacion = parsearCotizacionTxt(fs.readFileSync(rutaCotizacion, "utf-8"));
  } else {
    adjuntos_faltantes.push("cotizacion.txt");
  }

  const rutaAprobacion = path.join(dirCaso, "aprobacion.json");
  let aprobacion: AprobacionNormalizada | null = null;
  if (fs.existsSync(rutaAprobacion)) {
    const aprobRaw = JSON.parse(fs.readFileSync(rutaAprobacion, "utf-8")) as Record<string, unknown>;
    const cuerpo = String(aprobRaw.cuerpo ?? "");
    const aprobado = !/\bno\s+aprobado\b/i.test(cuerpo) && /\baprobado\b/i.test(cuerpo);
    aprobacion = {
      de: String(aprobRaw.de ?? "").trim().toLowerCase(),
      para: aprobRaw.para ? String(aprobRaw.para) : undefined,
      cc: Array.isArray(aprobRaw.cc) ? aprobRaw.cc.map(String) : undefined,
      asunto: aprobRaw.asunto ? String(aprobRaw.asunto) : undefined,
      fecha: String(aprobRaw.fecha ?? ""),
      aprobado,
      texto: cuerpo,
    };
  } else {
    adjuntos_faltantes.push("aprobacion.json");
  }

  const rutaFactura = path.join(dirCaso, "factura.txt");
  let factura: FacturaNormalizada | null = null;
  if (fs.existsSync(rutaFactura)) {
    factura = parsearFacturaTxt(fs.readFileSync(rutaFactura, "utf-8"));
  }

  return PaqueteSchema.parse({
    correo: {
      id: String(correoRaw.id ?? `${caso}-correo`),
      de: String(correoRaw.de ?? ""),
      para: correoRaw.para ? String(correoRaw.para) : undefined,
      asunto: String(correoRaw.asunto ?? ""),
      fecha: String(correoRaw.fecha ?? ""),
      cuerpo: correoRaw.cuerpo ? String(correoRaw.cuerpo) : undefined,
      adjuntos: Array.isArray(correoRaw.adjuntos) ? correoRaw.adjuntos.map(String) : undefined,
    },
    solicitud,
    cotizacion,
    aprobacion,
    factura,
    adjuntos_faltantes,
  });
}

// ============================================================================
// Funciones Puras de Control Interno (RC1 - RC10)
// ============================================================================

export function evaluarProveedorRC1(
  solicitud: Pick<Solicitud, "proveedor_nit" | "proveedor_nombre">,
  proveedores: ProveedorMaestro[]
): {
  valido: boolean;
  proveedor: ProveedorMaestro | null;
  metodo: "nit" | "nombre_normalizado" | null;
  bloqueo: HallazgoControl | null;
} {
  let encontrado: ProveedorMaestro | undefined;
  let metodo: "nit" | "nombre_normalizado" | null = null;

  if (solicitud.proveedor_nit && solicitud.proveedor_nit.trim() !== "") {
    const nitBuscado = normalizarNitBase(solicitud.proveedor_nit);
    encontrado = proveedores.find((p) => normalizarNitBase(p.nit) === nitBuscado);
    metodo = "nit";
  } else {
    const nombreBuscado = normalizarTextoComparacion(solicitud.proveedor_nombre);
    encontrado = proveedores.find(
      (p) => normalizarTextoComparacion(p.nombre) === nombreBuscado
    );
    metodo = "nombre_normalizado";
  }

  if (!encontrado) {
    return {
      valido: false,
      proveedor: null,
      metodo,
      bloqueo: {
        codigo: "RC1",
        regla: "Proveedor registrado y activo en maestro SAP",
        detalle: solicitud.proveedor_nit
          ? `El proveedor "${solicitud.proveedor_nombre}" (NIT ${solicitud.proveedor_nit}) no existe en proveedores.json.`
          : `El proveedor "${solicitud.proveedor_nombre}" (sin NIT en solicitud) no existe por nombre normalizado en proveedores.json.`,
        fuente: "maestro.proveedores",
        accion_sugerida:
          "Solicitar creación y homologación del proveedor en datos maestros SAP (adjuntando RUT, Cámara de Comercio y certificación bancaria) antes de generar la OC.",
        valores: {
          proveedor_nombre: solicitud.proveedor_nombre,
          proveedor_nit: solicitud.proveedor_nit ?? null,
        },
      },
    };
  }

  if (!encontrado.activo) {
    return {
      valido: false,
      proveedor: encontrado,
      metodo,
      bloqueo: {
        codigo: "RC1",
        regla: "Proveedor registrado y activo en maestro SAP",
        detalle: `El proveedor "${encontrado.nombre}" (NIT ${encontrado.nit}, código SAP ${encontrado.codigo_sap}) figura INACTIVO (activo = false) en proveedores.json.`,
        fuente: "maestro.proveedores",
        accion_sugerida:
          "Escalar al área de Compras / Cumplimiento para verificar bloqueo o reactivar al proveedor en SAP antes de emitir la OC.",
        valores: {
          codigo_sap: encontrado.codigo_sap,
          nit: encontrado.nit,
          activo: false,
        },
      },
    };
  }

  return { valido: true, proveedor: encontrado, metodo, bloqueo: null };
}

export function evaluarCentroSubareaRC4(
  solicitud: Pick<Solicitud, "centro_costo" | "subarea">,
  centrosCosto: CentroCostoMaestro[]
): {
  valido: boolean;
  centro: CentroCostoMaestro | null;
  bloqueo: HallazgoControl | null;
} {
  const centro = centrosCosto.find((c) => c.centro_costo === solicitud.centro_costo) ?? null;
  if (!centro) {
    return {
      valido: false,
      centro: null,
      bloqueo: {
        codigo: "RC4",
        regla: "Centro de costo y subárea válidos en maestro",
        detalle: `El centro de costo "${solicitud.centro_costo}" no existe en centros-costo.json.`,
        fuente: "maestro.centros-costo",
        accion_sugerida:
          "Devolver al solicitante para corregir el código de centro de costo según el catálogo financiero vigente.",
        valores: {
          centro_costo: solicitud.centro_costo,
          subarea: solicitud.subarea,
        },
      },
    };
  }

  if (!centro.subareas.includes(solicitud.subarea)) {
    return {
      valido: false,
      centro,
      bloqueo: {
        codigo: "RC4",
        regla: "Subárea perteneciente al centro de costo",
        detalle: `La subárea "${solicitud.subarea}" no pertenece al centro de costo ${centro.centro_costo} (${centro.nombre ?? ""}). Subáreas válidas: ${centro.subareas.join(", ")}.`,
        fuente: "maestro.centros-costo",
        accion_sugerida: `Solicitar corrección de la subárea a una de las habilitadas para ${centro.centro_costo}: ${centro.subareas.join(", ")}.`,
        valores: {
          centro_costo: solicitud.centro_costo,
          subarea: solicitud.subarea,
          subareas_validas: centro.subareas.join(" | "),
        },
      },
    };
  }

  return { valido: true, centro, bloqueo: null };
}

export function evaluarAprobacionYTope(
  solicitud: Pick<Solicitud, "centro_costo" | "valor_total" | "moneda" | "fecha_solicitud">,
  aprobacion: AprobacionNormalizada | null,
  centrosCosto: CentroCostoMaestro[]
): {
  bloqueoRC2: HallazgoControl | null;
  bloqueoRC3: HallazgoControl | null;
  confirmacionRC9: HallazgoControl | null;
  aprobadorAutorizado: { email: string; tope: number; nombre?: string } | null;
} {
  const centro = centrosCosto.find((c) => c.centro_costo === solicitud.centro_costo) ?? null;

  if (!aprobacion) {
    return {
      bloqueoRC2: {
        codigo: "RC2",
        regla: "Existencia y validez de aprobación del líder",
        detalle: "No se encontró el correo de aprobación (aprobacion.json) en el paquete.",
        fuente: "aprobacion.json + maestro.centros-costo",
        accion_sugerida:
          "Solicitar al área requirente adjuntar el correo de aprobación explícita del líder autorizado del centro de costos.",
      },
      bloqueoRC3: null,
      confirmacionRC9: null,
      aprobadorAutorizado: null,
    };
  }

  if (!aprobacion.aprobado) {
    return {
      bloqueoRC2: {
        codigo: "RC2",
        regla: "Palabra explícita 'Aprobado' en el correo del líder",
        detalle: `El correo de ${aprobacion.de} no contiene aprobación explícita ("Aprobado").`,
        fuente: "aprobacion.json",
        accion_sugerida:
          "Pedir confirmación expresa con la palabra 'Aprobado' por parte del líder del centro de costos.",
        valores: { remitente: aprobacion.de },
      },
      bloqueoRC3: null,
      confirmacionRC9: null,
      aprobadorAutorizado: null,
    };
  }

  const emailRemitente = aprobacion.de.trim().toLowerCase();
  const aprobadorEnCentro =
    centro?.aprobadores.find((a) => a.email.trim().toLowerCase() === emailRemitente) ?? null;

  let bloqueoRC2: HallazgoControl | null = null;
  let bloqueoRC3: HallazgoControl | null = null;

  if (!centro || !aprobadorEnCentro) {
    const otrosCentrosDelAprobador = centrosCosto
      .filter((c) => c.aprobadores.some((a) => a.email.toLowerCase() === emailRemitente))
      .map((c) => `${c.centro_costo} (${c.nombre ?? ""})`)
      .join(", ");
    const aprobadoresValidos = centro
      ? centro.aprobadores
          .map((a) => `${a.email} (tope ${solicitud.moneda} ${a.tope.toLocaleString("es-CO")})`)
          .join(", ")
      : "ninguno (centro inexistente)";

    bloqueoRC2 = {
      codigo: "RC2",
      regla: "Aprobador autorizado en la matriz del centro de costos",
      detalle: `El remitente "${aprobacion.de}" no está autorizado para aprobar imputaciones al centro de costo ${solicitud.centro_costo}${centro?.nombre ? ` (${centro.nombre})` : ""}${otrosCentrosDelAprobador ? `; solo tiene firma en ${otrosCentrosDelAprobador}` : ""}. Aprobadores válidos de ${solicitud.centro_costo}: ${aprobadoresValidos}.`,
      fuente: "maestro.centros-costo",
      accion_sugerida: centro
        ? `Rechazar solicitud actual: o se reimputa al centro de costo dueño del aprobador (${otrosCentrosDelAprobador || "correspondiente"}) si el gasto le pertenece, o debe aprobarla un líder autorizado de ${solicitud.centro_costo} con cupo suficiente.`
        : "Corregir el centro de costos antes de validar aprobadores.",
      valores: {
        aprobador_correo: aprobacion.de,
        centro_costo_solicitud: solicitud.centro_costo,
        valor_total: solicitud.valor_total,
      },
    };
  } else if (solicitud.valor_total > aprobadorEnCentro.tope) {
    const superior = centro.aprobadores.find((a) => a.tope >= solicitud.valor_total);
    bloqueoRC3 = {
      codigo: "RC3",
      regla: "Valor total dentro del tope de aprobación del líder",
      detalle: `El valor total (${solicitud.moneda} ${solicitud.valor_total.toLocaleString("es-CO")}) supera el tope autorizado de ${aprobadorEnCentro.email} (${solicitud.moneda} ${aprobadorEnCentro.tope.toLocaleString("es-CO")}) para ${solicitud.centro_costo}.`,
      fuente: "maestro.centros-costo",
      accion_sugerida: superior
        ? `Escalar aprobación a ${superior.email} (tope ${solicitud.moneda} ${superior.tope.toLocaleString("es-CO")}).`
        : `Escalar a Gerencia General / Comité de Compras (ningún aprobador en ${solicitud.centro_costo} tiene tope >= ${solicitud.valor_total.toLocaleString("es-CO")}).`,
      valores: {
        aprobador: aprobadorEnCentro.email,
        tope_aprobador: aprobadorEnCentro.tope,
        valor_total: solicitud.valor_total,
      },
    };
  }

  // RC9: fecha de aprobación >= fecha_solicitud (comparación por fecha calendario local YYYY-MM-DD)
  const fechaAprobYmd = aprobacion.fecha.slice(0, 10);
  let confirmacionRC9: HallazgoControl | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaAprobYmd) && fechaAprobYmd < solicitud.fecha_solicitud) {
    confirmacionRC9 = {
      codigo: "RC9",
      regla: "Secuencia cronológica aprobación >= solicitud",
      detalle: `La fecha del correo de aprobación (${fechaAprobYmd}) es anterior a la fecha de la solicitud (${solicitud.fecha_solicitud}).`,
      fuente: "aprobacion.json vs solicitud.json",
      accion_sugerida:
        "Confirmar con la analista si la aprobación previa corresponde exactamente al alcance final de la solicitud.",
      valores: {
        fecha_aprobacion: fechaAprobYmd,
        fecha_solicitud: solicitud.fecha_solicitud,
      },
    };
  }

  return {
    bloqueoRC2,
    bloqueoRC3,
    confirmacionRC9,
    aprobadorAutorizado: aprobadorEnCentro,
  };
}

export function evaluarCotizacionRC5(
  solicitud: Pick<Solicitud, "valor_total" | "moneda">,
  cotizacion: CotizacionNormalizada | null
): {
  confirmacion: HallazgoControl | null;
  desviacionPorcentaje: number | null;
} {
  if (!cotizacion) {
    return {
      confirmacion: {
        codigo: "RC5",
        regla: "Respaldo y consistencia de cotización (tolerancia <= 2%)",
        detalle: `No se adjuntó cotización del proveedor para respaldar el valor solicitado de ${solicitud.moneda} ${solicitud.valor_total.toLocaleString("es-CO")}.`,
        fuente: "cotizacion.txt vs solicitud.json",
        accion_sugerida:
          "Confirmar si existe acuerdo marco vigente o solicitar la cotización formal antes de emitir la OC.",
        valores: {
          valor_solicitud: solicitud.valor_total,
          valor_cotizacion: null,
        },
      },
      desviacionPorcentaje: null,
    };
  }

  const diferenciaAbs = Math.abs(cotizacion.total - solicitud.valor_total);
  const ratio = diferenciaAbs / solicitud.valor_total;
  const porcentaje = Number((ratio * 100).toFixed(2));

  if (ratio > 0.02) {
    return {
      confirmacion: {
        codigo: "RC5",
        regla: "Diferencia entre cotización y solicitud <= 2%",
        detalle: `Discrepancia del ${porcentaje}% (> 2% permitido): la solicitud registra ${solicitud.moneda} ${solicitud.valor_total.toLocaleString("es-CO")} pero la cotización ${cotizacion.referencia ?? ""} es por ${cotizacion.moneda} ${cotizacion.total.toLocaleString("es-CO")} (diferencia de ${solicitud.moneda} ${diferenciaAbs.toLocaleString("es-CO")}).`,
        fuente: "cotizacion.txt vs solicitud.json",
        accion_sugerida:
          "Verificar con el solicitante y el líder aprobador cuál monto rige antes de confirmar la creación de la OC en SAP.",
        valores: {
          valor_solicitud: solicitud.valor_total,
          valor_cotizacion: cotizacion.total,
          diferencia: diferenciaAbs,
          desviacion_pct: porcentaje,
        },
      },
      desviacionPorcentaje: porcentaje,
    };
  }

  return { confirmacion: null, desviacionPorcentaje: porcentaje };
}

export function evaluarIvaRC6(
  solicitud: Pick<Solicitud, "indicador_iva">,
  proveedor: ProveedorMaestro | null,
  indicadoresIva: IndicadorIvaMaestro[]
): {
  codigoIva: string | undefined;
  origen: "solicitud" | "maestro.proveedores" | undefined;
  descripcionIva: string | undefined;
  confirmacion: HallazgoControl | null;
  bloqueo: HallazgoControl | null;
} {
  if (solicitud.indicador_iva && solicitud.indicador_iva.trim() !== "") {
    const ind = indicadoresIva.find((i) => i.codigo === solicitud.indicador_iva);
    if (!ind) {
      return {
        codigoIva: undefined,
        origen: undefined,
        descripcionIva: undefined,
        confirmacion: null,
        bloqueo: {
          codigo: "RC6",
          regla: "Indicador de IVA válido en maestro SAP",
          detalle: `El indicador de IVA "${solicitud.indicador_iva}" no existe en indicadores-iva.json. Códigos válidos: ${indicadoresIva.map((i) => i.codigo).join(", ")}.`,
          fuente: "maestro.indicadores-iva",
          accion_sugerida: "Corregir el código de indicador de IVA en la solicitud.",
          valores: { indicador_iva: solicitud.indicador_iva },
        },
      };
    }
    return {
      codigoIva: ind.codigo,
      origen: "solicitud",
      descripcionIva: ind.descripcion,
      confirmacion: null,
      bloqueo: null,
    };
  }

  if (!proveedor) {
    return {
      codigoIva: undefined,
      origen: undefined,
      descripcionIva: undefined,
      confirmacion: null,
      bloqueo: null,
    };
  }

  const indDefault = indicadoresIva.find((i) => i.codigo === proveedor.indicador_iva_default);
  const desc = indDefault ? `${indDefault.descripcion} (${indDefault.tasa * 100}%)` : proveedor.indicador_iva_default;

  return {
    codigoIva: proveedor.indicador_iva_default,
    origen: "maestro.proveedores",
    descripcionIva: indDefault?.descripcion,
    bloqueo: null,
    confirmacion: {
      codigo: "RC6",
      regla: "Indicador de IVA ausente derivado desde maestro de proveedor",
      detalle: `La solicitud no informó indicador_iva; se derivó "${proveedor.indicador_iva_default}" (${desc}) desde el maestro del proveedor "${proveedor.nombre}".`,
      fuente: "maestro.proveedores + maestro.indicadores-iva",
      accion_sugerida: `Confirmar que aplica el indicador de impuesto "${proveedor.indicador_iva_default}" (${desc}) antes de contabilizar la OC.`,
      valores: {
        indicador_iva_solicitud: null,
        indicador_iva_derivado: proveedor.indicador_iva_default,
        descripcion: desc,
      },
    },
  };
}

export function evaluarCondicionPagoRC7(
  solicitud: Pick<Solicitud, "condiciones_pago">,
  proveedor: ProveedorMaestro | null,
  condicionesPago: CondicionPagoMaestro[]
): {
  codigoCondicion: string | undefined;
  origen: "solicitud" | "maestro.proveedores" | undefined;
  descripcionCondicion: string | undefined;
  derivado: boolean;
  bloqueo: HallazgoControl | null;
} {
  if (solicitud.condiciones_pago && solicitud.condiciones_pago.trim() !== "") {
    const cond = condicionesPago.find((c) => c.codigo === solicitud.condiciones_pago);
    if (!cond) {
      return {
        codigoCondicion: undefined,
        origen: undefined,
        descripcionCondicion: undefined,
        derivado: false,
        bloqueo: {
          codigo: "RC7",
          regla: "Condición de pago válida en maestro SAP",
          detalle: `La condición de pago "${solicitud.condiciones_pago}" no existe en condiciones-pago.json. Códigos válidos: ${condicionesPago.map((c) => c.codigo).join(", ")}.`,
          fuente: "maestro.condiciones-pago",
          accion_sugerida: "Corregir el código de condición de pago conforme al maestro financiero.",
          valores: { condiciones_pago: solicitud.condiciones_pago },
        },
      };
    }
    return {
      codigoCondicion: cond.codigo,
      origen: "solicitud",
      descripcionCondicion: cond.descripcion,
      derivado: false,
      bloqueo: null,
    };
  }

  if (!proveedor) {
    return {
      codigoCondicion: undefined,
      origen: undefined,
      descripcionCondicion: undefined,
      derivado: false,
      bloqueo: null,
    };
  }

  const condDefault = condicionesPago.find((c) => c.codigo === proveedor.condiciones_pago_default);
  return {
    codigoCondicion: proveedor.condiciones_pago_default,
    origen: "maestro.proveedores",
    descripcionCondicion: condDefault?.descripcion,
    derivado: true,
    bloqueo: null,
  };
}

export function evaluarRetroactivaRC8(
  solicitud: Pick<Solicitud, "fecha_solicitud">,
  factura: FacturaNormalizada | null
): {
  retroactiva: boolean;
  confirmacion: HallazgoControl | null;
} {
  if (!factura || !factura.fecha) {
    return { retroactiva: false, confirmacion: null };
  }

  if (factura.fecha < solicitud.fecha_solicitud) {
    const msFactura = Date.parse(`${factura.fecha}T00:00:00Z`);
    const msSolicitud = Date.parse(`${solicitud.fecha_solicitud}T00:00:00Z`);
    const diasDesfase = Math.round((msSolicitud - msFactura) / (1000 * 60 * 60 * 24));

    return {
      retroactiva: true,
      confirmacion: {
        codigo: "RC8",
        regla: "Detección de compra retroactiva (factura anterior a solicitud)",
        detalle: `Desvío de proceso detectado: existe la factura ${factura.numero} con fecha de emisión ${factura.fecha}, anterior en ${diasDesfase} día(s) a la fecha de solicitud (${solicitud.fecha_solicitud}). Se marcará retroactiva = true en el log de auditoría.`,
        fuente: "factura.txt vs solicitud.json",
        accion_sugerida:
          "Confirmar autorización excepcional para regularización de factura recibida y registrar marca retroactiva = true para reporte a Dirección y Auditoría.",
        valores: {
          factura_numero: factura.numero,
          fecha_factura: factura.fecha,
          fecha_solicitud: solicitud.fecha_solicitud,
          dias_desfase: diasDesfase,
          factura_total: factura.total,
        },
      },
    };
  }

  return { retroactiva: false, confirmacion: null };
}

export function evaluarAritmeticaRC10(
  solicitud: Pick<Solicitud, "cantidad" | "valor_unitario" | "valor_total" | "moneda">
): {
  valido: boolean;
  bloqueo: HallazgoControl | null;
} {
  const calculado = solicitud.cantidad * solicitud.valor_unitario;
  const diferencia = Math.abs(calculado - solicitud.valor_total);

  if (diferencia > 1) {
    return {
      valido: false,
      bloqueo: {
        codigo: "RC10",
        regla: "Consistencia aritmética cantidad × valor_unitario = valor_total (±1)",
        detalle: `Error aritmético en solicitud: ${solicitud.cantidad} × ${solicitud.valor_unitario.toLocaleString("es-CO")} = ${calculado.toLocaleString("es-CO")}, pero valor_total indica ${solicitud.valor_total.toLocaleString("es-CO")} (diferencia de ${solicitud.moneda} ${diferencia.toLocaleString("es-CO")} > ±1).`,
        fuente: "solicitud.json",
        accion_sugerida:
          "Bloquear y devolver al solicitante para corregir cantidades, valor unitario o total en el formato de solicitud.",
        valores: {
          cantidad: solicitud.cantidad,
          valor_unitario: solicitud.valor_unitario,
          total_calculado: calculado,
          valor_total_declarado: solicitud.valor_total,
        },
      },
    };
  }

  return { valido: true, bloqueo: null };
}

export function evaluarPaqueteCompleto(
  paquete: Paquete,
  maestros: MaestrosCorporativos
): ResultadoValidacion {
  const bloqueos: HallazgoControl[] = [];
  const confirmaciones: HallazgoControl[] = [];
  const controles_evaluados: ResultadoValidacion["controles_evaluados"] = [];

  // RC1: Proveedor
  const resRC1 = evaluarProveedorRC1(paquete.solicitud, maestros.proveedores);
  if (resRC1.bloqueo) {
    bloqueos.push(resRC1.bloqueo);
    controles_evaluados.push({
      codigo: "RC1",
      nombre: "Proveedor en maestro y activo",
      estado: "BLOQUEADO",
      detalle: resRC1.bloqueo.detalle,
    });
  } else {
    controles_evaluados.push({
      codigo: "RC1",
      nombre: "Proveedor en maestro y activo",
      estado: "APROBADO",
      detalle: `Proveedor ${resRC1.proveedor?.nombre} (SAP ${resRC1.proveedor?.codigo_sap}, NIT ${resRC1.proveedor?.nit}) activo; resuelto por ${resRC1.metodo}.`,
    });
  }

  // RC2, RC3, RC9: Aprobación, tope y fecha
  const resAprob = evaluarAprobacionYTope(
    paquete.solicitud,
    paquete.aprobacion,
    maestros.centrosCosto
  );
  if (resAprob.bloqueoRC2) {
    bloqueos.push(resAprob.bloqueoRC2);
    controles_evaluados.push({
      codigo: "RC2",
      nombre: "Aprobación válida del centro de costos",
      estado: "BLOQUEADO",
      detalle: resAprob.bloqueoRC2.detalle,
    });
    controles_evaluados.push({
      codigo: "RC3",
      nombre: "Monto dentro del tope del aprobador",
      estado: "BLOQUEADO",
      detalle: "No superado porque el remitente carece de atribución en el centro de costos imputado.",
    });
  } else {
    controles_evaluados.push({
      codigo: "RC2",
      nombre: "Aprobación válida del centro de costos",
      estado: "APROBADO",
      detalle: `Aprobado por ${resAprob.aprobadorAutorizado?.email} para ${paquete.solicitud.centro_costo}.`,
    });
    if (resAprob.bloqueoRC3) {
      bloqueos.push(resAprob.bloqueoRC3);
      controles_evaluados.push({
        codigo: "RC3",
        nombre: "Monto dentro del tope del aprobador",
        estado: "BLOQUEADO",
        detalle: resAprob.bloqueoRC3.detalle,
      });
    } else {
      controles_evaluados.push({
        codigo: "RC3",
        nombre: "Monto dentro del tope del aprobador",
        estado: "APROBADO",
        detalle: `Monto ${paquete.solicitud.moneda} ${paquete.solicitud.valor_total.toLocaleString("es-CO")} <= tope ${paquete.solicitud.moneda} ${(resAprob.aprobadorAutorizado?.tope ?? 0).toLocaleString("es-CO")}.`,
      });
    }
  }

  // RC4: Subárea del centro de costos
  const resRC4 = evaluarCentroSubareaRC4(paquete.solicitud, maestros.centrosCosto);
  if (resRC4.bloqueo) {
    bloqueos.push(resRC4.bloqueo);
    controles_evaluados.push({
      codigo: "RC4",
      nombre: "Subárea pertenece al centro de costos",
      estado: "BLOQUEADO",
      detalle: resRC4.bloqueo.detalle,
    });
  } else {
    controles_evaluados.push({
      codigo: "RC4",
      nombre: "Subárea pertenece al centro de costos",
      estado: "APROBADO",
      detalle: `Subárea "${paquete.solicitud.subarea}" habilitada en ${paquete.solicitud.centro_costo}.`,
    });
  }

  // RC5: Cotización vs Solicitud (<= 2%)
  const resRC5 = evaluarCotizacionRC5(paquete.solicitud, paquete.cotizacion);
  if (resRC5.confirmacion) {
    confirmaciones.push(resRC5.confirmacion);
    controles_evaluados.push({
      codigo: "RC5",
      nombre: "Tolerancia cotización vs solicitud (<= 2%)",
      estado: "CONFIRMACION",
      detalle: resRC5.confirmacion.detalle,
    });
  } else {
    controles_evaluados.push({
      codigo: "RC5",
      nombre: "Tolerancia cotización vs solicitud (<= 2%)",
      estado: "APROBADO",
      detalle: `Desviación ${resRC5.desviacionPorcentaje ?? 0}% dentro del umbral del 2%.`,
    });
  }

  // RC6: Indicador de IVA
  const resRC6 = evaluarIvaRC6(paquete.solicitud, resRC1.proveedor, maestros.indicadoresIva);
  if (resRC6.bloqueo) {
    bloqueos.push(resRC6.bloqueo);
    controles_evaluados.push({
      codigo: "RC6",
      nombre: "Indicador de IVA",
      estado: "BLOQUEADO",
      detalle: resRC6.bloqueo.detalle,
    });
  } else if (resRC6.confirmacion) {
    confirmaciones.push(resRC6.confirmacion);
    controles_evaluados.push({
      codigo: "RC6",
      nombre: "Indicador de IVA",
      estado: "CONFIRMACION",
      detalle: resRC6.confirmacion.detalle,
    });
  } else {
    controles_evaluados.push({
      codigo: "RC6",
      nombre: "Indicador de IVA",
      estado: "APROBADO",
      detalle: `Indicador "${resRC6.codigoIva}" (${resRC6.descripcionIva ?? ""}) informado y válido.`,
    });
  }

  // RC7: Condiciones de pago
  const resRC7 = evaluarCondicionPagoRC7(
    paquete.solicitud,
    resRC1.proveedor,
    maestros.condicionesPago
  );
  if (resRC7.bloqueo) {
    bloqueos.push(resRC7.bloqueo);
    controles_evaluados.push({
      codigo: "RC7",
      nombre: "Condiciones de pago",
      estado: "BLOQUEADO",
      detalle: resRC7.bloqueo.detalle,
    });
  } else if (resRC7.derivado) {
    controles_evaluados.push({
      codigo: "RC7",
      nombre: "Condiciones de pago",
      estado: "DERIVADO",
      detalle: `Condición "${resRC7.codigoCondicion}" (${resRC7.descripcionCondicion ?? ""}) derivada del maestro del proveedor (informativo).`,
    });
  } else {
    controles_evaluados.push({
      codigo: "RC7",
      nombre: "Condiciones de pago",
      estado: "APROBADO",
      detalle: `Condición "${resRC7.codigoCondicion}" (${resRC7.descripcionCondicion ?? ""}) informada y válida.`,
    });
  }

  // RC8: Factura anterior a solicitud (compra retroactiva)
  const resRC8 = evaluarRetroactivaRC8(paquete.solicitud, paquete.factura);
  if (resRC8.confirmacion) {
    confirmaciones.push(resRC8.confirmacion);
    controles_evaluados.push({
      codigo: "RC8",
      nombre: "Detección de compra retroactiva",
      estado: "CONFIRMACION",
      detalle: resRC8.confirmacion.detalle,
    });
  } else {
    controles_evaluados.push({
      codigo: "RC8",
      nombre: "Detección de compra retroactiva",
      estado: "APROBADO",
      detalle: "Sin factura previa a la solicitud (proceso regular).",
    });
  }

  // RC9: Fecha de aprobación >= fecha de solicitud
  if (resAprob.confirmacionRC9) {
    confirmaciones.push(resAprob.confirmacionRC9);
    controles_evaluados.push({
      codigo: "RC9",
      nombre: "Cronología aprobación >= solicitud",
      estado: "CONFIRMACION",
      detalle: resAprob.confirmacionRC9.detalle,
    });
  } else if (paquete.aprobacion) {
    controles_evaluados.push({
      codigo: "RC9",
      nombre: "Cronología aprobación >= solicitud",
      estado: "APROBADO",
      detalle: `Fecha de aprobación (${paquete.aprobacion.fecha.slice(0, 10)}) >= fecha de solicitud (${paquete.solicitud.fecha_solicitud}).`,
    });
  }

  // RC10: Consistencia aritmética
  const resRC10 = evaluarAritmeticaRC10(paquete.solicitud);
  if (resRC10.bloqueo) {
    bloqueos.push(resRC10.bloqueo);
    controles_evaluados.push({
      codigo: "RC10",
      nombre: "Consistencia aritmética (cantidad × unitario = total)",
      estado: "BLOQUEADO",
      detalle: resRC10.bloqueo.detalle,
    });
  } else {
    controles_evaluados.push({
      codigo: "RC10",
      nombre: "Consistencia aritmética (cantidad × unitario = total)",
      estado: "APROBADO",
      detalle: `${paquete.solicitud.cantidad} × ${paquete.solicitud.valor_unitario.toLocaleString("es-CO")} = ${paquete.solicitud.valor_total.toLocaleString("es-CO")}.`,
    });
  }

  const derivados: Derivados = {
    codigo_sap_proveedor: resRC1.proveedor?.codigo_sap,
    proveedor_nit_resuelto: resRC1.proveedor?.nit,
    proveedor_nombre_maestro: resRC1.proveedor?.nombre,
    metodo_resolucion_proveedor: resRC1.metodo ?? undefined,
    indicador_iva: resRC6.codigoIva,
    indicador_iva_origen: resRC6.origen,
    indicador_iva_descripcion: resRC6.descripcionIva,
    condiciones_pago: resRC7.codigoCondicion,
    condiciones_pago_origen: resRC7.origen,
    condiciones_pago_descripcion: resRC7.descripcionCondicion,
    unidad_medida: inferirUnidadMedida(paquete.solicitud.descripcion),
    cotizacion_ref: paquete.cotizacion?.referencia ?? null,
  };

  return {
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones,
    derivados,
    retroactiva: resRC8.retroactiva,
    controles_evaluados,
  };
}

// ============================================================================
// Registro de Control Interno CSV (`out/control.csv`) y Evidencia (`txt` + `pdf`)
// ============================================================================

function escaparCampoCsv(valor: string): string {
  if (/[",\r\n]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

export function registrarEventoControlCsv(
  projectRoot: string,
  fila: {
    solicitud_id: string;
    resultado: "CREADA" | "IDEMPOTENTE" | "BLOQUEADA" | "PENDIENTE_CONFIRMACION";
    numero_oc: string;
    retroactiva: boolean;
    bloqueos: string[];
    confirmaciones: string[];
  }
): string {
  const rutaCsv = path.join(projectRoot, "out", "control.csv");
  fs.mkdirSync(path.dirname(rutaCsv), { recursive: true });

  const encabezado = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n";
  if (!fs.existsSync(rutaCsv)) {
    fs.writeFileSync(rutaCsv, encabezado, "utf-8");
  }

  const ts = new Date().toISOString();
  const linea = [
    escaparCampoCsv(fila.solicitud_id),
    escaparCampoCsv(fila.resultado),
    escaparCampoCsv(fila.numero_oc),
    String(fila.retroactiva),
    escaparCampoCsv(fila.bloqueos.join(";")),
    escaparCampoCsv(fila.confirmaciones.join(";")),
    ts,
  ].join(",");

  fs.appendFileSync(rutaCsv, `${linea}\n`, "utf-8");
  return rutaCsv;
}

function sanitizarTextoWinAnsi(texto: string): string {
  return texto
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/—/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "?");
}

export async function generarArchivosEvidencia(
  projectRoot: string,
  caso: string
): Promise<{ ruta: string; ruta_pdf: string; sha256: string }> {
  const dirCaso = resolverDirectorioCasoSeguro(projectRoot, caso);
  const rutaAprobJson = path.join(dirCaso, "aprobacion.json");
  if (!fs.existsSync(rutaAprobJson)) {
    throw new Error(`No existe aprobacion.json en el caso "${caso}" para generar evidencia.`);
  }

  const rawAprob = JSON.parse(fs.readFileSync(rutaAprobJson, "utf-8")) as Record<string, unknown>;
  const de = String(rawAprob.de ?? "");
  const para = String(rawAprob.para ?? "");
  const cc = Array.isArray(rawAprob.cc) ? rawAprob.cc.map(String).join(", ") : "";
  const fecha = String(rawAprob.fecha ?? "");
  const asunto = String(rawAprob.asunto ?? "");
  const cuerpo = String(rawAprob.cuerpo ?? "");

  const bloqueCanonico = [
    "========================================================================",
    "EVIDENCIA DE APROBACIÓN DE ORDEN DE COMPRA — PERIFERIA IT GROUP",
    "========================================================================",
    `Caso:    ${caso}`,
    `De:      ${de}`,
    `Para:    ${para}`,
    ...(cc ? [`CC:      ${cc}`] : []),
    `Fecha:   ${fecha}`,
    `Asunto:  ${asunto}`,
    "------------------------------------------------------------------------",
    "CUERPO DEL MENSAJE:",
    "",
    cuerpo,
    "------------------------------------------------------------------------",
  ].join("\n");

  const sha256 = crypto.createHash("sha256").update(bloqueCanonico, "utf-8").digest("hex");
  const contenidoTxt = `${bloqueCanonico}\nSHA-256: ${sha256}\n`;

  const outCasoDir = path.join(projectRoot, "out", caso);
  fs.mkdirSync(outCasoDir, { recursive: true });

  const rutaTxtAbs = path.join(outCasoDir, "aprobacion.txt");
  fs.writeFileSync(rutaTxtAbs, contenidoTxt, "utf-8");

  // P1: Generación de PDF de evidencia para auditoría con pdf-lib
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 790;
  page.drawText("PERIFERIA IT GROUP - EVIDENCIA DE APROBACION SAP", {
    x: 50,
    y,
    size: 13,
    font: fontBold,
    color: rgb(0.08, 0.22, 0.42),
  });
  y -= 28;

  const metadatos = [
    ["Caso:", caso],
    ["De:", de],
    ["Para:", para],
    ...(cc ? [["CC:", cc]] : []),
    ["Fecha:", fecha],
    ["Asunto:", asunto],
    ["SHA-256:", sha256],
  ];

  for (const [etiqueta, valor] of metadatos) {
    page.drawText(sanitizarTextoWinAnsi(etiqueta ?? ""), {
      x: 50,
      y,
      size: 10,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });
    page.drawText(sanitizarTextoWinAnsi(valor ?? "").slice(0, 85), {
      x: 115,
      y,
      size: 9.5,
      font: fontRegular,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 18;
  }

  y -= 10;
  page.drawLine({
    start: { x: 50, y },
    end: { x: 545, y },
    thickness: 1,
    color: rgb(0.75, 0.78, 0.82),
  });
  y -= 24;

  page.drawText("Cuerpo del correo de aprobacion:", {
    x: 50,
    y,
    size: 10.5,
    font: fontBold,
    color: rgb(0.15, 0.15, 0.15),
  });
  y -= 20;

  const lineasCuerpo = sanitizarTextoWinAnsi(cuerpo).split(/\r?\n/);
  for (const linea of lineasCuerpo) {
    const fragmentos = linea.match(/.{1,82}/g) ?? [""];
    for (const frag of fragmentos) {
      if (y < 60) break;
      page.drawText(frag, {
        x: 50,
        y,
        size: 10,
        font: fontRegular,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= 15;
    }
  }

  const pdfBytes = await pdfDoc.save();
  const rutaPdfAbs = path.join(outCasoDir, "aprobacion.pdf");
  fs.writeFileSync(rutaPdfAbs, pdfBytes);

  return {
    ruta: path.posix.join("out", caso, "aprobacion.txt"),
    ruta_pdf: path.posix.join("out", caso, "aprobacion.pdf"),
    sha256,
  };
}

export async function construirPayloadYTraza(
  projectRoot: string,
  caso: string,
  paqueteEntrada?: Paquete,
  derivadosEntrada?: Derivados,
  confirmadoPor: string | null = null
): Promise<{
  payload: OrdenCompra;
  ruta_trazabilidad: string;
  validacion: ResultadoValidacion;
}> {
  const maestros = cargarMaestros(projectRoot);
  const paquete = paqueteEntrada ?? leerPaqueteDesdeDisco(projectRoot, caso);
  const validacion = evaluarPaqueteCompleto(paquete, maestros);

  if (!validacion.apta) {
    const resumenBloqueos = validacion.bloqueos.map((b) => `${b.codigo}: ${b.detalle}`).join(" | ");
    throw new Error(
      `No es posible construir un payload SAP válido para "${caso}" porque tiene controles bloqueantes: ${resumenBloqueos}`
    );
  }

  const derivados = { ...validacion.derivados, ...derivadosEntrada };
  const evidencia = await generarArchivosEvidencia(projectRoot, caso);

  const descripcionCorta = paquete.solicitud.descripcion.trim().slice(0, 40);
  const fueTruncada = paquete.solicitud.descripcion.trim().length > 40;

  const codigoSap = derivados.codigo_sap_proveedor ?? "";
  const nitProveedor = derivados.proveedor_nit_resuelto ?? paquete.solicitud.proveedor_nit ?? "";
  const nombreProveedor = derivados.proveedor_nombre_maestro ?? paquete.solicitud.proveedor_nombre;
  const condicionesPago = derivados.condiciones_pago ?? paquete.solicitud.condiciones_pago ?? "";
  const indicadorIva = derivados.indicador_iva ?? paquete.solicitud.indicador_iva ?? "";
  const unidad = derivados.unidad_medida ?? inferirUnidadMedida(paquete.solicitud.descripcion);

  const payloadSinValidar: OrdenCompra = {
    referencia: {
      solicitud_id: paquete.solicitud.solicitud_id,
      correo_id: paquete.correo.id,
      cotizacion_ref: paquete.cotizacion?.referencia ?? derivados.cotizacion_ref ?? null,
    },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: {
      codigo_sap: codigoSap,
      nit: nitProveedor,
      nombre: nombreProveedor,
    },
    moneda: paquete.solicitud.moneda,
    condiciones_pago: condicionesPago,
    aprobador: {
      email: paquete.aprobacion?.de ?? "",
      fecha_aprobacion: paquete.aprobacion?.fecha ?? "",
      evidencia_sha256: evidencia.sha256,
    },
    posiciones: [
      {
        numero: 10,
        descripcion: descripcionCorta,
        cantidad: paquete.solicitud.cantidad,
        unidad,
        precio_unitario: paquete.solicitud.valor_unitario,
        centro_costo: paquete.solicitud.centro_costo,
        subarea: paquete.solicitud.subarea,
        indicador_iva: indicadorIva,
      },
    ],
    excepciones: validacion.confirmaciones.map((c) => ({
      codigo: c.codigo,
      detalle: c.detalle,
      confirmado_por: confirmadoPor,
    })),
  };

  const payload = OrdenCompraSchema.parse(payloadSinValidar);

  const trazabilidad = {
    solicitud_id: paquete.solicitud.solicitud_id,
    caso,
    generado_en: new Date().toISOString(),
    campos: {
      "referencia.solicitud_id": { valor: payload.referencia.solicitud_id, fuente: "solicitud" },
      "referencia.correo_id": { valor: payload.referencia.correo_id, fuente: "solicitud (correo.json)" },
      "referencia.cotizacion_ref": {
        valor: payload.referencia.cotizacion_ref,
        fuente: paquete.cotizacion ? "cotizacion" : "derivado",
      },
      sociedad: { valor: payload.sociedad, fuente: "derivado" },
      organizacion_compras: { valor: payload.organizacion_compras, fuente: "derivado" },
      "proveedor.codigo_sap": { valor: payload.proveedor.codigo_sap, fuente: "maestro.proveedores" },
      "proveedor.nit": {
        valor: payload.proveedor.nit,
        fuente: paquete.solicitud.proveedor_nit ? "solicitud" : "maestro.proveedores",
      },
      "proveedor.nombre": { valor: payload.proveedor.nombre, fuente: "maestro.proveedores" },
      moneda: { valor: payload.moneda, fuente: "solicitud" },
      condiciones_pago: {
        valor: payload.condiciones_pago,
        fuente:
          derivados.condiciones_pago_origen === "maestro.proveedores"
            ? "derivado (maestro.proveedores)"
            : "solicitud",
      },
      "aprobador.email": { valor: payload.aprobador.email, fuente: "solicitud (aprobacion.json)" },
      "aprobador.fecha_aprobacion": {
        valor: payload.aprobador.fecha_aprobacion,
        fuente: "solicitud (aprobacion.json)",
      },
      "aprobador.evidencia_sha256": { valor: payload.aprobador.evidencia_sha256, fuente: "derivado" },
      "posiciones[0].numero": { valor: 10, fuente: "derivado" },
      "posiciones[0].descripcion": {
        valor: descripcionCorta,
        descripcion_original: paquete.solicitud.descripcion,
        truncada_limite_sap_40_chars: fueTruncada,
        fuente: "solicitud",
      },
      "posiciones[0].cantidad": { valor: payload.posiciones[0]?.cantidad, fuente: "solicitud" },
      "posiciones[0].unidad": { valor: unidad, fuente: "derivado" },
      "posiciones[0].precio_unitario": {
        valor: payload.posiciones[0]?.precio_unitario,
        fuente: "solicitud",
      },
      "posiciones[0].centro_costo": {
        valor: payload.posiciones[0]?.centro_costo,
        fuente: "solicitud",
      },
      "posiciones[0].subarea": { valor: payload.posiciones[0]?.subarea, fuente: "solicitud" },
      "posiciones[0].indicador_iva": {
        valor: indicadorIva,
        fuente:
          derivados.indicador_iva_origen === "maestro.proveedores"
            ? "derivado (maestro.proveedores)"
            : "solicitud",
      },
    },
  };

  const outCasoDir = path.join(projectRoot, "out", caso);
  fs.mkdirSync(outCasoDir, { recursive: true });
  const rutaTrazabilidadAbs = path.join(outCasoDir, "trazabilidad.json");
  fs.writeFileSync(rutaTrazabilidadAbs, JSON.stringify(trazabilidad, null, 2), "utf-8");

  return {
    payload,
    ruta_trazabilidad: path.posix.join("out", caso, "trazabilidad.json"),
    validacion,
  };
}

// Inyección opcional de SapAdapter para pruebas de integración o producción
let sapAdapterOverride: SapAdapter | null = null;
export function configurarSapAdapter(adapter: SapAdapter | null): void {
  sapAdapterOverride = adapter;
}
function obtenerSapAdapter(projectRoot: string): SapAdapter {
  return sapAdapterOverride ?? new MockSapAdapter(projectRoot);
}

// ============================================================================
// Herramientas Exportadas según Contrato Sección 6.2 (`oc_<export>`)
// ============================================================================

export const leer_paquete: ToolDefinition<{ caso: z.ZodString }> = {
  description:
    "Lee y normaliza el paquete documental completo de una solicitud de compra (correo, solicitud, cotización, aprobación y factura si existe).",
  args: {
    caso: z
      .string()
      .min(1)
      .describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (ej. 'sol-001')"),
  },
  async execute(args, ctx) {
    try {
      const data = leerPaqueteDesdeDisco(ctx.directory, args.caso);
      return JSON.stringify({ ok: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ ok: false, error: message });
    }
  },
};

export const validar: ToolDefinition<{
  caso: z.ZodString;
  paquete: z.ZodOptional<typeof PaqueteSchema>;
}> = {
  description:
    "Evalúa las 10 reglas obligatorias de control interno (RC1 a RC10) contra los maestros SAP, clasificando bloqueos, confirmaciones, valores derivados y compras retroactivas.",
  args: {
    caso: z
      .string()
      .min(1)
      .describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (ej. 'sol-001')"),
    paquete: PaqueteSchema.optional().describe(
      "Paquete normalizado devuelto por oc_leer_paquete (opcional; si se omite, se lee desde disco para el caso indicado)."
    ),
  },
  async execute(args, ctx) {
    try {
      const maestros = cargarMaestros(ctx.directory);
      const paquete = args.paquete ?? leerPaqueteDesdeDisco(ctx.directory, args.caso);
      const resultado = evaluarPaqueteCompleto(paquete, maestros);

      if (!resultado.apta) {
        registrarEventoControlCsv(ctx.directory, {
          solicitud_id: paquete.solicitud.solicitud_id,
          resultado: "BLOQUEADA",
          numero_oc: "",
          retroactiva: resultado.retroactiva,
          bloqueos: resultado.bloqueos.map((b) => b.codigo),
          confirmaciones: resultado.confirmaciones.map((c) => c.codigo),
        });
      }

      return JSON.stringify({ ok: true, data: resultado });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ ok: false, error: message });
    }
  },
};

export const generar_evidencia: ToolDefinition<{ caso: z.ZodString }> = {
  description:
    "Genera y archiva la evidencia verificable del correo de aprobación en texto y PDF (out/<caso>/aprobacion.txt y aprobacion.pdf) junto con su hash criptográfico SHA-256.",
  args: {
    caso: z
      .string()
      .min(1)
      .describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (ej. 'sol-001')"),
  },
  async execute(args, ctx) {
    try {
      const data = await generarArchivosEvidencia(ctx.directory, args.caso);
      return JSON.stringify({ ok: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ ok: false, error: message });
    }
  },
};

export const construir_payload: ToolDefinition<{
  caso: z.ZodString;
  paquete: z.ZodOptional<typeof PaqueteSchema>;
  derivados: z.ZodOptional<typeof DerivadosSchema>;
}> = {
  description:
    "Construye y valida el payload estructurado OrdenCompra para SAP (Sociedad 1000) y guarda la trazabilidad campo a campo en out/<caso>/trazabilidad.json.",
  args: {
    caso: z
      .string()
      .min(1)
      .describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (ej. 'sol-001')"),
    paquete: PaqueteSchema.optional().describe("Paquete normalizado opcional."),
    derivados: DerivadosSchema.optional().describe("Valores derivados devueltos por oc_validar."),
  },
  async execute(args, ctx) {
    try {
      const { payload, ruta_trazabilidad } = await construirPayloadYTraza(
        ctx.directory,
        args.caso,
        args.paquete,
        args.derivados
      );
      return JSON.stringify({
        ok: true,
        data: {
          orden_compra: payload,
          ruta_trazabilidad,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ ok: false, error: message });
    }
  },
};

export const crear: ToolDefinition<{
  caso: z.ZodString;
  payload: z.ZodOptional<typeof OrdenCompraSchema>;
  confirmado: z.ZodOptional<z.ZodBoolean>;
}> = {
  description:
    "Crea la Orden de Compra en el adaptador SAP de forma idempotente y auditable en out/control.csv; exige que apta=true y confirmación humana explícita si existen excepciones.",
  args: {
    caso: z
      .string()
      .min(1)
      .describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (ej. 'sol-001')"),
    payload: OrdenCompraSchema.optional().describe(
      "Payload de OrdenCompra previamente generado por oc_construir_payload."
    ),
    confirmado: z
      .boolean()
      .optional()
      .describe(
        "Debe ser true únicamente cuando la analista humana ya confirmó explícitamente las excepciones pendientes."
      ),
  },
  async execute(args, ctx) {
    try {
      const maestros = cargarMaestros(ctx.directory);
      const paquete = leerPaqueteDesdeDisco(ctx.directory, args.caso);
      const validacion = evaluarPaqueteCompleto(paquete, maestros);

      if (!validacion.apta) {
        registrarEventoControlCsv(ctx.directory, {
          solicitud_id: paquete.solicitud.solicitud_id,
          resultado: "BLOQUEADA",
          numero_oc: "",
          retroactiva: validacion.retroactiva,
          bloqueos: validacion.bloqueos.map((b) => b.codigo),
          confirmaciones: validacion.confirmaciones.map((c) => c.codigo),
        });
        return JSON.stringify({
          ok: false,
          error: `Creación rechazada por controles bloqueantes (${validacion.bloqueos.map((b) => b.codigo).join(", ")}).`,
          bloqueos: validacion.bloqueos,
        });
      }

      const requiereConfirmacion = validacion.confirmaciones.length > 0;
      const estaConfirmado = args.confirmado === true;

      if (requiereConfirmacion && !estaConfirmado) {
        registrarEventoControlCsv(ctx.directory, {
          solicitud_id: paquete.solicitud.solicitud_id,
          resultado: "PENDIENTE_CONFIRMACION",
          numero_oc: "",
          retroactiva: validacion.retroactiva,
          bloqueos: [],
          confirmaciones: validacion.confirmaciones.map((c) => c.codigo),
        });
        return JSON.stringify({
          ok: false,
          requiere_confirmacion: true,
          error: `La solicitud ${paquete.solicitud.solicitud_id} requiere confirmación humana explícita para las excepciones: ${validacion.confirmaciones.map((c) => c.codigo).join(", ")}.`,
          confirmaciones: validacion.confirmaciones,
        });
      }

      // Defensa en profundidad: se reconstruye el payload canónico desde fuentes inmutables
      // para impedir que el modelo altere precios, cantidades, proveedor o centro de costos.
      const confirmadoPor =
        requiereConfirmacion && estaConfirmado ? `analista:${ctx.sessionId}` : null;
      const { payload: payloadCanonico } = await construirPayloadYTraza(
        ctx.directory,
        args.caso,
        paquete,
        validacion.derivados,
        confirmadoPor
      );

      if (args.payload) {
        const precioCanonico = payloadCanonico.posiciones[0]?.precio_unitario;
        const precioEnviado = args.payload.posiciones[0]?.precio_unitario;
        const cantCanonica = payloadCanonico.posiciones[0]?.cantidad;
        const cantEnviada = args.payload.posiciones[0]?.cantidad;
        if (
          precioEnviado !== precioCanonico ||
          cantEnviada !== cantCanonica ||
          args.payload.proveedor.codigo_sap !== payloadCanonico.proveedor.codigo_sap ||
          args.payload.posiciones[0]?.centro_costo !== payloadCanonico.posiciones[0]?.centro_costo
        ) {
          return JSON.stringify({
            ok: false,
            error:
              "Integridad rechazada: el payload recibido difiere de los valores canónicos validados en las fuentes.",
          });
        }
      }

      const sap = obtenerSapAdapter(ctx.directory);
      const previa = await sap.buscarOrdenPorReferencia(payloadCanonico.referencia.solicitud_id);
      const creada = await sap.crearOrden(payloadCanonico);
      const idempotente = previa !== null;

      registrarEventoControlCsv(ctx.directory, {
        solicitud_id: paquete.solicitud.solicitud_id,
        resultado: idempotente ? "IDEMPOTENTE" : "CREADA",
        numero_oc: creada.numero_oc,
        retroactiva: validacion.retroactiva,
        bloqueos: [],
        confirmaciones: validacion.confirmaciones.map((c) => c.codigo),
      });

      return JSON.stringify({
        ok: true,
        data: {
          numero_oc: creada.numero_oc,
          fecha: creada.fecha,
          idempotente,
          retroactiva: validacion.retroactiva,
          solicitud_id: paquete.solicitud.solicitud_id,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ ok: false, error: message });
    }
  },
};

// ============================================================================
// Herramientas Atómicas de Consulta y Validación Puntual + P1 Excel
// ============================================================================

export const validar_proveedor: ToolDefinition<{
  proveedor_nombre: z.ZodString;
  proveedor_nit: z.ZodOptional<z.ZodString>;
}> = {
  description:
    "Valida puntualmente la regla RC1 verificando si un proveedor existe por NIT o razón social normalizada en proveedores.json y si está activo en SAP.",
  args: {
    proveedor_nombre: z.string().min(1).describe("Razón social del proveedor."),
    proveedor_nit: z.string().optional().describe("NIT del proveedor (opcional)."),
  },
  async execute(args, ctx) {
    try {
      const { proveedores } = cargarMaestros(ctx.directory);
      const data = evaluarProveedorRC1(args, proveedores);
      return JSON.stringify({ ok: true, data });
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};

export const validar_centro_costo: ToolDefinition<{
  centro_costo: z.ZodString;
  subarea: z.ZodString;
  aprobador_email: z.ZodOptional<z.ZodString>;
  valor_total: z.ZodOptional<z.ZodNumber>;
}> = {
  description:
    "Valida centro de costo, pertenencia de subárea (RC4) y opcionalmente el tope de aprobación del líder en ese centro (RC2/RC3).",
  args: {
    centro_costo: z.string().min(1).describe("Código del centro de costos (ej. 'CC-1010')."),
    subarea: z.string().min(1).describe("Nombre de la subárea imputada (ej. 'Infraestructura')."),
    aprobador_email: z.string().optional().describe("Correo del líder aprobador (opcional)."),
    valor_total: z.number().optional().describe("Monto total a validar frente al tope (opcional)."),
  },
  async execute(args, ctx) {
    try {
      const { centrosCosto } = cargarMaestros(ctx.directory);
      const resSubarea = evaluarCentroSubareaRC4(args, centrosCosto);
      let topeInfo: Record<string, unknown> | null = null;
      if (args.aprobador_email && args.valor_total !== undefined && resSubarea.centro) {
        const aprob = resSubarea.centro.aprobadores.find(
          (a) => a.email.toLowerCase() === args.aprobador_email?.toLowerCase()
        );
        topeInfo = {
          autorizado_en_centro: Boolean(aprob),
          tope: aprob?.tope ?? null,
          cumple_tope: aprob ? args.valor_total <= aprob.tope : false,
        };
      }
      return JSON.stringify({ ok: true, data: { ...resSubarea, validacion_tope: topeInfo } });
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};

export const verificar_aprobacion: ToolDefinition<{ caso: z.ZodString }> = {
  description:
    "Verifica puntualmente la evidencia de aprobación del líder en un caso (RC2 autoridad, RC3 tope de monto y RC9 consistencia de fechas).",
  args: {
    caso: z.string().min(1).describe("Nombre del caso en fixtures/reto-03/solicitudes/."),
  },
  async execute(args, ctx) {
    try {
      const maestros = cargarMaestros(ctx.directory);
      const paquete = leerPaqueteDesdeDisco(ctx.directory, args.caso);
      const data = evaluarAprobacionYTope(paquete.solicitud, paquete.aprobacion, maestros.centrosCosto);
      return JSON.stringify({ ok: true, data });
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};

export const validar_iva: ToolDefinition<{
  caso: z.ZodString;
}> = {
  description:
    "Valida el indicador de IVA de un caso contra indicadores-iva.json o deriva el predeterminado del proveedor (RC6).",
  args: {
    caso: z.string().min(1).describe("Nombre del caso en fixtures/reto-03/solicitudes/."),
  },
  async execute(args, ctx) {
    try {
      const maestros = cargarMaestros(ctx.directory);
      const paquete = leerPaqueteDesdeDisco(ctx.directory, args.caso);
      const prov = evaluarProveedorRC1(paquete.solicitud, maestros.proveedores);
      const data = evaluarIvaRC6(paquete.solicitud, prov.proveedor, maestros.indicadoresIva);
      return JSON.stringify({ ok: true, data });
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};

export const validar_condicion_pago: ToolDefinition<{
  caso: z.ZodString;
}> = {
  description:
    "Valida la condición de pago de un caso contra condiciones-pago.json o deriva la predeterminada del proveedor (RC7).",
  args: {
    caso: z.string().min(1).describe("Nombre del caso en fixtures/reto-03/solicitudes/."),
  },
  async execute(args, ctx) {
    try {
      const maestros = cargarMaestros(ctx.directory);
      const paquete = leerPaqueteDesdeDisco(ctx.directory, args.caso);
      const prov = evaluarProveedorRC1(paquete.solicitud, maestros.proveedores);
      const data = evaluarCondicionPagoRC7(
        paquete.solicitud,
        prov.proveedor,
        maestros.condicionesPago
      );
      return JSON.stringify({ ok: true, data });
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};

export const detectar_retroactiva: ToolDefinition<{ caso: z.ZodString }> = {
  description:
    "Analiza si una solicitud corresponde a una compra retroactiva verificando si existe factura emitida antes de la fecha de solicitud (RC8).",
  args: {
    caso: z.string().min(1).describe("Nombre del caso en fixtures/reto-03/solicitudes/."),
  },
  async execute(args, ctx) {
    try {
      const paquete = leerPaqueteDesdeDisco(ctx.directory, args.caso);
      const data = evaluarRetroactivaRC8(paquete.solicitud, paquete.factura);
      return JSON.stringify({ ok: true, data });
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};

export const listar_casos: ToolDefinition<Record<string, never>> = {
  description:
    "Lista todos los casos de solicitud disponibles en fixtures/reto-03/solicitudes/ con su ID, solicitante, proveedor y monto.",
  args: {},
  async execute(_args, ctx) {
    try {
      const dir = path.join(ctx.directory, "fixtures", "reto-03", "solicitudes");
      const carpetas = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();

      const casos = carpetas.map((nombre) => {
        const solPath = path.join(dir, nombre, "solicitud.json");
        const tieneFactura = fs.existsSync(path.join(dir, nombre, "factura.txt"));
        if (!fs.existsSync(solPath)) {
          return { caso: nombre, estado_lectura: "incompleto" };
        }
        const sol = JSON.parse(fs.readFileSync(solPath, "utf-8")) as Record<string, unknown>;
        return {
          caso: nombre,
          solicitud_id: sol.solicitud_id,
          solicitante: sol.solicitante,
          proveedor_nombre: sol.proveedor_nombre,
          centro_costo: sol.centro_costo,
          valor_total: sol.valor_total,
          moneda: sol.moneda,
          incluye_factura: tieneFactura,
        };
      });

      return JSON.stringify({ ok: true, data: { total: casos.length, casos } });
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};

export const consultar_conocimiento: ToolDefinition<{ tema: z.ZodOptional<z.ZodString> }> = {
  description:
    "Consulta la base de conocimiento normativa del proceso de Órdenes de Compra SAP y el detalle de las reglas RC1 a RC10.",
  args: {
    tema: z
      .string()
      .optional()
      .describe("Término o regla específica a consultar (ej. 'RC5', 'retroactiva', 'SAP')."),
  },
  async execute(args, ctx) {
    try {
      const ruta = path.join(ctx.directory, "src", "knowledge", "ordenes-compra.md");
      const contenido = fs.readFileSync(ruta, "utf-8");
      return JSON.stringify({
        ok: true,
        data: {
          tema: args.tema ?? "general",
          conocimiento: contenido,
        },
      });
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};

export const leer_excel: ToolDefinition<{ ruta: z.ZodString }> = {
  description:
    "Lee filas tabulares desde un archivo Excel (.xlsx) ubicado dentro del directorio del proyecto (herramienta P1).",
  args: {
    ruta: z
      .string()
      .min(1)
      .describe("Ruta relativa dentro del proyecto hacia el archivo .xlsx."),
  },
  async execute(args, ctx) {
    try {
      const raiz = path.resolve(ctx.directory);
      const destino = path.resolve(raiz, args.ruta);
      if (!destino.startsWith(raiz + path.sep)) {
        return JSON.stringify({
          ok: false,
          error: "Acceso denegado: la ruta debe estar contenida dentro del directorio del proyecto.",
        });
      }
      if (!fs.existsSync(destino)) {
        return JSON.stringify({ ok: false, error: `No existe el archivo Excel: ${args.ruta}` });
      }
      const filas = leerFilasXlsx(destino);
      return JSON.stringify({ ok: true, data: { filas } });
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};
