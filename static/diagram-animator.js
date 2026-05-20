/*
 * Diagram Animator — Atualiza SVG plant-diagram em tempo real
 * O SVG é carregado inline no HTML
 */

// ── SVG Zoom & Pan ───────────────────────────────────────────────────────────

let _zoom = 1;
let _panX = 0;
let _panY = 0;
let _isPanning = false;
let _panStartX = 0;
let _panStartY = 0;

function initDiagramInteraction() {
    const svg = document.getElementById('tep-diagram');
    const container = document.getElementById('diagram-container');
    if (!svg || !container) return;

    // Change SVG background color to light blue
    const bgRect = svg.querySelector('rect.background');
    if (bgRect) bgRect.setAttribute('fill', '#1e4d7f');

    // Zoom with mouse wheel
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const oldZoom = _zoom;
        _zoom += e.deltaY > 0 ? -0.1 : 0.1;
        _zoom = Math.max(0.5, Math.min(3, _zoom)); // Clamp 0.5x to 3x
        svg.style.transform = `scale(${_zoom}) translate(${_panX}px, ${_panY}px)`;
    }, { passive: false });

    // Pan with middle mouse or Ctrl+Drag
    container.addEventListener('mousedown', (e) => {
        if (e.button === 1 || (e.button === 0 && e.ctrlKey)) { // middle button or Ctrl+left
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

    // Reset zoom/pan on double-click
    container.addEventListener('dblclick', () => {
        _zoom = 1;
        _panX = 0;
        _panY = 0;
        svg.style.transform = 'scale(1) translate(0, 0)';
    });

    console.log('[diagram] Interaction initialized (zoom: wheel, pan: Ctrl+drag or middle-click)');
}

// ── Temperature-based vessel coloring ────────────────────────────────────────
// XMEAS: 9=Reactor, 11=Separator, 18=Stripper
// Cold: < 100°C, Warm: 100–150°C, Hot: > 150°C

function colorizeVessel(vesselId, tempC) {
    const vessel = document.getElementById(vesselId);
    if (!vessel) return;

    const rect = vessel.querySelector('rect[class*="vessel"]');
    if (!rect) return;

    rect.classList.remove('vessel-cold', 'vessel-warm', 'vessel-hot');

    if (tempC < 100) {
        rect.classList.add('vessel-cold');
    } else if (tempC < 150) {
        rect.classList.add('vessel-warm');
    } else {
        rect.classList.add('vessel-hot');
    }
}

// ── Stream flow visualization (stroke-width) ────────────────────────────────
// Feeds e fluxos principais
// Range normalizado a 0-1, width escala de 1.5 a 4

function scaleStreamWidth(flowValue, maxFlow = 60) {
    const normalized = Math.max(0, Math.min(1, flowValue / maxFlow));
    return 1.5 + normalized * 2.5;
}

function updateStreamWidth(streamId, flowValue) {
    const stream = document.getElementById(streamId);
    if (!stream) return;

    const path = stream.querySelector('path');
    if (path) {
        path.setAttribute('stroke-width', scaleStreamWidth(flowValue).toFixed(2));
    }
}

// ── Sensor value inline updates ──────────────────────────────────────────────
// Sensores têm id="sensor-xmeas-NN" com <text class="sensor-value"> child

function updateSensorValue(sensorId, value, unit = '') {
    const sensor = document.getElementById(sensorId);
    if (!sensor) return;

    const textEl = sensor.querySelector('.sensor-value');
    if (textEl) {
        textEl.textContent = `${value.toFixed(1)}${unit ? ' ' + unit : ''}`;
    }
}

// ── Analyzer composition display ─────────────────────────────────────────────
// Analisadores: data-xmeas-range="23-28", "29-36", "37-41"
// Mostrar componentes com valores: "A:45.2 | B:23.1 | C:12.0"

const ANALYZER_COMPONENTS = {
    '23-28': ['A', 'B', 'C', 'D', 'E', 'F'],          // Reactor feed
    '29-36': ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], // Purge
    '37-41': ['D', 'E', 'F', 'G', 'H'],               // Product
};

function updateAnalyzerDisplay(analyzerId, xmeasValues) {
    const analyzer = document.getElementById(analyzerId);
    if (!analyzer) return;

    const rangeAttr = analyzer.getAttribute('data-xmeas-range');
    if (!rangeAttr) return;

    const [startIdx, endIdx] = rangeAttr.split('-').map(s => parseInt(s) - 1);
    const comps = ANALYZER_COMPONENTS[rangeAttr];

    if (!comps) return;

    // Extrai valores XMEAS(start..end)
    const values = xmeasValues.slice(startIdx, endIdx + 1);
    const displayStr = comps
        .map((comp, i) => values[i] != null ? `${comp}:${values[i].toFixed(0)}` : `${comp}:--`)
        .join('|');

    const textEl = analyzer.querySelector('.analyzer-label');
    if (textEl) {
        textEl.textContent = displayStr;
    }
}

// ── Main update function ─────────────────────────────────────────────────────
// Chamado a cada WebSocket message com dados de xmeas e xmv

function updateDiagram(xmeas, xmv) {
    if (!xmeas || !xmv) return;

    // Cores de vasos (temperatura)
    colorizeVessel('unit-reactor', xmeas[8]);       // XMEAS(9)
    colorizeVessel('unit-separator', xmeas[10]);    // XMEAS(11)
    colorizeVessel('unit-stripper', xmeas[17]);     // XMEAS(18)

    // Largura de streams (fluxos)
    updateStreamWidth('stream-01-a-feed', xmeas[0]);         // XMEAS(1)
    updateStreamWidth('stream-02-d-feed', xmeas[1]);         // XMEAS(2)
    updateStreamWidth('stream-03-e-feed', xmeas[2]);         // XMEAS(3)
    updateStreamWidth('stream-04-ac-feed', xmeas[3]);        // XMEAS(4)
    updateStreamWidth('stream-06-reactor-feed', xmeas[5]);   // XMEAS(6)
    updateStreamWidth('stream-09-purge', xmeas[9]);          // XMEAS(10)
    updateStreamWidth('stream-08-recycle', xmeas[4]);        // XMEAS(5)

    // Valores de sensores
    updateSensorValue('sensor-xmeas-07', xmeas[6], 'kPa');   // XMEAS(7)
    updateSensorValue('sensor-xmeas-08', xmeas[7], '%');     // XMEAS(8)
    updateSensorValue('sensor-xmeas-09', xmeas[8], '°C');    // XMEAS(9)
    updateSensorValue('sensor-xmeas-12', xmeas[11], '%');    // XMEAS(12)
    updateSensorValue('sensor-xmeas-13', xmeas[12], 'kPa');  // XMEAS(13)
    updateSensorValue('sensor-xmeas-15', xmeas[14], '%');    // XMEAS(15)
    updateSensorValue('sensor-xmeas-16', xmeas[15], 'kPa');  // XMEAS(16)
    updateSensorValue('sensor-xmeas-18', xmeas[17], '°C');   // XMEAS(18)

    // Composições de analisadores
    updateAnalyzerDisplay('analyzer-reactor-feed', xmeas);   // XMEAS(23-28)
    updateAnalyzerDisplay('analyzer-purge', xmeas);          // XMEAS(29-36)
    updateAnalyzerDisplay('analyzer-product', xmeas);        // XMEAS(37-41)
}

// ── Initialization ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initDiagramInteraction();
});
