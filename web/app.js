const STORAGE_KEY = "periferia_reto03_session_id";

function generarSessionId() {
  const rand = Math.random().toString(36).slice(2, 9);
  return `ses-${Date.now().toString(36)}-${rand}`;
}

let currentSessionId = localStorage.getItem(STORAGE_KEY) || generarSessionId();
localStorage.setItem(STORAGE_KEY, currentSessionId);

const els = {
  sessionLabel: document.getElementById("sessionLabel"),
  policyLabel: document.getElementById("policyLabel"),
  healthDot: document.getElementById("healthDot"),
  providerLabel: document.getElementById("providerLabel"),
  modelLabel: document.getElementById("modelLabel"),
  tokenCounter: document.getElementById("tokenCounter"),
  casesList: document.getElementById("casesList"),
  messagesContainer: document.getElementById("messagesContainer"),
  thinkingBar: document.getElementById("thinkingBar"),
  chatForm: document.getElementById("chatForm"),
  messageInput: document.getElementById("messageInput"),
  sendBtn: document.getElementById("sendBtn"),
  btnRefreshCases: document.getElementById("btnRefreshCases"),
  btnPromptPrd11: document.getElementById("btnPromptPrd11"),
  btnNewSession: document.getElementById("btnNewSession"),
  btnAuditModal: document.getElementById("btnAuditModal"),
  auditModal: document.getElementById("auditModal"),
  btnCloseModal: document.getElementById("btnCloseModal"),
  auditContent: document.getElementById("auditContent"),
};

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renderizador ligero y seguro de Markdown (tablas, encabezados, listas, código y bloques <details>).
 */
