/*
 * Diagram Animator — Atualiza SVG plant-diagram em tempo real
 * O SVG é carregado inline no HTML via fetch('/static/plant-diagram.svg')
 *
 * Endereçamento: data-cell-id (draw.io), não id.
 * Primitivas de seleção: diagram-adapter.js (deve ser carregado antes deste arquivo).
 */

// ── SVG Zoom & Pan ───────────────────────────────────────────────────────────

let _zoom = 1;
let _panX = 0;
let _panY = 0;
let _isPanning = false;
let _panStartX = 0;
let _panStartY = 0;

// ── Blue-gray ISA theme ───────────────────────────────────────────────────────
// O draw.io moderno exporta cores em style="fill: rgb(...);" e usa light-dark()
// para adaptação dark/light mode. Em tema claro: light-dark(#000,#fff) → PRETO.
// Esta função resolve tudo via manipulação do atributo style.

const _RGB_REMAP = {
    'rgb(0, 0, 0)':       'rgb(46, 69, 112)',
    'rgb(255, 255, 255)': 'rgb(232, 240, 248)',
    'rgb(245, 245, 245)': 'rgb(216, 230, 242)',
    'rgb(218, 232, 252)': 'rgb(192, 212, 236)',
    'rgb(213, 232, 212)': 'rgb(192, 212, 236)',
    'rgb(225, 213, 231)': 'rgb(200, 212, 232)',
    'rgb(248, 206, 204)': 'rgb(200, 212, 232)',
    'rgb(255, 242, 204)': 'rgb(216, 230, 242)',
    'rgb(108, 142, 191)': 'rgb(74, 111, 175)',
    'rgb(130, 179, 102)': 'rgb(74, 104, 136)',
    'rgb(150, 115, 166)': 'rgb(74, 104, 136)',
    'rgb(184, 84, 80)':   'rgb(74, 104, 136)',
    'rgb(214, 182, 86)':  'rgb(104, 136, 160)',
    'rgb(102, 102, 102)': 'rgb(74, 104, 136)',
    'rgb(153, 153, 153)': 'rgb(104, 136, 160)',
};

/*
 * light-dark(valor-claro, valor-escuro) — o draw.io usa o PRIMEIRO valor para tema claro.
 *
 * Duas situações:
 *   darkIsFirst = true  → light-dark(#000, #fff) — elemento é PRETO em tema claro
 *                          → arrow-heads, connectors, stream lines
 *   darkIsFirst = false → light-dark(#fff, dark)  — elemento é BRANCO em tema claro
 *                          → instrument circles (fill), valve bodies
 *
 * Lógica correta por propriedade:
 *   fill/background-color + darkIsFirst  → azul-cinza médio (arrow, connector)
 *   fill/background-color + !darkIsFirst → branco (circle body, valve body)
 *   stroke + darkIsFirst                 → azul-cinza (border escuro)
 *   stroke + !darkIsFirst                → azul-cinza (border claro → uniformizar)
 *   color                                → sempre escuro (texto legível)
 */
