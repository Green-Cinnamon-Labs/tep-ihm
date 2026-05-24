/*
 * TEP IHM — frontend
 *
 * Espelha a estrutura do dashboard ratatui (dashboard.rs):
 * Header → Solver + Alarms → XMEAS | XMV tables → Charts
 */

const MAX_POINTS = 300;

// ── Metadata (mesma ordem do dashboard.rs) ──────────────────────────────────

const XMEAS_META = [
    { tag: "XMEAS(1)",  name: "A Feed",                unit: "kscmh" },
    { tag: "XMEAS(2)",  name: "D Feed",                unit: "kg/hr" },
    { tag: "XMEAS(3)",  name: "E Feed",                unit: "kg/hr" },
    { tag: "XMEAS(4)",  name: "A&C Feed",              unit: "kscmh" },
    { tag: "XMEAS(5)",  name: "Recycle Flow",           unit: "kscmh" },
    { tag: "XMEAS(6)",  name: "Reactor Feed Rate",      unit: "kscmh" },
    { tag: "XMEAS(7)",  name: "Reactor Pressure",       unit: "kPa" },
    { tag: "XMEAS(8)",  name: "Reactor Level",          unit: "%" },
    { tag: "XMEAS(9)",  name: "Reactor Temperature",    unit: "\u00b0C" },
    { tag: "XMEAS(10)", name: "Purge Rate",             unit: "kscmh" },
    { tag: "XMEAS(11)", name: "Sep Temperature",        unit: "\u00b0C" },
    { tag: "XMEAS(12)", name: "Sep Level",              unit: "%" },
    { tag: "XMEAS(13)", name: "Sep Pressure",           unit: "kPa" },
    { tag: "XMEAS(14)", name: "Sep Underflow",          unit: "m\u00b3/hr" },
    { tag: "XMEAS(15)", name: "Stripper Level",         unit: "%" },
    { tag: "XMEAS(16)", name: "Stripper Pressure",      unit: "kPa" },
    { tag: "XMEAS(17)", name: "Stripper Underflow",     unit: "m\u00b3/hr" },
    { tag: "XMEAS(18)", name: "Stripper Temperature",   unit: "\u00b0C" },
    { tag: "XMEAS(19)", name: "Stripper Steam Flow",    unit: "kg/hr" },
    { tag: "XMEAS(20)", name: "Compressor Work",        unit: "kW" },
    { tag: "XMEAS(21)", name: "Reactor CW Outlet Temp",       unit: "\u00b0C" },
    { tag: "XMEAS(22)", name: "Sep CW Outlet Temp",           unit: "\u00b0C" },
    // Tabela 5 — analisadores (amostragem periódica)
    { tag: "XMEAS(23)", name: "Reactor A Composition",        unit: "mol%" },
    { tag: "XMEAS(24)", name: "Reactor B Composition",        unit: "mol%" },
    { tag: "XMEAS(25)", name: "Reactor C Composition",        unit: "mol%" },
    { tag: "XMEAS(26)", name: "Reactor D Composition",        unit: "mol%" },
    { tag: "XMEAS(27)", name: "Reactor E Composition",        unit: "mol%" },
    { tag: "XMEAS(28)", name: "Reactor F Composition",        unit: "mol%" },
    { tag: "XMEAS(29)", name: "Purge A Composition",          unit: "mol%" },
    { tag: "XMEAS(30)", name: "Purge B Composition",          unit: "mol%" },
    { tag: "XMEAS(31)", name: "Purge C Composition",          unit: "mol%" },
    { tag: "XMEAS(32)", name: "Purge D Composition",          unit: "mol%" },
    { tag: "XMEAS(33)", name: "Purge E Composition",          unit: "mol%" },
    { tag: "XMEAS(34)", name: "Purge F Composition",          unit: "mol%" },
    { tag: "XMEAS(35)", name: "Purge G Composition",          unit: "mol%" },
    { tag: "XMEAS(36)", name: "Purge H Composition",          unit: "mol%" },
    { tag: "XMEAS(37)", name: "Product D Composition",        unit: "mol%" },
    { tag: "XMEAS(38)", name: "Product E Composition",        unit: "mol%" },
    { tag: "XMEAS(39)", name: "Product F Composition",        unit: "mol%" },
    { tag: "XMEAS(40)", name: "Product G Composition",        unit: "mol%" },
    { tag: "XMEAS(41)", name: "Product H Composition",        unit: "mol%" },
];

