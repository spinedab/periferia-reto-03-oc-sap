import type { OrdenCompra } from "../types.js";

/**
 * Interfaz estándar de integración con SAP ERP / S/4HANA (Sección 7.4 del PRD).
 * Desacopla completamente al agente y las herramientas del transporte subyacente:
 * - Desarrollo / Pruebas: MockSapAdapter sobre archivos JSONL locales (`out/sap/ordenes.jsonl`).
 * - Producción: Adaptador real OData (`API_PURCHASEORDER_PROCESS_SRV`) o RFC (`BAPI_PO_CREATE1`).
 */
export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>;
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>;
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>;
}
