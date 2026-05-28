'use strict';

// ── Variable metadata ────────────────────────────────────────────────────────

const XMEAS_META = [
  { key: 'xmeas_1',  label: 'A Feed (Stream 1)',        unit: 'kscmh' },
  { key: 'xmeas_2',  label: 'D Feed (Stream 2)',        unit: 'kg/h'  },
  { key: 'xmeas_3',  label: 'E Feed (Stream 3)',        unit: 'kg/h'  },
  { key: 'xmeas_4',  label: 'A+C Feed (Stream 4)',      unit: 'kscmh' },
  { key: 'xmeas_5',  label: 'Recycle Flow',             unit: 'kscmh' },
  { key: 'xmeas_6',  label: 'Reactor Feed Rate',        unit: 'kscmh' },
  { key: 'xmeas_7',  label: 'Reactor Pressure',         unit: 'kPa'   },
  { key: 'xmeas_8',  label: 'Reactor Level',            unit: '%'     },
  { key: 'xmeas_9',  label: 'Reactor Temperature',      unit: '°C'    },
  { key: 'xmeas_10', label: 'Purge Rate',               unit: 'kscmh' },
  { key: 'xmeas_11', label: 'Separator Temperature',    unit: '°C'    },
  { key: 'xmeas_12', label: 'Separator Level',          unit: '%'     },
  { key: 'xmeas_13', label: 'Separator Pressure',       unit: 'kPa'   },
  { key: 'xmeas_14', label: 'Separator Underflow',      unit: 'm³/h'  },
  { key: 'xmeas_15', label: 'Stripper Level',           unit: '%'     },
  { key: 'xmeas_16', label: 'Stripper Pressure',        unit: 'kPa'   },
  { key: 'xmeas_17', label: 'Stripper Underflow',       unit: 'm³/h'  },
  { key: 'xmeas_18', label: 'Stripper Temperature',     unit: '°C'    },
  { key: 'xmeas_19', label: 'Stripper Steam',           unit: 'kg/h'  },
  { key: 'xmeas_20', label: 'Compressor Work',          unit: 'kW'    },
  { key: 'xmeas_21', label: 'Reactor CW Outlet Temp',   unit: '°C'    },
  { key: 'xmeas_22', label: 'Separator CW Outlet Temp', unit: '°C'    },
  { key: 'xmeas_23', label: 'Feed Comp A (Analyser)',   unit: 'mol%'  },
  { key: 'xmeas_24', label: 'Feed Comp B (Analyser)',   unit: 'mol%'  },
  { key: 'xmeas_25', label: 'Feed Comp C (Analyser)',   unit: 'mol%'  },
  { key: 'xmeas_26', label: 'Feed Comp D (Analyser)',   unit: 'mol%'  },
  { key: 'xmeas_27', label: 'Feed Comp E (Analyser)',   unit: 'mol%'  },
  { key: 'xmeas_28', label: 'Feed Comp F (Analyser)',   unit: 'mol%'  },
  { key: 'xmeas_29', label: 'Purge Comp A (Analyser)',  unit: 'mol%'  },
  { key: 'xmeas_30', label: 'Purge Comp B (Analyser)',  unit: 'mol%'  },
  { key: 'xmeas_31', label: 'Purge Comp C (Analyser)',  unit: 'mol%'  },
  { key: 'xmeas_32', label: 'Purge Comp D (Analyser)',  unit: 'mol%'  },
  { key: 'xmeas_33', label: 'Purge Comp E (Analyser)',  unit: 'mol%'  },
  { key: 'xmeas_34', label: 'Purge Comp F (Analyser)',  unit: 'mol%'  },
  { key: 'xmeas_35', label: 'Purge Comp G (Analyser)',  unit: 'mol%'  },
  { key: 'xmeas_36', label: 'Purge Comp H (Analyser)',  unit: 'mol%'  },
  { key: 'xmeas_37', label: 'Product Comp D (Analyser)',unit: 'mol%'  },
  { key: 'xmeas_38', label: 'Product Comp E (Analyser)',unit: 'mol%'  },
  { key: 'xmeas_39', label: 'Product Comp F (Analyser)',unit: 'mol%'  },
  { key: 'xmeas_40', label: 'Product Comp G (Analyser)',unit: 'mol%'  },
  { key: 'xmeas_41', label: 'Product Comp H (Analyser)',unit: 'mol%'  },
];