const XMV_META = [
    { tag: "XMV(1)",  name: "D Feed Flow",             unit: "%" },
    { tag: "XMV(2)",  name: "E Feed Flow",             unit: "%" },
    { tag: "XMV(3)",  name: "A Feed Flow",             unit: "%" },
    { tag: "XMV(4)",  name: "A&C Feed Flow",           unit: "%" },
    { tag: "XMV(5)",  name: "Compressor Recycle",      unit: "%" },
    { tag: "XMV(6)",  name: "Purge Valve",             unit: "%" },
    { tag: "XMV(7)",  name: "Sep Pot Liquid Flow",     unit: "%" },
    { tag: "XMV(8)",  name: "Stripper Liquid Product", unit: "%" },
    { tag: "XMV(9)",  name: "Stripper Steam Valve",    unit: "%" },
    { tag: "XMV(10)", name: "Reactor CW Flow",         unit: "%" },
    { tag: "XMV(11)", name: "Condenser CW Flow",       unit: "%" },
    { tag: "XMV(12)", name: "Agitator Speed",          unit: "%" },
];

// Nomes dos alarmes (mesmo que a planta expõe via gRPC)
const ALARM_NAMES = [
    "Reactor High Pressure",
    "Reactor High Level",
    "Reactor High Temperature",
    "Separator High Level",
    "Stripper High Level",
    "Stripper High Underflow",
    "Reactor Low Level",
    "Separator Low Level",
    "Stripper Low Level",
];

// ── Chart setup ──────────────────────────────────────────────────────────────

const COLORS = ['#4fc3f7', '#66bb6a', '#ffa726', '#ef5350', '#ab47bc', '#26c6da'];

const chartOpts = (title) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
        title: { display: true, text: title, color: '#78909c', font: { size: 11, family: 'Consolas' } },
        legend: { labels: { color: '#555', font: { size: 10 } } },
    },
    scales: {
        x: { ticks: { color: '#333', maxTicksLimit: 6, font: { size: 9 } }, grid: { color: '#1e2130' } },
        y: { ticks: { color: '#555', font: { size: 9 } }, grid: { color: '#1e2130' } },
    },
});

function ds(label, ci) {
    return { label, data: [], borderColor: COLORS[ci % COLORS.length], borderWidth: 1.5, pointRadius: 0, tension: 0.2 };
}

const timeLabels = [];

const chartPressure = new Chart(document.getElementById('chart-pressure'), {
    type: 'line',
    data: { labels: timeLabels, datasets: [ds('Reactor (7)', 0), ds('Separator (13)', 1), ds('Stripper (16)', 2)] },
    options: chartOpts('Pressure (kPa)'),
});

const chartTemp = new Chart(document.getElementById('chart-temperature'), {
    type: 'line',
    data: { labels: timeLabels, datasets: [ds('Reactor (9)', 3), ds('Separator (11)', 4), ds('Stripper (18)', 5)] },
    options: chartOpts('Temperature (\u00b0C)'),
});

const chartLevels = new Chart(document.getElementById('chart-levels'), {
    type: 'line',
    data: { labels: timeLabels, datasets: [ds('Reactor (8)', 0), ds('Separator (12)', 1), ds('Stripper (15)', 2)] },
    options: chartOpts('Level (%)'),
});

