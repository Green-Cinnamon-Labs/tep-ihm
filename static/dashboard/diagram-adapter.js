/**
 * diagram-adapter.js
 *
 * Adapter entre o SVG bruto exportado pelo Draw.io e a animação dinâmica do TEP.
 *
 * O Draw.io exporta elementos com data-cell-id="semantic-id" (não com id=).
 * A estrutura interna varia por tipo de elemento:
 *
 *   stream   → g[data-cell-id] > g[transform] > path (linha), path (seta)
 *   unit     → g[data-cell-id] > g[transform] > path ou rect (forma)
 *   actuator → g[data-cell-id] > g[transform] > path... (múltiplos)
 *   sensor   → g[data-cell-id] > g[data-cell-id=auto] > g[transform] > ellipse
 *   node     → g[data-cell-id] > g[transform] > rect
 *
 * Este adapter não assume estrutura perfeita. Ele inspeciona e adapta.
 */

// ── Resolvers primitivos ─────────────────────────────────────────────────────

/**
 * Retorna o wrapper semântico <g data-cell-id="id">.
 */
function getSemanticElement(id) {
    return document.querySelector(`[data-cell-id="${id}"]`);
}

/**
 * Retorna o primeiro elemento gráfico desenhável dentro do wrapper.
 * Procura em: g[transform] direto, depois em sub-cells (padrão sensor).
 * Elemento preferido: path > rect > ellipse > line > polyline.
 */
function getDrawablePath(id) {
    const wrapper = getSemanticElement(id);
    if (!wrapper) return null;

    const SHAPES = 'path, rect, ellipse, line, polyline';

    // Caso 1: forma está no primeiro g[transform] filho direto
    const transformGroup = wrapper.querySelector(':scope > g[transform]');
    if (transformGroup) {
        const shape = transformGroup.querySelector(SHAPES);
        if (shape) return shape;
    }

    // Caso 2: sensor — forma está em sub-cell com data-cell-id automático
    const subCell = wrapper.querySelector(':scope > g[data-cell-id]');
    if (subCell) {
        const shape = subCell.querySelector(SHAPES);
        if (shape) return shape;
    }

    // Fallback: qualquer forma dentro do wrapper
    return wrapper.querySelector(SHAPES);
}

/**
 * Retorna todos os paths principais (exclui setas de streams).
 * Para streams, o primeiro path é a linha; o segundo é a seta.
 * Aqui retornamos apenas o primeiro.
 */
function getStreamLine(id) {
    const wrapper = getSemanticElement(id);
    if (!wrapper) return null;
    const tg = wrapper.querySelector(':scope > g[transform]');
    if (!tg) return null;
    return tg.querySelector('path');  // primeiro path = linha do stream
}

// Posicionamento por sensor/actuator.
// placement: 'right' (padrão) | 'left' | 'above' | 'below'
// offset: afastamento extra em pixels de tela (positivo = para fora do sensor)
const SENSOR_TEXT_POSITION = {
    'sensor-xmeas-01': { placement: 'left', offset: 5  },
    'sensor-xmeas-02': { placement: 'left', offset: 5  },
    'sensor-xmeas-03': { placement: 'left', offset: 5  },
    'sensor-xmeas-04': { placement: 'left', offset: 5  },
    'sensor-xmeas-05': { placement: 'above', offset: 5  },
    'sensor-xmeas-06': { placement: 'right', offset: 5  },
    'sensor-xmeas-07': { placement: 'above', offset: 5  },
    'sensor-xmeas-09': { placement: 'above', offset: 5  },
    'sensor-xmeas-10': { placement: 'above', offset: 5  },
    'sensor-xmeas-14': { placement: 'above', offset: 5  },
    'sensor-xmeas-15': { placement: 'right', offset: 5  },
    'sensor-xmeas-18': { placement: 'right', offset: 5  },
    'sensor-xmeas-20': { placement: 'above', offset: 5  },
    // Atuadores
    'actuator-xmv-01': { placement: 'below', offset: 0  },
    'actuator-xmv-02': { placement: 'below', offset: 0  },
    'actuator-xmv-03': { placement: 'below', offset: 0  },
    'actuator-xmv-04': { placement: 'below', offset: 0  },
    'actuator-xmv-05': { placement: 'above', offset: 5  },
    'actuator-xmv-06': { placement: 'below', offset: 0  },
    'actuator-xmv-07': { placement: 'below', offset: 0  },
    'actuator-xmv-08': { placement: 'below', offset: 0  },
    'actuator-xmv-09': { placement: 'below', offset: 0  },
    'actuator-xmv-10': { placement: 'below', offset: 0  },
    'actuator-xmv-11': { placement: 'below', offset: 0  },
    'actuator-xmv-12': { placement: 'above', offset: 5  },
    // Analisador de feed — posicionado à esquerda do bloco
    'sensor-xmeas-23': { placement: 'left' },
    'sensor-xmeas-24': { placement: 'left' },
    'sensor-xmeas-25': { placement: 'left' },
    'sensor-xmeas-26': { placement: 'left' },
    'sensor-xmeas-27': { placement: 'left' },
    'sensor-xmeas-28': { placement: 'left' },
};

