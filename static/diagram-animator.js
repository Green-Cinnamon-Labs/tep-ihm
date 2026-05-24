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

// ISA-101 §7: vasos permanecem em cinza neutro — cor de ênfase reservada para badges de alarme.
function colorizeVessel(vesselId) {
    const vessel = document.querySelector(`[data-cell-id="${vesselId}"]`);
    if (!vessel) return;
    vessel.querySelectorAll('path, ellipse, rect').forEach(el => {
        el.style.fill        = '#6F767D';
        el.style.fillOpacity = '0.20';
    });
}

// ── Stream flow visualization (stroke-width) ─────────────────────────────────
// Usa data-cell-id (draw.io), não getElementById.

function scaleStreamWidth(flowValue, maxFlow = 60) {
    const normalized = Math.max(0, Math.min(1, flowValue / maxFlow));
    return 1.5 + normalized * 2.5;
}

function updateStreamGroup(prefix, flowValue, maxFlow = 60) {
    const t         = Math.max(0, Math.min(1, flowValue / maxFlow));
    const w         = scaleStreamWidth(flowValue, maxFlow).toFixed(2);
    const lightness = Math.round(28 + t * 67);   // 28% (sem fluxo) → 95% (fluxo máximo)
    const stroke    = `hsl(210, 10%, ${lightness}%)`;
    const opacity   = flowValue < 0.5 ? '0.4' : '1';
    document.querySelectorAll(`[data-cell-id^="${prefix}"]`).forEach(seg => {
        const path = seg.querySelector('path');
        if (!path) return;
        path.setAttribute('stroke-width', w);
        path.style.stroke  = stroke;
        path.style.opacity = opacity;
    });
}

// ── Sensor value display ──────────────────────────────────────────────────────
// Delega para getOrCreateValueText (diagram-adapter.js) que cria label flutuante.
// Draw.io não exporta .sensor-value como classe CSS — não confiar em querySelector de classe.

function _idToTag(id) {
    const xm = id.match(/sensor-xmeas-0*(\d+)/);
    if (xm) return `XMEAS(${parseInt(xm[1])})`;
    const xv = id.match(/actuator-xmv-0*(\d+)/);
    if (xv) return `XMV(${parseInt(xv[1])})`;
    return '';
}

function updateSensorValue(sensorId, value, unit = '') {
    const textEl = getOrCreateValueText(sensorId);
    if (!textEl) return;
    const tag = _idToTag(sensorId);
    const val = `${value.toFixed(1)}${unit ? ' ' + unit : ''}`;
    textEl.textContent = tag ? `${tag}  ${val}` : val;
}

// ── Main update function ──────────────────────────────────────────────────────
// Chamado a cada WebSocket message com arrays xmeas[41] e xmv[12].
// Indexação: XMEAS(n) = xmeas[n-1], XMV(n) = xmv[n-1]

function updateDiagram(xmeas, xmv) {
    if (!xmeas || !xmv) return;

    // Vasos — cinza neutro (ISA-101 §7). Alarmes comunicados por badges, não por cor do vaso.
    colorizeVessel('unit-reactor');
    colorizeVessel('unit-separator');
    colorizeVessel('unit-stripper');
    colorizeVessel('unit-condenser');
    colorizeVessel('unit-stripper-boiler');
    colorizeVessel('unit-compressor-1');
    colorizeVessel('unit-compressor-2');
    colorizeVessel('unit-compressor-3');

    // Streams — todos os segmentos do mesmo stream recebem a mesma largura (prefix match)
    updateStreamGroup('stream-01-', xmeas[0],   1    );  // XMEAS(1)  A feed kscmh
    updateStreamGroup('stream-02-', xmeas[1],   6000 );  // XMEAS(2)  D feed kg/hr
    updateStreamGroup('stream-03-', xmeas[2],   7000 );  // XMEAS(3)  E feed kg/hr
    updateStreamGroup('stream-04-', xmeas[3],   15   );  // XMEAS(4)  A/C feed kscmh
    updateStreamGroup('stream-06-', xmeas[5],   80   );  // XMEAS(6)  reactor feed kscmh
    updateStreamGroup('stream-07-', xmeas[5],   80   );  // proxy XMEAS(6) — sem medição própria
    updateStreamGroup('stream-08-', xmeas[4],   60   );  // XMEAS(5)  reciclo kscmh
    updateStreamGroup('stream-09-', xmeas[9],   1    );  // XMEAS(10) purga kscmh
    updateStreamGroup('stream-10-', xmeas[13],  40   );  // XMEAS(14) sep underflow m³/hr
    updateStreamGroup('stream-11-', xmeas[16],  80   );  // XMEAS(17) produto m³/hr
    updateStreamGroup('stream-12-', xmv[9],     100  );  // XMV(10)   CWS reator %
    updateStreamGroup('stream-13-', xmv[10],    100  );  // XMV(11)   CWS condensador %
    updateStreamGroup('stream-14-', xmeas[18],  500  );  // XMEAS(19) vapor stripper kg/hr
    // stream-08.1 bypass: espessura fixa (sem medição independente do reciclo principal)
    // stream-05, stream-15: sem sensor de fluxo — espessura fixa pelo draw.io

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

    // Atuadores XMV(1..12) — cor + valor numérico
    for (let i = 1; i <= 12; i++) {
        const id = `actuator-xmv-${String(i).padStart(2, '0')}`;
        updateActuator(id, xmv[i - 1]);
        updateSensorValue(id, xmv[i - 1], '%');
    }

    // Analisadores de composição XMEAS(23..41)
    for (let n = 23; n <= 41; n++) {
        if (xmeas[n - 1] == null) continue;
        updateSensorValue(`sensor-xmeas-${n}`, xmeas[n - 1], '%');
    }
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
