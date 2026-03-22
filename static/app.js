/*
 * TEP IHM — frontend
 *
 * Conecta no backend via WebSocket e atualiza gráficos e tabelas em tempo real.
 */

const MAX_POINTS = 300;  // ~2.5 min a 500ms de intervalo

// ── Nomes das variáveis TEP ──────────────────────────────────────────────────

const XMEAS_NAMES = [
    "A feed (stream 1)",          // 0
    "D feed (stream 2)",          // 1
    "E feed (stream 3)",          // 2
    "A+C feed (stream 4)",        // 3
    "Recycle flow (stream 8)",    // 4
    "Reactor feed rate",          // 5
    "Reactor pressure",           // 6
    "Reactor level",              // 7
    "Reactor temperature",        // 8
    "Purge rate (stream 9)",      // 9
    "Separator temperature",      // 10
    "Separator level",            // 11
    "Separator pressure",         // 12
    "Separator underflow",        // 13
    "Stripper level",             // 14
    "Stripper pressure",          // 15
    "Stripper underflow",         // 16
    "Stripper temperature",       // 17
    "Stripper steam flow",        // 18
    "Compressor work",            // 19
    "Reactor CW outlet temp",     // 20
    "Separator CW outlet temp",   // 21
];

const XMV_NAMES = [
    "D feed flow",                // 0
    "E feed flow",                // 1
    "A feed flow",                // 2
    "A+C feed flow",              // 3
    "Compressor recycle valve",   // 4
    "Purge valve",                // 5
    "Separator pot liq flow",     // 6
    "Stripper liq product flow",  // 7
    "Stripper steam valve",       // 8
    "Reactor CW flow",            // 9
    "Condenser CW flow",          // 10
    "Agitator speed",             // 11
];

// ── Chart setup ──────────────────────────────────────────────────────────────

const chartOptions = (title) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
        title: { display: true, text: title, color: '#90a4ae', font: { size: 12 } },
        legend: { labels: { color: '#78909c', font: { size: 10 } } },
    },
    scales: {
        x: {
            display: true,
            ticks: { color: '#555', maxTicksLimit: 6, font: { size: 9 } },
            grid: { color: '#1e2130' },
        },
        y: {
            ticks: { color: '#78909c', font: { size: 10 } },
            grid: { color: '#1e2130' },
        },
    },
});

const COLORS = ['#4fc3f7', '#66bb6a', '#ffa726', '#ef5350', '#ab47bc', '#26c6da'];

function makeDataset(label, colorIdx) {
    return {
        label,
        data: [],
        borderColor: COLORS[colorIdx % COLORS.length],
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.2,
    };
}

const timeLabels = [];

// Pressão: reactor (6), separator (12), stripper (15)
const chartPressure = new Chart(document.getElementById('chart-pressure'), {
    type: 'line',
    data: {
        labels: timeLabels,
        datasets: [
            makeDataset('Reactor (7)', 0),
            makeDataset('Separator (13)', 1),
            makeDataset('Stripper (16)', 2),
        ],
    },
    options: chartOptions('Pressão (kPa)'),
});

// Temperatura: reactor (8), separator (10), stripper (17)
const chartTemp = new Chart(document.getElementById('chart-temperature'), {
    type: 'line',
    data: {
        labels: timeLabels,
        datasets: [
            makeDataset('Reactor (9)', 3),
            makeDataset('Separator (11)', 4),
            makeDataset('Stripper (18)', 5),
        ],
    },
    options: chartOptions('Temperatura (°C)'),
});

// Níveis: reactor (7), separator (11), stripper (14)
const chartLevels = new Chart(document.getElementById('chart-levels'), {
    type: 'line',
    data: {
        labels: timeLabels,
        datasets: [
            makeDataset('Reactor (8)', 0),
            makeDataset('Separator (12)', 1),
            makeDataset('Stripper (15)', 2),
        ],
    },
    options: chartOptions('Nível (%)'),
});

