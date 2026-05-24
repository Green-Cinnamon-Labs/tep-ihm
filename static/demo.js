/*
 * TEP Demo Mode
 * Registry de demonstrações visuais ISA-101 (sem planta conectada).
 * Exporta window._demoActive para app.js suprimir updateDiagram/updateAlarms do WebSocket.
 */

window._demoActive = false;

let _demoTimerId   = null;
let _demoStepIndex = 0;
let _demoCurrent   = null;
let _demoSteps     = [];

let _flowHighlightStreams   = [];
let _flowHighlightActuators = [];
let _flowHighlightUnits     = [];

// ── Valores nominais TEP ──────────────────────────────────────────────────────

function _nominalXmeas() {
    return [
        0.25, 3600, 4600, 9.35, 26.9, 42.3,
        2705, 75.0, 122.9, 0.34, 80.1, 50.0,
        2633, 25.2, 50.0, 3102, 23.0, 65.7,
        230.3, 341.4, 31.8, 13.8,
        30.0, 10.0, 25.0, 7.0, 18.0, 2.0, 5.0, 3.0,
        10.0, 20.0, 15.0, 35.0, 20.0,
        45.0, 5.0, 35.0, 5.0, 8.0, 2.0,
    ];
}

function _nominalXmv() {
    return [63.1, 53.4, 24.6, 61.3, 22.2, 40.1, 38.1, 46.5, 47.3, 41.1, 18.1, 50.0];
}

// ── Log ───────────────────────────────────────────────────────────────────────

function _demoLog(msg, level) {
    if (typeof _consoleLog === 'function') _consoleLog(msg, level || 'LOG');
}

// ── Demo 1: Tour pelos alarmes ────────────────────────────────────────────────
// Cada elemento do diagrama mostra sev-3 (advisory) → sev-2 (warning) → sev-1 (alarm).
// Antes de cada elemento, o console exibe o contexto TEP da variável.

const _TOUR_ELEMENTS = [
    {
        element: 'unit-compressor-3',
        label:   'Compressor',
        tep:     'XMEAS(20) — Trabalho do compressor de reciclo [kW]. Nominal ~341 kW. ' +
                 'Reflete carga do loop de reciclo. Excesso indica restrição ou sobrecarga. Hi: 400 kW · Hi-Hi: 450 kW.',
    },
    {
        element: 'sensor-xmeas-09',
        label:   'Reactor Temperature (TI)',
        tep:     'XMEAS(9) — Temperatura do reator CSTR [°C]. Nominal ~122.9°C. ' +
                 'Controlada por água de resfriamento (CW). Reação exotérmica: aumento indica perda de controle térmico. Hi: 150°C · Hi-Hi: 165°C.',
    },
    {
        element: 'sensor-xmeas-07',
        label:   'Reactor Pressure (PI)',
        tep:     'XMEAS(7) — Pressão do reator [kPa]. Nominal ~2705 kPa. ' +
                 'Controlada pela purga (stream 9) e pelo compressor. Excesso pode indicar acúmulo de inertes.',
    },
    {
        element: 'sensor-xmeas-08',
        label:   'Reactor Level (LI)',
        tep:     'XMEAS(8) — Nível do reator [%]. Nominal ~75%. ' +
                'Não há pareamento canônico direto com uma válvula de nível no artigo. ' +
                'É uma variável crítica monitorada por limites operacionais/shutdown; varia indiretamente com feeds, reciclo, pressão, temperatura e dinâmica de reação.'
    },
    {
        element: 'sensor-xmeas-11',
        label:   'Separator Temperature (TI)',
        tep:     'XMEAS(11) — Temperatura do separador vapor-líquido [°C]. Nominal ~80°C. ' +
                 'Alta temperatura indica condensação insuficiente ou excesso de calor no reciclo. Hi: 100°C · Hi-Hi: 115°C.',
    },
    {
        element: 'sensor-xmeas-12',
        label:   'Separator Level (LI)',
        tep:     'XMEAS(12) — Nível do separador [%]. Nominal ~50%. ' +
                'Controlado principalmente pela saída líquida do separador para o stripper (XMV(7), stream 10). ' +
                'Nível alto indica acúmulo/inundação; nível baixo pode indicar esvaziamento do vaso e risco de arraste/intermitência.'
    },
    {
        element: 'sensor-xmeas-22',
        label:   'Condenser Temperature (TI)',
        tep:     'XMEAS(22) — Temperatura de saída da água de resfriamento do condensador [°C]. Nominal ~77.3°C. ' +
                'O condensador remove calor do vapor vindo do reator antes do separador. ' +
                'Temperatura alta na saída da água indica maior carga térmica ou menor capacidade de resfriamento, podendo reduzir a condensação e afetar o separador.'
    },
    {
        element: 'sensor-xmeas-18',
        label:   'Stripper Temperature (TI)',
        tep:     'XMEAS(18) — Temperatura do stripper [°C]. Nominal ~65.7°C. ' +
                 'Coluna de stripping que remove produtos leves do líquido. Aquecida pelo boiler (steam). Hi: 80°C · Hi-Hi: 90°C.',
    },
    {
        element: 'sensor-xmeas-15',
        label:   'Stripper Level (LI)',
        tep:     'XMEAS(15) — Nível do stripper [%]. Nominal ~50%. ' +
                'Controlado principalmente pela saída de produto líquido do stripper (XMV(8), stream 11). ' +
                'Desvio indica desbalanço de massa na coluna; nível alto sugere acúmulo, nível baixo sugere esvaziamento do fundo.'
    },
];