function _resolveStyleProp(propName, value) {
    if (value.includes('light-dark(')) {
        const darkIsFirst = value.includes('#000000') || value.includes('rgb(0, 0, 0)') || /light-dark\(\s*black\b/.test(value);

        if (propName === 'fill' || propName === 'background-color') {
            return darkIsFirst
                ? '#607898'   // era preto → azul-cinza médio (setas, conectores)
                : '#FFFFFF';  // era branco → manter branco (círculos, válvulas)
        }
        if (propName === 'stroke') {
            return '#4A6888'; // todas as bordas → azul médio uniforme
        }
        // color (texto CSS): sempre escuro para legibilidade
        return '#1F252A';
    }

    // Remap rgb() direto (sem light-dark)
    for (const [from, to] of Object.entries(_RGB_REMAP)) {
        if (value.includes(from)) value = value.replaceAll(from, to);
    }
    return value;
}

function _applyBlueGrayTheme(svg) {
    // 1. Remapeia style="fill:...; stroke:...;" (principal mecanismo do draw.io moderno)
    svg.querySelectorAll('[style]').forEach(el => {
        const raw = el.getAttribute('style');
        if (!raw) return;
        const remapped = raw.split(';').map(prop => {
            const trimmed = prop.trim();
            if (!trimmed) return prop;
            const colon = trimmed.indexOf(':');
            if (colon === -1) return prop;
            const key = trimmed.slice(0, colon).trim();
            const val = trimmed.slice(colon + 1).trim();
            if (key === 'fill' || key === 'stroke' || key === 'color' || key === 'background-color') {
                return `${key}: ${_resolveStyleProp(key, val)}`;
            }
            return prop;
        }).join('; ');
        el.setAttribute('style', remapped);
    });

    // 2. Presentation attributes fill="..." stroke="..." (draw.io legado)
    const ATTR_FILL = {
        '#000000': '#2E4570', '#ffffff': '#E8F0F8', '#f5f5f5': '#D8E6F2',
        '#dae8fc': '#C0D4EC', '#d5e8d4': '#C0D4EC', '#e1d5e7': '#C8D4E8',
        '#f8cecc': '#C8D4E8', '#fff2cc': '#D8E6F2',
    };
    const ATTR_STROKE = {
        '#000000': '#2E4570', '#666666': '#4A6888', '#999999': '#6888A0',
        '#6c8ebf': '#4A6FAF', '#82b366': '#4A6888', '#9673a6': '#4A6888',
        '#b85450': '#4A6888', '#d6b656': '#6888A0',
    };
    svg.querySelectorAll('[fill]').forEach(el => {
        const f = (el.getAttribute('fill') || '').toLowerCase();
        if (ATTR_FILL[f]) el.setAttribute('fill', ATTR_FILL[f]);
    });
    svg.querySelectorAll('[stroke]').forEach(el => {
        const s = (el.getAttribute('stroke') || '').toLowerCase();
        if (ATTR_STROKE[s]) el.setAttribute('stroke', ATTR_STROKE[s]);
    });
}

function initDiagramInteraction() {
    const container = document.getElementById('diagram-container');
    const svg = container ? container.querySelector('svg') : null;
    if (!svg || !container) return;

    // Permite texto fora do viewBox (ex: labels de analisadores na borda direita)
    svg.setAttribute('overflow', 'visible');

    const bgRect = svg.querySelector('rect.background');
    if (bgRect) bgRect.style.fill = 'var(--hmi-bg)';

    _applyBlueGrayTheme(svg);

    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        _zoom += e.deltaY > 0 ? -0.1 : 0.1;
        _zoom = Math.max(0.5, Math.min(3, _zoom));
        svg.style.transform = `scale(${_zoom}) translate(${_panX}px, ${_panY}px)`;
    }, { passive: false });

    container.addEventListener('mousedown', (e) => {
        if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
            _isPanning = true;
            _panStartX = e.clientX - _panX;
            _panStartY = e.clientY - _panY;
            container.classList.add('panning');
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!_isPanning) return;
        _panX = e.clientX - _panStartX;
        _panY = e.clientY - _panStartY;
        svg.style.transform = `scale(${_zoom}) translate(${_panX}px, ${_panY}px)`;
    });

    document.addEventListener('mouseup', () => {
        _isPanning = false;
        container.classList.remove('panning');
    });

    container.addEventListener('dblclick', () => {
        _zoom = 1; _panX = 0; _panY = 0;
        svg.style.transform = 'scale(1) translate(0, 0)';
    });

    console.log('[diagram] Interaction initialized (zoom: wheel, pan: Ctrl+drag or middle-click)');
}

// ── Vessel alarm state coloring (ISA-101 §7) ─────────────────────────────────
// Normal = cinza neutro. Cor apenas em condição anormal (warning / alarm).
// Gradiente contínuo por temperatura é decorativo e viola ISA-101.

const VESSEL_ALARM_LIMITS = {
    'unit-reactor':         { hi: 150, hi_hi: 165 },
    'unit-separator':       { hi: 100, hi_hi: 115 },
    'unit-stripper':        { hi: 80,  hi_hi: 90  },
    'unit-condenser':       { hi: 55,  hi_hi: 65  },
    'unit-stripper-boiler': { hi: 80,  hi_hi: 90  },
    // Compressores: limite baseado em trabalho (XMEAS 20, kW). Nominal ~340–360 kW.
    'unit-compressor-1':    { hi: 400, hi_hi: 450 },
    'unit-compressor-2':    { hi: 400, hi_hi: 450 },
    'unit-compressor-3':    { hi: 400, hi_hi: 450 },
};

function colorizeVessel(vesselId, tempC) {
    const vessel = document.querySelector(`[data-cell-id="${vesselId}"]`);
    if (!vessel) return;
    const { hi = 150, hi_hi = 175 } = VESSEL_ALARM_LIMITS[vesselId] || {};
    const color   = tempC > hi_hi ? '#B00020'  // --hmi-alarm
                  : tempC > hi    ? '#B7791F'  // --hmi-warning
                  :                 '#6F767D'; // --hmi-line (normal)
    const opacity = tempC > hi    ? '0.55' : '0.20';
    vessel.querySelectorAll('path, ellipse, rect').forEach(el => {
        el.style.fill        = color;
        el.style.fillOpacity = opacity;
    });
}

// ── Stream flow visualization (stroke-width) ─────────────────────────────────
// Usa data-cell-id (draw.io), não getElementById.

function scaleStreamWidth(flowValue, maxFlow = 60) {
    const normalized = Math.max(0, Math.min(1, flowValue / maxFlow));
    return 1.5 + normalized * 2.5;
}