/**
 * Retorna ou cria um nó <text> SVG para exibir valores ao lado de um elemento.
 * O texto é posicionado com base no bounding box do elemento gráfico.
 */
function getOrCreateValueText(id) {
    const svg = document.querySelector('#diagram-container svg');
    if (!svg) return null;

    const existingId = `val-${id}`;
    let textEl = document.getElementById(existingId);
    if (textEl) return textEl;

    const wrapper = getSemanticElement(id);
    if (!wrapper) return null;

    // Sensores: usa a ellipse (evita pegar a linha tracejada que vem antes no DOM)
    // Atuadores/outros: usa o wrapper inteiro (haste da válvula tem width≈0)
    const ellipse = wrapper.querySelector('ellipse');
    const er = ellipse
        ? ellipse.getBoundingClientRect()
        : wrapper.getBoundingClientRect();
    if (!er.width && !er.height) return null;

    // Converte coordenadas de tela para espaço do SVG raiz
    const pt = svg.createSVGPoint();
    const ctm = svg.getScreenCTM().inverse();

    const cfg       = SENSOR_TEXT_POSITION[id] || {};
    const placement = cfg.placement || 'right';
    const offset    = cfg.offset    || 0;

    switch (placement) {
        case 'above':
            pt.x = er.left + er.width / 2;
            pt.y = er.top  - 4 - offset;
            break;
        case 'below':
            pt.x = er.left   + er.width  / 2;
            pt.y = er.bottom + 12 + offset;
            break;
        case 'left':
            pt.x = er.left - 4 - offset;
            pt.y = er.top  + er.height / 2;
            break;
        default: // right
            pt.x = er.right + 4 + offset;
            pt.y = er.top   + er.height / 2;
    }
    const pos = pt.matrixTransform(ctm);

    textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textEl.setAttribute('id', existingId);
    textEl.setAttribute('x', pos.x);
    textEl.setAttribute('y', pos.y + 4);
    textEl.setAttribute('text-anchor', placement === 'above' || placement === 'below' ? 'middle' : placement === 'left' ? 'end' : 'start');
    textEl.setAttribute('font-size', '10');
    textEl.setAttribute('font-family', 'Consolas, monospace');
    textEl.style.fill = 'var(--hmi-display)';
    textEl.setAttribute('pointer-events', 'none');
    svg.appendChild(textEl);
    return textEl;
}

// ── Updaters de alto nível ───────────────────────────────────────────────────

/**
 * Atualiza visualmente um stream.
 *   value    — valor de fluxo (ex: XMEAS em unidade física)
 *   maxValue — valor de referência para normalizar stroke-width
 */
function updateStream(id, value, maxValue = 60) {
    const line = getStreamLine(id);
    if (!line) return;

    const normalized = Math.max(0, Math.min(1, value / maxValue));
    const width = 1 + normalized * 4;
    const opacity = value < 0.5 ? 0.25 : 0.85;

    line.style.strokeWidth = `${width.toFixed(2)}px`;
    line.style.opacity = `${opacity.toFixed(2)}`;
}

/**
 * Atualiza visualmente um atuador (válvula).
 *   value — posição da válvula 0..100 (XMV em %)
 *
 * ISA-101 §7: cor reservada para estado anormal.
 * Válvulas usam degradê de tons de fundo em passos de 10%:
 *   fechada (0%)  → cinza escuro   hsl(210, 12%, 28%)
 *   aberta (100%) → cinza claro    hsl(210, 18%, 82%)
 */