function _buildAlarmTourSteps() {
    const SEV = [
        { severity: 'advisory', icon: '🔸', label: 'Advisory  (sev-3 — desvio leve)'    },
        { severity: 'warning',  icon: '⚠️',  label: 'Warning   (sev-2 — limite operacional)' },
        { severity: 'alarm',    icon: '🔴', label: 'Alarm     (sev-1 — limite de shutdown)'  },
    ];

    const steps = [{
        delay: 0,
        msg: '▶  Tour pelos alarmes ISA-101 — 10 elementos × 3 severidades',
        patch: {}, directAlarms: [],
    }];

    _TOUR_ELEMENTS.forEach(({ element, label, tep }) => {
        // Contexto TEP antes de iniciar o elemento
        steps.push({
            delay: 800,
            msg: `━━ ${label.toUpperCase()} ━━`,
            patch: {}, directAlarms: [], _info: true,
        });
        steps.push({
            delay: 200,
            msg: tep,
            patch: {}, directAlarms: [], _info: true,
        });

        SEV.forEach(({ severity, icon, label: sevLabel }) => {
            steps.push({
                delay: 3500,
                msg: `${icon}  ${label}  →  ${sevLabel}`,
                patch: {},
                directAlarms: [{ element, severity, active: true }],
            });
        });

        steps.push({
            delay: 2000,
            msg: `✓  ${label} — normalizado`,
            patch: {}, directAlarms: [],
        });
    });

    steps.push({
        delay: 1500,
        msg: '✅ Tour concluído — todos os elementos visitados.',
        patch: {}, directAlarms: [], final: true,
    });

    return steps;
}

// ── Flow Path Tour — helpers ──────────────────────────────────────────────────

function setDemoStreamIntensity(prefix, t) {
    const w      = (1.5 + t * 6).toFixed(2);
    const light  = Math.round(45 + t * 45);       // 45% (dim) → 90% (bright)
    const stroke = `hsl(210, 55%, ${light}%)`;
    const opacity = (0.15 + t * 0.85).toFixed(2);
    document.querySelectorAll(`[data-cell-id^="${prefix}"]`).forEach(seg => {
        const path = seg.querySelector('path');
        if (!path) return;
        path.setAttribute('stroke-width', w);
        path.style.stroke  = stroke;
        path.style.opacity = opacity;
    });
}

function setDemoActuatorOpening(id, opening) {
    if (typeof updateActuator === 'function') updateActuator(id, opening);
}

function highlightDemoUnit(id, active) {
    const el = document.querySelector(`[data-cell-id="${id}"]`);
    if (!el) return;
    el.querySelectorAll('path, ellipse, rect').forEach(shape => {
        shape.style.fill        = active ? 'hsl(210, 50%, 42%)' : '#6F767D';
        shape.style.fillOpacity = active ? '0.45' : '0.20';
    });
}

function clearDemoFlowHighlights() {
    // Reseta streams que podem não estar no updateDiagram padrão (stream-05, stream-08.1, stream-15)
    _flowHighlightStreams.forEach(prefix => setDemoStreamIntensity(prefix, 0));
    // Reseta atuadores para abertura neutra (50%)
    _flowHighlightActuators.forEach(id => setDemoActuatorOpening(id, 50));
    _flowHighlightUnits.forEach(id => highlightDemoUnit(id, false));
    _flowHighlightStreams    = [];
    _flowHighlightActuators = [];
    _flowHighlightUnits     = [];
}

function applyDemoFlowHighlight({ streams = [], actuators = [], units = [], flowLevel = 1, valveOpening = 100, clear = false }) {
    if (clear) clearDemoFlowHighlights();
    _flowHighlightStreams    = streams;
    _flowHighlightActuators = actuators;
    _flowHighlightUnits     = units;
    streams.forEach(prefix => setDemoStreamIntensity(prefix, flowLevel));
    actuators.forEach(id   => setDemoActuatorOpening(id, valveOpening));
    units.forEach(id       => highlightDemoUnit(id, true));
}