const chartFlows = new Chart(document.getElementById('chart-flows'), {
    type: 'line',
    data: { labels: timeLabels, datasets: [ds('A (1)', 0), ds('D (2)', 1), ds('E (3)', 2), ds('A&C (4)', 3)] },
    options: chartOpts('Feed Flows (kscmh / kg/hr)'),
});

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $status = document.getElementById('connection-status');
const $simTime = document.getElementById('sim-time');
const $plantStatus = document.getElementById('plant-status');
const $solverDeriv = document.getElementById('solver-deriv');
const $solverStatus = document.getElementById('solver-status');
const $alarmsLeft = document.getElementById('alarms-col-left');
const $alarmsRight = document.getElementById('alarms-col-right');
const $xmeasTbody = document.querySelector('#xmeas-table tbody');
const $xmvTbody = document.querySelector('#xmv-table tbody');
const $isdBanner = document.getElementById('isd-banner');

// ── State ────────────────────────────────────────────────────────────────────

let _currentActiveIdv = [];  // Track current active disturbances from WebSocket

// ── WebSocket ────────────────────────────────────────────────────────────────

const $btnReconnect = document.getElementById('btn-reconnect');

function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => { $status.textContent = 'conectado'; $status.className = 'header-info status-connected'; };
    ws.onclose = () => { $status.textContent = 'desconectado'; $status.className = 'header-info status-disconnected'; setTimeout(connect, 2000); };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => update(JSON.parse(e.data));
}

async function reconnectPlant() {
    if ($btnReconnect) { $btnReconnect.disabled = true; $btnReconnect.textContent = '⟳ Conectando...'; }
    try {
        await fetch('/api/reconnect', { method: 'POST' });
    } finally {
        if ($btnReconnect) { $btnReconnect.disabled = false; $btnReconnect.textContent = '⟳ Tentar conectar'; }
    }
}

// ── Update ───────────────────────────────────────────────────────────────────

// ── Operator panel ───────────────────────────────────────────────────────────

const $opPhase = document.getElementById('op-phase');
const $opTime = document.getElementById('op-time');
const $opIsd = document.getElementById('op-isd');
const $opReconcile = document.getElementById('op-reconcile');
const $opLastAction = document.getElementById('op-last-action');
const $opVarsTbody = document.getElementById('op-vars-tbody');

function renderOperator(op) {
    if (!op) {
        $opPhase.textContent = 'não conectado';
        return;
    }

    $opPhase.textContent = op.phase || '--';
    $opPhase.className = op.phase === 'Alarm' || op.phase === 'Shutdown' ? 'status-alarm' : '';

    $opTime.textContent = op.plantTime != null ? `${op.plantTime.toFixed(2)} h` : '--';
    $opIsd.textContent = op.isdActive ? 'SIM' : 'não';
    $opIsd.className = op.isdActive ? 'status-alarm' : '';

    if (op.lastReconcileTime) {
        const d = new Date(op.lastReconcileTime);
        $opReconcile.textContent = d.toLocaleTimeString();
    } else {
        $opReconcile.textContent = '--';
    }

    if (op.lastAction) {
        const a = op.lastAction;
        $opLastAction.textContent = `${a.ruleName}: ${a.controllerID}.${a.parameter} → ${a.value}`;
    } else {
        $opLastAction.textContent = 'nenhuma';
    }

    // Policy variables table
    const vars = op.variables || [];
    $opVarsTbody.innerHTML = vars.map(v => {
        const meta = XMEAS_META[v.xmeasIndex] || { tag: `XMEAS(${v.xmeasIndex + 1})`, name: '', unit: '' };
        const inRangeCls = v.inRange ? 'alarm-inactive' : 'alarm-active';
        const inRangeText = v.inRange ? 'ok' : 'OUT';
        const trendIcon = { Rising: '↑', Falling: '↓', Stable: '→' }[v.trend] || '?';
        return `<tr class="${inRangeCls}">
            <td>${v.name}</td>
            <td class="tag-xmeas">${meta.tag}</td>
            <td class="val">${v.value.toFixed(3)} ${meta.unit}</td>
            <td>${inRangeText}</td>
            <td>${trendIcon}</td>
        </tr>`;
    }).join('');
}