function renderMarkdown(md) {
  if (!md) return "";

  // Extraer bloques <details> permitidos de forma controlada
  const detailsBlocks = [];
  let text = String(md).replace(
    /<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi,
    (_m, sum, inner) => {
      const idx = detailsBlocks.length;
      detailsBlocks.push({ sum: escapeHtml(sum), inner });
      return `@@DETAILS_${idx}@@`;
    }
  );

  text = escapeHtml(text);

  // Tablas Markdown
  text = text.replace(
    /((?:^\|.+\|\r?\n)+)/gm,
    (tableBlock) => {
      const rows = tableBlock.trim().split(/\r?\n/);
      if (rows.length < 2) return tableBlock;
      const headerCells = rows[0]
        .split("|")
        .slice(1, -1)
        .map((c) => `<th>${formatInline(c.trim())}</th>`)
        .join("");
      const bodyRows = rows
        .slice(2)
        .map((r) => {
          const cells = r
            .split("|")
            .slice(1, -1)
            .map((c) => `<td>${formatInline(c.trim())}</td>`)
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    }
  );

  // Encabezados
  text = text.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  text = text.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");

  // Listas con viñeta
  text = text.replace(/^(?:-\s+.+(?:\r?\n|$))+/gm, (listBlock) => {
    const items = listBlock
      .trim()
      .split(/\r?\n/)
      .map((line) => `<li>${formatInline(line.replace(/^\s*-\s+/, ""))}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  });

  // Párrafos
  const lines = text.split(/\r?\n\r?\n/);
  const html = lines
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (
        trimmed.startsWith("<h") ||
        trimmed.startsWith("<table") ||
        trimmed.startsWith("<ul") ||
        trimmed.startsWith("@@DETAILS_")
      ) {
        return formatInline(trimmed);
      }
      return `<p>${formatInline(trimmed).replace(/\r?\n/g, "<br/>")}</p>`;
    })
    .join("");

  return html.replace(/@@DETAILS_(\d+)@@/g, (_m, idx) => {
    const b = detailsBlocks[Number(idx)];
    if (!b) return "";
    return `<details><summary>${b.sum}</summary>${renderMarkdown(b.inner)}</details>`;
  });
}

function formatInline(str) {
  return str
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

async function cargarHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    els.healthDot.className = `status-dot ${data.configured ? "online" : "offline"}`;
    els.providerLabel.textContent = `LLM: ${String(data.provider).toUpperCase()}`;
    els.modelLabel.textContent = `Modelo: ${data.model}${data.configured ? "" : " (sin API key)"}`;
    els.policyLabel.textContent = `Política HITL: ${String(data.confirmPolicy || "prd").toUpperCase()}`;
  } catch {
    els.healthDot.className = "status-dot offline";
    els.providerLabel.textContent = "Backend desconectado";
  }
}

async function cargarCasos() {
  try {
    const res = await fetch("/api/cases");
    const data = await res.json();
    els.casesList.innerHTML = "";
    for (const c of data.cases || []) {
      const card = document.createElement("div");
      card.className = "case-item";

      let badgeHtml = `<span class="case-badge">${escapeHtml(c.centro_costo)}</span>`;
      if (c.numero_oc) {
        badgeHtml = `<span class="case-badge created">OC ${escapeHtml(c.numero_oc)}</span>`;
      } else if (c.tiene_factura) {
        badgeHtml = `<span class="case-badge retro">Factura previa</span>`;
      }

      const linksHtml = c.evidencia_pdf_url
        ? `<div class="case-links" onclick="event.stopPropagation()">
             <a href="${escapeHtml(c.evidencia_pdf_url)}" target="_blank">📄 Evidencia PDF</a>
             <a href="/out/${escapeHtml(c.caso)}/trazabilidad.json" target="_blank">🔍 Trazabilidad</a>
           </div>`
        : "";

      card.innerHTML = `
        <div class="case-top">
          <span>${escapeHtml(c.caso)} · ${escapeHtml(c.solicitud_id)}</span>
          ${badgeHtml}
        </div>
        <div class="case-sub">${escapeHtml(c.proveedor_nombre)}</div>
        <div class="case-sub">${escapeHtml(c.moneda)} ${Number(c.valor_total).toLocaleString("es-CO")} · ${escapeHtml(c.subarea)}</div>
        ${linksHtml}
      `;
      card.addEventListener("click", () => {
        enviarMensaje(`Procesa la solicitud "${c.caso}".`);
      });
      els.casesList.appendChild(card);
    }
  } catch {
    els.casesList.innerHTML = `<div class="section-hint">Error cargando casos</div>`;
  }
}

function crearElementoToolCall(tc) {
  const card = document.createElement("div");
  card.className = `tool-card ${tc.ok ? "" : "error"}`;

  const argsPretty = JSON.stringify(tc.args ?? {}, null, 2);
  const resPretty = JSON.stringify(tc.rawResult ?? {}, null, 2);

  card.innerHTML = `
    <div class="tool-header">
      <div class="tool-title">
        <span>🔧 ${escapeHtml(tc.name)}</span>
        <span class="tool-pill">${tc.ok ? "OK" : "DETENIDO / ERROR"} · ${Number(tc.durationMs ?? 0)}ms</span>
      </div>
      <span style="font-size:11px;color:#64748b;">Ver JSON ▾</span>
    </div>
    <div class="tool-summary">${escapeHtml(tc.resultSummary)}</div>
    <div class="tool-details">
      <div><strong>Argumentos enviados:</strong></div>
      <pre class="tool-pre">${escapeHtml(argsPretty)}</pre>
      <div style="margin-top:6px;"><strong>Resultado devuelto:</strong></div>
      <pre class="tool-pre">${escapeHtml(resPretty)}</pre>
    </div>
  `;

  card.querySelector(".tool-header").addEventListener("click", () => {
    card.classList.toggle("expanded");
  });

  return card;
}

function crearTarjetaConfirmacion(pendingConfirmation) {
  const card = document.createElement("div");
  const esRetro = Boolean(pendingConfirmation?.retroactiva);
  card.className = `confirmation-card ${esRetro ? "retroactive" : ""}`;

  const items = (pendingConfirmation?.confirmaciones || [])
    .map((c) => `<li><strong>${escapeHtml(c.codigo)}:</strong> ${escapeHtml(c.detalle)}</li>`)
    .join("");

  card.innerHTML = `
    <div class="conf-header">
      <div class="conf-title">
        ⚠️ Solicitud de Confirmación Humana — Caso <code>${escapeHtml(pendingConfirmation?.caso || "")}</code>
      </div>
      ${esRetro ? `<span class="retro-tag">COMPRA RETROACTIVA (RC8)</span>` : ""}
    </div>
    <p style="font-size:13px;color:#78350f;">
      La creación de la Orden de Compra en SAP es una operación irreversible con impacto presupuestal. Revisa las excepciones antes de autorizar:
    </p>
    ${items ? `<ul class="conf-list">${items}</ul>` : `<p style="margin:8px 0;font-size:13px;color:#78350f;">${escapeHtml(pendingConfirmation?.motivoGeneral || "")}</p>`}
    <div class="conf-actions">
      <button type="button" class="btn-approve">✓ Aprobar y Crear OC en SAP</button>
      <button type="button" class="btn-reject">✕ Rechazar Solicitud</button>
    </div>
  `;

  const btnApprove = card.querySelector(".btn-approve");
  const btnReject = card.querySelector(".btn-reject");

  const deshabilitar = () => {
    btnApprove.disabled = true;
    btnReject.disabled = true;
  };

  btnApprove.addEventListener("click", () => {
    deshabilitar();
    enviarMensaje(`Confirmo la creación de la orden de compra para ${pendingConfirmation.caso}.`);
  });

  btnReject.addEventListener("click", () => {
    deshabilitar();
    enviarMensaje(`Rechazo la creación de la orden de compra para ${pendingConfirmation.caso}.`);
  });

  return card;
}

function renderizarTurno(turn, esUltimoTurnoActivo) {
  // Mensaje Usuario
  const userRow = document.createElement("div");
  userRow.className = "msg-row user";
  userRow.innerHTML = `<div class="bubble">${escapeHtml(turn.userMessage)}</div>`;
  els.messagesContainer.appendChild(userRow);

  // Respuesta Asistente + Tool Calls + Confirmación
  const asstRow = document.createElement("div");
  asstRow.className = "msg-row assistant";

  if (Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0) {
    const stack = document.createElement("div");
    stack.className = "tools-stack";
    for (const tc of turn.toolCalls) {
      stack.appendChild(crearElementoToolCall(tc));
    }
    asstRow.appendChild(stack);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = renderMarkdown(turn.assistantReply);
  asstRow.appendChild(bubble);

  if (turn.needsConfirmation && turn.pendingConfirmation && esUltimoTurnoActivo) {
    asstRow.appendChild(crearTarjetaConfirmacion(turn.pendingConfirmation));
  }

  els.messagesContainer.appendChild(asstRow);
  els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
}

async function restaurarHistorialSesion() {
  els.sessionLabel.textContent = `Sesión: ${currentSessionId}`;
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(currentSessionId)}`);
    const data = await res.json();
    els.tokenCounter.textContent = `Tokens sesión: ${Number(data.totalTokensUsed || 0).toLocaleString("es-CO")}`;
    const turns = data.turns || [];
    turns.forEach((t, idx) => {
      renderizarTurno(t, idx === turns.length - 1);
    });
  } catch {
    // Sesión nueva
  }
}

async function enviarMensaje(texto) {
  const limpio = String(texto || "").trim();
  if (!limpio) return;

  els.messageInput.value = "";
  els.sendBtn.disabled = true;
  els.thinkingBar.classList.remove("hidden");

  // Desactivar tarjetas de confirmación anteriores
  document.querySelectorAll(".btn-approve, .btn-reject").forEach((b) => {
    b.disabled = true;
  });

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: currentSessionId,
        message: limpio,
      }),
    });
    const data = await res.json();
    if (!res.ok && data.error) {
      renderizarTurno(
        {
          userMessage: limpio,
          assistantReply: `⚠️ Error HTTP: ${data.error}`,
          toolCalls: [],
          needsConfirmation: false,
          pendingConfirmation: null,
        },
        false
      );
    } else {
      els.tokenCounter.textContent = `Tokens sesión: ${Number(
        data.usage?.sessionTotalTokens || 0
      ).toLocaleString("es-CO")}`;
      renderizarTurno(
        {
          userMessage: limpio,
          assistantReply: data.reply,
          toolCalls: data.toolCalls || [],
          needsConfirmation: Boolean(data.needsConfirmation),
          pendingConfirmation: data.pendingConfirmation || null,
        },
        true
      );
      await cargarCasos();
    }
  } catch (err) {
    renderizarTurno(
      {
        userMessage: limpio,
        assistantReply: `⚠️ Error de red comunicando con el backend: ${err.message}`,
        toolCalls: [],
        needsConfirmation: false,
        pendingConfirmation: null,
      },
      false
    );
  } finally {
    els.thinkingBar.classList.add("hidden");
    els.sendBtn.disabled = false;
    els.messageInput.focus();
  }
}