function _flowRamp(streams, actuators, units) {
    return [0, 0.25, 0.5, 0.75, 1.0].map((t, i) => ({
        delay:     i === 0 ? 650 : 450,
        msg:       null,
        patch:     {},
        highlight: { streams, actuators, units, flowLevel: t, valveOpening: Math.round(t * 100) },
        _ramp:     true,
    }));
}

function _flowGroup(header, detail, streams, actuators, units) {
    return [
        { delay: 1300, msg: `━━ ${header} ━━`, patch: {}, highlight: { streams, actuators, units, flowLevel: 0, valveOpening: 0, clear: true }, _info: true },
        { delay: 500,  msg: detail,            patch: {}, highlight: { streams, actuators, units, flowLevel: 0, valveOpening: 0 }, _ramp: true, _info: true },
        ..._flowRamp(streams, actuators, units),
        { delay: 2800, msg: null, patch: {}, highlight: { streams, actuators, units, flowLevel: 1, valveOpening: 100 }, _ramp: true },
    ];
}

// ── Flow Path Tour — steps ────────────────────────────────────────────────────

function _buildFlowPathTourSteps() {
    const steps = [
        { delay: 0, msg: '▶  Tour pelos caminhos de fluxo — 7 grupos · feeds → reator → separação → reciclo → produto → utilidades', patch: {}, highlight: { streams: [], actuators: [], units: [], flowLevel: 0, clear: true }, _info: true },
    ];

    steps.push(..._flowGroup(
        'FEEDS DE MATÉRIA-PRIMA',
        'A (XMV-3), D (XMV-1), E (XMV-2), A/C (XMV-4) entram no Feed Mixer.',
        ['stream-01-', 'stream-02-', 'stream-03-', 'stream-04-'],
        ['actuator-xmv-01', 'actuator-xmv-02', 'actuator-xmv-03', 'actuator-xmv-04'],
        ['node-reactor-feed-mixer'],
    ));

    steps.push(..._flowGroup(
        'ALIMENTAÇÃO DO REATOR',
        'Fluxo total do mixer + reciclo do stripper → reator CSTR.',
        ['stream-05-', 'stream-06-'],
        [],
        ['unit-reactor'],
    ));

    steps.push(..._flowGroup(
        'PRODUTO DO REATOR',
        'Efluente do reator → condensador → separador vapor/líquido.',
        ['stream-07-'],
        [],
        ['unit-condenser', 'unit-separator'],
    ));

    steps.push(..._flowGroup(
        'RECICLO DE VAPOR',
        'Vapor do separador → compressores → reciclo ao reator. XMV-5: bypass do compressor.',
        ['stream-08-', 'stream-08.1-'],
        ['actuator-xmv-05'],
        ['unit-compressor-1', 'unit-compressor-2', 'unit-compressor-3'],
    ));

    steps.push(..._flowGroup(
        'PURGA',
        'XMV-6 remove inertes acumulados no loop de reciclo — sem purga, o sistema fica saturado.',
        ['stream-09-'],
        ['actuator-xmv-06'],
        [],
    ));

    steps.push(..._flowGroup(
        'CAMINHO LÍQUIDO — PRODUTO FINAL',
        'Separador underflow (XMV-7) → stripper → produto final (XMV-8).',
        ['stream-10-', 'stream-11-'],
        ['actuator-xmv-07', 'actuator-xmv-08'],
        ['unit-stripper'],
    ));

    steps.push(..._flowGroup(
        'ÁGUA DE RESFRIAMENTO (CWS)',
        'CWS reator (XMV-10) e condensador (XMV-11) — retirada de calor nos dois equipamentos.',
        ['stream-12-', 'stream-13-'],
        ['actuator-xmv-10', 'actuator-xmv-11'],
        [],
    ));

    steps.push(..._flowGroup(
        'VAPOR — REBOILER DO STRIPPER',
        'XMV-9 fornece vapor ao reboiler do stripper para controlar a temperatura da coluna.',
        ['stream-14-', 'stream-15-'],
        ['actuator-xmv-09'],
        ['unit-stripper-boiler'],
    ));

    steps.push({ delay: 1500, msg: '✅ Tour concluído — todos os caminhos de fluxo visitados.', patch: {}, highlight: { streams: [], actuators: [], units: [], flowLevel: 0, clear: true }, final: true, _info: true });
    return steps;
}

// ── Registry de demos ─────────────────────────────────────────────────────────

