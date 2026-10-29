---
name: ordenes-compra
description: Reglas corporativas RC1-RC10, datos maestros SAP y controles de auditoría para Órdenes de Compra en Periferia IT Group.
---

# Conocimiento del Proceso: Órdenes de Compra en SAP (Periferia IT Group)

## 1. Propósito del Proceso Procure-to-Pay (P2P)

En Periferia IT Group, toda adquisición de bienes o servicios para la Sociedad `1000` y Organización de Compras `1000` requiere una Orden de Compra (OC) registrada en SAP antes de comprometer gasto o radicar facturación. El paquete documental de entrada consta de:

1. **Correo remisorio (`correo.json`)**: enviado por el solicitante a `compras@periferia-ficticia.com`.
2. **Solicitud de compra (`solicitud.json` / `.xlsx`)**: contiene imputación presupuestal (`centro_costo`, `subarea`), proveedor, descripción, cantidades, valores, moneda e impuestos.
3. **Cotización del proveedor (`cotizacion.txt` / `.pdf`)**: oferta comercial vigente emitida por el proveedor.
4. **Evidencia de aprobación (`aprobacion.json` / `.eml`)**: correo del líder autorizando el gasto con la palabra explícita `"Aprobado"`.
5. **Factura (`factura.txt` / `.pdf`, anómalo)**: solo aparece cuando el área ejecutó una **compra retroactiva** (hecho cumplido antes de emitir la OC).

---

## 2. Catálogo de Reglas de Control Interno (`RC1` – `RC10`)

| Código | Regla de Negocio | Maestro / Fuente | Severidad | Acción del Agente |
|---|---|---|---|---|
| **RC1** | El proveedor debe existir en `proveedores.json` (búsqueda primaria por NIT sin dígito de verificación; si no viene NIT en solicitud, búsqueda por razón social normalizada) y tener `activo = true`. | `proveedores.json` | **Bloqueo** | Rechazar creación; solicitar creación/reactivación del proveedor en datos maestros SAP (`XK01`/`BP`). |
| **RC2** | Debe existir `aprobacion.json`, su cuerpo debe contener la palabra `"Aprobado"` (insensible a mayúsculas) y el remitente (`de`) debe figurar como aprobador autorizado del `centro_costo` imputado. | `centros-costo.json` | **Bloqueo** | Rechazar creación; escalar al aprobador dueño del centro de costos correspondiente. |
| **RC3** | `solicitud.valor_total` debe ser menor o igual al `tope` asignado al aprobador dentro de ese `centro_costo`. | `centros-costo.json` | **Bloqueo** | Rechazar creación; solicitar visto bueno de un aprobador de nivel superior con cupo suficiente. |
| **RC4** | La `subarea` indicada en la solicitud debe pertenecer al catálogo de `subareas` válidas del `centro_costo`. | `centros-costo.json` | **Bloqueo** | Rechazar creación; pedir corrección de imputación analítica al solicitante. |
| **RC5** | Si existe cotización, `abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total <= 0.02` (tolerancia máxima del 2 %). Si supera el 2 % o no existe cotización adjunta, exige confirmación humana mostrando ambos valores. | `cotizacion.txt` vs `solicitud.json` | **Confirmación** | Detener y solicitar confirmación explícita a la analista antes de crear la OC. |
| **RC6** | Si `indicador_iva` está ausente en la solicitud, se deriva `indicador_iva_default` del maestro del proveedor y se exige confirmación humana. Si viene informado pero no existe en `indicadores-iva.json`, se bloquea. | `proveedores.json` + `indicadores-iva.json` | **Confirmación + Derivado** | Informar código e impuesto derivado y solicitar confirmación antes de crear la OC. |
| **RC7** | Si `condiciones_pago` está ausente en la solicitud, se deriva `condiciones_pago_default` del proveedor. Solo se informa (no bloquea ni exige confirmación). Si viene un código inexistente en `condiciones-pago.json`, se bloquea. | `proveedores.json` + `condiciones-pago.json` | **Derivado informativo** | Completar en el payload SAP, dejar trazabilidad y notificar en el resumen. |
| **RC8** | Si existe `factura` adjunta cuya `fecha` de emisión es estrictamente anterior (`<`) a `solicitud.fecha_solicitud`, el caso se marca `retroactiva = true`, exige confirmación humana y queda auditado en `out/control.csv`. | `factura.txt` vs `solicitud.json` | **Confirmación + Marca Auditoría** | Alertar desvío de proceso (compra posfacturada), pedir confirmación y registrar `retroactiva=true`. |
| **RC9** | La fecha del correo de aprobación debe ser mayor o igual (`>=`) a `solicitud.fecha_solicitud` (comparación por fecha calendario `YYYY-MM-DD`). Si es anterior, exige confirmación humana. | `aprobacion.json` vs `solicitud.json` | **Confirmación** | Advertir inconsistencia cronológica entre solicitud y aprobación; pedir confirmación. |
| **RC10** | Consistencia aritmética: `abs((cantidad * valor_unitario) - valor_total) <= 1` unidad monetaria. Si excede ±1, se bloquea por error aritmético. | `solicitud.json` | **Bloqueo** | Rechazar creación; devolver solicitud para corrección de cantidades o precios unitarios. |

---

## 3. Reglas Técnicas del Payload SAP y Evidencia

- **Texto breve de posición (`EKPO-TXZ01`)**: SAP restringe `posiciones[].descripcion` a un máximo de **40 caracteres**. El texto completo se conserva en `out/<caso>/trazabilidad.json`.
- **Numeración de posiciones**: Secuencia estándar SAP de 10 en 10 (`10`, `20`, `30`...).
- **Evidencia de aprobación**: Se archiva en `out/<caso>/aprobacion.txt` (P0) y `out/<caso>/aprobacion.pdf` (P1) incluyendo hash `SHA-256` verificable en `aprobador.evidencia_sha256`.
- **Idempotencia**: SAP simulado asigna consecutivos desde `4500000001` en `out/sap/ordenes.jsonl`. Reintentar un `solicitud_id` ya creado retorna la misma OC sin duplicar compromisos presupuestales.
