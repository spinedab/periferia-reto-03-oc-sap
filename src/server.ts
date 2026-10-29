import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { GestorCicloAgente } from "./agent-loop.js";
import { crearAdaptadorLlm } from "./llm/factory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolverRaizProyecto(): string {
  // Soporta ejecución directa con tsx (`src/server.ts`) y compilada (`dist/src/server.js`)
  const candidatoDirecto = path.resolve(__dirname, "..");
  if (fs.existsSync(path.join(candidatoDirecto, "agent", "prompt.md"))) {
    return candidatoDirecto;
  }
  const candidatoCompilado = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(candidatoCompilado, "agent", "prompt.md"))) {
    return candidatoCompilado;
  }
  return process.cwd();
}

const PROJECT_ROOT = resolverRaizProyecto();
const gestorAgente = new GestorCicloAgente(PROJECT_ROOT);

const ChatRequestSchema = z.object({
  sessionId: z.string().min(1).max(120),
  message: z.string().min(1).max(4000),
});

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
};

function enviarJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

async function leerCuerpoJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    totalBytes += buf.length;
    if (totalBytes > 256 * 1024) {
      throw new Error("El cuerpo de la petición excede el tamaño máximo permitido (256 KB).");
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? (JSON.parse(raw) as unknown) : {};
}

function obtenerResumenCasosYEstado(): unknown {
  const solicitudesDir = path.join(PROJECT_ROOT, "fixtures", "reto-03", "solicitudes");
  const ordenesPath = path.join(PROJECT_ROOT, "out", "sap", "ordenes.jsonl");

  const ordenesPorSolicitud = new Map<string, string>();
  if (fs.existsSync(ordenesPath)) {
    const lineas = fs
      .readFileSync(ordenesPath, "utf-8")
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    for (const l of lineas) {
      try {
        const reg = JSON.parse(l) as {
          numero_oc: string;
          orden?: { referencia?: { solicitud_id?: string } };
        };
        const solId = reg.orden?.referencia?.solicitud_id;
        if (solId) {
          ordenesPorSolicitud.set(solId, reg.numero_oc);
        }
      } catch {
        // Ignorar líneas malformadas
      }
    }
  }

  if (!fs.existsSync(solicitudesDir)) {
    return [];
  }

  return fs
    .readdirSync(solicitudesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((caso) => {
      const solFile = path.join(solicitudesDir, caso, "solicitud.json");
      const sol = JSON.parse(fs.readFileSync(solFile, "utf-8")) as Record<string, unknown>;
      const solicitudId = String(sol.solicitud_id ?? "");
      const tieneFactura = fs.existsSync(path.join(solicitudesDir, caso, "factura.txt"));
      const tieneEvidenciaPdf = fs.existsSync(
        path.join(PROJECT_ROOT, "out", caso, "aprobacion.pdf")
      );
      return {
        caso,
        solicitud_id: solicitudId,
        solicitante: sol.solicitante,
        proveedor_nombre: sol.proveedor_nombre,
        descripcion: sol.descripcion,
        centro_costo: sol.centro_costo,
        subarea: sol.subarea,
        valor_total: sol.valor_total,
        moneda: sol.moneda,
        tiene_factura: tieneFactura,
        numero_oc: ordenesPorSolicitud.get(solicitudId) ?? null,
        evidencia_pdf_url: tieneEvidenciaPdf ? `/out/${caso}/aprobacion.pdf` : null,
      };
    });
}

function obtenerResumenAuditoria(): unknown {
  const controlPath = path.join(PROJECT_ROOT, "out", "control.csv");
  const ordenesPath = path.join(PROJECT_ROOT, "out", "sap", "ordenes.jsonl");

  const controlRows: Array<Record<string, string>> = [];
  if (fs.existsSync(controlPath)) {
    const lines = fs
      .readFileSync(controlPath, "utf-8")
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    const headers = (lines[0] ?? "").split(",");
    for (const line of lines.slice(1)) {
      const cols = line.split(",");
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = cols[idx] ?? "";
      });
      controlRows.push(row);
    }
  }

  const ordenes: unknown[] = [];
  if (fs.existsSync(ordenesPath)) {
    const lines = fs
      .readFileSync(ordenesPath, "utf-8")
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    for (const l of lines) {
      try {
        ordenes.push(JSON.parse(l));
      } catch {
        // Ignorar
      }
    }
  }

  return { control: controlRows, ordenes };
}

function servirArchivoSeguro(
  res: http.ServerResponse,
  baseDir: string,
  subRuta: string
): boolean {
  const baseAbs = path.resolve(baseDir);
  const destinoAbs = path.resolve(baseAbs, subRuta);
  if (destinoAbs !== baseAbs && !destinoAbs.startsWith(baseAbs + path.sep)) {
    return false;
  }
  if (!fs.existsSync(destinoAbs) || !fs.statSync(destinoAbs).isFile()) {
    return false;
  }
  const ext = path.extname(destinoAbs).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  fs.createReadStream(destinoAbs).pipe(res);
  return true;
}

