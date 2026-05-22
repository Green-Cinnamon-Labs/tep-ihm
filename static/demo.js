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
        element: 'unit-compressor-1',
        label:   'Compressor',
        tep:     'XMEAS(20) — Trabalho do compressor de reciclo [kW]. Nominal ~341 kW. ' +
                 'Reflete carga do loop de reciclo. Excesso indica restrição ou sobrecarga. Hi: 400 kW · Hi-Hi: 450 kW.',
    },
    {
        element: 'unit-reactor',
        label:   'Reactor',
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
                 'Controlado pela vazão de produto (XMV 10). Nível alto = reator cheio; baixo = cavitação do agitador.',
    },
    {
        element: 'unit-separator',
        label:   'Separator',
        tep:     'XMEAS(11) — Temperatura do separador vapor-líquido [°C]. Nominal ~80°C. ' +
                 'Alta temperatura indica condensação insuficiente ou excesso de calor no reciclo. Hi: 100°C · Hi-Hi: 115°C.',
    },
    {
        element: 'sensor-xmeas-12',
        label:   'Separator Level (LI)',
        tep:     'XMEAS(12) — Nível do separador [%]. Nominal ~50%. ' +
                 'Controlado pela válvula de saída de líquido (XMV 11). Nível alto = inundação; baixo = arrastamento de líquido.',
    },
    {
        element: 'unit-condenser',
        label:   'Condenser',
        tep:     'XMEAS(22) — Temperatura de saída do condensador [°C]. Nominal ~13.8°C. ' +
                 'Resfria o vapor do reator. Alta temperatura reduz eficiência de separação. Hi: 55°C · Hi-Hi: 65°C.',
    },
    {
        element: 'unit-stripper',
        label:   'Stripper',
        tep:     'XMEAS(18) — Temperatura do stripper [°C]. Nominal ~65.7°C. ' +
                 'Coluna de stripping que remove produtos leves do líquido. Aquecida pelo boiler (steam). Hi: 80°C · Hi-Hi: 90°C.',
    },
    {
        element: 'sensor-xmeas-15',
        label:   'Stripper Level (LI)',
        tep:     'XMEAS(15) — Nível do stripper [%]. Nominal ~50%. ' +
                 'Controlado pela válvula de saída de produto (XMV 12). Desvio indica desbalanço de massa na coluna.',
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

// ── Registry de demos ─────────────────────────────────────────────────────────

const DEMO_REGISTRY = [
    {
        id:    'alarm-tour',
        label: '🔔 Tour pelos alarmes',
        desc:  'Visita todos os elementos do diagrama exibindo as 3 severidades ISA-101.',
        build: _buildAlarmTourSteps,
    },
    // Novas demos podem ser adicionadas aqui
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

        const level = step._info ? 'INF' : 'LOG';
        _demoLog(step.msg, level);

        if (typeof updateDiagram === 'function') {
            updateDiagram([..._demoCurrent.xmeas], [..._demoCurrent.xmv]);
        }

        if (typeof updateAlarms === 'function') {
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
