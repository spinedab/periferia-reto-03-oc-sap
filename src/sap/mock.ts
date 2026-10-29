import fs from "node:fs";
import path from "node:path";
import { ProveedorMaestroSchema, type OrdenCompra } from "../types.js";
import type { SapAdapter } from "./adapter.js";
import { z } from "zod";

export interface RegistroOrdenSap {
  numero_oc: string;
  fecha: string;
  orden: OrdenCompra;
}

const SECUENCIA_INICIAL_SAP = 4500000001;

export function normalizarNitBase(nit: string): string {
  const limpio = nit.trim().replace(/\./g, "").replace(/\s+/g, "");
  // Si incluye guion de dígito de verificación colombiano (ej. 900555111-2), conserva los 9 dígitos base
  const partes = limpio.split("-");
  return partes[0] ?? limpio;
}

/**
 * Implementación simulada determinista de SAP sobre archivos JSONL en `out/sap/ordenes.jsonl`.
 * Garantiza:
 * 1. Numeración secuencial estándar de documentos de compras SAP (`4500000001`...).
 * 2. Idempotencia estricta por `referencia.solicitud_id` (nunca duplica una OC ante reintentos).
 * 3. Consulta de proveedores contra `fixtures/reto-03/maestros/proveedores.json`.
 */
export class MockSapAdapter implements SapAdapter {
  private readonly projectRoot: string;
  private readonly ordenesFilePath: string;
  private readonly proveedoresFilePath: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.ordenesFilePath = path.join(this.projectRoot, "out", "sap", "ordenes.jsonl");
    this.proveedoresFilePath = path.join(
      this.projectRoot,
      "fixtures",
      "reto-03",
      "maestros",
      "proveedores.json"
    );
  }

  private leerRegistrosExistentes(): RegistroOrdenSap[] {
    if (!fs.existsSync(this.ordenesFilePath)) {
      return [];
    }
    const raw = fs.readFileSync(this.ordenesFilePath, "utf-8").trim();
    if (!raw) {
      return [];
    }
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as RegistroOrdenSap);
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    if (!fs.existsSync(this.proveedoresFilePath)) {
      return null;
    }
    const contenido = fs.readFileSync(this.proveedoresFilePath, "utf-8");
    const proveedores = z.array(ProveedorMaestroSchema).parse(JSON.parse(contenido));
    const nitBuscado = normalizarNitBase(nit);
    const encontrado = proveedores.find((p) => normalizarNitBase(p.nit) === nitBuscado);
    if (!encontrado) {
      return null;
    }
    return {
      codigo_sap: encontrado.codigo_sap,
      activo: encontrado.activo,
    };
  }

  async buscarOrdenPorReferencia(
    solicitud_id: string
  ): Promise<{ numero_oc: string; fecha: string } | null> {
    const registros = this.leerRegistrosExistentes();
    const existente = registros.find((r) => r.orden.referencia.solicitud_id === solicitud_id);
    if (!existente) {
      return null;
    }
    return {
      numero_oc: existente.numero_oc,
      fecha: existente.fecha,
    };
  }

  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const existente = await this.buscarOrdenPorReferencia(orden.referencia.solicitud_id);
    if (existente) {
      return existente;
    }

    const dir = path.dirname(this.ordenesFilePath);
    fs.mkdirSync(dir, { recursive: true });

    const registros = this.leerRegistrosExistentes();
    const siguienteNumero =
      registros.length === 0
        ? SECUENCIA_INICIAL_SAP
        : Math.max(...registros.map((r) => Number.parseInt(r.numero_oc, 10))) + 1;

    const numero_oc = String(siguienteNumero);
    const fecha = new Date().toISOString();

    const nuevoRegistro: RegistroOrdenSap = {
      numero_oc,
      fecha,
      orden,
    };

    fs.appendFileSync(this.ordenesFilePath, `${JSON.stringify(nuevoRegistro)}\n`, "utf-8");

    return { numero_oc, fecha };
  }
}
