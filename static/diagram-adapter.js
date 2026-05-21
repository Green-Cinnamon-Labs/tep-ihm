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

/**
 * Retorna ou cria um nó <text> SVG para exibir valores ao lado de um elemento.
 * O texto é posicionado com base no bounding box do elemento gráfico.
 */
function getOrCreateValueText(id) {
    const svg = document.querySelector('#tep-diagram svg, svg#tep-diagram, svg');
    if (!svg) return null;

    const existingId = `val-${id}`;
    let textEl = svg.getElementById(existingId);
    if (textEl) return textEl;

    const drawable = getDrawablePath(id);
    if (!drawable) return null;

    const bbox = drawable.getBBox();
    textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textEl.setAttribute('id', existingId);
    textEl.setAttribute('x', bbox.x + bbox.width + 4);
    textEl.setAttribute('y', bbox.y + bbox.height / 2 + 4);
    textEl.setAttribute('font-size', '10');
    textEl.setAttribute('font-family', 'Consolas, monospace');
    textEl.setAttribute('fill', '#00e5ff');
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
 */
function updateActuator(id, value) {
    const wrapper = getSemanticElement(id);
    if (!wrapper) return;

    const tg = wrapper.querySelector(':scope > g[transform]');
    if (!tg) return;

    // Aplica cor em todos os paths exceto o primeiro (linha de haste)
    const paths = tg.querySelectorAll('path');
    const color = value < 5   ? '#546e7a'   // fechada → cinza
                : value < 40  ? '#ef5350'   // quase fechada → vermelho
                : value < 80  ? '#ffa726'   // parcial → laranja
                :               '#66bb6a';  // aberta → verde

    paths.forEach((p, i) => {
        if (i === 0) return;  // linha de haste — não colorir
        p.style.fill = color;
        p.style.fillOpacity = '0.85';
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