const XMV_META = [
  { key: 'xmv_1',  label: 'D Feed Valve (Stream 2)',    unit: '%' },
  { key: 'xmv_2',  label: 'E Feed Valve (Stream 3)',    unit: '%' },
  { key: 'xmv_3',  label: 'A Feed Valve (Stream 1)',    unit: '%' },
  { key: 'xmv_4',  label: 'A+C Feed Valve (Stream 4)',  unit: '%' },
  { key: 'xmv_5',  label: 'Compressor Recycle Valve',   unit: '%' },
  { key: 'xmv_6',  label: 'Purge Valve',                unit: '%' },
  { key: 'xmv_7',  label: 'Separator Liq. Outlet',      unit: '%' },
  { key: 'xmv_8',  label: 'Stripper Liq. Outlet',       unit: '%' },
  { key: 'xmv_9',  label: 'Stripper Steam Valve',       unit: '%' },
  { key: 'xmv_10', label: 'Reactor CW Flow',            unit: '%' },
  { key: 'xmv_11', label: 'Condenser CW Flow',          unit: '%' },
  { key: 'xmv_12', label: 'Agitator Speed',             unit: '%' },
];

const ALL_VARS = [...XMEAS_META, ...XMV_META];
const VAR_MAP  = Object.fromEntries(ALL_VARS.map(v => [v.key, v]));

// ISA-101 palette — calm, distinguishable, not rainbow
const SERIES_COLORS = [
  '#4fc3f7', '#66bb6a', '#ffd54f', '#ef9a9a', '#ce93d8',
  '#80cbc4', '#ffcc80', '#90caf9', '#a5d6a7', '#f48fb1',
];

// ── State ────────────────────────────────────────────────────────────────────

let _sessions      = [];
let _selectedSid   = null;   // session being viewed
let _activeCapture = null;   // {session_id, name} or null
let _slots         = [];     // array of SlotState
let _activeSlotIdx = 0;

// ── Slot ─────────────────────────────────────────────────────────────────────

class Slot {
  constructor(idx) {
    this.idx        = idx;
    this.echart     = null;
    this.el         = null;
    this.selectedKeys = [];
  }

  build() {
    const el = document.createElement('div');
    el.className = 'chart-slot';
    el.dataset.slotIdx = this.idx;

    el.innerHTML = `
      <div class="slot-header">
        <span class="slot-title">Chart ${this.idx + 1}</span>
        <span class="slot-selected-vars" id="slot-vars-${this.idx}">No variables selected</span>
        <button class="slot-btn-focus" title="Make active for query">◎ Focus</button>
        <button class="slot-btn-clear" title="Clear chart">✕</button>
        <button class="slot-btn-remove" title="Remove slot" style="color:var(--muted)">—</button>
      </div>
      <div class="slot-body">
        <div class="slot-chart" id="slot-chart-${this.idx}"></div>
      </div>
    `;

    el.querySelector('.slot-btn-focus').addEventListener('click', () => setActiveSlot(this.idx));
    el.querySelector('.slot-btn-clear').addEventListener('click', () => this.clear());
    el.querySelector('.slot-btn-remove').addEventListener('click', () => removeSlot(this.idx));

    this.el = el;
    return el;
  }

  initChart() {
    const container = this.el.querySelector(`#slot-chart-${this.idx}`);
    if (!container) return;
    this.echart = echarts.init(container, 'dark', { renderer: 'canvas' });
    this.echart.setOption(_emptyOption());
    window.addEventListener('resize', () => this.echart?.resize());
  }

