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
const $alarmsPanel = document.getElementById('alarms-panel');
const $alarmsLeft = document.getElementById('alarms-col-left');
const $alarmsRight = document.getElementById('alarms-col-right');
const $xmeasTbody = document.querySelector('#xmeas-table tbody');
const $xmvTbody = document.querySelector('#xmv-table tbody');
const $isdBanner = document.getElementById('isd-banner');

// ── WebSocket ────────────────────────────────────────────────────────────────

function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => { $status.textContent = 'conectado'; $status.className = 'header-info status-connected'; };
    ws.onclose = () => { $status.textContent = 'desconectado'; $status.className = 'header-info status-disconnected'; setTimeout(connect, 2000); };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => update(JSON.parse(e.data));
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

// ── Update ───────────────────────────────────────────────────────────────────

function update(data) {
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

    // Alarms (full list, matching ratatui two-column layout)
    updateAlarms(alarms);

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
}

function updateAlarms(alarms) {
    // Se vier da planta (gRPC), alarms é um array de objetos
    // Se vier do CSV, alarms é vazio — mostra placeholder
    if (!alarms || alarms.length === 0) {
        // CSV mode: show static alarm names as inactive
        const names = ALARM_NAMES;
        const mid = Math.ceil(names.length / 2);
        $alarmsLeft.innerHTML = names.slice(0, mid).map(n => alarmHtml(n, false)).join('');
        $alarmsRight.innerHTML = names.slice(mid).map(n => alarmHtml(n, false)).join('');
        $alarmsPanel.classList.remove('has-alarms');
        return;
    }

    const mid = Math.ceil(alarms.length / 2);
    const hasActive = alarms.some(a => a.active);

    $alarmsLeft.innerHTML = alarms.slice(0, mid).map(a => alarmHtml(a.variable, a.active)).join('');
    $alarmsRight.innerHTML = alarms.slice(mid).map(a => alarmHtml(a.variable, a.active)).join('');

    if (hasActive) {
        $alarmsPanel.classList.add('has-alarms');
    } else {
        $alarmsPanel.classList.remove('has-alarms');
    }
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

connect();