export function crearServidorHttp(): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "localhost";
      const url = new URL(req.url ?? "/", `http://${host}`);
      const pathname = decodeURIComponent(url.pathname);
      const method = req.method ?? "GET";

      if (method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
      }

      // 1. Endpoint obligatorio GET /api/health (sin exponer claves)
      if (method === "GET" && pathname === "/api/health") {
        const llm = crearAdaptadorLlm();
        enviarJson(res, 200, {
          ok: true,
          provider: llm.providerName,
          model: llm.modelName,
          configured: llm.isConfigured,
          confirmPolicy: process.env.CONFIRM_POLICY ?? "prd",
          maxIterations: Number(process.env.AGENT_MAX_ITERATIONS ?? 25),
        });
        return;
      }

      // 2. Endpoint obligatorio POST /api/chat
      if (method === "POST" && pathname === "/api/chat") {
        const rawBody = await leerCuerpoJson(req);
        const parsed = ChatRequestSchema.safeParse(rawBody);
        if (!parsed.success) {
          enviarJson(res, 400, {
            ok: false,
            error: `Petición inválida: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
          });
          return;
        }

        const llm = crearAdaptadorLlm();
        const resultado = await gestorAgente.procesarTurno(
          parsed.data.sessionId,
          parsed.data.message,
          llm
        );
        enviarJson(res, 200, resultado);
        return;
      }

      // 3. Endpoint obligatorio GET /api/sessions/:id (+ DELETE para reiniciar)
      if (pathname.startsWith("/api/sessions/")) {
        const sessionId = pathname.slice("/api/sessions/".length).trim();
        if (!sessionId) {
          enviarJson(res, 400, { ok: false, error: "Falta sessionId" });
          return;
        }
        if (method === "DELETE") {
          gestorAgente.eliminarSesion(sessionId);
          enviarJson(res, 200, { ok: true, deleted: sessionId });
          return;
        }
        if (method === "GET") {
          const sesion = gestorAgente.obtenerSesion(sessionId);
          if (!sesion) {
            enviarJson(res, 200, {
              sessionId,
              turns: [],
              totalTokensUsed: 0,
              pendingConfirmation: null,
            });
            return;
          }
          enviarJson(res, 200, {
            sessionId: sesion.sessionId,
            createdAt: sesion.createdAt,
            updatedAt: sesion.updatedAt,
            turns: sesion.turns,
            totalTokensUsed: sesion.totalTokensUsed,
            pendingConfirmation: sesion.pendingConfirmation,
          });
          return;
        }
      }

      // 4. Endpoints auxiliares de observabilidad para el panel de chat
      if (method === "GET" && pathname === "/api/cases") {
        enviarJson(res, 200, { ok: true, cases: obtenerResumenCasosYEstado() });
        return;
      }

      if (method === "GET" && pathname === "/api/audit") {
        enviarJson(res, 200, { ok: true, ...(obtenerResumenAuditoria() as object) });
        return;
      }

      // 5. Descarga segura de solo lectura de evidencias generadas en out/<caso>/
      if (method === "GET" && pathname.startsWith("/out/")) {
        const sub = pathname.slice("/out/".length);
        // Bloquear lectura de sesiones internas desde ruta estática
        if (sub.startsWith("sessions")) {
          enviarJson(res, 403, { ok: false, error: "Acceso restringido" });
          return;
        }
        const ok = servirArchivoSeguro(res, path.join(PROJECT_ROOT, "out"), sub);
        if (!ok) {
          enviarJson(res, 404, { ok: false, error: "Artefacto aún no generado" });
        }
        return;
      }

      // 6. Frontend estático en web/
      if (method === "GET") {
        const webDir = path.join(PROJECT_ROOT, "web");
        const archivoSolicitado = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
        if (servirArchivoSeguro(res, webDir, archivoSolicitado)) {
          return;
        }
      }

      enviarJson(res, 404, { ok: false, error: `Ruta no encontrada: ${method} ${pathname}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error interno del servidor";
      enviarJson(res, 500, { ok: false, error: msg });
    }
  });
}

// Arranque directo si es el entrypoint principal
const esEntrypointDirecto =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === path.resolve(__filename).toLowerCase();

if (esEntrypointDirecto) {
  const port = Number(process.env.PORT ?? 3000);
  const server = crearServidorHttp();
  server.listen(port, "0.0.0.0", () => {
    const llm = crearAdaptadorLlm();
    console.log("========================================================================");
    console.log("  Periferia IT Group · Agente Órdenes de Compra SAP (Reto 03)");
    console.log(`  URL Local:      http://localhost:${port}`);
    console.log(`  Proveedor LLM:  ${llm.providerName} (${llm.modelName})`);
    console.log(`  API Key lista:  ${llm.isConfigured ? "SÍ" : "NO (configure .env o use LLM_PROVIDER=deterministic)"}`);
    console.log("========================================================================");
  });
}
