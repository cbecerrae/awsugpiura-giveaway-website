const app = document.getElementById("app");
const toastContainer = document.getElementById("toastContainer");
const winnerModal = document.getElementById("winnerModal");
const winnerText = document.getElementById("winnerText");
const closeWinnerModal = document.getElementById("closeWinnerModal");
const confettiCanvas = document.getElementById("confettiCanvas");

let raffleState = {
  participants: [],
  byDni: new Set(),
  pollingTimer: null,
  spinning: false,
  angle: 0,
  velocity: 0,
};

let API_BASE_URL = "";
let qrEscHandler = null;
const BASE_PATH = window.location.pathname.startsWith("/sorteo") ? "/sorteo" : "";
const withBasePath = (path) => `${BASE_PATH}${path}`;

const ensureQrOverlay = () => {
  let overlay = document.getElementById("qrOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "qrOverlay";
    overlay.className = "qr-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="qr-overlay-content">
        <p class="qr-overlay-title">¡Regístrate en el sorteo!</p>
        <img
          src="${withBasePath("/assets/qr/sorteo.png")}"
          alt="QR ampliado para nuevos participantes"
          class="qr-overlay-image"
        />
        <p class="qr-overlay-url">awsugpiura.com/sorteo</p>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  return overlay;
};

const setupQrToggle = () => {
  const qrToggle = document.getElementById("qrToggle");
  if (!qrToggle) return;
  const qrOverlay = ensureQrOverlay();

  const setQrExpanded = (expanded) => {
    qrOverlay.classList.toggle("show", expanded);
    document.body.classList.toggle("qr-lock", expanded);
    qrToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    qrOverlay.setAttribute("aria-hidden", expanded ? "false" : "true");
  };

  qrToggle.addEventListener("click", () => {
    setQrExpanded(!qrOverlay.classList.contains("show"));
  });

  qrOverlay.addEventListener("click", () => setQrExpanded(false));

  if (qrEscHandler) document.removeEventListener("keydown", qrEscHandler);
  qrEscHandler = (e) => { if (e.key === "Escape") setQrExpanded(false); };
  document.addEventListener("keydown", qrEscHandler);
};

const showToast = (message, type = "success") => {
  const toast = document.createElement("div");
  toast.className = `toast ${type === "success" ? "toast-success" : "toast-error"}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.classList.add("opacity-0", "transition", "duration-300"), 2200);
  setTimeout(() => toast.remove(), 2600);
};

const api = async (path, options = {}) => {
  const resp = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  let body;
  try { body = await resp.json(); } catch (_e) { body = {}; }
  if (!resp.ok) throw new Error(body.message || "Error de red");
  return body;
};

const adminApi = async (path, options = {}) => {
  const key = sessionStorage.getItem("adminKey") || "";
  return api(path, {
    ...options,
    headers: { "X-Admin-Key": key, ...(options.headers || {}) },
  });
};

const loadConfig = async () => {
  try {
    const resp = await fetch(withBasePath("/config.json"), { cache: "no-store" });
    const data = await resp.json();
    API_BASE_URL = String(data.apiBaseUrl || "").replace(/\/$/, "");
  } catch (_e) { API_BASE_URL = ""; }
  if (!API_BASE_URL) showToast("No se pudo cargar config.json con el endpoint API.", "error");
};

const formatDate = (dateStr) => {
  if (!dateStr) return "—";
  const parts = dateStr.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
};

// ─── REGISTRAR VIEW ─────────────────────────────────────────────────────────────

const renderRegistrar = async () => {
  app.innerHTML = `
    <div class="mx-auto max-w-xl space-y-4">
      <div id="sorteosList" class="space-y-4">
        <p class="muted">Cargando sorteos...</p>
      </div>

      <div class="surface p-6 sm:p-8">
        <div class="qr-invite">
          <p class="qr-invite-title">¡Invita a nuevos participantes!</p>
          <button id="qrToggle" type="button" class="qr-button" aria-expanded="false" aria-label="Expandir o contraer QR">
            <img
              src="${withBasePath("/assets/qr/sorteo.png")}"
              alt="QR de registro para nuevos participantes"
              class="qr-image"
            />
          </button>
        </div>
      </div>

      <div id="closedSorteosList" class="space-y-4"></div>
    </div>
  `;

  setupQrToggle();

  try {
    const data = await api("/sorteos");
    const allSorteos = data.sorteos || [];
    const openSorteos = allSorteos.filter((s) => s.status === "open");
    const closedSorteos = allSorteos.filter((s) => s.status === "closed");
    const container = document.getElementById("sorteosList");
    const closedContainer = document.getElementById("closedSorteosList");

    if (openSorteos.length === 0) {
      container.innerHTML = `<div class="surface p-6 sm:p-8"><p class="muted">No hay sorteos disponibles en este momento.</p></div>`;
    } else {
      container.innerHTML = openSorteos.map((s) => `
        <div class="surface p-5 sm:p-6 sorteo-card" data-sorteo-id="${s.sorteoId}">
          <div class="sorteo-card-header">
            <h3 class="sorteo-card-name">${s.name}</h3>
            <span class="sorteo-badge badge-open">Abierto</span>
          </div>
          ${s.group ? `<p class="sorteo-card-group">${s.group}</p>` : ""}
          <div class="sorteo-card-meta">
            <span>Participantes: <strong>${s.participantCount || 0}</strong></span>
            <span>Fecha: <strong>${formatDate(s.raffleDate)}</strong></span>
          </div>
          <button class="btn btn-primary register-btn mt-3 w-full register-in-sorteo" data-id="${s.sorteoId}">Registrarse</button>
        </div>
      `).join("");

      container.querySelectorAll(".register-in-sorteo").forEach((btn) => {
        btn.addEventListener("click", () => renderRegistrarForm(btn.dataset.id));
      });
    }

    // Render closed sorteos section
    if (closedSorteos.length > 0) {
      closedContainer.innerHTML = `
        <div class="surface p-5 sm:p-6" style="background: rgba(22, 30, 45, 0.5); border-color: rgba(255,255,255,0.1);">
          <h2 class="text-base font-bold text-white mb-1" style="font-size: 1.05rem; opacity: 0.85;">Sorteos anteriores</h2>
          <p class="muted" style="font-size: 0.82rem; margin-bottom: 0.75rem;">Historial de sorteos realizados por la comunidad.</p>
          <div class="closed-sorteos-list">
            ${closedSorteos.map((s, i) => `
              ${i > 0 ? '<div class="closed-sorteo-divider"></div>' : ''}
              <div class="sorteo-card sorteo-closed" style="padding: 0.9rem 1.1rem;">
                <div class="sorteo-card-header">
                  <h3 class="sorteo-card-name" style="font-size: 1rem;">${s.name}</h3>
                  <span class="sorteo-badge badge-closed">Finalizado</span>
                </div>
                ${s.group ? `<p class="sorteo-card-group">${s.group}</p>` : ""}
                <div class="sorteo-card-meta">
                  <span>Participantes: <strong>${s.participantCount || 0}</strong></span>
                  <span>Fecha: <strong>${formatDate(s.raffleDate)}</strong></span>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }
  } catch (error) {
    document.getElementById("sorteosList").innerHTML =
      `<p class="muted">Error al cargar sorteos: ${error.message}</p>`;
  }
};

const renderRegistrarForm = (sorteoId) => {
  app.innerHTML = `
    <div class="mx-auto max-w-xl space-y-4">
      <div class="surface p-6 sm:p-8">
        <button id="backBtn" class="btn btn-secondary mb-4">← Volver</button>
        <h1 class="title">Registro de Participante</h1>
        <p class="mt-2 muted">Completa el formulario para ingresar al sorteo.</p>
        <form id="registerForm" class="mt-6 space-y-4">
          <div>
            <label class="mb-1 block label">Nombres</label>
            <input name="firstName" class="input-field" required pattern="[A-Za-zÀ-ÿ\\u0300-\\u036f\\s]+" title="Solo letras" />
          </div>
          <div>
            <label class="mb-1 block label">Apellidos</label>
            <input name="lastName" class="input-field" required pattern="[A-Za-zÀ-ÿ\\u0300-\\u036f\\s]+" title="Solo letras" />
          </div>
          <div>
            <label class="mb-1 block label">DNI</label>
            <input name="dni" class="input-field" required inputmode="numeric" pattern="\\d{8}" minlength="8" maxlength="8" title="DNI de 8 dígitos" />
          </div>
          <button class="btn btn-primary register-btn w-full">Registrarse</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById("backBtn").addEventListener("click", () => renderRegistrar());

  const form = document.getElementById("registerForm");
  const sanitizeLetters = (v) => String(v || "").normalize("NFC").replace(/[^\p{L}\p{M}\s]/gu, "").replace(/\s{2,}/g, " ").trimStart();

  const firstNameInput = form.elements.firstName;
  const lastNameInput = form.elements.lastName;
  const dniInput = form.elements.dni;

  [firstNameInput, lastNameInput].forEach((input) => {
    input.addEventListener("input", () => { input.value = sanitizeLetters(input.value); });
  });
  dniInput.addEventListener("input", () => { dniInput.value = String(dniInput.value || "").replace(/\D/g, "").slice(0, 8); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      firstName: sanitizeLetters(new FormData(form).get("firstName")).trim(),
      lastName: sanitizeLetters(new FormData(form).get("lastName")).trim(),
      dni: String(new FormData(form).get("dni") || "").replace(/\D/g, "").slice(0, 8),
    };
    if (!payload.firstName || !payload.lastName || !payload.dni) {
      showToast("Todos los campos son obligatorios.", "error"); return;
    }
    if (!/^\d{8}$/.test(payload.dni)) {
      showToast("El DNI debe tener exactamente 8 digitos.", "error"); return;
    }
    try {
      await api(`/sorteos/${sorteoId}/participantes`, { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      showToast("Participante registrado correctamente.", "success");
    } catch (err) {
      showToast(err.message || "No se pudo registrar.", "error");
    }
  });
};

// ─── WHEEL DRAWING ──────────────────────────────────────────────────────────────

const drawWheel = (ctx, canvas, participants, angle) => {
  const size = Math.min(canvas.clientWidth, 520);
  canvas.width = size;
  canvas.height = size;
  const wheelFontFamily = '"Amazon Ember Display", "Segoe UI", sans-serif';
  ctx.clearRect(0, 0, size, size);

  if (!participants.length) {
    ctx.fillStyle = "#2a344d";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 22px ${wheelFontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Sin participantes", size / 2, size / 2);
    return;
  }

  const radius = size / 2 - 8;
  const center = size / 2;
  const arc = (Math.PI * 2) / participants.length;

  const fitSingleLine = (text, maxWidth) => {
    const raw = String(text || "").trim() || "Sin nombre";
    let fontSize = Math.max(9, Math.min(16, 430 / participants.length));
    while (fontSize > 8) {
      ctx.font = `bold ${fontSize}px ${wheelFontFamily}`;
      if (ctx.measureText(raw).width <= maxWidth) return { label: raw, fontSize };
      fontSize -= 1;
    }
    ctx.font = `bold 8px ${wheelFontFamily}`;
    let clipped = raw;
    while (clipped.length > 0 && ctx.measureText(`${clipped}...`).width > maxWidth) clipped = clipped.slice(0, -1);
    return { label: `${clipped}...`, fontSize: 8 };
  };

  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(angle);

  participants.forEach((p, i) => {
    const start = i * arc;
    const end = start + arc;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? "#8b5cf6" : "#a166ff";
    ctx.fill();

    ctx.save();
    ctx.rotate(start + arc / 2);
    ctx.fillStyle = "white";
    const labelRadius = radius * 0.56;
    const maxWidth = Math.max(56, Math.min(radius * 0.85, arc * labelRadius * 0.9));
    const label = `${p.firstName} ${p.lastName}`.trim();
    const fitted = fitSingleLine(label, maxWidth);
    ctx.font = `bold ${fitted.fontSize}px ${wheelFontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fitted.label, labelRadius, 0);
    ctx.restore();
  });

  ctx.restore();
  ctx.beginPath();
  ctx.arc(center, center, 24, 0, Math.PI * 2);
  ctx.fillStyle = "#0f172a";
  ctx.fill();
};

const startConfetti = () => {
  const ctx = confettiCanvas.getContext("2d");
  confettiCanvas.classList.remove("hidden");
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
  const particles = Array.from({ length: 130 }).map(() => ({
    x: Math.random() * confettiCanvas.width,
    y: Math.random() * -confettiCanvas.height,
    r: Math.random() * 6 + 3,
    c: ["#a166ff", "#8b5cf6", "#22c55e", "#eab308"][Math.floor(Math.random() * 4)],
    vy: Math.random() * 4 + 2,
    vx: Math.random() * 2 - 1,
  }));
  let frame = 0;
  const maxFrames = 170;
  const animate = () => {
    frame += 1;
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    particles.forEach((p) => { p.x += p.vx; p.y += p.vy; ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.r, p.r * 1.7); });
    if (frame < maxFrames) requestAnimationFrame(animate);
    else confettiCanvas.classList.add("hidden");
  };
  animate();
};

const winnerFromAngle = (participants, angle) => {
  const count = participants.length;
  if (!count) return null;
  const twoPi = Math.PI * 2;
  const normalized = ((0 - (angle % twoPi)) + twoPi) % twoPi;
  const segment = twoPi / count;
  const index = Math.floor(normalized / segment) % count;
  return participants[index];
};

const stopPolling = () => {
  if (raffleState.pollingTimer) { clearInterval(raffleState.pollingTimer); raffleState.pollingTimer = null; }
};

const startPollingParticipants = (sorteoId, refreshFn) => {
  stopPolling();
  const poll = async () => {
    try {
      const data = await api(`/sorteos/${sorteoId}/participantes`);
      const list = Array.isArray(data.participants) ? data.participants : [];
      let changed = false;
      list.forEach((item) => {
        if (!item || !item.dni || raffleState.byDni.has(item.dni)) return;
        raffleState.byDni.add(item.dni);
        raffleState.participants.push(item);
        changed = true;
      });
      if (changed) refreshFn();
    } catch (_e) {}
  };
  poll();
  raffleState.pollingTimer = setInterval(poll, 2500);
};

const openWinnerModal = (winner) => {
  winnerText.textContent = `${winner.firstName} ${winner.lastName} - DNI: ${winner.dni}`;
  winnerModal.classList.add("show");
};

closeWinnerModal.addEventListener("click", () => { winnerModal.classList.remove("show"); });

// ─── SORTEAR VIEW ───────────────────────────────────────────────────────────────

const renderSortear = async () => {
  app.innerHTML = `
    <div class="surface p-4 sm:p-6">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 class="title">Sorteo</h1>
        <select id="sorteoSelect" class="input-field" style="max-width:280px;"></select>
      </div>
      <p class="text-sm muted mb-3">Participantes: <span id="participantCount" class="font-bold text-white">0</span></p>
      <div class="relative mx-auto mt-3 w-full max-w-[520px]">
        <canvas id="wheelCanvas" class="w-full"></canvas>
        <div class="wheel-pointer z-20" aria-hidden="true"></div>
      </div>
      <div class="mt-6 flex flex-wrap gap-3">
        <button id="spinBtn" class="btn btn-primary register-btn">Sortear</button>
      </div>
    </div>
  `;

  const select = document.getElementById("sorteoSelect");
  const canvas = document.getElementById("wheelCanvas");
  const ctx = canvas.getContext("2d");
  const countEl = document.getElementById("participantCount");
  const spinBtn = document.getElementById("spinBtn");

  let currentSorteoId = null;

  const refreshView = () => {
    countEl.textContent = String(raffleState.participants.length);
    drawWheel(ctx, canvas, raffleState.participants, raffleState.angle);
  };

  const loadSorteo = (sorteoId) => {
    stopPolling();
    currentSorteoId = sorteoId;
    raffleState = { participants: [], byDni: new Set(), pollingTimer: null, spinning: false, angle: 0, velocity: 0 };
    refreshView();
    if (sorteoId) startPollingParticipants(sorteoId, refreshView);
  };

  // Load open sorteos
  try {
    const data = await api("/sorteos");
    const openSorteos = (data.sorteos || []).filter((s) => s.status === "open");
    if (openSorteos.length === 0) {
      select.innerHTML = `<option value="">Sin sorteos abiertos</option>`;
    } else {
      select.innerHTML = openSorteos.map((s) => `<option value="${s.sorteoId}">${s.name}</option>`).join("");
      loadSorteo(openSorteos[0].sorteoId);
    }
  } catch (err) {
    select.innerHTML = `<option value="">Error cargando sorteos</option>`;
  }

  select.addEventListener("change", () => loadSorteo(select.value));

  const runSpin = () => {
    if (raffleState.spinning) return;
    if (raffleState.participants.length < 2) {
      showToast("Se requieren al menos 2 participantes para sortear.", "error");
      return;
    }
    stopPolling();
    raffleState.spinning = true;

    const SPIN_DURATION_MS = 5000;
    const initialVelocity = (Math.random() * 0.22) + 0.33;
    const threshold = 0.0001;
    const frictionPerMs = Math.pow(threshold / initialVelocity, 1 / SPIN_DURATION_MS);
    const startTime = performance.now();
    let lastTime = startTime;

    const frame = (now) => {
      const elapsed = now - startTime;
      const dt = now - lastTime;
      lastTime = now;
      const currentVelocity = initialVelocity * Math.pow(frictionPerMs, elapsed);
      raffleState.angle += currentVelocity * dt;

      if (elapsed >= SPIN_DURATION_MS || currentVelocity < 0.0001) {
        raffleState.spinning = false;
        raffleState.velocity = 0;
        const winner = winnerFromAngle(raffleState.participants, raffleState.angle);
        refreshView();
        if (winner) {
          startConfetti();
          openWinnerModal(winner);
          showToast(`Ganador: ${winner.firstName} ${winner.lastName}`, "success");
        }
        if (currentSorteoId) startPollingParticipants(currentSorteoId, refreshView);
        return;
      }

      raffleState.velocity = currentVelocity;
      refreshView();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  spinBtn.addEventListener("click", runSpin);
  window.addEventListener("resize", refreshView);
  refreshView();
};

// ─── ADMIN VIEW ─────────────────────────────────────────────────────────────────

const renderAdmin = () => {
  const stored = sessionStorage.getItem("adminKey");

  if (!stored) {
    app.innerHTML = `
      <div class="surface mx-auto max-w-xl p-6 sm:p-8">
        <h1 class="title">Administración</h1>
        <p class="mt-2 muted">Ingresa la clave de administrador para continuar.</p>
        <form id="adminLoginForm" class="mt-6 space-y-4">
          <input id="adminKeyInput" type="password" class="input-field" placeholder="Clave de administrador" required />
          <button class="btn btn-primary register-btn w-full">Ingresar</button>
        </form>
      </div>
    `;
    document.getElementById("adminLoginForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const key = document.getElementById("adminKeyInput").value;
      sessionStorage.setItem("adminKey", key);
      renderAdminPanel();
    });
    return;
  }

  renderAdminPanel();
};

const renderAdminPanel = async () => {
  app.innerHTML = `
    <div class="mx-auto max-w-3xl space-y-4">
      <div class="surface p-6 sm:p-8">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h1 class="title">Panel de Administración</h1>
          <button id="logoutBtn" class="btn btn-secondary">Cerrar sesión</button>
        </div>

        <div class="surface p-4 mt-4" style="background: rgba(161,102,255,0.08);">
          <h2 class="text-lg font-bold text-white mb-3">Crear Nuevo Sorteo</h2>
          <form id="createSorteoForm" class="space-y-3">
            <input name="name" class="input-field" placeholder="Nombre del evento" required />
            <input name="group" class="input-field" placeholder="Grupo (ej: AWS User Group Piura)" required />
            <input name="raffleDate" type="date" class="input-field" required />
            <button class="btn btn-primary register-btn w-full">Crear Sorteo</button>
          </form>
        </div>

        <div id="adminSorteosList" class="mt-6 space-y-3">
          <p class="muted">Cargando sorteos...</p>
        </div>
      </div>
    </div>
  `;

  document.getElementById("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("adminKey");
    renderAdmin();
  });

  // Set min date to today on the date input
  const dateInput = document.querySelector('input[name="raffleDate"]');
  const today = new Date();
  const todayStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  dateInput.setAttribute("min", todayStr);

  document.getElementById("createSorteoForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = (fd.get("name") || "").trim();
    const group = (fd.get("group") || "").trim();
    const raffleDate = (fd.get("raffleDate") || "").trim();

    if (!name || !group || !raffleDate) {
      showToast("Todos los campos son obligatorios.", "error");
      return;
    }

    // Validate date is not in the past
    const todayCheck = new Date();
    todayCheck.setHours(0, 0, 0, 0);
    const dateObj = new Date(raffleDate + "T00:00:00");
    if (dateObj < todayCheck) {
      showToast("La fecha del sorteo no puede ser anterior a hoy.", "error");
      return;
    }

    try {
      await adminApi("/sorteos", {
        method: "POST",
        body: JSON.stringify({ name, group, raffleDate }),
      });
      showToast("Sorteo creado.", "success");
      e.target.reset();
      loadAdminSorteos();
    } catch (err) {
      showToast(err.message || "Error al crear sorteo.", "error");
    }
  });

  loadAdminSorteos();
};

const loadAdminSorteos = async () => {
  const container = document.getElementById("adminSorteosList");
  if (!container) return;

  try {
    const data = await api("/sorteos");
    const sorteos = data.sorteos || [];

    if (sorteos.length === 0) {
      container.innerHTML = `<p class="muted">No hay sorteos creados.</p>`;
      return;
    }

    container.innerHTML = sorteos.map((s) => `
      <div class="sorteo-card ${s.status === "closed" ? "sorteo-closed" : ""}">
        <div class="sorteo-card-header">
          <h3 class="sorteo-card-name">${s.name}</h3>
          <span class="sorteo-badge ${s.status === "open" ? "badge-open" : "badge-closed"}">
            ${s.status === "open" ? "Abierto" : "Cerrado"}
          </span>
        </div>
        ${s.group ? `<p class="sorteo-card-group">${s.group}</p>` : ""}
        <div class="sorteo-card-meta">
          <span>Participantes: <strong>${s.participantCount || 0}</strong></span>
          <span>Fecha: <strong>${formatDate(s.raffleDate)}</strong></span>
        </div>
        <div class="admin-actions mt-3">
          ${s.status === "open"
            ? `<button class="btn btn-secondary btn-sm" data-action="close" data-id="${s.sorteoId}">Cerrar</button>`
            : `<button class="btn btn-primary btn-sm" data-action="reopen" data-id="${s.sorteoId}">Reabrir</button>`
          }
          <button class="btn btn-danger btn-sm" data-action="clear" data-id="${s.sorteoId}">Vaciar</button>
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="${s.sorteoId}">Eliminar</button>
        </div>
      </div>
    `).join("");

    container.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => handleAdminAction(btn.dataset.action, btn.dataset.id));
    });
  } catch (err) {
    container.innerHTML = `<p class="muted">Error: ${err.message}</p>`;
  }
};

const handleAdminAction = async (action, sorteoId) => {
  if (action === "clear") {
    const input = window.prompt("Escribe VACIAR para confirmar que deseas eliminar todos los participantes:");
    if (input !== "VACIAR") {
      if (input !== null) showToast("Texto incorrecto. Operación cancelada.", "error");
      return;
    }
  } else if (action === "delete") {
    const input = window.prompt("Escribe ELIMINAR para confirmar la eliminación permanente del sorteo:");
    if (input !== "ELIMINAR") {
      if (input !== null) showToast("Texto incorrecto. Operación cancelada.", "error");
      return;
    }
  } else {
    const messages = {
      close: "¿Cerrar este sorteo? Los participantes no podrán registrarse.",
      reopen: "¿Reabrir este sorteo?",
    };
    if (!window.confirm(messages[action])) return;
  }

  try {
    if (action === "close") {
      await adminApi(`/sorteos/${sorteoId}/close`, { method: "PATCH" });
      showToast("Sorteo cerrado.", "success");
    } else if (action === "reopen") {
      await adminApi(`/sorteos/${sorteoId}/reopen`, { method: "PATCH" });
      showToast("Sorteo reabierto.", "success");
    } else if (action === "clear") {
      await adminApi(`/sorteos/${sorteoId}/participantes`, { method: "DELETE" });
      showToast("Participantes eliminados.", "success");
    } else if (action === "delete") {
      await adminApi(`/sorteos/${sorteoId}`, { method: "DELETE" });
      showToast("Sorteo eliminado.", "success");
    }
    loadAdminSorteos();
  } catch (err) {
    showToast(err.message || "Error en la operación.", "error");
  }
};

// ─── ROUTING ────────────────────────────────────────────────────────────────────

const renderView = (view) => {
  stopPolling();
  if (view === "sortear") { renderSortear(); return; }
  if (view === "admin") { renderAdmin(); return; }
  renderRegistrar();
};

(async () => {
  await loadConfig();

  document.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      renderView(el.getAttribute("data-view") || "registrar");
    });
  });

  renderView("registrar");
})();