// ── IDV metadata ─────────────────────────────────────────────────────────────

const IDV_META = [
    { n:  1, type: "Step",   desc: "A/C ratio in feed (stream 4)" },
    { n:  2, type: "Step",   desc: "B composition in feed (stream 4)" },
    { n:  3, type: "Step",   desc: "D feed temperature" },
    { n:  4, type: "Step",   desc: "Reactor CW inlet temp (+5°C)" },
    { n:  5, type: "Step",   desc: "Condenser CW inlet temp (+5°C)" },
    { n:  6, type: "Step",   desc: "A feed loss (stream 1 → 0)" },
    { n:  7, type: "Step",   desc: "C header pressure drop" },
    { n:  8, type: "Random", desc: "A/B/C feed composition noise" },
    { n:  9, type: "Random", desc: "D feed temperature noise" },
    { n: 10, type: "Random", desc: "C feed temperature noise" },
    { n: 11, type: "Random", desc: "Reactor CW temp noise" },
    { n: 12, type: "Random", desc: "Condenser CW temp noise" },
    { n: 13, type: "Random", desc: "Reaction kinetics drift" },
    { n: 14, type: "Stuck",  desc: "Reactor CW valve stuck (XMV 10)" },
    { n: 15, type: "Stuck",  desc: "Condenser CW valve stuck (XMV 11)" },
    { n: 16, type: "Stuck",  desc: "D feed valve stuck (XMV 1)" },
    { n: 17, type: "Stuck",  desc: "A&C feed valve stuck (XMV 4)" },
    { n: 18, type: "Stuck",  desc: "A feed valve stuck (XMV 3)" },
    { n: 19, type: "Stuck",  desc: "Compressor recycle valve stuck (XMV 5)" },
    { n: 20, type: "Stuck",  desc: "Stripper product valve stuck (XMV 8)" },
];

const $idvList = document.getElementById('idv-list');

function renderIdv(activeList) {
    const active = new Set(activeList || []);
    $idvList.innerHTML = IDV_META.map(({ n, type, desc }) => {
        const on = active.has(n);
        return `<div class="idv-item ${on ? 'idv-active' : ''}">
            <div class="idv-content">
                <strong>IDV(${n})</strong> [${type}] ${desc}
            </div>
            <button class="idv-toggle ${on ? 'idv-toggle-on' : 'idv-toggle-off'}"
                    data-idv="${n}"
                    title="${on ? 'Desativar' : 'Ativar'} IDV(${n})">
                ${on ? '⏹' : '▶'}
            </button>
        </div>`;
    }).join('');

    // Event listeners for toggle buttons
    document.querySelectorAll('.idv-toggle').forEach(btn => {
        btn.addEventListener('click', toggleIdv);
    });
}

async function toggleIdv(event) {
    const btn = event.target;
    const idvNum = parseInt(btn.dataset.idv);
    const isActive = btn.classList.contains('idv-toggle-on');

    // Get current active list and toggle
    const currentActive = new Set(_currentActiveIdv || []);
    if (isActive) {
        currentActive.delete(idvNum);
    } else {
        currentActive.add(idvNum);
    }

    // Send to server
    const resp = await fetch('/disturbances/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_idv: Array.from(currentActive) })
    });

    if (resp.ok) {
        console.log(`[idv] IDV(${idvNum}) toggled to ${!isActive}`);
    } else {
        console.error(`[idv] Failed to toggle IDV(${idvNum})`);
    }
}

renderIdv([]);

// ── Floating panels: toggle + drag ───────────────────────────────────────────

