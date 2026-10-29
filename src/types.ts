import { z } from "zod";

// ============================================================================
// 1. Esquemas de Maestros Corporativos (fixtures/reto-03/maestros/)
// ============================================================================

export const ProveedorMaestroSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
});
export type ProveedorMaestro = z.infer<typeof ProveedorMaestroSchema>;

export const AprobadorCentroSchema = z.object({
  email: z.string().email(),
  nombre: z.string().optional(),
  tope: z.number().nonnegative(),
});
export type AprobadorCentro = z.infer<typeof AprobadorCentroSchema>;

export const CentroCostoMaestroSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string().optional(),
  subareas: z.array(z.string()),
  aprobadores: z.array(AprobadorCentroSchema),
});
export type CentroCostoMaestro = z.infer<typeof CentroCostoMaestroSchema>;

export const IndicadorIvaMaestroSchema = z.object({
  codigo: z.string(),
  descripcion: z.string(),
  tasa: z.number().min(0).max(1),
});
export type IndicadorIvaMaestro = z.infer<typeof IndicadorIvaMaestroSchema>;

export const CondicionPagoMaestroSchema = z.object({
  codigo: z.string(),
  descripcion: z.string(),
  dias: z.number().int().nonnegative(),
});
export type CondicionPagoMaestro = z.infer<typeof CondicionPagoMaestroSchema>;

export interface MaestrosCorporativos {
  proveedores: ProveedorMaestro[];
  centrosCosto: CentroCostoMaestro[];
  indicadoresIva: IndicadorIvaMaestro[];
  condicionesPago: CondicionPagoMaestro[];
}

// ============================================================================
// 2. Esquemas del Paquete de Entrada Normalizado (Sección 7.1 y 7.2 del PRD)
// ============================================================================

export const MonedaSchema = z.enum(["COP", "USD"]);
export type Moneda = z.infer<typeof MonedaSchema>;

export const SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: z.number().positive(),
  valor_unitario: z.number().nonnegative(),
  valor_total: z.number().positive(),
  moneda: MonedaSchema,
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado YYYY-MM-DD"),
});
export type Solicitud = z.infer<typeof SolicitudSchema>;

export const CorreoNormalizadoSchema = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string().optional(),
  asunto: z.string(),
  fecha: z.string(),
  cuerpo: z.string().optional(),
  adjuntos: z.array(z.string()).optional(),
});
export type CorreoNormalizado = z.infer<typeof CorreoNormalizadoSchema>;

export const CotizacionNormalizadaSchema = z.object({
  referencia: z.string().nullable().optional(),
  fecha: z.string().nullable().optional(),
  proveedor: z.string(),
  nit: z.string().nullable(),
  total: z.number(),
  moneda: z.string(),
  validez_hasta: z.string().nullable(),
  texto: z.string(),
});
export type CotizacionNormalizada = z.infer<typeof CotizacionNormalizadaSchema>;

export const AprobacionNormalizadaSchema = z.object({
  de: z.string(),
  para: z.string().optional(),
  cc: z.array(z.string()).optional(),
  asunto: z.string().optional(),
  fecha: z.string(),
  aprobado: z.boolean(),
  texto: z.string(),
});
export type AprobacionNormalizada = z.infer<typeof AprobacionNormalizadaSchema>;

export const FacturaNormalizadaSchema = z.object({
  numero: z.string(),
  fecha: z.string(),
  total: z.number(),
});
export type FacturaNormalizada = z.infer<typeof FacturaNormalizadaSchema>;

export const PaqueteSchema = z.object({
  correo: CorreoNormalizadoSchema,
  solicitud: SolicitudSchema,
  cotizacion: CotizacionNormalizadaSchema.nullable(),
  aprobacion: AprobacionNormalizadaSchema.nullable(),
  factura: FacturaNormalizadaSchema.nullable(),
  adjuntos_faltantes: z.array(z.string()).optional(),
});
export type Paquete = z.infer<typeof PaqueteSchema>;