function updateStreamWidth(streamId, flowValue, maxFlow = 60) {
    const stream = document.querySelector(`[data-cell-id="${streamId}"]`);
    if (!stream) return;
    const path = stream.querySelector('path');
    if (!path) return;
    path.setAttribute('stroke-width', scaleStreamWidth(flowValue, maxFlow).toFixed(2));
    path.style.opacity = flowValue < 0.5 ? '0.3' : '0.85';
}

// ── Sensor value display ──────────────────────────────────────────────────────
// Delega para getOrCreateValueText (diagram-adapter.js) que cria label flutuante.
// Draw.io não exporta .sensor-value como classe CSS — não confiar em querySelector de classe.

function updateSensorValue(sensorId, value, unit = '') {
    const textEl = getOrCreateValueText(sensorId);
    if (!textEl) return;
    textEl.textContent = `${value.toFixed(1)}${unit ? ' ' + unit : ''}`;
}

// ── Analyzer composition display ──────────────────────────────────────────────
// Mapeamento hardcoded porque o draw.io não exporta data-xmeas-range como atributo SVG.
// Índices são 0-based (XMEAS(23) = xmeas[22]).

// Cada analisador tem sensores individuais sensor-xmeas-NN no SVG.
// side: 'left'  → texto à esquerda do wrapper do sensor
//        'right' → texto à direita do wrapper do sensor
//
// Usa getBoundingClientRect() para posicionamento correto independente
// de transforms aninhados do draw.io — evita mismatch de coordenadas locais vs root SVG.
const ANALYZER_CONFIG = {
    'analyzer-06-feed':    { xmeas_start: 36, xmeas_end: 41, side: 'left'  },
    'analyzer-09-purge':   { xmeas_start: 23, xmeas_end: 30, side: 'right' },
    'analyzer-11-product': { xmeas_start: 31, xmeas_end: 35, side: 'right' },
};