function _setPanel(panelId, btnId, open) {
    const panel = document.getElementById(panelId);
    const btn   = document.getElementById(btnId);
    if (!panel) return;
    panel.hidden = !open;
    if (btn) btn.classList.toggle('panel-btn-open', open);
}

function toggleIdvPanel() {
    const panel = document.getElementById('idv-panel');
    _setPanel('idv-panel', 'btn-idv', !!panel?.hidden);
}

function toggleConsolePanel() {
    const panel = document.getElementById('console-panel');
    _setPanel('console-panel', 'btn-console', !!panel?.hidden);
}

// ── Console intercept ────────────────────────────────────────────────────────

function _consoleLog(msg, level = 'LOG') {
    const container = document.getElementById('console-log');
    if (!container) return;
    const now  = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const line = document.createElement('div');
    line.className = `demo-log-line log-${level}`;
    line.textContent = `[${now}] [${level}] ${msg}`;
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
}

(function _interceptConsole() {
    const _orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    console.log   = (...a) => { _orig.log(...a);   _consoleLog(a.join(' '), 'LOG'); };
    console.warn  = (...a) => { _orig.warn(...a);  _consoleLog(a.join(' '), 'WRN'); };
    console.error = (...a) => { _orig.error(...a); _consoleLog(a.join(' '), 'ERR'); };
    console.info  = (...a) => { _orig.info(...a);  _consoleLog(a.join(' '), 'INF'); };
})();

function makeDraggable(panel, handle) {
    handle.style.cursor    = 'grab';
    handle.style.userSelect = 'none';

    handle.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;

        const rect    = panel.getBoundingClientRect();
        const startX  = e.clientX;
        const startY  = e.clientY;
        const origLeft = rect.left;
        const origTop  = rect.top;

        panel.style.right  = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left   = origLeft + 'px';
        panel.style.top    = origTop  + 'px';

        handle.style.cursor = 'grabbing';
        handle.setPointerCapture(e.pointerId);

        const onMove = ev => {
            panel.style.left = (origLeft + ev.clientX - startX) + 'px';
            panel.style.top  = (origTop  + ev.clientY - startY) + 'px';
        };
        const onUp = () => {
            handle.style.cursor = 'grab';
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup',   onUp);
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup',   onUp);
        e.preventDefault();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const demoPanel  = document.getElementById('console-panel');
    const demoHandle = demoPanel?.querySelector('.demo-panel-header');
    if (demoPanel && demoHandle) makeDraggable(demoPanel, demoHandle);

    const idvPanel  = document.getElementById('idv-panel');
    const idvHandle = idvPanel?.querySelector('.idv-panel-header');
    if (idvPanel && idvHandle) makeDraggable(idvPanel, idvHandle);
});

// ── Update ───────────────────────────────────────────────────────────────────