// ============================================================================
// 3. Resultados de Validación y Controles (RC1 - RC10)
// ============================================================================

export const HallazgoControlSchema = z.object({
  codigo: z.string(),
  regla: z.string(),
  detalle: z.string(),
  fuente: z.string(),
  accion_sugerida: z.string(),
  valores: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});
export type HallazgoControl = z.infer<typeof HallazgoControlSchema>;

export const DerivadosSchema = z.object({
  codigo_sap_proveedor: z.string().optional(),
  proveedor_nit_resuelto: z.string().optional(),
  proveedor_nombre_maestro: z.string().optional(),
  metodo_resolucion_proveedor: z.enum(["nit", "nombre_normalizado"]).optional(),
  indicador_iva: z.string().optional(),
  indicador_iva_origen: z.enum(["solicitud", "maestro.proveedores"]).optional(),
  indicador_iva_descripcion: z.string().optional(),
  condiciones_pago: z.string().optional(),
  condiciones_pago_origen: z.enum(["solicitud", "maestro.proveedores"]).optional(),
  condiciones_pago_descripcion: z.string().optional(),
  unidad_medida: z.enum(["UN", "H", "MES"]).optional(),
  cotizacion_ref: z.string().nullable().optional(),
});
export type Derivados = z.infer<typeof DerivadosSchema>;

export const ResultadoValidacionSchema = z.object({
  apta: z.boolean(),
  bloqueos: z.array(HallazgoControlSchema),
  confirmaciones: z.array(HallazgoControlSchema),
  derivados: DerivadosSchema,
  retroactiva: z.boolean(),
  controles_evaluados: z.array(
    z.object({
      codigo: z.string(),
      nombre: z.string(),
      estado: z.enum(["APROBADO", "BLOQUEADO", "CONFIRMACION", "DERIVADO"]),
      detalle: z.string(),
    })
  ),
});
export type ResultadoValidacion = z.infer<typeof ResultadoValidacionSchema>;

// ============================================================================
// 4. Payload de Orden de Compra SAP (Sección 7.4 del PRD)
// ============================================================================

export const PosicionOrdenCompraSchema = z.object({
  numero: z.number().int().positive(),
  descripcion: z.string().min(1).max(40),
  cantidad: z.number().positive(),
  unidad: z.enum(["UN", "H", "MES"]),
  precio_unitario: z.number().nonnegative(),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  indicador_iva: z.string().min(1),
});
export type PosicionOrdenCompra = z.infer<typeof PosicionOrdenCompraSchema>;

export const ExcepcionOrdenCompraSchema = z.object({
  codigo: z.string(),
  detalle: z.string(),
  confirmado_por: z.string().nullable(),
});
export type ExcepcionOrdenCompra = z.infer<typeof ExcepcionOrdenCompraSchema>;

export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({
    codigo_sap: z.string(),
    nit: z.string(),
    nombre: z.string(),
  }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({
    email: z.string(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string(),
  }),
  posiciones: z.array(PosicionOrdenCompraSchema).min(1),
  excepciones: z.array(ExcepcionOrdenCompraSchema),
});
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>;

// ============================================================================
// 5. Contrato de Herramientas (Sección 6.2 del PRD)
// ============================================================================

export interface ToolContext {
  directory: string;
  sessionId: string;
}

export interface ToolDefinition<TArgs extends z.ZodRawShape = z.ZodRawShape> {
  description: string;
  args: TArgs;
  execute: (args: z.infer<z.ZodObject<TArgs>>, ctx: ToolContext) => Promise<string>;
}

export interface ToolSuccess<T> {
  ok: true;
  data: T;
}

export interface ToolFailure {
  ok: false;
  error: string;
  requiere_confirmacion?: boolean;
  confirmaciones?: HallazgoControl[];
  bloqueos?: HallazgoControl[];
}

export type ToolResult<T> = ToolSuccess<T> | ToolFailure;