els.chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  enviarMensaje(els.messageInput.value);
});

els.messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    enviarMensaje(els.messageInput.value);
  }
});

els.btnRefreshCases.addEventListener("click", cargarCasos);

els.btnPromptPrd11.addEventListener("click", () => {
  enviarMensaje(
    'Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.'
  );
});

els.btnNewSession.addEventListener("click", async () => {
  currentSessionId = generarSessionId();
  localStorage.setItem(STORAGE_KEY, currentSessionId);
  els.sessionLabel.textContent = `Sesión: ${currentSessionId}`;
  els.tokenCounter.textContent = "Tokens sesión: 0";
  // Conservar únicamente el banner de bienvenida
  const banner = els.messagesContainer.querySelector(".welcome-banner");
  els.messagesContainer.innerHTML = "";
  if (banner) els.messagesContainer.appendChild(banner);
});

els.btnAuditModal.addEventListener("click", async () => {
  els.auditModal.classList.remove("hidden");
  els.auditContent.innerHTML = "Cargando registros de auditoría...";
  try {
    const res = await fetch("/api/audit");
    const data = await res.json();
    const rows = data.control || [];
    const ordenes = data.ordenes || [];

    const controlHtml =
      rows.length === 0
        ? "<p>Aún no hay filas en <code>out/control.csv</code>.</p>"
        : `<table class="audit-table">
            <thead>
              <tr>
                <th>Solicitud ID</th>
                <th>Resultado</th>
                <th>Número OC</th>
                <th>Retroactiva</th>
                <th>Bloqueos</th>
                <th>Confirmaciones</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) => `<tr>
                    <td><code>${escapeHtml(r.solicitud_id)}</code></td>
                    <td><strong>${escapeHtml(r.resultado)}</strong></td>
                    <td><code>${escapeHtml(r.numero_oc || "—")}</code></td>
                    <td>${r.retroactiva === "true" ? "🔴 SÍ" : "No"}</td>
                    <td>${escapeHtml(r.bloqueos || "—")}</td>
                    <td>${escapeHtml(r.confirmaciones || "—")}</td>
                    <td>${escapeHtml(r.ts)}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>`;

    const ordenesHtml =
      ordenes.length === 0
        ? "<p>Aún no hay órdenes creadas en <code>out/sap/ordenes.jsonl</code>.</p>"
        : `<pre class="tool-pre" style="max-height:280px;">${escapeHtml(
            JSON.stringify(ordenes, null, 2)
          )}</pre>`;

    els.auditContent.innerHTML = `
      <h4 style="margin-bottom:8px;">Bitácora de Control Interno (out/control.csv)</h4>
      ${controlHtml}
      <h4 style="margin:14px 0 8px;">Órdenes Registradas en SAP Simulado (out/sap/ordenes.jsonl)</h4>
      ${ordenesHtml}
    `;
  } catch (e) {
    els.auditContent.innerHTML = `<p>Error consultando auditoría: ${escapeHtml(e.message)}</p>`;
  }
});

els.btnCloseModal.addEventListener("click", () => {
  els.auditModal.classList.add("hidden");
});

els.auditModal.addEventListener("click", (e) => {
  if (e.target === els.auditModal) {
    els.auditModal.classList.add("hidden");
  }
});

// Inicialización
cargarHealth();
cargarCasos();
restaurarHistorialSesion();