function updateActuator(id, value) {
    const wrapper = getSemanticElement(id);
    if (!wrapper) return;

    const tg = wrapper.querySelector(':scope > g[transform]');
    if (!tg) return;

    // Snap para o múltiplo de 10 mais próximo → 11 tons discretos visíveis
    const step      = Math.round(Math.max(0, Math.min(100, value)) / 10) * 10;
    const t         = step / 100;
    const lightness = Math.round(28 + t * 67);   // 28% (fechada) → 95% (aberta ≈ branco)
    const color     = `hsl(210, 10%, ${lightness}%)`;

    const paths = tg.querySelectorAll('path');
    paths.forEach((p, i) => {
        if (i === 0) return;  // linha de haste — não colorir
        p.style.fill        = color;
        p.style.fillOpacity = '1';
    });
}

/**
 * Atualiza visualmente um sensor exibindo o valor numérico.
 *   value — valor da medição (XMEAS)
 *   unit  — string de unidade (ex: 'kPa', '°C', '%')
 */
function updateSensor(id, value, unit = '') {
    const textEl = getOrCreateValueText(id);
    if (!textEl) return;
    textEl.textContent = `${value.toFixed(1)}${unit ? ' ' + unit : ''}`;
}

/**
 * Aplica cor de temperatura a um vaso (unit).
 *   tempC — temperatura em °C (XMEAS)
 */
function updateUnit(id, tempC) {
    const wrapper = getSemanticElement(id);
    if (!wrapper) return;

    const color = tempC == null ? null
                : tempC < 100  ? '#4fc3f7'   // frio → azul
                : tempC < 150  ? '#ffb74d'   // morno → laranja
                :                '#ef5350';  // quente → vermelho

    if (!color) return;

    wrapper.querySelectorAll('path, ellipse, rect').forEach(el => {
        el.style.fill = color;
        el.style.fillOpacity = '0.45';
    });
}

// ── SVGControlChart ──────────────────────────────────────────────────────────
//
// Widget fechado: até 3 barras verticais (estado atual) com rastro suave saindo
// à esquerda de cada barra (histórico). Normalização por série usando min/max
// declarados no config; se omitidos, usa auto-scale do próprio buffer.
//
// Série: { key, label, color, min?, max? }
// Propriedades extras (derive, hideTrend, dashed…) são ignoradas pelo componente
// e podem ser usadas pelo chamador como decoração.

