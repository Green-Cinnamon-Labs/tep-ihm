/*
 * TEP Demo Mode — injeta valores sintéticos em updateDiagram()
 * para demonstrar transições de estado ISA-101 sem precisar da planta.
 *
 * Exporta window._demoActive para app.js suprimir updateDiagram() do WebSocket.
 */

window._demoActive = false;

let _demoTimerId    = null;
let _demoStepIndex  = 0;
let _demoCurrent    = null;

// ── Valores nominais TEP (estado estacionário de referência) ─────────────────

function _nominalXmeas() {
    return [
        // XMEAS 1-22 — medições de processo
        0.25, 3600, 4600, 9.35, 26.9, 42.3,    //  1- 6
        2705, 75.0, 122.9, 0.34, 80.1, 50.0,   //  7-12
        2633, 25.2, 50.0, 3102, 23.0, 65.7,    // 13-18
        230.3, 341.4, 31.8, 13.8,              // 19-22
        // XMEAS 23-30 — analisador purga
        30.0, 10.0, 25.0, 7.0, 18.0, 2.0, 5.0, 3.0,
        // XMEAS 31-35 — analisador produto
        10.0, 20.0, 15.0, 35.0, 20.0,
        // XMEAS 36-41 — analisador feed
        45.0, 5.0, 35.0, 5.0, 8.0, 2.0,
    ];
}

function _nominalXmv() {
    return [63.1, 53.4, 24.6, 61.3, 22.2, 40.1, 38.1, 46.5, 47.3, 41.1, 18.1, 50.0];
}

// ── Cenário de demonstração ──────────────────────────────────────────────────
// delay: ms após o passo anterior. patch: overrides parciais em xmeas (0-based).

const DEMO_STEPS = [
    {
        delay: 0,
        msg: '▶  Estado nominal — reator 122.9°C · compressor 341 kW · sep 80°C · stripper 65.7°C',
        patch: {},
    },

    // — Compressor —
    {
        delay: 3000,
        msg: '⬆  Compressor Work subindo → 380 kW  (limite WARNING: 400 kW)',
        patch: { 19: 380 },
    },
    {
        delay: 2500,
        msg: '⚠  Compressor Work em WARNING → 420 kW  [hi = 400 kW]',
        patch: { 19: 420 },
    },
    {
        delay: 2500,
        msg: '🔴 Compressor Work em ALARM → 462 kW  [hi-hi = 450 kW]',
        patch: { 19: 462 },
    },
    {
        delay: 3000,
        msg: '↩  Compressor normalizado (341 kW). Iniciando rampa no Reator...',
        patch: { 19: 341 },
    },

    // — Reator —
    {
        delay: 2000,
        msg: '⬆  Reactor Temp subindo → 140°C  (limite WARNING: 150°C)',
        patch: { 8: 140 },
    },
    {
        delay: 2500,
        msg: '⚠  Reactor Temp em WARNING → 155°C  [hi = 150°C]',
        patch: { 8: 155 },
    },
    {
        delay: 2500,
        msg: '🔴 Reactor Temp em ALARM → 172°C  [hi-hi = 165°C]',
        patch: { 8: 172 },
    },
    {
        delay: 3000,
        msg: '↩  Reator normalizado (122.9°C). Iniciando rampa no Separador...',
        patch: { 8: 122.9 },
    },

    // — Separador —
    {
        delay: 2000,
        msg: '⬆  Sep Temp subindo → 95°C  (limite WARNING: 100°C)',
        patch: { 10: 95 },
    },
    {
        delay: 2500,
        msg: '⚠  Sep Temp em WARNING → 108°C  [hi = 100°C]',
        patch: { 10: 108 },
    },
    {
        delay: 2500,
        msg: '🔴 Sep Temp em ALARM → 120°C  [hi-hi = 115°C]',
        patch: { 10: 120 },
    },
    {
        delay: 3000,
        msg: '↩  Separador normalizado. Iniciando rampa no Stripper...',
        patch: { 10: 80.1 },
    },

    // — Stripper —
    {
        delay: 2000,
        msg: '⬆  Stripper Temp subindo → 78°C  (limite WARNING: 80°C)',
        patch: { 17: 78 },
    },
    {
        delay: 2500,
        msg: '⚠  Stripper Temp em WARNING → 84°C  [hi = 80°C]',
        patch: { 17: 84 },
    },
    {
        delay: 2500,
        msg: '🔴 Stripper Temp em ALARM → 93°C  [hi-hi = 90°C]',
        patch: { 17: 93 },
    },
    {
        delay: 3000,
        msg: '↩  Stripper normalizado.',
        patch: { 17: 65.7 },
    },

    // — Fim —
    {
        delay: 1500,
        msg: '✅ Demo concluído. Todos os vasos em estado normal (cinza).',
        patch: {},
        final: true,
    },
];

// ── Log panel ────────────────────────────────────────────────────────────────

function _demoLog(msg) {
    const log = document.getElementById('demo-log');
    if (!log) return;
    const now = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const line = document.createElement('div');
    line.className = 'demo-log-line';
    line.textContent = `[${now}]  ${msg}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}

// ── Controle ─────────────────────────────────────────────────────────────────

function startDemo() {
    if (window._demoActive) return;
    window._demoActive = true;
    _demoStepIndex = 0;
    _demoCurrent = { xmeas: _nominalXmeas(), xmv: _nominalXmv() };

    const panel = document.getElementById('demo-panel');
    if (panel) panel.hidden = false;

    const log = document.getElementById('demo-log');
    if (log) log.innerHTML = '';

    const btn = document.getElementById('btn-demo');
    if (btn) { btn.textContent = '⏹ Demo'; btn.classList.add('demo-btn-active'); }

    _demoLog('━━━  DEMO MODE  ━━━  planta desconectada da tela');
    _runDemoStep();
}

function stopDemo() {
    window._demoActive = false;
    if (_demoTimerId) { clearTimeout(_demoTimerId); _demoTimerId = null; }

    const btn = document.getElementById('btn-demo');
    if (btn) { btn.textContent = '▶ Demo'; btn.classList.remove('demo-btn-active'); }

    _demoLog('⏹  Demo encerrado.');
}

function _runDemoStep() {
    if (!window._demoActive) return;
    const step = DEMO_STEPS[_demoStepIndex];
    if (!step) { stopDemo(); return; }

    _demoTimerId = setTimeout(() => {
        if (!window._demoActive) return;

        // Aplica overrides parciais no estado atual
        Object.entries(step.patch).forEach(([idx, val]) => {
            _demoCurrent.xmeas[parseInt(idx)] = val;
        });

        _demoLog(step.msg);

        if (typeof updateDiagram === 'function') {
            updateDiagram([..._demoCurrent.xmeas], [..._demoCurrent.xmv]);
        }

        if (step.final) {
            setTimeout(stopDemo, 2000);
            return;
        }

        _demoStepIndex++;
        _runDemoStep();
    }, step.delay);
}
