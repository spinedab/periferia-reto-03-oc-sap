# Reto Técnico 03 — Agente Conversacional de Órdenes de Compra SAP

> **Periferia IT Group · Equipo Perxia 2.0**  
> **Candidato:** Santiago Pineda Botero (Ingeniero de Redes y Ciberseguridad)  
> **Stack:** TypeScript estricto (Node 20+) · Herramientas tipadas con `zod` · `pdf-lib` · Gemini / OpenAI / Anthropic / Fallback Determinista

Agente conversacional de extremo a extremo para automatizar la lectura, validación de controles internos corporativos (`RC1`–`RC10`), generación de evidencia criptográfica (`TXT` + `PDF` + `SHA-256`), trazabilidad campo a campo y creación idempotente de Órdenes de Compra en SAP (Sociedad `1000`).

---

## 1. Requisitos e Instalación Rápida

Requiere **Node.js 20+** (probado en Node 22 y Node 24) o **Bun 1.1+**.

```bash
cd reto-03
npm install
cp .env.example .env
```

*(En Windows PowerShell: `Copy-Item .env.example .env`)*

---

## 2. Verificación Determinista sin Modelo (`demo.ts`)

Procesa los 6 paquetes oficiales (`sol-001` a `sol-006`) llamando directamente a las herramientas de `src/tools/oc.ts`, **sin consumir ningún LLM ni requerir API key**, verificando además la **idempotencia** sobre `sol-001` y la **confirmación explícita** sobre `sol-004` y `sol-005`:

```bash
npm run demo
```

Para ejecutar la suite de pruebas unitarias e integrales (`Vitest`):

```bash
npm test
```

---

## 3. Levantar Chat Local (Frontend + Backend en un solo comando)

1. Edita `.env` y agrega tu clave de Google Gemini (`GEMINI_API_KEY=...`).  
   *(Si deseas probar inmediatamente la interfaz y el flujo HITL sin clave externa, establece `LLM_PROVIDER=deterministic` en `.env`).*
2. Ejecuta:

```bash
npm run dev
```

3. Abre en el navegador: **http://localhost:3000**

---

## 4. Variables de Entorno (`.env.example`)

| Variable | Requerida | Default | Descripción |
|---|---|---|---|
| `PORT` | No | `3000` | Puerto HTTP único para API y Frontend. |
| `LLM_PROVIDER` | Sí | `gemini` | Proveedor activo: `gemini`, `openai`, `anthropic` o `deterministic`. |
| `LLM_MODEL` | No | `gemini-2.5-flash` | Modelo del proveedor seleccionado. |
| `GEMINI_API_KEY` | Si `gemini` | — | Clave de Google AI Studio (solo en backend; jamás se expone al front ni logs). |
| `OPENAI_API_KEY` | Si `openai` | — | Clave API compatible con OpenAI. |
| `OPENAI_BASE_URL` | No | `https://api.openai.com/v1` | Endpoint compatible (OpenAI, Groq, OpenRouter, Azure, Ollama). |
| `ANTHROPIC_API_KEY` | Si `anthropic` | — | Clave API de Anthropic Claude. |
| `AGENT_MAX_ITERATIONS` | No | `25` | Tope de iteraciones herramienta → modelo por turno (`CA1`). |
| `SESSION_MAX_TOKENS` | No | `120000` | Presupuesto máximo de tokens por sesión para protección de costos. |
| `LLM_TIMEOUT_MS` | No | `30000` | Timeout por llamada HTTP al proveedor LLM (`CA5`). |
| `LLM_FALLBACK_DETERMINISTIC` | No | `false` | Si `true`, conmuta automáticamente al motor determinista ante caída/cuota del LLM. |
| `CONFIRM_POLICY` | No | `prd` | `prd` (crea directo casos limpios como `sol-001` y exige confirmación en `RC5/RC6/RC8/RC9`) o `always` (exige confirmación humana antes de toda OC). |

---

## 5. Contrato de API HTTP

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/health` | Estado del servicio: `{ ok, provider, model, configured, confirmPolicy }` (sin exponer secretos). |
| `POST` | `/api/chat` | Ejecuta un turno del ciclo del agente: `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation, pendingConfirmation, usage }`. |
| `GET` | `/api/sessions/:id` | Historial completo de turnos, llamadas a herramientas y uso de tokens de la sesión. |
| `DELETE` | `/api/sessions/:id` | Reinicia la sesión indicada. |
| `GET` | `/api/cases` | Lista los 6 casos de `fixtures/reto-03/solicitudes/` y su estado actual en SAP simulado. |
| `GET` | `/api/audit` | Devuelve el contenido estructurado de `out/control.csv` y `out/sap/ordenes.jsonl`. |

---

## 6. Despliegue para Obtener Enlace Público Funcional

El proyecto incluye `Dockerfile` multi-etapa endurecido (usuario sin privilegios `node`, `HEALTHCHECK` integrado) y `render.yaml` listo para despliegue gratuito:

### Opción A — Render.com (Recomendada, gratuita con `render.yaml`)
1. El repositorio público ya está publicado en GitHub:  
   **https://github.com/spinedab/periferia-reto-03-oc-sap**
   ```bash
   git branch -M main
   git remote add origin https://github.com/spinedab/periferia-reto-03-oc-sap.git
   git push -u origin main
   ```
2. Haz clic directo en el Blueprint de despliegue (o entra a [https://dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint**):  
   **https://render.com/deploy?repo=https://github.com/spinedab/periferia-reto-03-oc-sap**
3. En **Environment Variables**, pega el valor de `GEMINI_API_KEY` (además `LLM_FALLBACK_DETERMINISTIC=true` ya queda activo como respaldo continuo).
4. Haz clic en **Apply / Deploy**. En ~2 minutos quedará activa la URL pública:
   `https://periferia-reto03-agente-oc-sap.onrender.com`

### Opción B — Railway.app (1 comando o GitHub)
1. En [https://railway.app](https://railway.app), selecciona **New Project → Deploy from GitHub repo**.
2. Agrega `GEMINI_API_KEY` y `LLM_PROVIDER=gemini` en la pestaña **Variables**.
3. En **Settings → Networking**, pulsa **Generate Domain** para obtener la URL pública HTTPS.

### Opción C — Túnel HTTPS instantáneo desde tu máquina durante la defensa (Cloudflare Tunnel)
Si necesitas exponer tu instancia local en segundos sin esperar build en la nube:
```bash
npm run dev
# En otra terminal:
npx cloudflared tunnel --url http://localhost:3000
```
Esto entrega de inmediato una URL pública `https://*.trycloudflare.com` conectada a tu servidor local.

---

## 7. Enlace Público de Demostración y Repositorio

- **URL en vivo 24/7 (GitHub Pages):** https://spinedab.github.io/periferia-reto-03-oc-sap/
- **Repositorio GitHub:** https://github.com/spinedab/periferia-reto-03-oc-sap
- **Descarga directa paquete `.zip` (GitHub Release):** https://github.com/spinedab/periferia-reto-03-oc-sap/releases/latest
- **Despliegue contenedor Docker en 1 clic (Render Blueprint):** https://render.com/deploy?repo=https://github.com/spinedab/periferia-reto-03-oc-sap
- **Evidencias de pruebas:** [`docs/EVIDENCIAS_PRUEBAS_RETO03.pdf`](docs/EVIDENCIAS_PRUEBAS_RETO03.pdf)
- **Autenticación:** Pública para evaluación técnica (sin credenciales requeridas).