function update(data) {
    if (data.plant_connection === 'failed') {
        if ($btnReconnect) $btnReconnect.style.display = 'inline-block';
        $status.textContent = 'planta offline';
        $status.className = 'header-info status-disconnected';
        return;
    }
    if ($btnReconnect) $btnReconnect.style.display = 'none';

    const { t_h, xmeas, xmv, alarms, deriv_norm, isd_active } = data;

    // Header
    $simTime.textContent = `t = ${t_h.toFixed(2)} h`;

    // ISD
    $isdBanner.hidden = !isd_active;

    // Solver diagnostics
    const dn = deriv_norm ?? 0;
    $solverDeriv.textContent = dn.toExponential(2);
    if (dn < 1e-6) {
        $solverStatus.textContent = 'Steady-state';
        $solverStatus.className = 'solver-steady';
    } else if (dn < 1.0) {
        $solverStatus.textContent = 'Slow transient';
        $solverStatus.className = 'solver-slow';
    } else {
        $solverStatus.textContent = 'Fast transient';
        $solverStatus.className = 'solver-fast';
    }

    // Plant status (header tag)
    const anyAlarm = alarms && alarms.some(a => a.active);
    if (isd_active) {
        $plantStatus.textContent = 'ISD';
        $plantStatus.className = 'header-info status-tag status-alarm';
    } else if (anyAlarm) {
        $plantStatus.textContent = 'ALARM';
        $plantStatus.className = 'header-info status-tag status-alarm';
    } else {
        $plantStatus.textContent = 'OK';
        $plantStatus.className = 'header-info status-tag status-ok';
    }

    // Alarms — suprimido durante demo mode (badges geridos pelo demo)
    if (!window._demoActive) {
        updateAlarms(alarms);
    }

    // Time label for charts
    const label = t_h.toFixed(1);
    timeLabels.push(label);
    if (timeLabels.length > MAX_POINTS) timeLabels.shift();

    // Charts
    pushData(chartPressure, [xmeas[6], xmeas[12], xmeas[15]]);
    pushData(chartTemp, [xmeas[8], xmeas[10], xmeas[17]]);
    pushData(chartLevels, [xmeas[7], xmeas[11], xmeas[14]]);
    pushData(chartFlows, [xmeas[0], xmeas[1], xmeas[2], xmeas[3]]);

    // XMEAS table
    $xmeasTbody.innerHTML = xmeas.map((v, i) => {
        const m = XMEAS_META[i] || { tag: `XMEAS(${i+1})`, name: '', unit: '' };
        return `<tr>
            <td class="tag-xmeas">${m.tag}</td>
            <td class="val">${v.toFixed(3)}</td>
            <td class="unit">${m.unit}</td>
            <td class="name">${m.name}</td>
        </tr>`;
    }).join('');

    // XMV table
    $xmvTbody.innerHTML = xmv.map((v, i) => {
        const m = XMV_META[i] || { tag: `XMV(${i+1})`, name: '', unit: '' };
        return `<tr>
            <td class="tag-xmv">${m.tag}</td>
            <td class="val">${v.toFixed(2)}</td>
            <td class="unit">${m.unit}</td>
            <td class="name">${m.name}</td>
        </tr>`;
    }).join('');

    // Operator panel
    renderOperator(data.operator);

    // IDV panel — track current active list and render
    _currentActiveIdv = data.active_idv || [];
    renderIdv(_currentActiveIdv);

    // Diagram animation (P&ID) — suprimido durante demo mode
    if (typeof updateDiagram === 'function' && !window._demoActive) {
        updateDiagram(xmeas, xmv);
    }
}

// Catálogo unificado: gRPC alarms + limites locais → elemento SVG + severidade
// severity 'alarm' = hi_hi (quadrado vermelho) | 'warning' = hi/lo (triângulo âmbar)
const ALARM_CATALOG = [
    { variable: 'Reactor High Pressure',    element: 'sensor-xmeas-07', severity: 'alarm'   },
    { variable: 'Reactor High Level',       element: 'sensor-xmeas-08', severity: 'alarm'   },
    { variable: 'Reactor High Temperature', element: 'unit-reactor',    severity: 'alarm'   },
    { variable: 'Reactor Low Level',        element: 'sensor-xmeas-08', severity: 'warning', offset: 'below' },
    { variable: 'Separator High Level',     element: 'sensor-xmeas-12', severity: 'alarm'   },
    { variable: 'Separator Low Level',      element: 'sensor-xmeas-12', severity: 'warning', offset: 'below' },
    { variable: 'Stripper High Level',      element: 'sensor-xmeas-15', severity: 'alarm'   },
    { variable: 'Stripper Low Level',       element: 'sensor-xmeas-15', severity: 'warning', offset: 'below' },
    { variable: 'Stripper High Underflow',  element: 'unit-stripper',   severity: 'alarm'   },
    // Locais (temperatura de vasos e compressores — derivados pelo frontend)
    { variable: 'Separator High Temperature', element: 'unit-separator',       severity: 'alarm'   },
    { variable: 'Stripper High Temperature',  element: 'unit-stripper',        severity: 'alarm'   },
    { variable: 'Condenser High Temperature', element: 'unit-condenser',       severity: 'warning' },
    { variable: 'Compressor High Work',       element: 'unit-compressor-1',    severity: 'alarm'   },
];