function _screenToSVG(svg, screenX, screenY) {
    const pt = svg.createSVGPoint();
    pt.x = screenX;
    pt.y = screenY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function getOrCreateAnalyzerText(sensorId, side) {
    const existingId = `val-${sensorId}`;
    let textEl = document.getElementById(existingId);
    if (textEl) return textEl;

    const svg = document.querySelector('#diagram-container svg');
    if (!svg || !svg.viewBox.baseVal.width) return null;

    // Usa o drawable (ellipse real) em vez do wrapper <g> para evitar que a
    // bounding rect inclua a linha tracejada ou label interno do draw.io.
    const drawable = getDrawablePath(sensorId);
    if (!drawable) return null;

    const er = drawable.getBoundingClientRect();
    if (!er.width) return null;   // ainda não renderizado

    const midY  = er.top  + er.height / 2;
    const left  = _screenToSVG(svg, er.left,  midY);
    const right = _screenToSVG(svg, er.right, midY);

    textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textEl.setAttribute('id', existingId);
    textEl.setAttribute('y', left.y + 4);
    textEl.setAttribute('font-size', '9');
    textEl.setAttribute('font-family', 'Consolas, monospace');
    textEl.style.fill = 'var(--hmi-display)';
    textEl.setAttribute('pointer-events', 'none');

    if (side === 'left') {
        textEl.setAttribute('x', left.x - 20);
        textEl.setAttribute('text-anchor', 'end');
    } else {
        textEl.setAttribute('x', right.x + 20);
        textEl.setAttribute('text-anchor', 'start');
    }

    svg.appendChild(textEl);
    return textEl;
}

function updateAnalyzerDisplay(analyzerId, xmeasValues) {
    const cfg = ANALYZER_CONFIG[analyzerId];
    if (!cfg) return;
    for (let n = cfg.xmeas_start; n <= cfg.xmeas_end; n++) {
        const value = xmeasValues[n - 1];
        if (value == null) continue;
        const textEl = getOrCreateAnalyzerText(`sensor-xmeas-${n}`, cfg.side);
        if (textEl) textEl.textContent = `${value.toFixed(1)}%`;
    }
}

// ── Main update function ──────────────────────────────────────────────────────
// Chamado a cada WebSocket message com arrays xmeas[41] e xmv[12].
// Indexação: XMEAS(n) = xmeas[n-1], XMV(n) = xmv[n-1]

function updateDiagram(xmeas, xmv) {
    if (!xmeas || !xmv) return;

    // Vasos — colorização por temperatura
    colorizeVessel('unit-reactor',         xmeas[8]);   // XMEAS(9)  temperatura do reator
    colorizeVessel('unit-separator',       xmeas[10]);  // XMEAS(11) temperatura do separador
    colorizeVessel('unit-stripper',        xmeas[17]);  // XMEAS(18) temperatura do stripper
    colorizeVessel('unit-condenser',       xmeas[21]);  // XMEAS(22) saída CWS condensador
    colorizeVessel('unit-stripper-boiler', xmeas[17]);  // proxy: temperatura do stripper
    colorizeVessel('unit-compressor-1',    xmeas[19]);  // XMEAS(20) trabalho do compressor (kW)
    colorizeVessel('unit-compressor-2',    xmeas[19]);
    colorizeVessel('unit-compressor-3',    xmeas[19]);

    // Streams de processo — largura proporcional à vazão
    updateStreamWidth('stream-01-a-feed-down', xmeas[0]);     // XMEAS(1)  A feed
    updateStreamWidth('stream-02-d-feed-down', xmeas[1]);     // XMEAS(2)  D feed
    updateStreamWidth('stream-03-e-feed-down', xmeas[2]);     // XMEAS(3)  E feed
    updateStreamWidth('stream-04-c-feed-down', xmeas[3]);     // XMEAS(4)  A/C feed
    updateStreamWidth('stream-06-mixer-reactor', xmeas[5]);   // XMEAS(6)  reactor feed total
    updateStreamWidth('stream-08-down',          xmeas[4]);   // XMEAS(5)  reciclo
    updateStreamWidth('stream-09-purge',         xmeas[9]);   // XMEAS(10) purga
    updateStreamWidth('stream-10-in',            xmeas[13]);  // XMEAS(14) sep underflow
    updateStreamWidth('stream-11-product',       xmeas[16]);  // XMEAS(17) produto

    // Streams de utilidade
    updateStreamWidth('stream-cws-reactor-in',   xmeas[20], 200); // XMEAS(21) — escala diferente
    updateStreamWidth('stream-cws-condenser-in', xmeas[21], 200); // XMEAS(22)
    updateStreamWidth('stream-stm-boiler-in',    xmeas[18], 500); // XMEAS(19) kg/hr

    // Sensores XMEAS(1..22) — cria label flutuante via getOrCreateValueText
    updateSensorValue('sensor-xmeas-01', xmeas[0],  'kscmh');
    updateSensorValue('sensor-xmeas-02', xmeas[1],  'kg/hr');
    updateSensorValue('sensor-xmeas-03', xmeas[2],  'kg/hr');
    updateSensorValue('sensor-xmeas-04', xmeas[3],  'kscmh');
    updateSensorValue('sensor-xmeas-05', xmeas[4],  'kscmh');
    updateSensorValue('sensor-xmeas-06', xmeas[5],  'kscmh');
    updateSensorValue('sensor-xmeas-07', xmeas[6],  'kPa');
    updateSensorValue('sensor-xmeas-08', xmeas[7],  '%');
    updateSensorValue('sensor-xmeas-09', xmeas[8],  '°C');
    updateSensorValue('sensor-xmeas-10', xmeas[9],  'kscmh');
    updateSensorValue('sensor-xmeas-11', xmeas[10], '°C');
    updateSensorValue('sensor-xmeas-12', xmeas[11], '%');
    updateSensorValue('sensor-xmeas-13', xmeas[12], 'kPa');
    updateSensorValue('sensor-xmeas-14', xmeas[13], 'm³/hr');
    updateSensorValue('sensor-xmeas-15', xmeas[14], '%');
    updateSensorValue('sensor-xmeas-16', xmeas[15], 'kPa');
    updateSensorValue('sensor-xmeas-17', xmeas[16], 'm³/hr');
    updateSensorValue('sensor-xmeas-18', xmeas[17], '°C');
    updateSensorValue('sensor-xmeas-19', xmeas[18], 'kg/hr');
    updateSensorValue('sensor-xmeas-20', xmeas[19], 'kW');
    updateSensorValue('sensor-xmeas-21', xmeas[20], '°C');
    updateSensorValue('sensor-xmeas-22', xmeas[21], '°C');

    // Atuadores XMV(1..12) — usa updateActuator do diagram-adapter.js
    for (let i = 1; i <= 12; i++) {
        updateActuator(`actuator-xmv-${String(i).padStart(2, '0')}`, xmv[i - 1]);
    }

    // Analisadores de composição XMEAS(23..41)
    updateAnalyzerDisplay('analyzer-06-feed',    xmeas);
    updateAnalyzerDisplay('analyzer-09-purge',   xmeas);
    updateAnalyzerDisplay('analyzer-11-product', xmeas);
}

// ── Initialization ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('diagram-container');
    if (container) {
        try {
            const res = await fetch('/static/plant-diagram.svg');
            const svgText = await res.text();
            container.innerHTML = svgText;
            console.log('[diagram] SVG carregado de plant-diagram.svg');
        } catch (e) {
            console.error('[diagram] Falha ao carregar SVG:', e);
        }
    }
    initDiagramInteraction();
});