// Flows: A feed (0), D feed (1), E feed (2), A+C feed (3)
const chartFlows = new Chart(document.getElementById('chart-flows'), {
    type: 'line',
    data: {
        labels: timeLabels,
        datasets: [
            makeDataset('A feed (1)', 0),
            makeDataset('D feed (2)', 1),
            makeDataset('E feed (3)', 2),
            makeDataset('A+C feed (4)', 3),
        ],
    },
    options: chartOptions('Vazão de alimentação (kscmh)'),
});

// ── WebSocket ────────────────────────────────────────────────────────────────

const statusEl = document.getElementById('connection-status');
const simTimeEl = document.getElementById('sim-time');
const alarmsEl = document.getElementById('alarms-list');
const alarmsPanelEl = document.getElementById('alarms-panel');
const xmeasTableEl = document.getElementById('xmeas-table');
const xmvTableEl = document.getElementById('xmv-table');

function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => {
        statusEl.textContent = 'conectado';
        statusEl.className = 'status-connected';
    };

    ws.onclose = () => {
        statusEl.textContent = 'desconectado';
        statusEl.className = 'status-disconnected';
        setTimeout(connect, 2000);
    };

    ws.onerror = () => ws.close();

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        update(data);
    };
}

function update(data) {
    const { t_h, xmeas, xmv, alarms, isd_active } = data;

    // Tempo de simulação
    simTimeEl.textContent = `t = ${t_h.toFixed(2)} h`;

    // ISD banner
    let isdBanner = document.getElementById('isd-banner');
    if (isd_active) {
        if (!isdBanner) {
            isdBanner = document.createElement('div');
            isdBanner.id = 'isd-banner';
            isdBanner.className = 'isd-banner';
            isdBanner.textContent = 'EMERGENCY SHUTDOWN (ISD)';
            document.body.insertBefore(isdBanner, document.querySelector('main'));
        }
    } else if (isdBanner) {
        isdBanner.remove();
    }

    // Time label
    const label = t_h.toFixed(1);
    timeLabels.push(label);
    if (timeLabels.length > MAX_POINTS) timeLabels.shift();

    // Pressão: XMEAS 6, 12, 15
    pushData(chartPressure, [xmeas[6], xmeas[12], xmeas[15]]);

    // Temperatura: XMEAS 8, 10, 17
    pushData(chartTemp, [xmeas[8], xmeas[10], xmeas[17]]);

    // Níveis: XMEAS 7, 11, 14
    pushData(chartLevels, [xmeas[7], xmeas[11], xmeas[14]]);

    // Flows: XMEAS 0, 1, 2, 3
    pushData(chartFlows, [xmeas[0], xmeas[1], xmeas[2], xmeas[3]]);

    // Tabela XMEAS
    xmeasTableEl.innerHTML = xmeas.map((v, i) =>
        `<tr><td>XMEAS(${i + 1})</td><td title="${XMEAS_NAMES[i] || ''}">${v.toFixed(4)}</td></tr>`
    ).join('');

    // Tabela XMV
    xmvTableEl.innerHTML = xmv.map((v, i) =>
        `<tr><td>XMV(${i + 1})</td><td title="${XMV_NAMES[i] || ''}">${v.toFixed(4)}</td></tr>`
    ).join('');

    // Alarmes
    const activeAlarms = alarms.filter(a => a.active);
    if (activeAlarms.length > 0) {
        alarmsPanelEl.classList.add('has-alarms');
        alarmsEl.innerHTML = activeAlarms.map(a =>
            `<div class="alarm-item">${a.variable}</div>`
        ).join('');
    } else {
        alarmsPanelEl.classList.remove('has-alarms');
        alarmsEl.textContent = 'Nenhum alarme ativo';
    }
}

function pushData(chart, values) {
    values.forEach((v, i) => {
        chart.data.datasets[i].data.push(v);
        if (chart.data.datasets[i].data.length > MAX_POINTS) {
            chart.data.datasets[i].data.shift();
        }
    });
    chart.update('none');
}

// Iniciar conexão
connect();