const _SEV_ICON = {
    alarm:   '/static/sev-1.drawio.png',
    warning: '/static/sev-2.drawio.png',
    advisory:'/static/sev-3.drawio.png',
};

function _badgeShape(NS, entry, cx, cy, n) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('id', `alarm-badge-${n}`);
    g.setAttribute('pointer-events', 'none');

    const S    = 32;
    const href = _SEV_ICON[entry.severity] || _SEV_ICON.alarm;

    const img = document.createElementNS(NS, 'image');
    img.setAttribute('href', href);
    img.setAttribute('x', cx - S / 2);
    img.setAttribute('y', cy - S / 2);
    img.setAttribute('width',  S);
    img.setAttribute('height', S);

    g.appendChild(img);
    return g;
}

// Aceita dois formatos:
//   gRPC:   [{variable, active}]          → resolve element+severity via ALARM_CATALOG
//   direto: [{element, severity, active}] → usa diretamente (usado pelo demo tour)
function renderAlarmBadges(alarms) {
    const svg = document.querySelector('#diagram-container svg');
    if (!svg) return;
    svg.querySelectorAll('[id^="alarm-badge-"]').forEach(el => el.remove());
    if (!alarms || !alarms.length) return;

    const NS  = 'http://www.w3.org/2000/svg';
    const inv = svg.getScreenCTM()?.inverse();
    if (!inv) return;

    const toSVG = (x, y) => {
        const p = svg.createSVGPoint();
        p.x = x; p.y = y;
        return p.matrixTransform(inv);
    };

    // Normaliza para lista de {element, severity, offset}
    const resolved = [];
    alarms.filter(a => a.active).forEach(a => {
        if (a.element) {
            // formato direto
            resolved.push({ element: a.element, severity: a.severity || 'alarm', offset: a.offset });
        } else {
            // formato gRPC → lookup no catálogo
            const entry = ALARM_CATALOG.find(e => e.variable === a.variable);
            if (entry) resolved.push(entry);
        }
    });
    if (!resolved.length) return;

    resolved.forEach((entry, i) => {
        const drawable = typeof getDrawablePath === 'function' ? getDrawablePath(entry.element) : null;
        if (!drawable) { console.warn(`[alarms] drawable not found: ${entry.element}`); return; }

        const r     = drawable.getBoundingClientRect();
        const tr    = toSVG(r.right, r.top);
        const bl    = toSVG(r.left,  r.bottom);
        const below = entry.offset === 'below';
        const cx    = tr.x + 10;
        const cy    = below ? bl.y + 10 : tr.y - 10;

        svg.appendChild(_badgeShape(NS, entry, cx, cy, i + 1));
    });
}

function updateAlarms(alarms) {
    renderAlarmBadges(alarms);
}

function alarmHtml(name, active) {
    const cls = active ? 'alarm-active' : 'alarm-inactive';
    const statusText = active ? 'ALARM' : 'ok';
    return `<div class="alarm-item ${cls}">
        <span class="alarm-indicator"></span>
        <span class="alarm-status">${statusText}</span>
        <span class="alarm-label">${name}</span>
    </div>`;
}

function pushData(chart, values) {
    values.forEach((v, i) => {
        chart.data.datasets[i].data.push(v);
        if (chart.data.datasets[i].data.length > MAX_POINTS) chart.data.datasets[i].data.shift();
    });
    chart.update('none');
}

// ── Resizable diagram/charts divider ─────────────────────────────────────────