function _smoothPath(pts) {
    if (pts.length < 2) return '';
    if (pts.length === 2)
        return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const mx = ((pts[i].x + pts[i + 1].x) / 2).toFixed(1);
        const my = ((pts[i].y + pts[i + 1].y) / 2).toFixed(1);
        d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mx} ${my}`;
    }
    const lp = pts[pts.length - 1];
    return d + ` L ${lp.x.toFixed(1)} ${lp.y.toFixed(1)}`;
}

/**
 * Retorna lo, hi e ticks em valores "bonitos" (1/2/5 × potência de 10).
 * targetIntervals: número desejado de intervalos entre ticks.
 */
function _niceScale(lo, hi, targetIntervals) {
    const range  = hi - lo || 1;
    const rough  = range / Math.max(targetIntervals, 1);
    const mag    = Math.pow(10, Math.floor(Math.log10(rough)));
    const n      = rough / mag;
    const step   = n <= 1 ? mag : n <= 2 ? 2 * mag : n <= 5 ? 5 * mag : 10 * mag;
    const niceLo = Math.floor(lo / step) * step;
    const niceHi = Math.ceil(hi / step) * step;
    const ticks  = [];
    for (let i = 0; niceLo + i * step <= niceHi + step * 0.001; i++) {
        ticks.push(Math.round((niceLo + i * step) / step) * step);
    }
    return { lo: niceLo, hi: niceHi, step, ticks };
}

class SVGControlChart {
    constructor({ id, anchor, bufferSize = 15, series = [], title = '', tep = '', barSide = 'right' }) {
        this.id         = id;
        this.anchor     = anchor;
        this.bufferSize = bufferSize;
        this.series     = series;
        this.title      = title;
        this.tep        = tep;
        this.barSide    = barSide;

        this._buffers     = Object.fromEntries(series.map(s => [s.key, []]));
        this._svgEl       = null;
        this._paths       = {};   // key → <path> rastro suave
        this._connectors  = {};   // key → <line> liga rastro à barra
        this._barTracks   = {};   // key → <rect> track
        this._barFills    = {};   // key → <rect> fill
        this._statPolys   = {};   // key → { max, mean, min } <polygon> triângulos (opt-in: showStats)
        this._statConns   = {};   // key → { max, mean, min } <line> conectores
        this._barValues   = {};   // key → <text> valor atual
        this._gridEls     = [];   // { line, label } × N_GRID — grade auto-escala
        this._tooltipEl   = null;
        this._titleEl     = null;
        this._container   = null;
        this._ro          = null;
    }

    mount(container) {
        if (!container) return this;
        this._container = container;
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.id = `ctrl-${this.id}`;
        svg.classList.add('svg-control-chart');
        svg.style.cssText = 'position:absolute;pointer-events:auto;z-index:10;overflow:hidden;';

        // Fundo
        const bg = document.createElementNS(NS, 'rect');
        bg.setAttribute('width', '100%');
        bg.setAttribute('height', '100%');
        bg.setAttribute('class', 'chart-bg');
        svg.appendChild(bg);

        // Grade horizontal auto-escala (z-order: abaixo das séries)
        const N_GRID = 4;
        this._gridEls = [];
        for (let g = 0; g < N_GRID; g++) {
            const gl = document.createElementNS(NS, 'line');
            gl.setAttribute('class', 'chart-grid-line');
            svg.appendChild(gl);
            const lbl = document.createElementNS(NS, 'text');
            lbl.setAttribute('class', 'chart-grid-label');
            svg.appendChild(lbl);
            this._gridEls.push({ line: gl, label: lbl });
        }

        // Por série (z-order: conector → rastro → track → fill → max → labels)
        this.series.forEach(s => {
            // Conector horizontal: liga extremo direito do rastro à barra
            const conn = document.createElementNS(NS, 'line');
            conn.setAttribute('class', 'chart-connector');
            conn.style.stroke = s.color;
            svg.appendChild(conn);
            this._connectors[s.key] = conn;

            // Rastro suave
            const path = document.createElementNS(NS, 'path');
            path.setAttribute('fill', 'none');
            path.setAttribute('class', 'chart-trace');
            path.style.stroke = s.color;
            svg.appendChild(path);
            this._paths[s.key] = path;

            // Barra — track
            const track = document.createElementNS(NS, 'rect');
            track.setAttribute('class', 'chart-bar-track');
            svg.appendChild(track);
            this._barTracks[s.key] = track;

            // Barra — fill
            const fill = document.createElementNS(NS, 'rect');
            fill.setAttribute('class', 'chart-bar-fill');
            fill.style.fill = s.color;
            svg.appendChild(fill);
            this._barFills[s.key] = fill;

            // Indicadores de nível (triângulo + conector) — apenas se showStats: true
            if (s.showStats) {
                const STAT_COLORS = { max: '#ef5350', mean: '#78909c', min: '#b0bec5' };
                const polys = {}, conns = {};
                ['max', 'mean', 'min'].forEach(type => {
                    const poly = document.createElementNS(NS, 'polygon');
                    poly.setAttribute('class', `chart-stat-tri chart-stat-${type}`);
                    poly.style.fill = STAT_COLORS[type];
                    svg.appendChild(poly);
                    polys[type] = poly;

                    const ln = document.createElementNS(NS, 'line');
                    ln.setAttribute('class', `chart-stat-conn chart-stat-${type}-conn`);
                    ln.style.stroke = STAT_COLORS[type];
                    svg.appendChild(ln);
                    conns[type] = ln;
                });
                this._statPolys[s.key] = polys;
                this._statConns[s.key] = conns;
            }

            // Valor atual
            const val = document.createElementNS(NS, 'text');
            val.setAttribute('class', 'chart-bar-value');
            val.style.fill = s.color;
            svg.appendChild(val);
            this._barValues[s.key] = val;
        });

        // Tooltip HTML — criado uma vez por instância, fixo no body
        const tip = document.createElement('div');
        tip.className = 'chart-tooltip';
        tip.style.display = 'none';
        document.body.appendChild(tip);
        this._tooltipEl = tip;

        svg.addEventListener('mousemove', (e) => {
            const lines = this.series.map(s => {
                const buf  = this._buffers[s.key];
                const last = buf.length ? buf[buf.length - 1] : null;
                const mn   = buf.length ? Math.min(...buf) : null;
                const mx   = buf.length ? Math.max(...buf) : null;
                const mean = buf.length ? buf.reduce((a, b) => a + b, 0) / buf.length : null;
                const fmt  = v => v == null ? '—' : (v < 10 ? v.toFixed(2) : v.toFixed(1));
                const unit = s.unit ? ` ${s.unit}` : '';
                return `<span style="color:${s.color}">■</span> ${s.label || s.key}: <b>${fmt(last)}${unit}</b>` +
                       `<br><small style="color:#aaa;padding-left:14px">` +
                       `min ${fmt(mn)} · avg ${fmt(mean)} · max ${fmt(mx)}${unit}</small>`;
            }).join('<br>');
            tip.innerHTML = lines;
            tip.style.display = 'block';
            const offRight = e.clientX + 16 + tip.offsetWidth > window.innerWidth;
            tip.style.left = (offRight ? e.clientX - 12 - tip.offsetWidth : e.clientX + 14) + 'px';
            tip.style.top  = (e.clientY - 10) + 'px';
        });
        svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

        // Título (por cima de tudo — z-order SVG)
        if (this.title) {
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('class', 'chart-title');
            t.textContent = this.title;
            svg.appendChild(t);
            this._titleEl = t;
        }

        this._svgEl = svg;
        container.appendChild(svg);

        this._ro = new ResizeObserver(() => this._reposition());
        this._ro.observe(container);

        window._svgCharts = window._svgCharts || {};
        window._svgCharts[this.id] = { instance: this, label: this.title || this.id, tep: this.tep, anchor: this.anchor };

        this._reposition();
        return this;
    }

    push(key, value) {
        const buf = this._buffers[key];
        if (!buf) return;
        buf.push(value);
        if (buf.length > this.bufferSize) buf.shift();
        this._reposition();
    }

    _reposition() {
        if (!this._svgEl || !this._container) return;
        const anchor = document.querySelector(`[data-cell-id="${this.anchor}"]`);
        if (!anchor) return;

        const cr = this._container.getBoundingClientRect();
        const ar = anchor.getBoundingClientRect();

        const left = ar.left - cr.left + this._container.scrollLeft;
        const top  = ar.top  - cr.top  + this._container.scrollTop;
        const w    = ar.width;
        const h    = ar.height;
        if (w < 2 || h < 2) return;

        this._svgEl.style.left   = `${left}px`;
        this._svgEl.style.top    = `${top}px`;
        this._svgEl.style.width  = `${w}px`;
        this._svgEl.style.height = `${h}px`;
        this._svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);

        this._redraw(w, h);
    }

    _redraw(w, h) {
        const n = this.series.length;
        if (n === 0) return;

        const BAR_W     = 14;
        const BAR_GAP   = 6;
        const TRACE_GAP = 8;
        const PAD = { t: this.title ? 20 : 4, b: 6, l: 6, r: 4 };

        const barsW  = n * BAR_W + (n - 1) * BAR_GAP;
        const left   = this.barSide === 'left';
        const barsX  = left ? PAD.l : w - PAD.r - barsW;
        const traceStartX = left ? PAD.l + barsW + TRACE_GAP : PAD.l;
        const traceEndX   = left ? w - PAD.r : barsX - TRACE_GAP;
        const plotH  = h - PAD.t - PAD.b;
        if (plotH < 4 || traceEndX <= traceStartX) return;

        if (this._titleEl) {
            this._titleEl.setAttribute('x', '4');
            this._titleEl.setAttribute('y', '3');
        }

        this.series.forEach((s, i) => {
            const buf  = this._buffers[s.key] || [];
            const barX = barsX + i * (BAR_W + BAR_GAP);

            // Escala: usa min/max fixo da série se declarado; nice-scale do buffer como fallback
            if (!buf.length) return;
            let lo, hi;
            if (s.min != null && s.max != null) {
                lo = s.min;
                hi = s.max;
            } else {
                const bufMin = Math.min(...buf);
                const bufMax = Math.max(...buf);
                ({ lo, hi } = _niceScale(bufMin, bufMax, this._gridEls.length + 1));
            }
            const range = hi - lo || 1;
            const norm  = v => Math.max(0, Math.min(1, (v - lo) / range));
            const toY   = v => PAD.t + (1 - norm(v)) * plotH;

            // Barra — track
            const track = this._barTracks[s.key];
            if (track) {
                track.setAttribute('x',      barX.toFixed(1));
                track.setAttribute('y',      PAD.t.toFixed(1));
                track.setAttribute('width',  BAR_W);
                track.setAttribute('height', plotH.toFixed(1));
            }

            // Barra — fill + valor
            const fillEl = this._barFills[s.key];
            const valEl  = this._barValues[s.key];
            const last   = buf.length ? buf[buf.length - 1] : null;

            if (last != null && isFinite(last)) {
                const fillH = Math.max(1, norm(last) * plotH);
                const fillY = PAD.t + plotH - fillH;
                if (fillEl) {
                    fillEl.setAttribute('x',      barX.toFixed(1));
                    fillEl.setAttribute('y',      fillY.toFixed(1));
                    fillEl.setAttribute('width',  BAR_W);
                    fillEl.setAttribute('height', fillH.toFixed(1));
                    fillEl.style.display = '';
                }
                if (valEl) {
                    valEl.textContent = last < 10 ? last.toFixed(1) : last.toFixed(0);
                    valEl.setAttribute('x', (barX + BAR_W / 2).toFixed(1));
                    valEl.setAttribute('y', (fillY - 1).toFixed(1));
                }
            } else {
                if (fillEl) fillEl.style.display = 'none';
                if (valEl)  valEl.textContent = '';
            }

            // Rastro suave
            // barSide right: idx=0 (oldest) → traceStartX, idx=n-1 (newest) → traceEndX
            // barSide left:  idx=0 (oldest) → traceEndX,   idx=n-1 (newest) → traceStartX
            const pathEl = this._paths[s.key];
            if (pathEl) {
                if (buf.length >= 2) {
                    const traceW = traceEndX - traceStartX;
                    const pts = buf.map((v, idx) => ({
                        x: left
                            ? traceStartX + ((buf.length - 1 - idx) / (buf.length - 1)) * traceW
                            : traceStartX + (idx / (buf.length - 1)) * traceW,
                        y: toY(v),
                    }));
                    pathEl.setAttribute('d', _smoothPath(pts));
                } else {
                    pathEl.setAttribute('d', '');
                }
            }

            // Conector: liga ponto mais recente do rastro à barra
            const connEl = this._connectors[s.key];
            if (connEl) {
                if (last != null && isFinite(last)) {
                    const cy = toY(last).toFixed(1);
                    // right: rastro termina em traceEndX → borda esquerda da barra
                    // left:  rastro termina em traceStartX → borda direita da barra
                    connEl.setAttribute('x1', left ? (barX + BAR_W).toFixed(1) : traceEndX.toFixed(1));
                    connEl.setAttribute('y1', cy);
                    connEl.setAttribute('x2', left ? traceStartX.toFixed(1) : barX.toFixed(1));
                    connEl.setAttribute('y2', cy);
                    connEl.style.display = '';
                } else {
                    connEl.style.display = 'none';
                }
            }

            // Triângulos indicadores de nível (showStats: true)
            const polys = this._statPolys[s.key];
            const conns = this._statConns[s.key];
            if (polys && buf.length) {
                const bufMin  = Math.min(...buf);
                const bufMax  = Math.max(...buf);
                const bufMean = buf.reduce((a, b) => a + b, 0) / buf.length;

                const TRI_W = 13;  // profundidade do triângulo
                const TRI_H = 8;   // meia-altura do triângulo
                const GAP   = 3;   // gap entre ponta e borda da barra

                // barSide right → triângulo à esquerda, ponta apontando para direita (►)
                // barSide left  → triângulo à direita, ponta apontando para esquerda (◄)
                const tipX    = left ? barX + BAR_W + GAP : barX - GAP;
                const baseX   = left ? tipX + TRI_W       : tipX - TRI_W;
                const barEdge = left ? barX + BAR_W        : barX;

                [['max', bufMax], ['mean', bufMean], ['min', bufMin]].forEach(([type, val]) => {
                    const poly = polys[type];
                    const conn = conns[type];
                    if (!poly) return;
                    const midY = toY(val);
                    poly.setAttribute('points',
                        `${baseX},${(midY - TRI_H).toFixed(1)} ` +
                        `${tipX},${midY.toFixed(1)} ` +
                        `${baseX},${(midY + TRI_H).toFixed(1)}`
                    );
                    poly.style.display = '';
                    if (conn) {
                        conn.setAttribute('x1', tipX.toFixed(1));
                        conn.setAttribute('y1', midY.toFixed(1));
                        conn.setAttribute('x2', barEdge.toFixed(1));
                        conn.setAttribute('y2', midY.toFixed(1));
                        conn.style.display = '';
                    }
                });
            } else if (polys) {
                Object.values(polys).forEach(p => { p.style.display = 'none'; });
                if (conns) Object.values(conns).forEach(c => { c.style.display = 'none'; });
            }

        });

        // Grade horizontal: mesma escala usada pela primeira série
        const firstBuf = this._buffers[this.series[0]?.key] || [];
        const s0 = this.series[0];
        if (this._gridEls.length && firstBuf.length >= 1) {
            const gLo0 = (s0?.min != null) ? s0.min : Math.min(...firstBuf);
            const gHi0 = (s0?.max != null) ? s0.max : Math.max(...firstBuf);
            const { lo: gLo, hi: gHi, step: gStep, ticks } =
                _niceScale(gLo0, gHi0, this._gridEls.length + 1);
            const gRange = gHi - gLo || 1;
            const gToY   = v => PAD.t + (1 - (v - gLo) / gRange) * plotH;
            // ticks interiores (excluí lo e hi que ficam nas bordas do plot)
            const inner  = ticks.filter(t => t > gLo && t < gHi).slice(0, this._gridEls.length);
            const dec    = gStep < 0.1 ? 3 : gStep < 1 ? 2 : gStep < 10 ? 1 : 0;
            const labelX = (traceStartX + 2).toFixed(1);
            this._gridEls.forEach(({ line, label }, idx) => {
                if (idx < inner.length) {
                    const val = inner[idx];
                    const y   = gToY(val).toFixed(1);
                    line.setAttribute('x1', traceStartX.toFixed(1));
                    line.setAttribute('y1', y);
                    line.setAttribute('x2', traceEndX.toFixed(1));
                    line.setAttribute('y2', y);
                    line.style.display = '';
                    label.setAttribute('x', labelX);
                    label.setAttribute('y', (parseFloat(y) - 2).toFixed(1));
                    label.textContent = val.toFixed(dec);
                    label.style.display = '';
                } else {
                    line.style.display  = 'none';
                    label.style.display = 'none';
                }
            });
        } else {
            this._gridEls.forEach(({ line, label }) => {
                line.style.display  = 'none';
                label.style.display = 'none';
            });
        }

    }

    destroy() {
        this._ro?.disconnect();
        this._svgEl?.remove();
        this._tooltipEl?.remove();
        if (window._svgCharts) delete window._svgCharts[this.id];
    }
}

// ── Inspecção / diagnóstico ──────────────────────────────────────────────────

/**
 * Loga no console a estrutura interna de um semantic element.
 * Útil para depurar novos elementos adicionados no Draw.io.
 */
function inspectElement(id) {
    const wrapper = getSemanticElement(id);
    if (!wrapper) { console.warn(`[adapter] "${id}" não encontrado no SVG`); return; }

    const drawable = getDrawablePath(id);
    console.group(`[adapter] ${id}`);
    console.log('wrapper tag:', wrapper.tagName);
    console.log('wrapper html (primeiros 300 chars):', wrapper.outerHTML.slice(0, 300));
    console.log('drawable:', drawable?.tagName, drawable?.getBBox?.());
    console.groupEnd();
}

// ── Teste mínimo ─────────────────────────────────────────────────────────────

/**
 * Executa um smoke-test com valores fixos nos quatro elementos canônicos.
 * Chamar no console do browser após o SVG ser carregado:
 *   runAdapterSmokeTest()
 */
function runAdapterSmokeTest() {
    console.group('[adapter] smoke test');

    updateStream('stream-09-purge', 18, 60);
    console.log('stream-09-purge → line:', getStreamLine('stream-09-purge'));

    updateActuator('actuator-xmv-03', 62);
    console.log('actuator-xmv-03 → drawable:', getDrawablePath('actuator-xmv-03'));

    updateSensor('sensor-xmeas-01', 42.7, 'kscmh');
    console.log('sensor-xmeas-01 → drawable:', getDrawablePath('sensor-xmeas-01'));

    updateUnit('unit-reactor', 135);
    console.log('unit-reactor → drawable:', getDrawablePath('unit-reactor'));

    console.groupEnd();
}