  setData(labels, seriesMap) {
    if (!this.echart) return;
    this.selectedKeys = Object.keys(seriesMap);
    this._updateVarsLabel();

    // Dual Y axis: XMV (%) on right, everything else on left
    const leftKeys  = this.selectedKeys.filter(k => !k.startsWith('xmv_'));
    const rightKeys = this.selectedKeys.filter(k => k.startsWith('xmv_'));

    const yAxis = [
      { type: 'value', name: leftKeys.length ? '' : '', scale: true, splitLine: { lineStyle: { color: '#2a2a4a' } } },
    ];
    if (rightKeys.length) {
      yAxis.push({ type: 'value', name: '%', scale: true, splitLine: { show: false } });
    }

    const series = this.selectedKeys.map((key, i) => {
      const meta = VAR_MAP[key];
      return {
        name:        meta ? meta.label : key,
        type:        'line',
        data:        seriesMap[key],
        smooth:      false,
        symbol:      'none',
        lineStyle:   { width: 1.5, type: key.startsWith('xmv_') ? 'dashed' : 'solid' },
        itemStyle:   { color: SERIES_COLORS[i % SERIES_COLORS.length] },
        yAxisIndex:  rightKeys.includes(key) ? 1 : 0,
      };
    });

    this.echart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#16213e',
        borderColor: '#2a2a4a',
        textStyle: { color: '#c8ccd8', fontSize: 11 },
        axisPointer: { type: 'cross', lineStyle: { color: '#4fc3f7', opacity: 0.5 } },
      },
      legend: {
        bottom: 4,
        textStyle: { color: '#c8ccd8', fontSize: 10 },
        icon: 'roundRect',
        itemWidth: 14, itemHeight: 3,
      },
      toolbox: {
        right: 8,
        feature: {
          dataZoom: { yAxisIndex: 'none', title: { zoom: 'Zoom', back: 'Reset' } },
          restore:  { title: 'Restore' },
          saveAsImage: { title: 'Save' },
        },
        iconStyle: { borderColor: '#6b7280' },
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0 },
        { type: 'slider', xAxisIndex: 0, height: 20, bottom: 32, borderColor: '#2a2a4a', fillerColor: 'rgba(79,195,247,0.1)' },
      ],
      grid: { left: 50, right: rightKeys.length ? 50 : 16, top: 12, bottom: 72 },
      xAxis: {
        type: 'category',
        data: labels,
        name: 't_h',
        nameLocation: 'end',
        axisLabel: { color: '#6b7280', fontSize: 10 },
        axisLine: { lineStyle: { color: '#2a2a4a' } },
        splitLine: { lineStyle: { color: '#2a2a4a' } },
      },
      yAxis,
      series,
    }, true);

    this.echart.resize();
  }

  clear() {
    this.selectedKeys = [];
    this._updateVarsLabel();
    this.echart?.setOption(_emptyOption(), true);
    saveState();
  }

  _updateVarsLabel() {
    const el = this.el?.querySelector(`#slot-vars-${this.idx}`);
    if (!el) return;
    if (!this.selectedKeys.length) {
      el.textContent = 'No variables selected';
      return;
    }
    el.textContent = this.selectedKeys.map(k => VAR_MAP[k]?.label ?? k).join(', ');
  }
}

function _emptyOption() {
  return {
    backgroundColor: 'transparent',
    xAxis: { type: 'category', data: [], axisLine: { lineStyle: { color: '#2a2a4a' } } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#2a2a4a' } } },
    series: [],
    graphic: [{
      type: 'text',
      left: 'center', top: 'middle',
      style: { text: 'Select a session and variables, then click Query.', fill: '#6b7280', fontSize: 12 },
    }],
  };
}

// ── Slot management ───────────────────────────────────────────────────────────

function addSlot() {
  const idx  = _slots.length;
  const slot = new Slot(idx);
  _slots.push(slot);

  const area = document.getElementById('slots-area');
  const addBtn = document.getElementById('btn-add-slot');
  area.insertBefore(slot.build(), addBtn);
  slot.initChart();

  setActiveSlot(idx);
}

function removeSlot(idx) {
  const slot = _slots[idx];
  if (!slot) return;
  slot.echart?.dispose();
  slot.el?.remove();
  _slots.splice(idx, 1);
  // Renumber remaining slots
  _slots.forEach((s, i) => {
    s.idx = i;
    s.el.dataset.slotIdx = i;
    s.el.querySelector('.slot-title').textContent = `Chart ${i + 1}`;
  });
  if (_slots.length === 0) addSlot();
  else setActiveSlot(Math.min(_activeSlotIdx, _slots.length - 1));
  saveState();
}

function setActiveSlot(idx) {
  _activeSlotIdx = idx;
  _slots.forEach((s, i) => {
    s.el?.classList.toggle('is-active', i === idx);
  });
}

// ── Variable picker ──────────────────────────────────────────────────────────

function buildVarPicker() {
  const container = document.getElementById('var-picker');
  if (!container) return;

  const groups = [
    { label: 'XMEAS — Process (1–22)',  vars: XMEAS_META.slice(0, 22) },
    { label: 'XMEAS — Analysers (23–41)', vars: XMEAS_META.slice(22) },
    { label: 'XMV — Actuators (1–12)',  vars: XMV_META },
  ];

  container.innerHTML = '';
  groups.forEach(g => {
    const details = document.createElement('details');
    details.innerHTML = `<summary>${g.label}</summary><div class="var-list"></div>`;
    const list = details.querySelector('.var-list');
    g.vars.forEach(v => {
      const item = document.createElement('div');
      item.className = 'var-item';
      item.innerHTML = `
        <input type="checkbox" id="var-${v.key}" data-key="${v.key}">
        <label for="var-${v.key}">${v.label} <span class="unit">${v.unit}</span></label>
      `;
      list.appendChild(item);
    });
    container.appendChild(details);
  });
}

function getSelectedVarKeys() {
  return Array.from(document.querySelectorAll('#var-picker input[type="checkbox"]:checked'))
    .map(cb => cb.dataset.key);
}

// ── Session management ───────────────────────────────────────────────────────

async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    _sessions = await res.json();
    renderSessionSelect();
  } catch (e) {
    console.error('[analytics] failed to load sessions:', e);
  }
}