const DEMO_REGISTRY = [
    {
        id:    'alarm-tour',
        label: '🔔 Tour pelos alarmes',
        desc:  'Visita todos os elementos do diagrama exibindo as 3 severidades ISA-101.',
        build: _buildAlarmTourSteps,
    },
    {
        id:    'flow-path-tour',
        label: '🌊 Tour pelos fluxos',
        desc:  '7 grupos de fluxo: feeds → reator → separação → reciclo → purga → produto → utilidades.',
        build: _buildFlowPathTourSteps,
    },
];

// ── Dropdown ──────────────────────────────────────────────────────────────────

function toggleDemoDropdown() {
    if (window._demoActive) { stopDemo(); return; }
    const dd  = document.getElementById('demo-dropdown');
    const btn = document.getElementById('btn-demo');
    if (!dd) return;

    if (!dd.hidden) { dd.hidden = true; return; }

    // Renderiza itens
    dd.innerHTML = DEMO_REGISTRY.map(d =>
        `<div class="demo-dd-item" onclick="startDemoById('${d.id}')">
            <span class="demo-dd-label">${d.label}</span>
            <span class="demo-dd-desc">${d.desc}</span>
        </div>`
    ).join('');

    dd.hidden = false;

    // Fecha ao clicar fora
    setTimeout(() => {
        document.addEventListener('mousedown', function _close(e) {
            if (!dd.contains(e.target) && e.target !== btn) {
                dd.hidden = true;
                document.removeEventListener('mousedown', _close);
            }
        });
    }, 0);
}

function startDemoById(id) {
    const dd = document.getElementById('demo-dropdown');
    if (dd) dd.hidden = true;

    const entry = DEMO_REGISTRY.find(d => d.id === id);
    if (!entry) return;

    if (window._demoActive) stopDemo();

    window._demoActive = true;
    _demoStepIndex = 0;
    _demoSteps     = entry.build();
    _demoCurrent   = { xmeas: _nominalXmeas(), xmv: _nominalXmv() };

    const btn = document.getElementById('btn-demo');
    if (btn) { btn.textContent = '⏹ Demo ▾'; btn.classList.add('panel-btn-open'); }

    _demoLog(`━━━  DEMO: ${entry.label}  ━━━`, 'INF');
    _runDemoStep();
}

function stopDemo() {
    window._demoActive = false;
    if (_demoTimerId) { clearTimeout(_demoTimerId); _demoTimerId = null; }
    _demoSteps = [];

    clearDemoFlowHighlights();
    if (typeof updateAlarms === 'function') updateAlarms([]);

    const btn = document.getElementById('btn-demo');
    if (btn) { btn.textContent = '▶ Demo ▾'; btn.classList.remove('panel-btn-open'); }

    _demoLog('⏹  Demo encerrado.');
}

function _runDemoStep() {
    if (!window._demoActive) return;
    const step = _demoSteps[_demoStepIndex];
    if (!step) { stopDemo(); return; }

    _demoTimerId = setTimeout(() => {
        if (!window._demoActive) return;

        Object.entries(step.patch || {}).forEach(([idx, val]) => {
            _demoCurrent.xmeas[parseInt(idx)] = val;
        });

        if (step.msg) {
            const level = step._info ? 'INF' : 'LOG';
            _demoLog(step.msg, level);
        }

        if (!step._ramp && typeof updateDiagram === 'function') {
            updateDiagram([..._demoCurrent.xmeas], [..._demoCurrent.xmv]);
        }

        if (step.highlight !== undefined) {
            applyDemoFlowHighlight(step.highlight);
        } else if (typeof updateAlarms === 'function') {
            updateAlarms(step.directAlarms !== undefined
                ? step.directAlarms
                : _deriveDemoAlarms(_demoCurrent.xmeas));
        }

        if (step.final) { setTimeout(stopDemo, 1500); return; }

        _demoStepIndex++;
        _runDemoStep();
    }, step.delay);
}

function _deriveDemoAlarms(x) {
    return [
        { variable: 'Reactor High Pressure',     active: x[6]  > 2800 },
        { variable: 'Reactor High Level',         active: x[7]  > 90   },
        { variable: 'Reactor Low Level',          active: x[7]  < 10   },
        { variable: 'Separator High Level',       active: x[11] > 90   },
        { variable: 'Separator Low Level',        active: x[11] < 10   },
        { variable: 'Stripper High Level',        active: x[14] > 90   },
        { variable: 'Stripper Low Level',         active: x[14] < 10   },
        { variable: 'Stripper High Underflow',    active: false         },
        { variable: 'Reactor High Temperature',   active: x[8]  > 150  },
        { variable: 'Separator High Temperature', active: x[10] > 100  },
        { variable: 'Stripper High Temperature',  active: x[17] > 80   },
        { variable: 'Compressor High Work',       active: x[19] > 400  },
    ];
}
