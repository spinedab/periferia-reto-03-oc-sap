import { FIXTURES_DATA } from "./fixtures-bundle.js";

const SAP_SEQ_START = 4500000001;
const STORE_KEY = "periferia_reto03_standalone_state_v1";

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return { ordenes: [], control: [], sessions: {} };
}

function saveState(st) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(st));
  } catch {
    // ignore
  }
}

function normNit(nit) {
  return String(nit || "").trim().replace(/\./g, "").replace(/\s+/g, "").split("-")[0] || "";
}

function normText(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseMoney(raw) {
  const clean = String(raw || "").trim().replace(/\s+/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(clean)) {
    return Number(clean.replace(/\./g, "").replace(",", "."));
  }
  return Number(clean.replace(/,/g, ""));
}

function inferUnit(desc) {
  if (/\b(horas?|hrs?)\b/i.test(desc)) return "H";
  if (/\b(mensualidad|servicio mensual|arrendamiento mensual|suscripci[oó]n mensual)\b/i.test(desc)) return "MES";
  return "UN";
}

function parseCotizacion(texto) {
  if (!texto) return null;
  const refM = /^COTIZACI[OÓ]N\s+([^\r\n]+)/im.exec(texto);
  const fechaM = /^Fecha:\s*(\d{4}-\d{2}-\d{2})/im.exec(texto);
  const provM = /^Proveedor:\s*(.+)$/im.exec(texto);
  const nitM = /^NIT:\s*([0-9.\-\s]+)$/im.exec(texto);
  const totalM = /^TOTAL[^:\r\n]*:\s*(COP|USD)\s*([0-9.,]+)/im.exec(texto);
  const valM = /^Validez de la oferta:\s*(\d+)\s*d[ií]as/im.exec(texto);
  const fecha = fechaM?.[1]?.trim() ?? null;
  let validez_hasta = null;
  if (fecha && valM?.[1]) {
    const [y, m, d] = fecha.split("-").map(Number);
    validez_hasta = new Date(Date.UTC(y, m - 1, d + Number(valM[1]))).toISOString().slice(0, 10);
  }
  return {
    referencia: refM?.[1]?.trim() ?? null,
    fecha,
    proveedor: provM?.[1]?.trim() ?? "Desconocido",
    nit: nitM?.[1] ? normNit(nitM[1]) : null,
    total: totalM?.[2] ? parseMoney(totalM[2]) : 0,
    moneda: totalM?.[1]?.trim() ?? "COP",
    validez_hasta,
    texto,
  };
}

function parseFactura(texto) {
  if (!texto) return null;
  const numM = /FACTURA[^\r\n]*?(?:No\.|Nro\.|#)\s*([A-Z0-9\-]+)/i.exec(texto);
  const fechaM = /Fecha(?:\s+de\s+emisi[oó]n)?:\s*(\d{4}-\d{2}-\d{2})/i.exec(texto);
  const totalM = /^TOTAL[^:\r\n]*:\s*(?:COP|USD)?\s*([0-9.,]+)/im.exec(texto);
  return {
    numero: numM?.[1]?.trim() ?? "SIN-NUMERO",
    fecha: fechaM?.[1]?.trim() ?? "",
    total: totalM?.[1] ? parseMoney(totalM[1]) : 0,
  };
}

async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function leerPaquete(caso) {
  const item = FIXTURES_DATA.solicitudes[caso];
  if (!item) throw new Error(`No existe el caso "${caso}". Casos válidos: sol-001 a sol-006.`);
  const cuerpoAprob = item.aprobacion ? String(item.aprobacion.cuerpo ?? "") : "";
  return {
    correo: {
      id: item.correo.id,
      de: item.correo.de,
      para: item.correo.para,
      asunto: item.correo.asunto,
      fecha: item.correo.fecha,
    },
    solicitud: item.solicitud,
    cotizacion: parseCotizacion(item.cotizacionTxt),
    aprobacion: item.aprobacion
      ? {
          de: String(item.aprobacion.de).trim().toLowerCase(),
          para: item.aprobacion.para,
          fecha: item.aprobacion.fecha,
          asunto: item.aprobacion.asunto,
          aprobado: !/\bno\s+aprobado\b/i.test(cuerpoAprob) && /\baprobado\b/i.test(cuerpoAprob),
          texto: cuerpoAprob,
        }
      : null,
    factura: parseFactura(item.facturaTxt),
  };
}

function evaluarControles(paquete) {
  const { proveedores, centrosCosto, indicadoresIva, condicionesPago } = FIXTURES_DATA.maestros;
  const sol = paquete.solicitud;
  const bloqueos = [];
  const confirmaciones = [];
  const controles_evaluados = [];

  // RC1
  let prov = null;
  let metodoProv = null;
  if (sol.proveedor_nit) {
    prov = proveedores.find((p) => normNit(p.nit) === normNit(sol.proveedor_nit)) || null;
    metodoProv = "nit";
  } else {
    prov = proveedores.find((p) => normText(p.nombre) === normText(sol.proveedor_nombre)) || null;
    metodoProv = "nombre_normalizado";
  }
  if (!prov || !prov.activo) {
    const det = !prov
      ? `El proveedor "${sol.proveedor_nombre}" (NIT ${sol.proveedor_nit || "ausente"}) no existe en proveedores.json.`
      : `El proveedor "${prov.nombre}" figura inactivo en proveedores.json.`;
    bloqueos.push({
      codigo: "RC1",
      regla: "Proveedor registrado y activo en maestro SAP",
      detalle: det,
      accion_sugerida: "Solicitar creación/homologación del proveedor en datos maestros SAP antes de emitir la OC.",
    });
    controles_evaluados.push({ codigo: "RC1", nombre: "Proveedor en maestro y activo", estado: "BLOQUEADO", detalle: det });
  } else {
    controles_evaluados.push({
      codigo: "RC1",
      nombre: "Proveedor en maestro y activo",
      estado: "APROBADO",
      detalle: `Proveedor ${prov.nombre} (SAP ${prov.codigo_sap}, NIT ${prov.nit}) activo; resuelto por ${metodoProv}.`,
    });
  }

  // RC2 + RC3 + RC9
  const centro = centrosCosto.find((c) => c.centro_costo === sol.centro_costo) || null;
  const emailAprob = paquete.aprobacion?.de || "";
  const aprobCentro = centro?.aprobadores.find((a) => a.email.toLowerCase() === emailAprob) || null;

  if (!paquete.aprobacion || !paquete.aprobacion.aprobado || !aprobCentro) {
    const validos = centro
      ? centro.aprobadores.map((a) => `${a.email} (tope ${sol.moneda} ${a.tope.toLocaleString("es-CO")})`).join(", ")
      : "ninguno";
    const det = `El remitente "${emailAprob || "ausente"}" no está autorizado para aprobar el centro ${sol.centro_costo}. Aprobadores válidos: ${validos}.`;
    bloqueos.push({
      codigo: "RC2",
      regla: "Aprobador autorizado en la matriz del centro de costos",
      detalle: det,
      accion_sugerida: `Rechazar o escalar al aprobador autorizado de ${sol.centro_costo} con cupo suficiente.`,
    });
    controles_evaluados.push({ codigo: "RC2", nombre: "Aprobación válida del centro", estado: "BLOQUEADO", detalle: det });
    controles_evaluados.push({ codigo: "RC3", nombre: "Monto dentro del tope", estado: "BLOQUEADO", detalle: "Sin atribución en el centro imputado." });
  } else {
    controles_evaluados.push({
      codigo: "RC2",
      nombre: "Aprobación válida del centro",
      estado: "APROBADO",
      detalle: `Aprobado por ${aprobCentro.email} para ${sol.centro_costo}.`,
    });
    if (sol.valor_total > aprobCentro.tope) {
      const det = `Valor ${sol.valor_total.toLocaleString("es-CO")} supera tope ${aprobCentro.tope.toLocaleString("es-CO")}.`;
      bloqueos.push({ codigo: "RC3", regla: "Tope de aprobación", detalle: det, accion_sugerida: "Escalar a aprobador con mayor tope." });
      controles_evaluados.push({ codigo: "RC3", nombre: "Monto dentro del tope", estado: "BLOQUEADO", detalle: det });
    } else {
      controles_evaluados.push({
        codigo: "RC3",
        nombre: "Monto dentro del tope",
        estado: "APROBADO",
        detalle: `${sol.moneda} ${sol.valor_total.toLocaleString("es-CO")} <= tope ${aprobCentro.tope.toLocaleString("es-CO")}.`,
      });
    }
  }

  // RC4
  if (!centro || !centro.subareas.includes(sol.subarea)) {
    const det = `Subárea "${sol.subarea}" no pertenece a ${sol.centro_costo}.`;
    bloqueos.push({ codigo: "RC4", regla: "Subárea válida", detalle: det, accion_sugerida: "Corregir imputación de subárea." });
    controles_evaluados.push({ codigo: "RC4", nombre: "Subárea del centro", estado: "BLOQUEADO", detalle: det });
  } else {
    controles_evaluados.push({ codigo: "RC4", nombre: "Subárea del centro", estado: "APROBADO", detalle: `Subárea "${sol.subarea}" habilitada.` });
  }

  // RC5
  if (!paquete.cotizacion) {
    const det = "No se adjuntó cotización.";
    confirmaciones.push({ codigo: "RC5", regla: "Cotización <= 2%", detalle: det, accion_sugerida: "Confirmar acuerdo comercial." });
    controles_evaluados.push({ codigo: "RC5", nombre: "Tolerancia cotización <= 2%", estado: "CONFIRMACION", detalle: det });
  } else {
    const diff = Math.abs(paquete.cotizacion.total - sol.valor_total);
    const pct = Number(((diff / sol.valor_total) * 100).toFixed(2));
    if (diff / sol.valor_total > 0.02) {
      const det = `Discrepancia del ${pct}% (> 2%): solicitud ${sol.moneda} ${sol.valor_total.toLocaleString("es-CO")} vs cotización ${paquete.cotizacion.moneda} ${paquete.cotizacion.total.toLocaleString("es-CO")}.`;
      confirmaciones.push({
        codigo: "RC5",
        regla: "Diferencia cotización vs solicitud <= 2%",
        detalle: det,
        accion_sugerida: "Verificar con solicitante y aprobador cuál monto rige antes de confirmar la OC.",
      });
      controles_evaluados.push({ codigo: "RC5", nombre: "Tolerancia cotización <= 2%", estado: "CONFIRMACION", detalle: det });
    } else {
      controles_evaluados.push({ codigo: "RC5", nombre: "Tolerancia cotización <= 2%", estado: "APROBADO", detalle: `Desviación ${pct}% <= 2%.` });
    }
  }

  // RC6
  let codigoIva = sol.indicador_iva;
  let ivaOrigen = "solicitud";
  if (!codigoIva && prov) {
    codigoIva = prov.indicador_iva_default;
    ivaOrigen = "maestro.proveedores";
    const ind = indicadoresIva.find((i) => i.codigo === codigoIva);
    const det = `La solicitud no informó indicador_iva; se derivó "${codigoIva}" (${ind?.descripcion || ""}) desde el maestro del proveedor "${prov.nombre}".`;
    confirmaciones.push({
      codigo: "RC6",
      regla: "Indicador de IVA derivado desde proveedor",
      detalle: det,
      accion_sugerida: `Confirmar que aplica el indicador "${codigoIva}" antes de contabilizar la OC.`,
    });
    controles_evaluados.push({ codigo: "RC6", nombre: "Indicador de IVA", estado: "CONFIRMACION", detalle: det });
  } else {
    controles_evaluados.push({ codigo: "RC6", nombre: "Indicador de IVA", estado: "APROBADO", detalle: `Indicador "${codigoIva}" válido.` });
  }

  // RC7
  let codigoPago = sol.condiciones_pago;
  let pagoOrigen = "solicitud";
  if (!codigoPago && prov) {
    codigoPago = prov.condiciones_pago_default;
    pagoOrigen = "maestro.proveedores";
    const cnd = condicionesPago.find((c) => c.codigo === codigoPago);
    controles_evaluados.push({
      codigo: "RC7",
      nombre: "Condiciones de pago",
      estado: "DERIVADO",
      detalle: `Condición "${codigoPago}" (${cnd?.descripcion || ""}) derivada del proveedor (informativo).`,
    });
  } else {
    controles_evaluados.push({ codigo: "RC7", nombre: "Condiciones de pago", estado: "APROBADO", detalle: `Condición "${codigoPago}" válida.` });
  }

  // RC8
  let retroactiva = false;
  if (paquete.factura && paquete.factura.fecha < sol.fecha_solicitud) {
    retroactiva = true;
    const dias = Math.round((Date.parse(sol.fecha_solicitud) - Date.parse(paquete.factura.fecha)) / 86400000);
    const det = `Desvío de proceso detectado: factura ${paquete.factura.numero} emitida el ${paquete.factura.fecha} (${dias} días antes de la solicitud ${sol.fecha_solicitud}). Se marcará retroactiva = true.`;
    confirmaciones.push({
      codigo: "RC8",
      regla: "Detección de compra retroactiva",
      detalle: det,
      accion_sugerida: "Confirmar autorización excepcional de regularización y auditar como retroactiva = true.",
    });
    controles_evaluados.push({ codigo: "RC8", nombre: "Compra retroactiva", estado: "CONFIRMACION", detalle: det });
  } else {
    controles_evaluados.push({ codigo: "RC8", nombre: "Compra retroactiva", estado: "APROBADO", detalle: "Sin factura previa." });
  }

  // RC9
  const fechaAp = (paquete.aprobacion?.fecha || "").slice(0, 10);
  if (fechaAp && fechaAp < sol.fecha_solicitud) {
    const det = `Fecha aprobación (${fechaAp}) < fecha solicitud (${sol.fecha_solicitud}).`;
    confirmaciones.push({ codigo: "RC9", regla: "Cronología aprobación", detalle: det, accion_sugerida: "Confirmar validez." });
    controles_evaluados.push({ codigo: "RC9", nombre: "Cronología aprobación", estado: "CONFIRMACION", detalle: det });
  } else {
    controles_evaluados.push({ codigo: "RC9", nombre: "Cronología aprobación", estado: "APROBADO", detalle: `${fechaAp} >= ${sol.fecha_solicitud}.` });
  }

  // RC10
  const calc = sol.cantidad * sol.valor_unitario;
  if (Math.abs(calc - sol.valor_total) > 1) {
    const det = `Error aritmético: ${sol.cantidad} × ${sol.valor_unitario} != ${sol.valor_total}.`;
    bloqueos.push({ codigo: "RC10", regla: "Aritmética", detalle: det, accion_sugerida: "Corregir solicitud." });
    controles_evaluados.push({ codigo: "RC10", nombre: "Aritmética", estado: "BLOQUEADO", detalle: det });
  } else {
    controles_evaluados.push({ codigo: "RC10", nombre: "Aritmética", estado: "APROBADO", detalle: `${sol.cantidad} × ${sol.valor_unitario.toLocaleString("es-CO")} = ${sol.valor_total.toLocaleString("es-CO")}.` });
  }

  return {
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones,
    retroactiva,
    controles_evaluados,
    derivados: {
      codigo_sap_proveedor: prov?.codigo_sap,
      proveedor_nit_resuelto: prov?.nit,
      proveedor_nombre_maestro: prov?.nombre,
      metodo_resolucion_proveedor: metodoProv,
      indicador_iva: codigoIva,
      indicador_iva_origen: ivaOrigen,
      condiciones_pago: codigoPago,
      condiciones_pago_origen: pagoOrigen,
      unidad_medida: inferUnit(sol.descripcion),
      cotizacion_ref: paquete.cotizacion?.referencia ?? null,
    },
  };
}

export async function standaloneCases() {
  const st = loadState();
  const bySol = new Map(st.ordenes.map((o) => [o.orden.referencia.solicitud_id, o.numero_oc]));
  const cases = Object.keys(FIXTURES_DATA.solicitudes)
    .sort()
    .map((caso) => {
      const f = FIXTURES_DATA.solicitudes[caso];
      return {
        caso,
        solicitud_id: f.solicitud.solicitud_id,
        solicitante: f.solicitud.solicitante,
        proveedor_nombre: f.solicitud.proveedor_nombre,
        descripcion: f.solicitud.descripcion,
        centro_costo: f.solicitud.centro_costo,
        subarea: f.solicitud.subarea,
        valor_total: f.solicitud.valor_total,
        moneda: f.solicitud.moneda,
        tiene_factura: Boolean(f.facturaTxt),
        numero_oc: bySol.get(f.solicitud.solicitud_id) || null,
        evidencia_pdf_url: null,
      };
    });
  return { ok: true, cases };
}

export async function standaloneAudit() {
  const st = loadState();
  return { ok: true, control: st.control, ordenes: st.ordenes };
}

export async function standaloneGetSession(sessionId) {
  const st = loadState();
  return st.sessions[sessionId] || { sessionId, turns: [], totalTokensUsed: 0, pendingConfirmation: null };
}

export async function standaloneChat(sessionId, message) {
  const st = loadState();
  const ses = st.sessions[sessionId] || {
    sessionId,
    turns: [],
    totalTokensUsed: 0,
    pendingConfirmation: null,
    lastCase: null,
  };

  const toolCalls = [];
  const msg = String(message || "").trim();
  const matchCaso = /\b(sol-00[1-6])\b/i.exec(msg);
  const caso = matchCaso ? matchCaso[1].toLowerCase() : ses.pendingConfirmation?.caso || ses.lastCase;
  if (caso) ses.lastCase = caso;

  const esRechazo =
    /\b(rechaz[oa]r?|cancelar?|no crear|no confirmo)\b/i.test(msg) &&
    !/\bno la crees hasta que yo lo confirme\b/i.test(msg);
  const esConfirmacion =
    !esRechazo &&
    /^(s[ií]|confirmo|confirmar|apruebo|aprobar|proceder|adelante)\b|\b(confirmo la creaci[oó]n|apruebo crear)\b/i.test(msg);
  const pidePausa = /\b(no la crees hasta|antes de crear|sin crear)\b/i.test(msg);

  let reply = "";
  let needsConfirmation = false;

  if (esRechazo && caso) {
    ses.pendingConfirmation = null;
    reply = `Entendido. Se ha **cancelado** la creación de la Orden de Compra para el caso **${caso}**. Devuelve las observaciones al solicitante antes de radicar nuevamente.`;
  } else if (esConfirmacion && caso) {
    const paquete = leerPaquete(caso);
    const val = evaluarControles(paquete);
    const sha = await sha256Hex(`${caso}:${paquete.aprobacion?.de}:${paquete.aprobacion?.fecha}:${paquete.aprobacion?.texto}`);
    const orden = {
      referencia: {
        solicitud_id: paquete.solicitud.solicitud_id,
        correo_id: paquete.correo.id,
        cotizacion_ref: val.derivados.cotizacion_ref,
      },
      sociedad: "1000",
      organizacion_compras: "1000",
      proveedor: {
        codigo_sap: val.derivados.codigo_sap_proveedor,
        nit: val.derivados.proveedor_nit_resuelto,
        nombre: val.derivados.proveedor_nombre_maestro,
      },
      moneda: paquete.solicitud.moneda,
      condiciones_pago: val.derivados.condiciones_pago,
      aprobador: {
        email: paquete.aprobacion?.de || "",
        fecha_aprobacion: paquete.aprobacion?.fecha || "",
        evidencia_sha256: sha,
      },
      posiciones: [
        {
          numero: 10,
          descripcion: paquete.solicitud.descripcion.trim().slice(0, 40),
          cantidad: paquete.solicitud.cantidad,
          unidad: val.derivados.unidad_medida,
          precio_unitario: paquete.solicitud.valor_unitario,
          centro_costo: paquete.solicitud.centro_costo,
          subarea: paquete.solicitud.subarea,
          indicador_iva: val.derivados.indicador_iva,
        },
      ],
      excepciones: val.confirmaciones.map((c) => ({
        codigo: c.codigo,
        detalle: c.detalle,
        confirmado_por: `analista:${sessionId}`,
      })),
    };

    let existente = st.ordenes.find((o) => o.orden.referencia.solicitud_id === orden.referencia.solicitud_id);
    const idempotente = Boolean(existente);
    if (!existente) {
      const nextNum =
        st.ordenes.length === 0
          ? SAP_SEQ_START
          : Math.max(...st.ordenes.map((o) => Number(o.numero_oc))) + 1;
      existente = { numero_oc: String(nextNum), fecha: new Date().toISOString(), orden };
      st.ordenes.push(existente);
    }
    st.control.push({
      solicitud_id: paquete.solicitud.solicitud_id,
      resultado: idempotente ? "IDEMPOTENTE" : "CREADA",
      numero_oc: existente.numero_oc,
      retroactiva: String(val.retroactiva),
      bloqueos: "",
      confirmaciones: val.confirmaciones.map((c) => c.codigo).join(";"),
      ts: new Date().toISOString(),
    });

    const dataCrear = {
      numero_oc: existente.numero_oc,
      fecha: existente.fecha,
      idempotente,
      retroactiva: val.retroactiva,
      solicitud_id: paquete.solicitud.solicitud_id,
    };
    toolCalls.push({
      id: "call_crear",
      name: "oc_crear",
      args: { caso, confirmado: true },
      ok: true,
      resultSummary: `OC SAP #${existente.numero_oc} (${idempotente ? "idempotente" : "creada"}) · retroactiva=${val.retroactiva}`,
      rawResult: { ok: true, data: dataCrear },
      durationMs: 4,
    });
    ses.pendingConfirmation = null;
    reply = [
      `### Orden de Compra Creada en SAP`,
      `- **Caso:** \`${caso}\` (\`${paquete.solicitud.solicitud_id}\`)`,
      `- **Número de OC SAP:** **\`${existente.numero_oc}\`** ${idempotente ? "*(recuperada por idempotencia)*" : ""}`,
      `- **Fecha de registro:** \`${existente.fecha}\``,
      `- **Marca compra retroactiva:** \`${val.retroactiva}\``,
      `- **Evidencia SHA-256:** \`${sha.slice(0, 24)}...\``,
    ].join("\n");
  } else if (!caso) {
    const lista = await standaloneCases();
    toolCalls.push({
      id: "call_list",
      name: "oc_listar_casos",
      args: {},
      ok: true,
      resultSummary: `${lista.cases.length} solicitudes encontradas en fixtures`,
      rawResult: { ok: true, data: { casos: lista.cases } },
      durationMs: 2,
    });
    const filas = lista.cases
      .map(
        (c) =>
          `| \`${c.caso}\` | ${c.solicitud_id} | ${c.proveedor_nombre} | ${c.centro_costo} | ${c.moneda} ${c.valor_total.toLocaleString("es-CO")} | ${c.tiene_factura ? "Sí (Factura adjunta)" : "No"} |`
      )
      .join("\n");
    reply = [
      "Hola, soy el **Agente de Órdenes de Compra SAP** de Periferia IT Group.",
      "",
      "| Caso | Solicitud ID | Proveedor | Centro Costo | Valor Total | Factura |",
      "|---|---|---|---|---:|---|",
      filas,
      "",
      'Selecciona una tarjeta del panel izquierdo o escribe por ejemplo: *"Procesa la solicitud sol-004"*.',
    ].join("\n");
  } else {
    const paquete = leerPaquete(caso);
    toolCalls.push({
      id: "call_leer",
      name: "oc_leer_paquete",
      args: { caso },
      ok: true,
      resultSummary: `Paquete ${paquete.solicitud.solicitud_id} leído · Proveedor: ${paquete.solicitud.proveedor_nombre} · Total: ${paquete.solicitud.moneda} ${paquete.solicitud.valor_total.toLocaleString("es-CO")}`,
      rawResult: { ok: true, data: paquete },
      durationMs: 3,
    });

    const val = evaluarControles(paquete);
    toolCalls.push({
      id: "call_val",
      name: "oc_validar",
      args: { caso },
      ok: true,
      resultSummary: `apta=${val.apta} · bloqueos=[${val.bloqueos.map((b) => b.codigo).join(",")}] · confirmaciones=[${val.confirmaciones.map((c) => c.codigo).join(",")}] · retroactiva=${val.retroactiva}`,
      rawResult: { ok: true, data: val },
      durationMs: 4,
    });

    if (!val.apta) {
      st.control.push({
        solicitud_id: paquete.solicitud.solicitud_id,
        resultado: "BLOQUEADA",
        numero_oc: "",
        retroactiva: String(val.retroactiva),
        bloqueos: val.bloqueos.map((b) => b.codigo).join(";"),
        confirmaciones: "",
        ts: new Date().toISOString(),
      });
      ses.pendingConfirmation = null;
      reply = [
        `### Solicitud Rechazada por Control Interno (\`${caso}\` — \`${paquete.solicitud.solicitud_id}\`)`,
        "",
        "La Orden de Compra **no puede crearse en SAP** porque fallaron controles obligatorios de bloqueo:",
        "",
        val.bloqueos
          .map((b) => `- **${b.codigo} (${b.regla}):** ${b.detalle}\n  - *Acción recomendada:* ${b.accion_sugerida}`)
          .join("\n"),
      ].join("\n");
    } else {
      const sha = await sha256Hex(`${caso}:${paquete.aprobacion?.de}:${paquete.aprobacion?.fecha}:${paquete.aprobacion?.texto}`);
      toolCalls.push({
        id: "call_evid",
        name: "oc_generar_evidencia",
        args: { caso },
        ok: true,
        resultSummary: `Evidencia generada (out/${caso}/aprobacion.pdf) · SHA-256: ${sha.slice(0, 16)}...`,
        rawResult: { ok: true, data: { ruta: `out/${caso}/aprobacion.txt`, ruta_pdf: `out/${caso}/aprobacion.pdf`, sha256: sha } },
        durationMs: 5,
      });

      const oc = {
        referencia: {
          solicitud_id: paquete.solicitud.solicitud_id,
          correo_id: paquete.correo.id,
          cotizacion_ref: val.derivados.cotizacion_ref,
        },
        sociedad: "1000",
        organizacion_compras: "1000",
        proveedor: {
          codigo_sap: val.derivados.codigo_sap_proveedor,
          nit: val.derivados.proveedor_nit_resuelto,
          nombre: val.derivados.proveedor_nombre_maestro,
        },
        moneda: paquete.solicitud.moneda,
        condiciones_pago: val.derivados.condiciones_pago,
        aprobador: {
          email: paquete.aprobacion?.de || "",
          fecha_aprobacion: paquete.aprobacion?.fecha || "",
          evidencia_sha256: sha,
        },
        posiciones: [
          {
            numero: 10,
            descripcion: paquete.solicitud.descripcion.trim().slice(0, 40),
            cantidad: paquete.solicitud.cantidad,
            unidad: val.derivados.unidad_medida,
            precio_unitario: paquete.solicitud.valor_unitario,
            centro_costo: paquete.solicitud.centro_costo,
            subarea: paquete.solicitud.subarea,
            indicador_iva: val.derivados.indicador_iva,
          },
        ],
        excepciones: val.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null })),
      };

      toolCalls.push({
        id: "call_pay",
        name: "oc_construir_payload",
        args: { caso },
        ok: true,
        resultSummary: `Payload SAP preparado · Proveedor SAP ${oc.proveedor.codigo_sap} · Trazabilidad en out/${caso}/trazabilidad.json`,
        rawResult: { ok: true, data: { orden_compra: oc, ruta_trazabilidad: `out/${caso}/trazabilidad.json` } },
        durationMs: 3,
      });

      if (val.confirmaciones.length > 0 || pidePausa) {
        st.control.push({
          solicitud_id: paquete.solicitud.solicitud_id,
          resultado: "PENDIENTE_CONFIRMACION",
          numero_oc: "",
          retroactiva: String(val.retroactiva),
          bloqueos: "",
          confirmaciones: val.confirmaciones.map((c) => c.codigo).join(";"),
          ts: new Date().toISOString(),
        });
        needsConfirmation = true;
        ses.pendingConfirmation = {
          caso,
          retroactiva: val.retroactiva,
          confirmaciones: val.confirmaciones,
          motivoGeneral: "Confirmación humana requerida antes de registrar en SAP.",
        };
        const pos = oc.posiciones[0];
        const tablaControles = val.controles_evaluados
          .map((c) => `| \`${c.codigo}\` | ${c.nombre} | **${c.estado}** | ${c.detalle} |`)
          .join("\n");
        reply = [
          `### Vista Previa de Orden de Compra SAP (\`${caso}\` — \`${oc.referencia.solicitud_id}\`)`,
          "",
          "| Campo SAP | Valor Preparado |",
          "|---|---|",
          `| Sociedad / Org. Compras | \`${oc.sociedad}\` / \`${oc.organizacion_compras}\` |`,
          `| Proveedor | **${oc.proveedor.nombre}** (SAP \`${oc.proveedor.codigo_sap}\` · NIT \`${oc.proveedor.nit}\`) |`,
          `| Posición \`${pos.numero}\` | \`${pos.descripcion}\` |`,
          `| Cantidad / Unidad | \`${pos.cantidad} ${pos.unidad}\` × \`${oc.moneda} ${pos.precio_unitario.toLocaleString("es-CO")}\` |`,
          `| Valor Total Solicitud | **${oc.moneda} ${paquete.solicitud.valor_total.toLocaleString("es-CO")}** |`,
          `| Imputación | \`${pos.centro_costo}\` / \`${pos.subarea}\` |`,
          `| IVA / Condición de Pago | \`${pos.indicador_iva}\` / \`${oc.condiciones_pago}\` |`,
          `| Aprobador | \`${oc.aprobador.email}\` (\`${oc.aprobador.fecha_aprobacion}\`) |`,
          `| Evidencia SHA-256 | \`${sha.slice(0, 24)}...\` |`,
          `| Compra Retroactiva | **${val.retroactiva ? "SÍ (Desvío detectado)" : "No"}** |`,
          "",
          "#### Excepciones que requieren confirmación humana",
          val.confirmaciones.length > 0
            ? val.confirmaciones.map((c) => `- **${c.codigo} — ${c.regla}:** ${c.detalle}\n  - *Recomendación:* ${c.accion_sugerida}`).join("\n")
            : "- *Pausa preventiva solicitada explícitamente antes de crear en SAP.*",
          "",
          "<details><summary>Ver detalle completo de controles RC1–RC10</summary>\n\n| Regla | Control | Estado | Detalle |\n|---|---|---|---|\n" +
            tablaControles +
            "\n</details>",
          "",
          "**¿Confirmas la creación de esta Orden de Compra en SAP con las condiciones y excepciones indicadas?**",
        ].join("\n");
      } else {
        let existente = st.ordenes.find((o) => o.orden.referencia.solicitud_id === oc.referencia.solicitud_id);
        const idempotente = Boolean(existente);
        if (!existente) {
          const nextNum =
            st.ordenes.length === 0
              ? SAP_SEQ_START
              : Math.max(...st.ordenes.map((o) => Number(o.numero_oc))) + 1;
          existente = { numero_oc: String(nextNum), fecha: new Date().toISOString(), orden: oc };
          st.ordenes.push(existente);
        }
        st.control.push({
          solicitud_id: paquete.solicitud.solicitud_id,
          resultado: idempotente ? "IDEMPOTENTE" : "CREADA",
          numero_oc: existente.numero_oc,
          retroactiva: "false",
          bloqueos: "",
          confirmaciones: "",
          ts: new Date().toISOString(),
        });
        toolCalls.push({
          id: "call_crear",
          name: "oc_crear",
          args: { caso, confirmado: false },
          ok: true,
          resultSummary: `OC SAP #${existente.numero_oc} (${idempotente ? "idempotente" : "creada"}) · retroactiva=false`,
          rawResult: { ok: true, data: { numero_oc: existente.numero_oc, fecha: existente.fecha, idempotente, retroactiva: false } },
          durationMs: 4,
        });
        const pos = oc.posiciones[0];
        reply = [
          `### Orden de Compra Creada Automáticamente (\`${caso}\` — \`${oc.referencia.solicitud_id}\`)`,
          "",
          "Todos los controles internos (`RC1` a `RC10`) fueron superados sin bloqueos ni excepciones.",
          "",
          `- **Número de OC SAP:** **\`${existente.numero_oc}\`** ${idempotente ? "*(idempotente: ya existía para esta solicitud)*" : ""}`,
          `- **Proveedor:** ${oc.proveedor.nombre} (SAP \`${oc.proveedor.codigo_sap}\`)`,
          `- **Valor Total:** ${oc.moneda} ${paquete.solicitud.valor_total.toLocaleString("es-CO")}`,
          `- **Centro de Costo / Subárea:** \`${pos.centro_costo}\` / \`${pos.subarea}\``,
          `- **Evidencia SHA-256:** \`${sha.slice(0, 24)}...\``,
        ].join("\n");
      }
    }
  }

  ses.turns.push({
    id: `turn_${ses.turns.length + 1}`,
    ts: new Date().toISOString(),
    userMessage: msg,
    assistantReply: reply,
    toolCalls,
    needsConfirmation,
    pendingConfirmation: ses.pendingConfirmation,
  });
  st.sessions[sessionId] = ses;
  saveState(st);

  return {
    sessionId,
    reply,
    toolCalls,
    needsConfirmation,
    pendingConfirmation: ses.pendingConfirmation,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, sessionTotalTokens: 0 },
  };
}