function renderSessionSelect() {
  const sel = document.getElementById('session-select');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— select session —</option>';
  _sessions.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    const date = new Date(s.started_at * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const pts  = s.point_count ?? 0;
    const active = s.ended_at == null ? ' ●' : '';
    opt.textContent = `${s.name}${active} — ${date} (${pts} pts)`;
    sel.appendChild(opt);
  });
  if (cur) sel.value = cur;
  onSessionChange();
}

function onSessionChange() {
  const sel = document.getElementById('session-select');
  _selectedSid = sel.value ? parseInt(sel.value) : null;
  saveState();
  const session = _sessions.find(s => s.id === _selectedSid);

  const metaEl  = document.getElementById('session-meta');
  const expBtn  = document.getElementById('btn-export-session');
  const delBtn  = document.getElementById('btn-delete-session');

  if (!session) {
    metaEl.textContent = '';
    expBtn.disabled = true;
    delBtn.disabled = true;
    return;
  }

  const start = new Date(session.started_at * 1000).toLocaleString('pt-BR');
  const end   = session.ended_at ? new Date(session.ended_at * 1000).toLocaleString('pt-BR') : 'recording…';
  const range = session.t_h_start != null
    ? `t_h: ${session.t_h_start?.toFixed(2)} – ${session.t_h_end?.toFixed(2)}`
    : '';
  metaEl.textContent = `${start} → ${end}\n${range}`.trim();
  expBtn.disabled = false;
  delBtn.disabled = false;
}

async function loadCaptureStatus() {
  try {
    const res  = await fetch('/api/capture/status');
    const data = await res.json();
    _activeCapture = data.active ? data : null;
    updateCaptureUI();
  } catch (e) {
    console.error('[analytics] failed to get capture status:', e);
  }
}

function updateCaptureUI() {
  const dot   = document.getElementById('capture-dot');
  const label = document.getElementById('capture-label');
  const start = document.getElementById('btn-start-capture');
  const stop  = document.getElementById('btn-stop-capture');
  const nameInput = document.getElementById('capture-name');

  if (_activeCapture) {
    dot.className = 'dot dot-active';
    label.textContent = `recording: ${_activeCapture.session?.name ?? ''}`;
    start.disabled = true;
    stop.disabled  = false;
    nameInput.disabled = true;
  } else {
    dot.className = 'dot dot-idle';
    label.textContent = 'idle';
    start.disabled = false;
    stop.disabled  = true;
    nameInput.disabled = false;
  }
}

