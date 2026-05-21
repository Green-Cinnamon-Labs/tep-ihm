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

function initDiagramInteraction() {
    const container = document.getElementById('diagram-container');
    const svg = container ? container.querySelector('svg') : null;
    if (!svg || !container) return;

    const bgRect = svg.querySelector('rect.background');
    if (bgRect) bgRect.setAttribute('fill', '#1e4d7f');

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

// ── Temperature-based vessel coloring ────────────────────────────────────────
// Usa data-cell-id (draw.io), não getElementById.

function colorizeVessel(vesselId, tempC) {
    const vessel = document.querySelector(`[data-cell-id="${vesselId}"]`);
    if (!vessel) return;
    const color = tempC < 100 ? '#4fc3f7' : tempC < 150 ? '#ffb74d' : '#ef5350';
    vessel.querySelectorAll('path, ellipse, rect').forEach(el => {
        el.style.fill = color;
        el.style.fillOpacity = '0.4';
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
    'analyzer-06-feed':    { xmeas_start: 23, xmeas_end: 28, side: 'left'  },
    'analyzer-09-purge':   { xmeas_start: 29, xmeas_end: 36, side: 'right' },
    'analyzer-11-product': { xmeas_start: 37, xmeas_end: 41, side: 'right' },
};

function _screenToSVG(svg, screenX, screenY) {
    const sr = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return {
        x: (screenX - sr.left) / sr.width  * vb.width,
        y: (screenY - sr.top)  / sr.height * vb.height,
    };
}

function getOrCreateAnalyzerText(sensorId, side) {
    const existingId = `val-${sensorId}`;
    let textEl = document.getElementById(existingId);
    if (textEl) return textEl;

    const wrapper = getSemanticElement(sensorId);
    if (!wrapper) return null;

    const svg = document.querySelector('#diagram-container svg');
    if (!svg || !svg.viewBox.baseVal.width) return null;

    const er = wrapper.getBoundingClientRect();
    if (!er.width) return null;   // ainda não renderizado

    const midY  = er.top  + er.height / 2;
    const left  = _screenToSVG(svg, er.left,  midY);
    const right = _screenToSVG(svg, er.right, midY);

    textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textEl.setAttribute('id', existingId);
    textEl.setAttribute('y', left.y + 4);
    textEl.setAttribute('font-size', '9');
    textEl.setAttribute('font-family', 'Consolas, monospace');
    textEl.setAttribute('fill', '#00e5ff');
    textEl.setAttribute('pointer-events', 'none');

    if (side === 'left') {
        textEl.setAttribute('x', left.x - 2);
        textEl.setAttribute('text-anchor', 'end');
    } else {
        textEl.setAttribute('x', right.x + 2);
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
    colorizeVessel('unit-compressor-1',    xmeas[8]);   // proxy: sem sensor direto
    colorizeVessel('unit-compressor-2',    xmeas[8]);
    colorizeVessel('unit-compressor-3',    xmeas[8]);

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