function initResizableDivider() {
    const divider = document.getElementById('resize-divider');
    const container = document.querySelector('.row-diagram-charts');
    if (!divider || !container) return;

    let isResizing = false;

    divider.addEventListener('mousedown', () => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const rect = container.getBoundingClientRect();
        const newLeftWidth = e.clientX - rect.left;
        const totalWidth = rect.width;
        const rightWidth = totalWidth - newLeftWidth - 6; // 6px for divider

        if (newLeftWidth > 200 && rightWidth > 200) { // Min 200px for each
            container.style.gridTemplateColumns = `${newLeftWidth}px 6px ${rightWidth}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
        document.body.style.cursor = 'auto';
        document.body.style.userSelect = 'auto';
    });

    console.log('[resize] Divider initialized');
}

initResizableDivider();
connect();

// ── Recording controls ────────────────────────────────────────────────────────

let _recording_state = false;  // estado atual de gravação
let _recording_start_time = null;  // timestamp quando começou a gravar
let _recording_timer_id = null;  // ID do setInterval

function _format_time(seconds) {
    const mm = Math.floor(seconds / 60);
    const ss = seconds % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function _update_timer() {
    if (!_recording_start_time) return;
    const elapsed = Math.floor((Date.now() - _recording_start_time) / 1000);
    document.getElementById('rec-timer').textContent = _format_time(elapsed);
}

function _update_recording_ui(recording) {
    _recording_state = recording;
    const btnStart = document.getElementById('btn-rec-start');
    const btnStop = document.getElementById('btn-rec-stop');
    const btnDownload = document.getElementById('btn-rec-download');
    const status = document.getElementById('rec-status');
    const timer = document.getElementById('rec-timer');

    btnStart.disabled = recording;
    btnStop.disabled = !recording;
    btnDownload.disabled = false;
    status.textContent = recording ? '● gravando' : '○ parado';
    status.className = recording ? 'rec-status rec-status-active' : 'rec-status';

    if (recording) {
        _recording_start_time = Date.now();
        if (_recording_timer_id) clearInterval(_recording_timer_id);
        _recording_timer_id = setInterval(_update_timer, 1000);
        timer.className = 'rec-timer rec-timer-active';
    } else {
        if (_recording_timer_id) clearInterval(_recording_timer_id);
        _recording_timer_id = null;
        timer.className = 'rec-timer';
    }
}

document.getElementById('btn-rec-start').addEventListener('click', async () => {
    const resp = await fetch('/recording/start', { method: 'POST' });
    if (resp.ok) {
        const data = await resp.json();
        _update_recording_ui(data.recording);
        console.log('[rec] gravação iniciada');
    }
});

document.getElementById('btn-rec-stop').addEventListener('click', async () => {
    const resp = await fetch('/recording/stop', { method: 'POST' });
    if (resp.ok) {
        const data = await resp.json();
        _update_recording_ui(data.recording);
        console.log('[rec] gravação parada');
    }
});

// Estado inicial: parado
_update_recording_ui(false);

// ── Simulation Pause Button ──────────────────────────────────────────────────────

let _sim_paused = false;

document.getElementById('btn-sim-pause').addEventListener('click', async () => {
    _sim_paused = !_sim_paused;
    const btn = document.getElementById('btn-sim-pause');
    const action = _sim_paused ? 'pause' : 'resume';

    // Send to server
    const resp = await fetch('/simulation/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
    });

    if (resp.ok) {
        if (_sim_paused) {
            btn.classList.remove('sim-running');
            btn.classList.add('sim-paused');
            btn.textContent = '▶ Resume';
            console.log('[sim] pause sent to plant');
        } else {
            btn.classList.remove('sim-paused');
            btn.classList.add('sim-running');
            btn.textContent = '⏸ Pause';
            console.log('[sim] resume sent to plant');
        }
    } else {
        console.error(`[sim] failed to ${action} simulation`);
        _sim_paused = !_sim_paused;
    }
});
