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
    'sensor-xmeas-06': { placement: 'above', offset: 10  },
    'sensor-xmeas-14': { placement: 'above', offset: 5  },
    'sensor-xmeas-15': { placement: 'right', offset: 5  },
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