async function startCapture() {
  const name = document.getElementById('capture-name').value.trim();
  if (!name) { alert('Enter a session name before starting.'); return; }
  const res = await fetch('/api/capture/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) { alert(await res.text()); return; }
  await loadCaptureStatus();
  await loadSessions();
}

async function stopCapture() {
  const res = await fetch('/api/capture/stop', { method: 'POST' });
  if (!res.ok) { alert(await res.text()); return; }
  await loadCaptureStatus();
  await loadSessions();
}

async function exportSession() {
  if (!_selectedSid) return;
  window.location.href = `/api/sessions/${_selectedSid}/export`;
}

async function deleteSession() {
  if (!_selectedSid) return;
  if (!confirm('Delete this session and all its data?')) return;
  const res = await fetch(`/api/sessions/${_selectedSid}`, { method: 'DELETE' });
  if (!res.ok) { alert(await res.text()); return; }
  _selectedSid = null;
  await loadSessions();
}

// ── State persistence ─────────────────────────────────────────────────────────

const _STORAGE_KEY = 'tep_analytics_v1';

function saveState() {
  try {
    localStorage.setItem(_STORAGE_KEY, JSON.stringify({
      selectedSid:     _selectedSid,
      selectedVarKeys: getSelectedVarKeys(),
      thFrom:          document.getElementById('th-from')?.value ?? '',
      thTo:            document.getElementById('th-to')?.value   ?? '',
      slots:           _slots.map(s => ({ selectedKeys: s.selectedKeys })),
    }));
  } catch (_) {}
}

function _loadSavedState() {
  try {
    const raw = localStorage.getItem(_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

// ── Query ────────────────────────────────────────────────────────────────────

async function _querySlot(slot, varKeys, sessionId, thFrom, thTo) {
  const params = new URLSearchParams({ session_id: sessionId, vars: varKeys.join(',') });
  if (thFrom) params.set('from_th', thFrom);
  if (thTo)   params.set('to_th',   thTo);
  const res = await fetch(`/api/history?${params}`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  slot.setData(data.labels, data.series);
}

async function queryActiveSlot() {
  if (!_selectedSid) { alert('Select a session first.'); return; }
  const varKeys = getSelectedVarKeys();
  if (!varKeys.length) { alert('Select at least one variable.'); return; }

  const slot = _slots[_activeSlotIdx];
  if (!slot) return;

  const thFrom = document.getElementById('th-from').value;
  const thTo   = document.getElementById('th-to').value;

  const btn = document.getElementById('btn-query');
  btn.textContent = '…';
  btn.disabled = true;

  try {
    await _querySlot(slot, varKeys, _selectedSid, thFrom, thTo);
    saveState();
  } catch (e) {
    alert('Query failed: ' + e.message);
  } finally {
    btn.textContent = 'Query selected chart';
    btn.disabled = false;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const saved = _loadSavedState();

  buildVarPicker();

  // Restore var picker selection before building slots
  if (saved?.selectedVarKeys?.length) {
    saved.selectedVarKeys.forEach(key => {
      const cb = document.querySelector(`#var-picker input[data-key="${key}"]`);
      if (cb) cb.checked = true;
    });
  }

  // Restore time range
  if (saved?.thFrom) document.getElementById('th-from').value = saved.thFrom;
  if (saved?.thTo)   document.getElementById('th-to').value   = saved.thTo;

  await loadSessions();
  await loadCaptureStatus();

  // Restore session selection (must happen after loadSessions so the option exists)
  if (saved?.selectedSid) {
    const sel = document.getElementById('session-select');
    sel.value = String(saved.selectedSid);
    onSessionChange();
  }

  // Restore slots: first slot was already added by addSlot() above — but we haven't called it yet
  const slotCount = saved?.slots?.length ?? 1;
  for (let i = 0; i < slotCount; i++) addSlot();

  // Re-query slots that had data
  if (saved?.slots?.length && _selectedSid) {
    const thFrom = document.getElementById('th-from').value;
    const thTo   = document.getElementById('th-to').value;
    for (let i = 0; i < saved.slots.length; i++) {
      const keys = saved.slots[i]?.selectedKeys;
      if (keys?.length && _slots[i]) {
        _querySlot(_slots[i], keys, _selectedSid, thFrom, thTo).catch(() => {});
      }
    }
  }

  document.getElementById('session-select').addEventListener('change', onSessionChange);
  document.getElementById('btn-refresh-sessions').addEventListener('click', loadSessions);
  document.getElementById('btn-export-session').addEventListener('click', exportSession);
  document.getElementById('btn-delete-session').addEventListener('click', deleteSession);
  document.getElementById('btn-start-capture').addEventListener('click', startCapture);
  document.getElementById('btn-stop-capture').addEventListener('click', stopCapture);
  document.getElementById('btn-add-slot').addEventListener('click', addSlot);
  document.getElementById('btn-query').addEventListener('click', queryActiveSlot);

  // Save state when time range changes
  document.getElementById('th-from').addEventListener('change', saveState);
  document.getElementById('th-to').addEventListener('change',   saveState);

  // Poll capture status every 5 seconds to reflect state if changed via IHM
  setInterval(loadCaptureStatus, 5000);
  // Refresh session list every 10 seconds when a capture is active
  setInterval(async () => {
    if (_activeCapture) await loadSessions();
  }, 10000);
});
