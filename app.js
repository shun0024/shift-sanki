/* シフト表アプリ  -  単一HTML / localStorage 保存 / Excel 取込・書出し */
(function () {
  'use strict';

  const STORAGE_KEY = 'shiftapp.v1';
  const DOW = ['日', '月', '火', '水', '木', '金', '土'];
  const TYPE_LABEL = { office: '事務所', float: 'FLOAT', pickup: '平日集荷', sunday: '日曜集荷', off: '休み', other: 'その他' };
  const TYPE_ORDER = ['office', 'float', 'pickup', 'sunday', 'off', 'other'];

  // ---------- 初期マスタ（元スプレッドシートの条件付き書式の色を踏襲） ----------
  // 元スプレッドシートの配色をベースに、全セル黒文字で読めるトーンに統一
  const DEFAULT_CODES = [
    { name: '事務所', short: '事務所', color: '#FFFFCC', type: 'office' },
    { name: 'FLOAT', short: 'FLOAT', color: '#F6B26B', type: 'float' },
    { name: '豊洲①', short: '豊洲①', color: '#95DCF7', type: 'pickup' },
    { name: '豊洲②', short: '豊洲②', color: '#B4E5FA', type: 'pickup' },
    { name: '豊洲・KFT', short: 'KFT', color: '#9FC5E8', type: 'pickup' },
    { name: 'キッコーマン', short: 'ｷｯｺｰﾏﾝ', color: '#B4A7D6', type: 'pickup' },
    { name: '霞ヶ浦C', short: '霞ヶ浦', color: '#A2D9CE', type: 'pickup' },
    { name: 'Proximar', short: 'Proxi', color: '#83CAEB', type: 'pickup' },
    { name: '営業臨時回収', short: '臨時回収', color: '#84E291', type: 'pickup' },
    { name: '角上C', short: '角上', color: '#66FFFF', type: 'sunday' },
    { name: 'ベニマルC', short: 'ベニマル', color: '#66FFFF', type: 'sunday' },
    { name: '池袋C', short: '池袋', color: '#66FFFF', type: 'sunday' },
    { name: '会議', short: '会議', color: '#FFFF00', type: 'other' },
    { name: '外出', short: '外出', color: '#FAE2D5', type: 'other' },
    { name: '豊洲応援', short: '豊洲応援', color: '#CAEDFB', type: 'other' },
    { name: '休み', short: '休み', color: '#F1CEEE', type: 'off' },
    { name: '有給休暇', short: '有給', color: '#E49EDD', type: 'off' },
  ];
  const PALETTE_VERSION = 3;
  const DEFAULT_TARGETS = [
    { code: '豊洲①', num: 2, sun: 0 },
    { code: '豊洲②', num: 1, sun: 0 },
    { code: '豊洲・KFT', num: 1, sun: 0 },
    { code: 'Proximar', num: null, sun: null },
    { code: '霞ヶ浦C', num: 1, sun: 0 },
    { code: '営業臨時回収', num: null, sun: null },
  ];
  const SEP_DEFAULT = new Set(['嶋根', '田邊(恭)']);

  // ---------- state ----------
  let state = null;          // { version, codes, targets, months: { 'YYYY-MM': { staff:[{id,name,sep}], shifts:{id:{day:{a,n}}} } } }
  let cur = { y: 0, m: 0 };  // 表示中の月
  let view = 'grid';
  let sel = null;            // { id, day }
  let filterCode = null;     // 凡例フィルタ
  let dayViewDate = null;
  const undoStack = [], redoStack = [];

  // ---------- utils ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const pad = n => String(n).padStart(2, '0');
  const ym = (y, m) => `${y}-${pad(m)}`;
  const daysIn = (y, m) => new Date(y, m, 0).getDate();
  const dow = (y, m, d) => new Date(y, m - 1, d).getDay();
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wareki = y => (y >= 2019 ? `R${y - 2018}` : `H${y - 1988}`);
  const clone = o => JSON.parse(JSON.stringify(o));

  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg; t.classList.toggle('error', !!isErr); t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), isErr ? 5000 : 2500);
  }
  function textColor(hex) {
    const c = hex.replace('#', ''); if (c.length < 6) return '#000';
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 120 ? '#111' : '#fff';
  }
  function codeOf(name) {
    if (!name) return null;
    const exact = state.codes.find(c => c.name === name);
    if (exact) return exact;
    return state.codes.find(c => name.includes(c.name) || c.name.includes(name)) || null;
  }
  function colorOf(name) { const c = codeOf(name); return c ? c.color : (name ? '#eeeeee' : ''); }
  function shortOf(name) { const c = state.codes.find(x => x.name === name); return (c && c.short) ? c.short : name; }
  function typeOf(name) { const c = codeOf(name); return c ? c.type : (name ? 'other' : null); }

  // ---------- storage ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state = JSON.parse(raw);
        if (state && state.months) {
          if ((state.palette || 1) < PALETTE_VERSION) {
            state.codes.forEach(c => { const d = DEFAULT_CODES.find(x => x.name === c.name); if (d) { c.color = d.color; if (!c.short) c.short = d.short; } });
            state.palette = PALETTE_VERSION;
          }
          return;
        }
      }
    } catch (e) { console.warn(e); }
    state = freshState();
  }
  function freshState() {
    const s = { version: 1, palette: PALETTE_VERSION, codes: clone(DEFAULT_CODES), targets: clone(DEFAULT_TARGETS), months: {} };
    if (window.SEED) {
      const key = ym(SEED.year, SEED.month);
      const month = { staff: [], shifts: {} };
      SEED.staff.forEach(st => {
        const id = uid();
        month.staff.push({ id, name: st.name, sep: SEP_DEFAULT.has(st.name) });
        month.shifts[id] = clone(st.shifts);
      });
      s.months[key] = month;
    }
    return s;
  }
  function save(opts) {
    state.updatedAt = new Date().toISOString();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('保存に失敗しました: ' + e.message, true); }
    updateStorageInfo();
    if (!(opts && opts.noSync)) sync.schedulePush();
  }

  // ---------- cloud sync (Google Apps Script) ----------
  const SYNC_KEY = 'shiftapp.sync';
  const sync = {
    cfg: { url: '', token: '', enabled: false },
    baseUpdatedAt: '',   // 最後にクラウドと一致した時点の updatedAt
    dirty: false, timer: null, busy: false, status: 'off', lastError: '',
    load() { try { Object.assign(this.cfg, JSON.parse(localStorage.getItem(SYNC_KEY) || '{}')); } catch (e) { } this.baseUpdatedAt = localStorage.getItem(SYNC_KEY + '.base') || ''; },
    saveCfg() { localStorage.setItem(SYNC_KEY, JSON.stringify(this.cfg)); },
    setBase(v) { this.baseUpdatedAt = v || ''; localStorage.setItem(SYNC_KEY + '.base', this.baseUpdatedAt); },
    on() { return this.cfg.enabled && this.cfg.url && this.cfg.token; },
    setStatus(s, msg) { this.status = s; this.lastError = msg || ''; renderSyncBadge(); },
    async call(action, body) {
      const u = new URL(this.cfg.url);
      u.searchParams.set('token', this.cfg.token); u.searchParams.set('action', action);
      // GAS は CORS プリフライトを通さないため、POST は text/plain で送る
      const res = await fetch(u.toString(), body
        ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ token: this.cfg.token, action }, body)), redirect: 'follow' }
        : { method: 'GET', redirect: 'follow' });
      const txt = await res.text();
      let j; try { j = JSON.parse(txt); } catch (e) { throw new Error('応答がJSONではありません（URLがウェブアプリのURLか、アクセス権が「全員」か確認してください）'); }
      return j;
    },
    schedulePush() {
      if (!this.on()) return;
      this.dirty = true; this.setStatus('pending');
      clearTimeout(this.timer); this.timer = setTimeout(() => this.push(), 2000);
    },
    async push(force) {
      if (!this.on() || this.busy) { if (this.busy) this.schedulePush(); return; }
      this.busy = true; this.setStatus('syncing');
      try {
        const j = await this.call('put', { data: state, baseUpdatedAt: this.baseUpdatedAt, force: !!force });
        if (j.ok) { this.dirty = false; this.setBase(j.updatedAt); this.setStatus('ok'); }
        else if (j.error === 'conflict') {
          this.busy = false;
          const remoteTime = j.updatedAt ? new Date(j.updatedAt).toLocaleString('ja-JP') : '不明';
          const localTime = state.updatedAt ? new Date(state.updatedAt).toLocaleString('ja-JP') : '不明';
          const useLocal = confirm(`クラウドに別の端末からの変更があります。\n\nクラウド: ${remoteTime}\nこの端末: ${localTime}\n\n[OK] この端末の内容でクラウドを上書き\n[キャンセル] クラウドの内容を読み込み（この端末の未同期の変更は失われます）`);
          if (useLocal) return this.push(true);
          if (j.data) { applyRemote(j.data); this.setBase(j.updatedAt); this.dirty = false; this.setStatus('ok'); toast('クラウドの内容を読み込みました'); }
          return;
        } else { throw new Error(j.error || 'unknown'); }
      } catch (e) { console.warn(e); this.setStatus('error', e.message); }
      finally { this.busy = false; }
    },
    async pull(silent) {
      if (!this.on() || this.busy) return;
      this.busy = true; this.setStatus('syncing');
      try {
        const j = await this.call('get');
        if (!j.ok) throw new Error(j.error || 'unknown');
        if (!j.data) { // クラウドが空 → この端末の内容を初回アップロード
          this.busy = false; await this.push(true); if (!silent) toast('クラウドに初回アップロードしました'); return;
        }
        if (j.updatedAt && j.updatedAt !== this.baseUpdatedAt) {
          if (this.dirty) { // 両方に変更がある
            const useRemote = confirm('クラウドにもこの端末にも未同期の変更があります。\n\n[OK] クラウドの内容を読み込む（この端末の変更は破棄）\n[キャンセル] この端末の内容でクラウドを上書き');
            if (!useRemote) { this.busy = false; return this.push(true); }
          }
          applyRemote(j.data); this.setBase(j.updatedAt); this.dirty = false;
          if (!silent) toast('クラウドから最新データを読み込みました');
        } else if (this.dirty) { this.busy = false; return this.push(); }
        this.setStatus('ok');
      } catch (e) { console.warn(e); this.setStatus('error', e.message); if (!silent) toast('同期エラー: ' + e.message, true); }
      finally { this.busy = false; }
    },
    async test() {
      const j = await this.call('ping');
      if (!j.ok) throw new Error(j.error === 'unauthorized' ? 'トークンが一致しません' : (j.error || 'unknown'));
      return j;
    }
  };
  function applyRemote(data) {
    if (!data || !data.months || !data.codes) throw new Error('クラウドのデータ形式が不正です');
    state = data;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { }
    undoStack.length = 0; redoStack.length = 0; updateUndoButtons();
    if (!state.months[monthKey()]) ensureStaffForMonth();
    renderAll();
  }
  function renderSyncBadge() {
    const el = $('#syncBadge'); if (!el) return;
    const map = { off: ['未設定', 'off'], pending: ['保存待ち', 'pending'], syncing: ['同期中…', 'syncing'], ok: ['同期済み', 'ok'], error: ['同期エラー', 'error'] };
    const s = sync.on() ? sync.status : 'off';
    const [label, cls] = map[s] || map.off;
    el.textContent = label; el.className = 'sync-badge ' + cls; el.title = sync.lastError || (s === 'off' ? '設定 → クラウド同期 から設定できます' : '');
    el.classList.toggle('hidden', s === 'off');
    const info = $('#syncStatusText'); if (info) info.textContent = s === 'off' ? '未設定' : `${label}${sync.lastError ? '：' + sync.lastError : ''}${sync.baseUpdatedAt ? '（最終同期 ' + new Date(sync.baseUpdatedAt).toLocaleString('ja-JP') + '）' : ''}`;
  }
  function updateStorageInfo() {
    const el = $('#storageInfo'); if (!el) return;
    const size = (localStorage.getItem(STORAGE_KEY) || '').length;
    el.textContent = `保存済み月: ${Object.keys(state.months).sort().join(', ') || 'なし'} / データ量: ${(size / 1024).toFixed(1)} KB`;
  }

  // ---------- month access ----------
  function monthKey() { return ym(cur.y, cur.m); }
  function month(create) {
    let mo = state.months[monthKey()];
    if (!mo && create) { mo = { staff: [], shifts: {} }; state.months[monthKey()] = mo; }
    return mo;
  }
  function getCell(id, d) { const mo = month(); return (mo && mo.shifts[id] && mo.shifts[id][d]) || null; }
  function setCell(id, d, a, n) {
    const mo = month(true);
    if (!mo.shifts[id]) mo.shifts[id] = {};
    a = (a || '').trim(); n = (n || '').trim();
    if (!a && !n) delete mo.shifts[id][d];
    else { const o = {}; if (a) o.a = a; if (n) o.n = n; mo.shifts[id][d] = o; }
  }
  function prevMonthKey() { const y = cur.m === 1 ? cur.y - 1 : cur.y, m = cur.m === 1 ? 12 : cur.m - 1; return ym(y, m); }
  function ensureStaffForMonth() {
    // 新しい月を開いたとき、直近の月のスタッフ構成を引き継ぐ
    if (month()) return;
    const keys = Object.keys(state.months).sort();
    const before = keys.filter(k => k < monthKey());
    const src = before.length ? state.months[before[before.length - 1]] : (keys.length ? state.months[keys[0]] : null);
    const mo = month(true);
    if (src) mo.staff = clone(src.staff);
  }

  // ---------- undo ----------
  function snapshot() {
    undoStack.push(JSON.stringify({ key: monthKey(), month: month(true) }));
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0; updateUndoButtons();
  }
  function restore(snap) {
    const o = JSON.parse(snap);
    const [y, m] = o.key.split('-').map(Number);
    state.months[o.key] = o.month;
    if (y !== cur.y || m !== cur.m) { cur = { y, m }; }
    save(); renderAll();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify({ key: monthKey(), month: month(true) }));
    restore(undoStack.pop()); updateUndoButtons();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify({ key: monthKey(), month: month(true) }));
    restore(redoStack.pop()); updateUndoButtons();
  }
  function updateUndoButtons() { $('#undoBtn').disabled = !undoStack.length; $('#redoBtn').disabled = !redoStack.length; }

  // ---------- counts ----------
  function countCodeOnDay(code, d) {
    const mo = month(); if (!mo) return 0;
    return mo.staff.reduce((n, s) => { const c = getCell(s.id, d); return n + (c && c.a === code ? 1 : 0); }, 0);
  }
  function staffCategoryCounts(id) {
    const res = { office: 0, float: 0, pickup: 0, sunday: 0, off: 0, other: 0, byCode: {} };
    const nd = daysIn(cur.y, cur.m);
    for (let d = 1; d <= nd; d++) {
      const c = getCell(id, d); if (!c || !c.a) continue;
      const t = typeOf(c.a); res[t] = (res[t] || 0) + 1;
      res.byCode[c.a] = (res.byCode[c.a] || 0) + 1;
    }
    return res;
  }
  function targetFor(t, d) { return dow(cur.y, cur.m, d) === 0 ? t.sun : t.num; }
  function targetClass(t, d) {
    const need = targetFor(t, d), n = countCodeOnDay(t.code, d);
    if (need == null || need === '') return n ? 'info' : '';
    if (n < need) return 'under'; if (n > need) return 'over'; return 'ok';
  }

  // ---------- render: header ----------
  function renderHeader() {
    $('#monthPicker').value = ym(cur.y, cur.m);
    document.title = `シフト表 ${cur.y}年${cur.m}月`;
  }

  // ---------- render: legend ----------
  function renderLegend() {
    const el = $('#legend');
    el.innerHTML = state.codes.map(c =>
      `<span class="chip ${filterCode ? (filterCode === c.name ? 'active' : 'dim') : ''}" data-code="${esc(c.name)}" style="background:${c.color};color:${textColor(c.color)}">${esc(c.name)}</span>`).join('');
    $$('.chip', el).forEach(ch => ch.onclick = () => { filterCode = filterCode === ch.dataset.code ? null : ch.dataset.code; renderLegend(); renderGrid(); });
  }

  // ---------- render: grid ----------
  function renderGrid() {
    const wrap = $('#gridWrap');
    const mo = month(true);
    const nd = daysIn(cur.y, cur.m);
    const showNotes = $('#showNotes').checked, showCounts = $('#showCounts').checked;
    const today = new Date(); const isThisMonth = today.getFullYear() === cur.y && today.getMonth() + 1 === cur.m;
    const dcls = d => { const w = dow(cur.y, cur.m, d); return w === 0 ? 'sun' : w === 6 ? 'sat' : w === 3 ? 'wed' : ''; };

    let h = '<table class="grid"><thead><tr>';
    h += `<th class="name">${wareki(cur.y)}.${cur.m}<span class="dow">${cur.y}年${cur.m}月</span></th>`;
    for (let d = 1; d <= nd; d++) h += `<th class="day ${dcls(d)} ${isThisMonth && today.getDate() === d ? 'today' : ''}">${d}<span class="dow">${DOW[dow(cur.y, cur.m, d)]}</span></th>`;
    h += '<th class="total">休み</th><th class="total">出勤</th></tr></thead><tbody>';

    if (!mo.staff.length) {
      h += `<tr><td colspan="${nd + 3}" style="padding:20px;color:#6b7280">スタッフが登録されていません。「設定」タブから追加するか、Excelを取り込んでください。</td></tr>`;
    }
    mo.staff.forEach((s, i) => {
      if (s.sep && i > 0) h += `<tr class="group-head"><td colspan="${nd + 3}"></td></tr>`;
      const cat = staffCategoryCounts(s.id);
      const work = nd - cat.off; // 休み以外=出勤扱い（空欄含む）。
      h += `<tr class="main" data-id="${s.id}"><td class="name" title="${esc(s.name)}">${esc(s.name)}</td>`;
      for (let d = 1; d <= nd; d++) {
        const c = getCell(s.id, d); const a = c ? c.a : '';
        const col = a ? colorOf(a) : '';
        const fo = filterCode && a !== filterCode ? 'filtered-out' : '';
        const selc = sel && sel.id === s.id && sel.day === d ? 'sel' : '';
        h += `<td class="cell ${dcls(d)} ${fo} ${selc}" data-id="${s.id}" data-day="${d}" data-kind="a" style="${col ? `background:${col};color:${textColor(col)}` : ''}" title="${esc(a)}${c && c.n ? '\n' + esc(c.n) : ''}"><span>${esc(shortOf(a))}</span></td>`;
      }
      h += `<td class="total">${cat.off || ''}</td><td class="total">${work}</td></tr>`;
      if (showNotes) {
        h += `<tr class="note" data-id="${s.id}"><td class="name">メモ</td>`;
        for (let d = 1; d <= nd; d++) {
          const c = getCell(s.id, d); const n = c ? (c.n || '') : '';
          h += `<td class="cell ${dcls(d)}" data-id="${s.id}" data-day="${d}" data-kind="n" title="${esc(n)}"><span>${esc(n)}</span></td>`;
        }
        h += '<td class="total"></td><td class="total"></td></tr>';
      }
    });

    if (showCounts && state.targets.length) {
      state.targets.forEach((t, i) => {
        const col = colorOf(t.code);
        h += `<tr class="count ${i === 0 ? 'first' : ''}"><td class="name" style="background:${col};color:${textColor(col)}">${esc(t.code)}</td>`;
        for (let d = 1; d <= nd; d++) {
          const n = countCodeOnDay(t.code, d); const need = targetFor(t, d);
          const cls = targetClass(t, d);
          h += `<td class="${cls} ${dcls(d)}" title="${need == null ? '' : '必要 ' + need}">${n}${need == null || need === '' ? '' : `<small style="opacity:.55">/${need}</small>`}</td>`;
        }
        h += '<td class="total" colspan="2"></td></tr>';
      });
    }
    h += '</tbody></table>';
    wrap.innerHTML = h;

    $$('td.cell', wrap).forEach(td => {
      td.addEventListener('click', e => { openEditor(td.dataset.id, +td.dataset.day, td.dataset.kind === 'n'); });
    });
    fitCellText(wrap);
  }
  // セル幅に収まらない文字は縮小して全体を表示する（セル幅は広げない）
  function fitCellText(wrap) {
    const spans = $$('td.cell > span', wrap).filter(sp => sp.textContent);
    const pad = 3;
    const items = spans.map(sp => ({ sp, w: sp.scrollWidth, avail: sp.parentElement.clientWidth - pad }));
    items.forEach(({ sp, w, avail }) => {
      if (w <= avail || avail <= 0) return;
      // まず字間を詰め、それでも収まらなければ最小限だけ縮小（略称があるので通常ここには来ない）
      sp.style.letterSpacing = '-0.05em';
      const w2 = sp.scrollWidth;
      if (w2 > avail) {
        const base = parseFloat(getComputedStyle(sp).fontSize);
        sp.style.fontSize = Math.max(8, Math.floor(base * avail / w2 * 10) / 10) + 'px';
      }
    });
  }
  let fitTimer; window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { if (view === 'grid') renderGrid(); }, 150); });

  // ---------- cell editor ----------
  const ed = {
    el: null, id: null, day: null,
    open(id, day, focusNote) {
      this.id = id; this.day = day;
      sel = { id, day };
      const s = month().staff.find(x => x.id === id);
      const c = getCell(id, day) || {};
      $('#ceTitle').textContent = `${s ? s.name : ''}  ${cur.m}/${day}(${DOW[dow(cur.y, cur.m, day)]})`;
      $('#ceCodes').innerHTML = state.codes.map(cd =>
        `<button data-code="${esc(cd.name)}" class="${c.a === cd.name ? 'current' : ''}" style="background:${cd.color};color:${textColor(cd.color)}">${esc(cd.name)}</button>`).join('');
      $$('#ceCodes button').forEach(b => b.onclick = () => { $('#ceCustom').value = b.dataset.code; this.commit(true); });
      $('#ceCustom').value = c.a || '';
      $('#ceNote').value = c.n || '';
      this.el.classList.remove('hidden');
      this.position();
      (focusNote ? $('#ceNote') : $('#ceCustom')).focus();
      (focusNote ? $('#ceNote') : $('#ceCustom')).select();
      highlightSel();
    },
    position() {
      const td = $(`td.cell[data-id="${this.id}"][data-day="${this.day}"][data-kind="a"]`);
      if (!td) return;
      const r = td.getBoundingClientRect(), w = this.el.offsetWidth, hgt = this.el.offsetHeight;
      let left = r.left, top = r.bottom + 4;
      if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
      if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 4);
      this.el.style.left = left + 'px'; this.el.style.top = top + 'px';
    },
    commit(close) {
      const a = $('#ceCustom').value, n = $('#ceNote').value;
      const before = getCell(this.id, this.day) || {};
      if ((before.a || '') !== a.trim() || (before.n || '') !== n.trim()) {
        snapshot(); setCell(this.id, this.day, a, n); save(); renderGrid();
      }
      if (close) this.close();
    },
    clear() { snapshot(); setCell(this.id, this.day, '', ''); save(); renderGrid(); this.close(); },
    close() { this.el.classList.add('hidden'); highlightSel(); },
    move(dd, di) {
      this.commit(false);
      const mo = month(); const nd = daysIn(cur.y, cur.m);
      let idx = mo.staff.findIndex(s => s.id === this.id); let d = this.day + dd; idx += di;
      if (d > nd) { d = 1; idx++; } if (d < 1) { d = nd; idx--; }
      if (idx < 0 || idx >= mo.staff.length) return;
      this.open(mo.staff[idx].id, d, document.activeElement === $('#ceNote'));
      const td = $(`td.cell[data-id="${mo.staff[idx].id}"][data-day="${d}"][data-kind="a"]`);
      if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };
  function openEditor(id, day, focusNote) { ed.open(id, day, focusNote); }
  function highlightSel() {
    $$('td.cell.sel').forEach(t => t.classList.remove('sel'));
    if (sel) $$(`td.cell[data-id="${sel.id}"][data-day="${sel.day}"]`).forEach(t => t.classList.add('sel'));
  }
  function initEditor() {
    ed.el = $('#cellEditor');
    $('#ceClose').onclick = () => ed.close();
    $('#ceOk').onclick = () => ed.commit(true);
    $('#ceClear').onclick = () => ed.clear();
    ['#ceCustom', '#ceNote'].forEach(sl => {
      $(sl).addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); ed.commit(true); }
        else if (e.key === 'Escape') { e.preventDefault(); ed.close(); }
        else if (e.key === 'Tab') { e.preventDefault(); ed.move(e.shiftKey ? -1 : 1, 0); }
        else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); ed.move(0, 1); }
        else if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); ed.move(0, -1); }
      });
    });
    document.addEventListener('mousedown', e => {
      if (ed.el.classList.contains('hidden')) return;
      if (ed.el.contains(e.target) || e.target.closest('td.cell')) return;
      ed.commit(true);
    });
    window.addEventListener('resize', () => { if (!ed.el.classList.contains('hidden')) ed.position(); });
    $('#gridWrap').addEventListener('scroll', () => { if (!ed.el.classList.contains('hidden')) ed.position(); });
    // datalists
    refreshDatalists();
  }
  function refreshDatalists() {
    $('#codeDatalist').innerHTML = state.codes.map(c => `<option value="${esc(c.name)}">`).join('');
    const notes = new Set();
    Object.values(state.months).forEach(mo => Object.values(mo.shifts).forEach(sh => Object.values(sh).forEach(c => { if (c.n) notes.add(c.n); })));
    $('#noteDatalist').innerHTML = Array.from(notes).sort().map(n => `<option value="${esc(n)}">`).join('');
  }

  // ---------- keyboard on grid ----------
  function initKeys() {
    document.addEventListener('keydown', e => {
      const inInput = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inInput) { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !inInput) { e.preventDefault(); redo(); return; }
      if (view !== 'grid' || inInput || !sel) return;
      const mo = month(); const nd = daysIn(cur.y, cur.m);
      let idx = mo.staff.findIndex(s => s.id === sel.id); let d = sel.day;
      const moveTo = () => { sel = { id: mo.staff[idx].id, day: d }; highlightSel(); const td = $(`td.cell[data-id="${sel.id}"][data-day="${d}"][data-kind="a"]`); if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); };
      switch (e.key) {
        case 'ArrowLeft': if (d > 1) { d--; moveTo(); } e.preventDefault(); break;
        case 'ArrowRight': if (d < nd) { d++; moveTo(); } e.preventDefault(); break;
        case 'ArrowUp': if (idx > 0) { idx--; moveTo(); } e.preventDefault(); break;
        case 'ArrowDown': if (idx < mo.staff.length - 1) { idx++; moveTo(); } e.preventDefault(); break;
        case 'Enter': case 'F2': openEditor(sel.id, sel.day, false); e.preventDefault(); break;
        case 'Delete': case 'Backspace': snapshot(); setCell(sel.id, sel.day, '', ''); save(); renderGrid(); e.preventDefault(); break;
        case 'c': if (e.ctrlKey || e.metaKey) { const c = getCell(sel.id, sel.day); initKeys.clip = c ? clone(c) : {}; toast('コピーしました'); e.preventDefault(); } break;
        case 'v': if ((e.ctrlKey || e.metaKey) && initKeys.clip) { snapshot(); setCell(sel.id, sel.day, initKeys.clip.a, initKeys.clip.n); save(); renderGrid(); e.preventDefault(); } break;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { openEditor(sel.id, sel.day, false); $('#ceCustom').value = ''; }
      }
    });
  }

  // ---------- day view ----------
  function renderDay() {
    const nd = daysIn(cur.y, cur.m);
    if (!dayViewDate || dayViewDate.y !== cur.y || dayViewDate.m !== cur.m) {
      const t = new Date(); dayViewDate = { y: cur.y, m: cur.m, d: (t.getFullYear() === cur.y && t.getMonth() + 1 === cur.m) ? t.getDate() : 1 };
    }
    const d = dayViewDate.d;
    $('#dayPicker').value = `${cur.y}-${pad(cur.m)}-${pad(d)}`;
    const mo = month(true);
    const byCode = {};
    mo.staff.forEach(s => { const c = getCell(s.id, d); const k = c && c.a ? c.a : '（未入力）'; (byCode[k] = byCode[k] || []).push({ s, c }); });
    const order = Object.keys(byCode).sort((a, b) => {
      const ia = state.codes.findIndex(c => c.name === a), ib = state.codes.findIndex(c => c.name === b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, 'ja');
    });
    let h = `<div class="day-wrap"><div class="card"><h3>${cur.m}月${d}日 (${DOW[dow(cur.y, cur.m, d)]}) 配置別<small>${mo.staff.length}名</small></h3><div class="group-by-code">`;
    order.forEach(k => {
      const t = state.targets.find(x => x.code === k); const need = t ? targetFor(t, d) : null;
      const list = byCode[k]; const under = need != null && need !== '' && list.length < need;
      const col = k === '（未入力）' ? '#f1f5f9' : colorOf(k);
      h += `<div class="gcode ${under ? 'under' : ''}"><div class="gname" style="background:${col};color:${textColor(col)}">${esc(k)}</div><div class="gmembers">${list.map(x => `<span>${esc(x.s.name)}${x.c && x.c.n ? ` <small>(${esc(x.c.n)})</small>` : ''}</span>`).join('')}</div><div class="gcount">${list.length}${need != null && need !== '' ? ' / ' + need : ''}名</div></div>`;
    });
    // 目標に足りない配置（0名）
    state.targets.forEach(t => { const need = targetFor(t, d); if (need && !byCode[t.code]) { const col = colorOf(t.code); h += `<div class="gcode under"><div class="gname" style="background:${col};color:${textColor(col)}">${esc(t.code)}</div><div class="gmembers" style="color:#dc2626">配置なし</div><div class="gcount">0 / ${need}名</div></div>`; } });
    h += '</div></div>';
    h += `<div class="card"><h3>スタッフ別</h3><ul class="day-list">`;
    mo.staff.forEach(s => {
      const c = getCell(s.id, d) || {}; const col = c.a ? colorOf(c.a) : '#f1f5f9';
      h += `<li data-id="${s.id}"><span class="nm">${esc(s.name)}</span><span class="code" style="background:${col};color:${textColor(col)}">${esc(c.a || '―')}</span><span class="note">${esc(c.n || '')}</span><button class="btn" style="margin-left:auto;padding:2px 8px" data-edit="${s.id}">編集</button></li>`;
    });
    h += '</ul></div></div>';
    $('#dayContent').innerHTML = h;
    $$('#dayContent [data-edit]').forEach(b => b.onclick = () => { switchView('grid'); setTimeout(() => { openEditor(b.dataset.edit, d, false); const td = $(`td.cell[data-id="${b.dataset.edit}"][data-day="${d}"][data-kind="a"]`); if (td) td.scrollIntoView({ block: 'center', inline: 'center' }); }, 30); });
  }

  // ---------- summary ----------
  function renderSummary() {
    const mo = month(true); const nd = daysIn(cur.y, cur.m);
    const cats = TYPE_ORDER;
    let h = '<div class="summary-wrap">';
    // 1) スタッフ × 区分
    h += '<div class="card"><h3>スタッフ別 区分集計<small>元スプレッドシートの集計表に対応</small></h3><div class="sum-wrap-scroll"><table class="sum"><tr><th>区分</th>';
    mo.staff.forEach(s => h += `<th>${esc(s.name)}</th>`); h += '<th>合計</th></tr>';
    const all = mo.staff.map(s => staffCategoryCounts(s.id));
    cats.forEach(t => {
      h += `<tr><td>${TYPE_LABEL[t]}</td>`;
      let tot = 0; all.forEach(c => { const n = c[t] || 0; tot += n; h += `<td class="${n ? '' : 'zero'}">${n}</td>`; });
      h += `<td>${tot}</td></tr>`;
    });
    h += '<tr><td>未入力</td>';
    all.forEach(c => { const filled = Object.values(c.byCode).reduce((a, b) => a + b, 0); const n = nd - filled; h += `<td class="${n ? 'warn' : 'zero'}">${n}</td>`; });
    h += '<td></td></tr></table></div></div>';
    // 2) スタッフ × 配置
    const used = new Set(); all.forEach(c => Object.keys(c.byCode).forEach(k => used.add(k)));
    const codesSorted = Array.from(used).sort((a, b) => { const ia = state.codes.findIndex(c => c.name === a), ib = state.codes.findIndex(c => c.name === b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, 'ja'); });
    h += '<div class="card"><h3>スタッフ別 配置内訳</h3><div class="sum-wrap-scroll"><table class="sum"><tr><th>配置</th>';
    mo.staff.forEach(s => h += `<th>${esc(s.name)}</th>`); h += '<th>合計</th></tr>';
    codesSorted.forEach(k => {
      const col = colorOf(k);
      h += `<tr><td style="background:${col};color:${textColor(col)}">${esc(k)}</td>`;
      let tot = 0; all.forEach(c => { const n = c.byCode[k] || 0; tot += n; h += `<td class="${n ? '' : 'zero'}">${n}</td>`; });
      h += `<td>${tot}</td></tr>`;
    });
    h += '</table></div></div>';
    // 3) 日別 × 配置（人数）
    h += '<div class="card"><h3>日別 配置人数</h3><div class="sum-wrap-scroll"><table class="sum"><tr><th>配置</th>';
    for (let d = 1; d <= nd; d++) h += `<th style="${dow(cur.y, cur.m, d) === 0 ? 'color:#dc2626' : dow(cur.y, cur.m, d) === 6 ? 'color:#2563eb' : ''}">${d}<br><small>${DOW[dow(cur.y, cur.m, d)]}</small></th>`;
    h += '</tr>';
    codesSorted.forEach(k => {
      const col = colorOf(k); const t = state.targets.find(x => x.code === k);
      h += `<tr><td style="background:${col};color:${textColor(col)}">${esc(k)}</td>`;
      for (let d = 1; d <= nd; d++) {
        const n = countCodeOnDay(k, d); let cls = n ? '' : 'zero';
        if (t) { const c = targetClass(t, d); if (c === 'under') cls = 'warn'; else if (c === 'over') cls = 'hi'; }
        h += `<td class="${cls}">${n}</td>`;
      }
      h += '</tr>';
    });
    h += '</table></div></div>';
    // 4) 月報集計
    h += '<div class="card"><h3>月報集計<small>振り返りの記入状況と評価</small></h3><div class="sum-wrap-scroll"><table class="sum"><tr><th>氏名</th><th>出勤</th><th>振り返り記入</th><th>記入率</th><th>◎</th><th>○</th><th>△</th><th>×</th><th>日次平均</th><th>考課タグ日</th><th>上長総評</th><th>月間評価</th></tr>';
    mo.staff.forEach(s => {
      const st = reportStats(s.id); const pct = st.work ? Math.round(st.filled / st.work * 100) : 0;
      h += `<tr><td>${esc(s.name)}</td><td>${st.work}</td><td>${st.filled}</td><td class="${pct < 50 ? 'warn' : pct >= 90 ? 'hi' : ''}">${pct}%</td><td>${st.rc[3] || ''}</td><td>${st.rc[2] || ''}</td><td>${st.rc[1] || ''}</td><td class="${st.rc[-1] ? 'warn' : ''}">${st.rc[-1] || ''}</td><td>${st.avg != null ? st.avg.toFixed(2) : ''}</td><td>${st.tagged || ''}</td><td>${st.hasMgr ? '済' : '<span style="color:#cbd5e1">未</span>'}</td><td>${st.rating ? `<b class="rt rt-${st.rating}">${st.rating}</b>` : '<span style="color:#cbd5e1">未</span>'}</td></tr>`;
    });
    h += '</table></div></div></div>';
    $('#summaryContent').innerHTML = h;
  }

  // ---------- settings ----------
  function renderSettings() {
    const mo = month(true);
    // staff
    const sl = $('#staffList');
    sl.innerHTML = mo.staff.map(s => `<li draggable="true" data-id="${s.id}"><span class="grip">&#8942;&#8942;</span><input type="text" value="${esc(s.name)}" data-f="name"><label class="chk" title="この人の上に区切り線を入れる"><input type="checkbox" data-f="sep" ${s.sep ? 'checked' : ''}>区切り</label><button class="del" title="削除">&#10005;</button></li>`).join('');
    $$('li', sl).forEach(li => {
      const s = mo.staff.find(x => x.id === li.dataset.id);
      $('[data-f=name]', li).onchange = e => { snapshot(); s.name = e.target.value.trim() || s.name; save(); renderGrid(); };
      $('[data-f=sep]', li).onchange = e => { snapshot(); s.sep = e.target.checked; save(); renderGrid(); };
      $('.del', li).onclick = () => {
        const has = Object.keys(mo.shifts[s.id] || {}).length;
        if (!confirm(`${s.name} をこの月から削除しますか？${has ? `\n（入力済みの予定 ${has} 件も削除されます）` : ''}`)) return;
        snapshot(); mo.staff = mo.staff.filter(x => x !== s); delete mo.shifts[s.id]; save(); renderSettings(); renderGrid();
      };
    });
    makeSortable(sl, order => { snapshot(); mo.staff = order.map(id => mo.staff.find(s => s.id === id)); save(); renderGrid(); renderSettings(); });
    // codes
    const cl = $('#codeList');
    cl.innerHTML = state.codes.map((c, i) => `<li draggable="true" data-id="${i}"><span class="grip">&#8942;&#8942;</span><input type="color" value="${c.color}" data-f="color"><input type="text" value="${esc(c.name)}" data-f="name"><input type="text" value="${esc(c.short || '')}" data-f="short" placeholder="表示略称" style="flex:0 0 72px" title="月間表のセルに表示する略称（空欄なら正式名）"><select data-f="type">${TYPE_ORDER.map(t => `<option value="${t}" ${c.type === t ? 'selected' : ''}>${TYPE_LABEL[t]}</option>`).join('')}</select><button class="del" title="削除">&#10005;</button></li>`).join('');
    $$('li', cl).forEach(li => {
      const c = state.codes[+li.dataset.id];
      $('[data-f=color]', li).oninput = e => { c.color = e.target.value; save(); renderGrid(); renderLegend(); };
      $('[data-f=name]', li).onchange = e => {
        const nv = e.target.value.trim(); if (!nv || nv === c.name) { e.target.value = c.name; return; }
        if (confirm(`配置名「${c.name}」を「${nv}」に変更します。\n全ての月の入力済みセルも置き換えますか？\n（キャンセル: マスタ名のみ変更）`)) {
          Object.values(state.months).forEach(m => Object.values(m.shifts).forEach(sh => Object.values(sh).forEach(x => { if (x.a === c.name) x.a = nv; })));
        }
        state.targets.forEach(t => { if (t.code === c.name) t.code = nv; });
        c.name = nv; save(); renderAll();
      };
      $('[data-f=type]', li).onchange = e => { c.type = e.target.value; save(); };
      $('[data-f=short]', li).onchange = e => { c.short = e.target.value.trim(); save(); renderGrid(); };
      $('.del', li).onclick = () => { if (!confirm(`配置「${c.name}」を選択肢から削除しますか？（入力済みのセルはそのまま残ります）`)) return; state.codes.splice(+li.dataset.id, 1); save(); renderAll(); };
    });
    makeSortable(cl, order => { state.codes = order.map(i => state.codes[+i]); save(); renderAll(); });
    // targets
    const tl = $('#targetList');
    tl.innerHTML = state.targets.map((t, i) => { const col = colorOf(t.code); return `<li draggable="true" data-id="${i}"><span class="grip">&#8942;&#8942;</span><span class="swatch" style="background:${col}"></span><span style="flex:1">${esc(t.code)}</span><label>平日 <input type="number" min="0" style="width:52px" value="${t.num == null ? '' : t.num}" data-f="num" placeholder="-"></label><label>日曜 <input type="number" min="0" style="width:52px" value="${t.sun == null ? '' : t.sun}" data-f="sun" placeholder="-"></label><button class="del" title="削除">&#10005;</button></li>`; }).join('');
    $$('li', tl).forEach(li => {
      const t = state.targets[+li.dataset.id];
      $('[data-f=num]', li).onchange = e => { t.num = e.target.value === '' ? null : +e.target.value; save(); renderGrid(); };
      $('[data-f=sun]', li).onchange = e => { t.sun = e.target.value === '' ? null : +e.target.value; save(); renderGrid(); };
      $('.del', li).onclick = () => { state.targets.splice(+li.dataset.id, 1); save(); renderSettings(); renderGrid(); };
    });
    makeSortable(tl, order => { state.targets = order.map(i => state.targets[+i]); save(); renderSettings(); renderGrid(); });
    $('#newTargetCode').innerHTML = state.codes.filter(c => !state.targets.some(t => t.code === c.name)).map(c => `<option>${esc(c.name)}</option>`).join('');
    updateStorageInfo(); renderSyncBadge();
  }
  function makeSortable(ul, onDone) {
    let drag = null;
    $$('li', ul).forEach(li => {
      li.addEventListener('dragstart', e => { drag = li; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      li.addEventListener('dragend', () => { li.classList.remove('dragging'); drag = null; onDone($$('li', ul).map(x => x.dataset.id)); });
      li.addEventListener('dragover', e => { e.preventDefault(); if (!drag || drag === li) return; const r = li.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; ul.insertBefore(drag, after ? li.nextSibling : li); });
    });
    // input 内でのドラッグ開始を抑止
    $$('input, select', ul).forEach(i => { i.addEventListener('mousedown', e => e.stopPropagation()); i.setAttribute('draggable', 'false'); });
  }
  function initSettings() {
    $('#addStaffBtn').onclick = () => { const v = $('#newStaffName').value.trim(); if (!v) return; snapshot(); month(true).staff.push({ id: uid(), name: v, sep: false }); $('#newStaffName').value = ''; save(); renderSettings(); renderGrid(); };
    $('#newStaffName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#addStaffBtn').click(); });
    $('#addCodeBtn').onclick = () => { const v = $('#newCodeName').value.trim(); if (!v) return; if (state.codes.some(c => c.name === v)) return toast('同名の配置があります', true); state.codes.push({ name: v, color: $('#newCodeColor').value, type: $('#newCodeType').value }); $('#newCodeName').value = ''; save(); renderAll(); };
    $('#newCodeName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#addCodeBtn').click(); });
    $('#addTargetBtn').onclick = () => { const code = $('#newTargetCode').value; if (!code) return; state.targets.push({ code, num: +$('#newTargetNum').value, sun: 0 }); save(); renderSettings(); renderGrid(); };
  }

  // ---------- Excel export ----------
  function exportExcel() {
    if (typeof XLSX === 'undefined') return toast('Excelライブラリが読み込めていません', true);
    const mo = month(true); const nd = daysIn(cur.y, cur.m);
    const ws = {}; const merges = [];
    const border = { style: 'thin', color: { rgb: 'A6A6A6' } };
    const B = { top: border, bottom: border, left: border, right: border };
    const put = (r, c, v, s, t, f) => { if (v == null && !f) return; const cell = { v: v == null ? '' : v, t: t || (typeof v === 'number' ? 'n' : 's'), s: s || {} }; if (f) cell.f = f; ws[XLSX.utils.encode_cell({ r, c })] = cell; };
    const fill = hex => ({ patternType: 'solid', fgColor: { rgb: hex.replace('#', '').toUpperCase() } });
    const center = { horizontal: 'center', vertical: 'center' };
    const font = { name: 'Noto Sans JP', sz: 10 };
    const colL = XLSX.utils.encode_col;
    const dayFill = d => { const w = dow(cur.y, cur.m, d); return w === 0 ? 'FDE8E8' : w === 6 ? 'E8F0FE' : w === 3 ? 'FFF7E6' : null; };

    // 行1: 空き / 行2: タイトル+日付 / 行3: 曜日
    put(1, 1, `${wareki(cur.y)}.${cur.m}`, { font: { ...font, bold: true, sz: 12 }, alignment: center, border: B, fill: fill('#D9D9D9') });
    put(2, 1, `${cur.y}年${cur.m}月`, { font, alignment: center, border: B, fill: fill('#D9D9D9') });
    for (let d = 1; d <= nd; d++) {
      const f = dayFill(d);
      put(1, d + 1, d, { font: { ...font, bold: true }, alignment: center, border: B, fill: f ? fill(f) : undefined });
      put(2, d + 1, DOW[dow(cur.y, cur.m, d)], { font: { ...font, color: { rgb: dow(cur.y, cur.m, d) === 0 ? 'C00000' : dow(cur.y, cur.m, d) === 6 ? '1F4E79' : '000000' } }, alignment: center, border: B, fill: f ? fill(f) : undefined });
    }
    let r = 3;
    const staffRow = {};
    mo.staff.forEach(s => {
      staffRow[s.id] = r;
      put(r, 1, s.name, { font: { ...font, bold: true }, alignment: center, border: B, fill: fill('#F2F2F2') });
      put(r + 1, 1, '', { border: B, fill: fill('#F2F2F2') });
      merges.push({ s: { r, c: 1 }, e: { r: r + 1, c: 1 } });
      for (let d = 1; d <= nd; d++) {
        const c = getCell(s.id, d) || {};
        const col = c.a ? colorOf(c.a) : null;
        put(r, d + 1, c.a || '', { font, alignment: center, border: B, fill: col ? fill(col) : undefined });
        put(r + 1, d + 1, c.n || '', { font: { ...font, sz: 8 }, alignment: { ...center, wrapText: true }, border: B });
      }
      r += 2;
    });
    const lastStaffRow = r - 1;
    r += 1;
    // 日別配置人数（COUNTIF 式で出力 → Excel上でも生きる）
    const firstC = colL(2), lastC = colL(nd + 1);
    state.targets.forEach(t => {
      const col = colorOf(t.code);
      put(r, 1, t.code, { font: { ...font, bold: true }, alignment: center, border: B, fill: fill(col) });
      for (let d = 1; d <= nd; d++) {
        const L = colL(d + 1);
        const n = countCodeOnDay(t.code, d); const cls = targetClass(t, d);
        const f = cls === 'under' ? 'FFC7CE' : cls === 'over' ? 'BDD7EE' : cls === 'ok' ? 'E2F0D9' : null;
        put(r, d + 1, n, { font, alignment: center, border: B, fill: f ? fill(f) : undefined }, 'n', `COUNTIF(${L}4:${L}${lastStaffRow + 1},"${t.code}")`);
      }
      r++;
    });
    r += 1;
    // スタッフ別 区分集計
    put(r, 1, '区分 / 氏名', { font: { ...font, bold: true }, alignment: center, border: B, fill: fill('#D9D9D9') });
    mo.staff.forEach((s, i) => put(r, i + 2, s.name, { font: { ...font, bold: true }, alignment: center, border: B, fill: fill('#D9D9D9') }));
    r++;
    TYPE_ORDER.forEach(t => {
      put(r, 1, TYPE_LABEL[t], { font: { ...font, bold: true }, alignment: center, border: B, fill: fill('#F2F2F2') });
      const names = state.codes.filter(c => c.type === t).map(c => c.name);
      mo.staff.forEach((s, i) => {
        const sr = staffRow[s.id] + 1;
        const f = names.length ? names.map(nm => `COUNTIF($${firstC}$${sr}:$${lastC}$${sr},"${nm}")`).join('+') : null;
        put(r, i + 2, staffCategoryCounts(s.id)[t] || 0, { font, alignment: center, border: B }, 'n', f);
      });
      r++;
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r, c: nd + 2 } });
    ws['!merges'] = merges;
    ws['!cols'] = [{ wch: 2 }, { wch: 12 }].concat(Array.from({ length: nd }, () => ({ wch: 11 })));
    ws['!rows'] = []; for (let i = 0; i < r; i++) ws['!rows'][i] = { hpt: 18 };
    for (let i = 0; i < mo.staff.length; i++) ws['!rows'][3 + i * 2 + 1] = { hpt: 14 };
    ws['!freeze'] = { xSplit: 2, ySplit: 3 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${cur.y}.${cur.m}`);
    XLSX.writeFile(wb, `シフト表_${cur.y}${pad(cur.m)}.xlsx`);
    toast('Excelを書き出しました');
  }

  // ---------- Excel import ----------
  function importExcel(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        let total = 0;
        const results = [];
        wb.SheetNames.forEach(name => {
          const res = parseSheet(wb.Sheets[name], name);
          if (res) results.push(res);
        });
        if (!results.length) return toast('シフト表の形式を認識できませんでした（1列目に氏名、上部に日付1..31 の行が必要です）', true);
        results.forEach(res => {
          const key = ym(res.y, res.m);
          const exists = state.months[key] && Object.values(state.months[key].shifts).some(s => Object.keys(s).length);
          if (exists && !confirm(`${res.y}年${res.m}月 はすでにデータがあります。\n取り込んだ内容で上書きしますか？`)) return;
          const mo = { staff: [], shifts: {} };
          res.staff.forEach(st => { const id = uid(); mo.staff.push({ id, name: st.name, sep: false }); mo.shifts[id] = st.shifts; total += Object.keys(st.shifts).length; });
          // 未知の配置名はマスタに追加（色はグレー）
          res.codesSeen.forEach(c => { if (!codeOf(c)) state.codes.push({ name: c, color: '#E0E0E0', type: 'other' }); });
          state.months[key] = mo;
          cur = { y: res.y, m: res.m };
        });
        undoStack.length = 0; redoStack.length = 0; updateUndoButtons();
        save(); renderAll();
        toast(`取り込みました（${results.map(r => `${r.y}/${r.m}`).join(', ')}・${total} 件）`);
      } catch (err) { console.error(err); toast('取り込みに失敗しました: ' + err.message, true); }
    };
    reader.readAsArrayBuffer(file);
  }
  function parseSheet(ws, sheetName) {
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    // 日付行を探す（1,2,3... が連続する行）
    let hdr = -1, startCol = -1;
    for (let r = 0; r < Math.min(aoa.length, 15) && hdr < 0; r++) {
      const row = aoa[r] || [];
      for (let c = 0; c < row.length - 3; c++) {
        if (num(row[c]) === 1 && num(row[c + 1]) === 2 && num(row[c + 2]) === 3) { hdr = r; startCol = c; break; }
      }
    }
    if (hdr < 0) return null;
    const nameCol = startCol - 1; if (nameCol < 0) return null;
    // 年月の判定
    let y = null, m = null;
    const title = String(aoa[hdr][nameCol] || '') + ' ' + sheetName;
    let mt = title.match(/(20\d{2})\D{0,3}(\d{1,2})/); if (mt) { y = +mt[1]; m = +mt[2]; }
    if (!y) { mt = title.match(/[RＲ令和]\s*(\d{1,2})\D{0,3}(\d{1,2})/); if (mt) { y = 2018 + +mt[1]; m = +mt[2]; } }
    if (!y) { mt = title.match(/(\d{1,2})\s*月/); if (mt) { y = cur.y; m = +mt[1]; } }
    if (!y || !m || m < 1 || m > 12) { y = cur.y; m = cur.m; }
    // 日付列
    const dayCols = {}; let maxDay = 0;
    for (let c = startCol; c < (aoa[hdr] || []).length; c++) { const v = num(aoa[hdr][c]); if (v && v >= 1 && v <= 31 && v === maxDay + 1) { dayCols[v] = c; maxDay = v; } else if (maxDay) break; }
    const nd = daysIn(y, m);
    // 曜日行があればスキップ
    let r = hdr + 1;
    if (aoa[r] && DOW.includes(String(aoa[r][startCol] || '').trim())) r++;
    const staff = []; const codesSeen = new Set();
    while (r < aoa.length) {
      const row = aoa[r] || [];
      const nm = row[nameCol] == null ? '' : String(row[nameCol]).trim();
      if (!nm) { // 空行: 次にまだ名前行が続くか？
        const next = aoa[r + 1] || [];
        if (next[nameCol] != null && String(next[nameCol]).trim()) { r++; continue; }
        // 次の名前も無ければ、メモ行の可能性 → 直前スタッフのメモとして取り込み
        if (staff.length && row.some((v, i) => i >= startCol && v != null && String(v).trim())) { r++; continue; }
        if (!staff.length) { r++; continue; }
        break;
      }
      // 集計行（数値のみ）なら終了
      const vals = Object.values(dayCols).map(c => row[c]).filter(v => v != null && v !== '');
      if (vals.length && vals.every(v => typeof v === 'number')) break;
      const shifts = {};
      const noteRow = aoa[r + 1] || [];
      const noteIsNote = (noteRow[nameCol] == null || String(noteRow[nameCol]).trim() === '') && !(aoa[r + 2] && aoa[r + 2][nameCol] == null && false);
      for (let d = 1; d <= Math.min(nd, maxDay); d++) {
        const c = dayCols[d];
        const a = row[c] == null ? '' : String(row[c]).trim();
        let n = '';
        if (noteIsNote) { const nv = noteRow[c]; n = nv == null ? '' : String(nv).trim(); if (typeof nv === 'number') n = ''; }
        if (a || n) { const o = {}; if (a) { o.a = a; codesSeen.add(a); } if (n) o.n = n; shifts[d] = o; }
      }
      staff.push({ name: nm, shifts });
      r += noteIsNote ? 2 : 1;
    }
    if (!staff.length) return null;
    return { y, m, staff, codesSeen };
  }
  function num(v) { return typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v.trim()) ? +v : null); }

  // ---------- backup / restore ----------
  function backup() {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `シフト表_バックアップ_${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function restoreJson(file) {
    const rd = new FileReader();
    rd.onload = e => { try { const s = JSON.parse(e.target.result); if (!s.months || !s.codes) throw new Error('形式が違います'); if (!confirm('現在のデータをすべて置き換えます。よろしいですか？')) return; state = s; save(); renderAll(); toast('復元しました'); } catch (err) { toast('復元に失敗: ' + err.message, true); } };
    rd.readAsText(file);
  }

  // ---------- 月報 ----------
  const RATINGS = ['S', 'A', 'B', 'C', 'D'];
  const DAY_RATES = [{ v: 3, label: '◎', title: '良い' }, { v: 2, label: '○', title: '普通' }, { v: 1, label: '△', title: '要改善' }, { v: -1, label: '×', title: '問題あり' }];
  const RATE_LABEL = v => { const x = DAY_RATES.find(r => r.v === v); return x ? x.label : ''; };
  const RATE_SCORE = { 3: 3, 2: 2, 1: 1, '-1': 0 };
  let reportStaffId = null;

  // ---------- 人事考課 項目マスタ（人事考課表.xlsx 評価表シートより） ----------
  const APPR_ITEMS = [
    { id: 'understand', group: '基礎項目', cat: '仕事のプロセス', name: '理解', short: '理解', q: '上司の指示を的確に理解し、先回りして行動することができているか？', desc: 'ある仕事について、命じる側がその目的と目標・実行方法・完了期限を命じられる側に理解できるよう指示しなければなりません。そのうえで命じられた側はその内容をしっかりと理解し、仕事の目的に沿って十分な結果を達成するよう行動しなければなりません。また、命じられた側に「痒いところに手が届く」ような仕事ぶりが見られれば、それも評価に値します。逆に命令違反や命令にそぐわないプロセスがあればマイナス評価となります。この項目および下記２つの項目はプロセスの評価なので、結果が不十分であっても構いません。' },
    { id: 'horenso', group: '基礎項目', cat: '仕事のプロセス', name: '報連相', short: '報連相', q: '仕事の途中で上司や周辺への経過報告・必要事項の連絡・相談はあったか？', desc: '「ただ言われた通りにやっています」は最低限の要件です。開始当初と状況が変化することもあるので、上司や周辺への途中経過の報告や協力してもらうための連絡や相談は必要です。' },
    { id: 'attitude', group: '基礎項目', cat: '仕事のプロセス', name: '仕事に向き合う姿勢・態度', short: '姿勢・態度', q: '勤務時間中は常に前向きに仕事を進める姿勢・態度であったか？', desc: '勤務時間中は休憩時間を除いて業務に集中する義務があります。積極的に仕事に取り組む姿勢や態度が職場にも良い影響を与えるとともに、工夫や改善が自分自身の成長につながっていきます。「さぼり」は言語道断です。' },
    { id: 'time', group: '基礎項目', cat: '仕事の結果', name: '時間', short: '時間', q: '仕事が完了するまでの時間は、上司の指示や期待された期限を満たすものであったか？', desc: '指示された期限や納期を守ることが重要です。示された納期がぼんやりとしたものであっても、上司に確認しながら、その業務を早く完了させる姿勢が求められます。' },
    { id: 'quality', group: '基礎項目', cat: '仕事の結果', name: '出来栄え', short: '出来栄え', q: '完了した仕事の出来栄えは指示・要求を満たすものであったか？', desc: '仕事の結果（成果物）が目的と目標を満たすものであったかに正確性も加味して評価します。要求あるいは期待以上の出来栄えであればさらにプラス評価に値します。ただし、上記の「時間」とは別の評価軸となることに注意が必要です。' },
    { id: 'responsibility', group: '行動指針項目', cat: '責任', name: '責任感', short: '責任感', q: '他者や外的要因に責任転嫁をせず、自ら責任感をもって仕事に取り組む姿勢であったか？', desc: '与えられた業務に対して、解決につながらない言い訳をせずに自らの責任感で最後まで取り組む姿勢を評価します。必ずしも独力で業務を完結することを指しておらず、たとえ他者の協力を要請したとしても、自らが先頭に立ってその業務に取り組み、投げ出すような姿勢がなければ評価に値します。' },
    { id: 'sincerity', group: '行動指針項目', cat: '責任', name: '誠実', short: '誠実', q: '手待ち時間を含めて、手を抜かずに誠実にまじめに仕事に取り組んでいたか？', desc: '「人が見ていなければ、何をしてもよい」という考え方が最悪の評価となります。手待ち時間であっても、その間に準備や他の作業ができることもあります。自分のやれることをしっかりやる、という姿勢を評価します。（ただし、その人の能力を超えたことを要求しても、できないものは無理です。）' },
    { id: 'find', group: '行動指針項目', cat: '課題解決', name: '課題発見', short: '課題発見', q: '自主的に仕事上の課題を発見し提案する姿勢や行動が見られたか？', desc: '業務効率（時間短縮、人員削減等）の改善、利益増大、コスト削減、安全性の向上、職場環境の改善、等々につながる課題となる事項を自分の業務の中から発見し、周辺や上司と共有して一緒に解決していこうという姿勢や行動を評価します。ただの言いっぱなし、では最高評価は与えられません。' },
    { id: 'solve', group: '行動指針項目', cat: '課題解決', name: '課題解決', short: '課題解決', q: '仕事上の課題に対して諦めずに解決しようとする姿勢が見られたか？', desc: '与えられた課題、あるいは自ら発見した課題に対して、粘り強く諦めずに解決しようとしているか、を評価します。様々な手法を試したり、周辺にアドバイスをもらったり、自らが工夫している姿勢が重要です。仕事の結果とは関係ない評価項目です。' },
    { id: 'challenge', group: '行動指針項目', cat: '挑戦', name: '挑戦する姿勢', short: '挑戦', q: '未経験の仕事・領域に対しても臆せず挑戦する姿勢が見られたか？', desc: '未経験だから、知らないから、と尻込みすることはよくあることです。そのうえでも「やってみます」という積極的な姿勢を評価します。ただし、やみくもに挑戦するのではなく、手順を考えてから実行する姿勢も必要です。これも仕事の結果とは無関係な評価項目です。' },
    { id: 'flexible', group: '行動指針項目', cat: '挑戦', name: '既成概念', short: '既成概念', q: '過去の経験のみに縛られず、柔軟に対応することができるか？', desc: '自らの経験や正しい知識に基づく行動は重要ですが、既成概念に縛られて一言目が「できません」では本人や会社の成長につながりません。こうやればできるかな、という柔軟なポジティブシンキングを評価します。' },
    { id: 'newvalue', group: '行動指針項目', cat: '挑戦', name: '新しい価値', short: '新しい価値', q: '会社の業務改善など新しい価値を創造する提案ができているか？', desc: '現在の自分の仕事を離れた位置から、会社の事業全体を俯瞰して捉え、業務改善や利益改善、新規事業の提案などができているか、を評価します。経営目線に近い、かなり高いレベルの考え方が必要となります。' },
    { id: 'trust', group: '行動指針項目', cat: '信頼', name: '信頼関係', short: '信頼関係', q: '発言・行動に信頼感があるか？他の従業員と信頼関係が築けているか？', desc: '上司から見て信頼できる行動や発言をしているか、他の従業員との関係を観察したときに、仕事上の信頼関係がしっかり築けているか、を評価します。単に「仲が良い」「友人関係」ということを評価するのではありません。' },
    { id: 'communication', group: '行動指針項目', cat: '信頼', name: 'コミュニケーション', short: 'ｺﾐｭﾆｹｰｼｮﾝ', q: '他の従業員とコミュニケーションを積極的にとっているか？', desc: '挨拶を含め、組織の中で報連相ができているかを評価します。報連相は上司・部下の間だけではありません。チャットを含めた仕事上のコミュニケーションであって、おしゃべりをしていることを評価するのではありません。' },
    { id: 'care', group: '行動指針項目', cat: '信頼', name: '思いやり', short: '思いやり', q: '他の従業員に対して職場の仲間としての思いやりをもった行動・発言ができているか？', desc: 'すべては従業員同士がお互いを人間として尊重することから始まります。ポジティブコミュニケーションがとれていれば評価は高くなります。誹謗中傷（直接的・間接的）、挨拶をしない、無視する、助け合わない、等はありませんか？他の従業員に対する態度に問題があれば評価は低くなります。' },
    { id: 'collab', group: '行動指針項目', cat: '信頼', name: '協業', short: '協業', q: '他の従業員と協力して業務に取り組み、共に目標を達成しようとする姿勢・態度が見られたか？', desc: '自分単独でできる仕事もありますが、仕事を自分だけで抱え込んではいけません。独善的にならず、会社としての目標を共有し、他の従業員と協力しながら同じ方向に進んでいこうとする姿勢や態度を評価します。他の従業員の業務を積極的に手伝う姿勢も評価に加えます。' },
    { id: 'env5s', group: '行動指針項目', cat: 'ウェルビーイング', name: '環境改善', short: '環境改善', q: '５S活動など職場の環境を改善する行動がとれているか？', desc: '例えば、命令されなくても、積極的に職場の清掃をしている、棚の整理整頓をして他の人が工具を使いやすいようにしている、書類の分類をして他の人が発見しやすいようにしている、など他の人が働きやすいように考えて行動していることを評価します。逆に片づけをしない、ゴミを見ても知らんふり、などは評価が下がります。' },
    { id: 'contribute', group: '行動指針項目', cat: 'ウェルビーイング', name: '周辺への貢献', short: '周辺貢献', q: '自分の本来の業務以外にも会社や社会に貢献する姿勢・行動が見られたか？', desc: '会社の周辺環境に配慮し、騒音や悪臭の発生につながらないよう仕事を進める姿勢や地域社会・地球環境に配慮した行動が見られれば評価に加算します。会社や社会に迷惑を掛けないだけでなく、どれだけ役に立つかを考えて行動することが重要です。' },
    { id: 'conduct', group: '行動指針項目', cat: 'ウェルビーイング', name: '勤務態度', short: '勤務態度', q: '他の従業員の仕事の妨害となったり、職場の雰囲気を乱したり、他の従業員に悪影響を与えていないか？周辺の従業員の手本となるような行動や態度をとっているか？', desc: 'ウェルビーイングとは、身体的、精神的、そして社会的に「満たされた良好な状態」を指します。その人の働きぶりや態度・発言が周りの従業員に好影響を与えていれば高い評価となります。逆にこのウェルビーイングに反する行動や態度は低い評価につながります。' },
  ];
  const APPR_ITEM = Object.fromEntries(APPR_ITEMS.map(i => [i.id, i]));
  const APPR_NOTE = '※評価は1～5の５段階で絶対評価で採点します。自分を客観的に見て「普通」と思う評価を３とします。';
  function reportOf(id, create) {
    const mo = month(true);
    if (!mo.reports) mo.reports = {};
    if (!mo.reports[id] && create) mo.reports[id] = { days: {}, self: '', mgrSummary: '', rating: '' };
    return mo.reports[id] || { days: {}, self: '', mgrSummary: '', rating: '' };
  }
  function reportDay(id, d, create) {
    const r = reportOf(id, create);
    if (!r.days[d] && create) r.days[d] = {};
    return r.days[d] || {};
  }
  function reportStats(id) {
    const r = reportOf(id); const nd = daysIn(cur.y, cur.m);
    let filled = 0, work = 0, rated = 0, sumRate = 0, tagged = 0; const rc = { 3: 0, 2: 0, 1: 0, '-1': 0 };
    for (let d = 1; d <= nd; d++) {
      const c = getCell(id, d); const isOff = c && typeOf(c.a) === 'off';
      if (!isOff) work++;
      const rd = r.days[d] || {};
      if (rd.note && rd.note.trim()) filled++;
      if (rd.rate) { rated++; sumRate += RATE_SCORE[rd.rate] ?? 0; rc[rd.rate] = (rc[rd.rate] || 0) + 1; }
      if (rd.tags && rd.tags.length) tagged++;
    }
    return { filled, work, rated, tagged, avg: rated ? sumRate / rated : null, rc, hasMgr: !!(r.mgrSummary && r.mgrSummary.trim()), rating: r.rating || '' };
  }
  function renderReport() {
    const mo = month(true);
    if (!mo.staff.length) { $('#reportMain').innerHTML = '<div class="card" style="margin:14px">スタッフが登録されていません。</div>'; $('#reportStaffList').innerHTML = ''; return; }
    if (!reportStaffId || !mo.staff.some(s => s.id === reportStaffId)) reportStaffId = mo.staff[0].id;
    // 左: スタッフ一覧
    $('#reportStaffList').innerHTML = mo.staff.map(s => {
      const st = reportStats(s.id);
      const pct = st.work ? Math.round(st.filled / st.work * 100) : 0;
      return `<li class="${s.id === reportStaffId ? 'active' : ''}" data-id="${s.id}">
        <span class="nm">${esc(s.name)}</span>
        <span class="meta">${st.filled}/${st.work}日${st.rating ? ` <b class="rt rt-${st.rating}">${st.rating}</b>` : ''}</span>
        <span class="bar"><i style="width:${pct}%"></i></span>
      </li>`;
    }).join('');
    $$('#reportStaffList li').forEach(li => li.onclick = () => { reportStaffId = li.dataset.id; renderReport(); });
    renderReportMain();
  }
  function renderReportMain() {
    const mo = month(true); const s = mo.staff.find(x => x.id === reportStaffId); if (!s) return;
    const nd = daysIn(cur.y, cur.m); const r = reportOf(s.id); const st = reportStats(s.id);
    const cat = staffCategoryCounts(s.id);
    const codesUsed = Object.entries(cat.byCode).sort((a, b) => b[1] - a[1]);
    let h = `<div class="report-head">
      <div><h2>${esc(s.name)} <small>${cur.y}年${cur.m}月 月報</small></h2>
        <div class="report-kpis">
          <span>出勤 <b>${st.work}</b>日</span><span>休み <b>${cat.off}</b>日</span>
          <span>振り返り記入 <b>${st.filled}</b>/${st.work}日</span>
          <span>日次評価 ◎${st.rc[3]} ○${st.rc[2]} △${st.rc[1]} ×${st.rc[-1]}</span>
          ${st.avg != null ? `<span>平均 <b>${st.avg.toFixed(2)}</b></span>` : ''}
          <span>考課タグ付き <b>${st.tagged}</b>日</span>
        </div>
        <div class="report-codes">${codesUsed.map(([k, n]) => `<span class="chip" style="background:${colorOf(k)}">${esc(k)} ${n}</span>`).join('')}</div>
      </div>
      <div class="report-actions no-print">
        <button class="btn" id="reportExportBtn">この人をExcel書出</button>
        <button class="btn" id="reportPrintBtn">印刷</button>
      </div>
    </div>`;
    h += `<table class="report-table"><thead><tr><th class="c-d">日</th><th class="c-w">曜</th><th class="c-s">配置</th><th class="c-m">メモ</th><th class="c-n">活動の振り返り（本人）</th><th class="c-r">評価</th><th class="c-g">上長コメント</th><th class="c-t">考課項目<span class="th-sub no-print">特筆すべき日だけ</span></th></tr></thead><tbody>`;
    for (let d = 1; d <= nd; d++) {
      const w = dow(cur.y, cur.m, d); const c = getCell(s.id, d) || {}; const rd = r.days[d] || {};
      const isOff = c.a && typeOf(c.a) === 'off';
      const col = c.a ? colorOf(c.a) : '';
      const tags = (rd.tags || []).filter(t => APPR_ITEM[t]);
      h += `<tr class="${w === 0 ? 'sun' : w === 6 ? 'sat' : ''} ${isOff ? 'off' : ''}" data-day="${d}">
        <td class="c-d">${d}</td><td class="c-w">${DOW[w]}</td>
        <td class="c-s"><span class="code" style="${col ? `background:${col}` : ''}">${esc(shortOf(c.a || ''))}</span></td>
        <td class="c-m">${esc(c.n || '')}</td>
        <td class="c-n"><textarea data-f="note" rows="1" placeholder="${isOff ? '' : '今日やったこと・気づき・課題など'}">${esc(rd.note || '')}</textarea></td>
        <td class="c-r"><div class="rate-btns">${DAY_RATES.map(x => `<button data-rate="${x.v}" class="${rd.rate === x.v ? 'on' : ''}" title="${x.title}">${x.label}</button>`).join('')}</div></td>
        <td class="c-g"><textarea data-f="mgr" rows="1" placeholder="">${esc(rd.mgr || '')}</textarea></td>
        <td class="c-t"><div class="tag-cell" data-day="${d}" title="クリックして考課項目を選択">${tags.map(t => `<span class="tag">${esc(APPR_ITEM[t].short)}</span>`).join('')}<button class="tag-add no-print" title="考課項目を付ける">${tags.length ? '…' : '＋'}</button></div></td>
      </tr>`;
    }
    h += '</tbody></table>';
    h += `<div class="report-summary">
      <div class="card"><h3>今月の総括（本人）</h3><textarea id="rSelf" rows="5" placeholder="今月の成果、うまくいったこと、課題、来月に向けて">${esc(r.self || '')}</textarea></div>
      <div class="card"><h3>上長総評・月間評価</h3>
        <div class="rating-row">月間評価：${RATINGS.map(x => `<button class="rt-btn rt-${x} ${r.rating === x ? 'on' : ''}" data-rating="${x}">${x}</button>`).join('')}<button class="rt-btn ${!r.rating ? 'on' : ''}" data-rating="">未評価</button></div>
        <textarea id="rMgr" rows="4" placeholder="良かった点、改善してほしい点、期待すること">${esc(r.mgrSummary || '')}</textarea>
      </div>
    </div>`;
    const main = $('#reportMain'); main.innerHTML = h;
    // handlers
    const autoGrow = ta => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
    $$('textarea', main).forEach(ta => { autoGrow(ta); ta.addEventListener('input', () => autoGrow(ta)); });
    $$('tr[data-day] textarea', main).forEach(ta => {
      ta.addEventListener('change', () => { const d = +ta.closest('tr').dataset.day; const rd = reportDay(s.id, d, true); rd[ta.dataset.f] = ta.value.trim(); save(); refreshReportSide(); });
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const rows = $$('tr[data-day]', main); const i = rows.indexOf(ta.closest('tr')); const nxt = rows[i + 1] && $(`textarea[data-f=${ta.dataset.f}]`, rows[i + 1]); if (nxt) { nxt.focus(); } } });
    });
    $$('.rate-btns button', main).forEach(b => b.onclick = () => { const d = +b.closest('tr').dataset.day; const rd = reportDay(s.id, d, true); const v = +b.dataset.rate; rd.rate = rd.rate === v ? 0 : v; save(); renderReport(); });
    $$('.tag-cell', main).forEach(cell => cell.onclick = e => { e.stopPropagation(); openTagPicker(s.id, +cell.dataset.day, cell); });
    $('#rSelf').addEventListener('change', e => { reportOf(s.id, true).self = e.target.value.trim(); save(); });
    $('#rMgr').addEventListener('change', e => { reportOf(s.id, true).mgrSummary = e.target.value.trim(); save(); refreshReportSide(); });
    $$('.rating-row button', main).forEach(b => b.onclick = () => { reportOf(s.id, true).rating = b.dataset.rating; save(); renderReport(); });
    $('#reportExportBtn').onclick = () => exportReportExcel([s]);
    $('#reportPrintBtn').onclick = () => {
      // 月報はA4縦で印刷（月間表はA3横のまま）
      let st = $('#printPageStyle'); if (!st) { st = document.createElement('style'); st.id = 'printPageStyle'; document.head.appendChild(st); }
      st.textContent = '@page { size: A4 portrait; margin: 10mm; }';
      const cleanup = () => { st.textContent = ''; window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup); window.print();
    };
  }
  function refreshReportSide() { const keep = reportStaffId; const mo = month(true); const li = $(`#reportStaffList li[data-id="${keep}"]`); if (!li) return; const st = reportStats(keep); const pct = st.work ? Math.round(st.filled / st.work * 100) : 0; $('.meta', li).innerHTML = `${st.filled}/${st.work}日${st.rating ? ` <b class="rt rt-${st.rating}">${st.rating}</b>` : ''}`; $('.bar i', li).style.width = pct + '%'; }
  // 考課項目タグの選択ポップアップ
  function openTagPicker(staffId, d, anchor) {
    closeTagPicker();
    const rd = reportDay(staffId, d, true); const cur0 = new Set(rd.tags || []);
    const pop = document.createElement('div'); pop.id = 'tagPicker'; pop.className = 'tag-picker no-print';
    const groups = []; APPR_ITEMS.forEach(it => { let g = groups.find(x => x.cat === it.cat); if (!g) { g = { cat: it.cat, group: it.group, items: [] }; groups.push(g); } g.items.push(it); });
    pop.innerHTML = `<div class="tp-head"><b>${cur.m}/${d} の考課項目</b><span class="hint">該当する項目にチェック（複数可）</span><button class="btn icon tp-close">&#10005;</button></div>
      <div class="tp-body">${groups.map(g => `<div class="tp-group"><div class="tp-cat">${esc(g.cat)}<small>${esc(g.group)}</small></div>${g.items.map(it => `<label class="tp-item" title="${esc(it.q)}"><input type="checkbox" value="${it.id}" ${cur0.has(it.id) ? 'checked' : ''}> ${esc(it.name)}</label>`).join('')}</div>`).join('')}</div>
      <div class="tp-foot"><button class="btn tp-clear">すべて外す</button><span style="flex:1"></span><button class="btn primary tp-ok">決定</button></div>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect(); const W = Math.min(560, window.innerWidth - 16);
    pop.style.width = W + 'px';
    let left = Math.min(r.left, window.innerWidth - W - 8); if (left < 8) left = 8;
    pop.style.left = left + 'px';
    const H = pop.offsetHeight; let top = r.bottom + 4; if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - 4);
    pop.style.top = top + 'px';
    const commit = () => { const tags = $$('input:checked', pop).map(i => i.value); if (tags.length) rd.tags = tags; else delete rd.tags; save(); closeTagPicker(); renderReport(); };
    $('.tp-ok', pop).onclick = commit;
    $('.tp-clear', pop).onclick = () => { $$('input', pop).forEach(i => i.checked = false); commit(); };
    $('.tp-close', pop).onclick = closeTagPicker;
    pop.addEventListener('click', e => e.stopPropagation());
    setTimeout(() => { document.addEventListener('click', closeTagPicker, { once: true }); }, 0);
    pop._esc = e => { if (e.key === 'Escape') closeTagPicker(); if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') commit(); }; document.addEventListener('keydown', pop._esc);
  }
  function closeTagPicker() { const p = $('#tagPicker'); if (p) { document.removeEventListener('keydown', p._esc); p.remove(); } }
  function exportReportExcel(list) {
    if (typeof XLSX === 'undefined') return toast('Excelライブラリが読み込めていません', true);
    const nd = daysIn(cur.y, cur.m); const wb = XLSX.utils.book_new();
    const border = { style: 'thin', color: { rgb: 'A6A6A6' } }; const B = { top: border, bottom: border, left: border, right: border };
    const font = { name: 'Noto Sans JP', sz: 10 }; const fill = hex => ({ patternType: 'solid', fgColor: { rgb: hex.replace('#', '').toUpperCase() } });
    const used = new Set();
    list.forEach(s => {
      const r = reportOf(s.id); const st = reportStats(s.id); const cat = staffCategoryCounts(s.id);
      const ws = {}; const put = (rr, c, v, st2) => { ws[XLSX.utils.encode_cell({ r: rr, c })] = { v: v == null ? '' : v, t: typeof v === 'number' ? 'n' : 's', s: st2 || { font, border: B, alignment: { vertical: 'top', wrapText: true } } }; };
      const hdr = { font: { ...font, bold: true }, border: B, fill: fill('#D9D9D9'), alignment: { horizontal: 'center', vertical: 'center' } };
      put(0, 0, `${cur.y}年${cur.m}月 月報`, { font: { ...font, bold: true, sz: 14 } }); put(0, 2, '氏名'); put(0, 3, s.name, { font: { ...font, bold: true, sz: 12 } });
      put(1, 0, `出勤 ${st.work}日 / 休み ${cat.off}日 / 振り返り記入 ${st.filled}日 / 日次評価 ◎${st.rc[3]} ○${st.rc[2]} △${st.rc[1]} ×${st.rc[-1]} / 月間評価 ${r.rating || '未評価'}`, { font });
      const H = ['日', '曜', '配置', 'メモ', '活動の振り返り（本人）', '評価', '上長コメント', '考課項目']; H.forEach((x, i) => put(3, i, x, hdr));
      let row = 4;
      for (let d = 1; d <= nd; d++) {
        const w = dow(cur.y, cur.m, d); const c = getCell(s.id, d) || {}; const rd = r.days[d] || {};
        const base = { font, border: B, alignment: { vertical: 'top', wrapText: true }, fill: w === 0 ? fill('#FDE8E8') : w === 6 ? fill('#E8F0FE') : undefined };
        put(row, 0, d, { ...base, alignment: { horizontal: 'center', vertical: 'top' } }); put(row, 1, DOW[w], { ...base, alignment: { horizontal: 'center', vertical: 'top' } });
        put(row, 2, c.a || '', { ...base, fill: c.a ? fill(colorOf(c.a)) : base.fill, alignment: { horizontal: 'center', vertical: 'top' } });
        put(row, 3, c.n || '', base); put(row, 4, rd.note || '', base);
        put(row, 5, RATE_LABEL(rd.rate), { ...base, alignment: { horizontal: 'center', vertical: 'top' } }); put(row, 6, rd.mgr || '', base);
        put(row, 7, (rd.tags || []).filter(t => APPR_ITEM[t]).map(t => APPR_ITEM[t].name).join('、'), base);
        row++;
      }
      row++;
      put(row, 0, '今月の総括（本人）', hdr); put(row, 1, r.self || '', { font, border: B, alignment: { vertical: 'top', wrapText: true } }); ws['!merges'] = [{ s: { r: row, c: 1 }, e: { r: row, c: 7 } }]; row++;
      put(row, 0, '上長総評', hdr); put(row, 1, r.mgrSummary || '', { font, border: B, alignment: { vertical: 'top', wrapText: true } }); ws['!merges'].push({ s: { r: row, c: 1 }, e: { r: row, c: 7 } }); row++;
      put(row, 0, '月間評価', hdr); put(row, 1, r.rating || '未評価', { font: { ...font, bold: true, sz: 12 }, border: B, alignment: { horizontal: 'center' } }); row++;
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row, c: 7 } });
      ws['!cols'] = [{ wch: 4 }, { wch: 4 }, { wch: 13 }, { wch: 16 }, { wch: 44 }, { wch: 5 }, { wch: 34 }, { wch: 18 }];
      let name = s.name.replace(/[\\\/\?\*\[\]:]/g, '_').slice(0, 28); let k = 2; const b0 = name; while (used.has(name)) name = `${b0}_${k++}`; used.add(name);
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    XLSX.writeFile(wb, `月報_${cur.y}${pad(cur.m)}${list.length === 1 ? '_' + list[0].name : ''}.xlsx`);
    toast('月報を書き出しました');
  }

  // ---------- 人事考課 ----------
  // state.appraisals[periodKey][staffName] = { scores:{itemId:1-5}, reasons:{itemId:text}, overall, date, evaluator }
  // 期間は月単位（from〜to）。スタッフは月ごとに id が変わり得るので氏名で突き合わせる。
  let appr = { from: '', to: '', name: null };
  const monthsBetween = (a, b) => { const out = []; if (!a || !b) return out; let [y, m] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number); while (y < y2 || (y === y2 && m <= m2)) { out.push(ym(y, m)); m++; if (m > 12) { m = 1; y++; } } return out.slice(0, 36); };
  const periodKey = () => `${appr.from}_${appr.to}`;
  function apprOf(name, create) {
    if (!state.appraisals) state.appraisals = {};
    const k = periodKey(); if (!state.appraisals[k]) state.appraisals[k] = {};
    if (!state.appraisals[k][name] && create) state.appraisals[k][name] = { scores: {}, reasons: {}, overall: '', date: '', evaluator: '' };
    return state.appraisals[k][name] || { scores: {}, reasons: {}, overall: '', date: '', evaluator: '' };
  }
  function apprStaffNames() {
    const seen = new Set(), out = [];
    monthsBetween(appr.from, appr.to).forEach(k => { const mo = state.months[k]; if (!mo) return; mo.staff.forEach(s => { if (!seen.has(s.name)) { seen.add(s.name); out.push(s.name); } }); });
    return out;
  }
  // 期間内の日次記録をすべて集める（タグ有無を問わず）
  function apprCollect(name) {
    const days = []; let work = 0;
    monthsBetween(appr.from, appr.to).forEach(k => {
      const mo = state.months[k]; if (!mo) return; const s = mo.staff.find(x => x.name === name); if (!s) return;
      const [y, m] = k.split('-').map(Number); const nd = daysIn(y, m); const r = (mo.reports && mo.reports[s.id]) || { days: {} };
      for (let d = 1; d <= nd; d++) {
        const c = (mo.shifts[s.id] && mo.shifts[s.id][d]) || {}; const isOff = c.a && typeOf(c.a) === 'off'; if (!isOff) work++;
        const rd = r.days[d]; if (!rd) continue;
        const tags = (rd.tags || []).filter(t => APPR_ITEM[t]);
        if (!tags.length && !rd.rate && !(rd.mgr && rd.mgr.trim())) continue;
        days.push({ k, y, m, d, w: dow(y, m, d), a: c.a || '', n: c.n || '', note: rd.note || '', mgr: rd.mgr || '', rate: rd.rate || 0, tags });
      }
    });
    return { days, work };
  }
  function apprStats(name) {
    const a = apprOf(name); const vals = Object.values(a.scores).filter(v => v >= 1 && v <= 5);
    const g = grp => APPR_ITEMS.filter(i => i.group === grp).map(i => a.scores[i.id]).filter(v => v >= 1);
    const avg = arr => arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : null;
    return { scored: vals.length, total: vals.reduce((x, y) => x + y, 0), avg: avg(vals), basic: avg(g('基礎項目')), guide: avg(g('行動指針項目')) };
  }
  function initAppraisal() {
    const saved = JSON.parse(localStorage.getItem('shiftapp.appr') || '{}');
    appr.from = saved.from || ''; appr.to = saved.to || '';
    $('#apprFrom').onchange = e => { appr.from = e.target.value; if (appr.to && appr.to < appr.from) appr.to = appr.from; persistAppr(); renderAppraisal(); };
    $('#apprTo').onchange = e => { appr.to = e.target.value; if (appr.from && appr.from > appr.to) appr.from = appr.to; persistAppr(); renderAppraisal(); };
    $('#apprExportAllBtn').onclick = () => exportAppraisalExcel(apprStaffNames());
  }
  function persistAppr() { localStorage.setItem('shiftapp.appr', JSON.stringify({ from: appr.from, to: appr.to })); }
  function renderAppraisal() {
    if (!appr.from || !appr.to) { const keys = Object.keys(state.months).sort(); appr.from = appr.from || keys[0] || monthKey(); appr.to = appr.to || keys[keys.length - 1] || monthKey(); if (appr.from > appr.to) appr.to = appr.from; persistAppr(); }
    $('#apprFrom').value = appr.from; $('#apprTo').value = appr.to;
    const names = apprStaffNames();
    if (!names.length) { $('#apprMain').innerHTML = '<div class="card" style="margin:14px">この期間にスタッフのデータがありません。評価期間を変えてください。</div>'; $('#apprStaffList').innerHTML = ''; return; }
    if (!appr.name || !names.includes(appr.name)) appr.name = names[0];
    $('#apprStaffList').innerHTML = names.map(n => {
      const st = apprStats(n); const pct = Math.round(st.scored / APPR_ITEMS.length * 100);
      return `<li class="${n === appr.name ? 'active' : ''}" data-name="${esc(n)}"><span class="nm">${esc(n)}</span><span class="meta">${st.scored}/${APPR_ITEMS.length}${st.avg != null ? ` <b>${st.avg.toFixed(1)}</b>` : ''}</span><span class="bar"><i style="width:${pct}%"></i></span></li>`;
    }).join('');
    $$('#apprStaffList li').forEach(li => li.onclick = () => { appr.name = li.dataset.name; renderAppraisal(); });
    renderAppraisalMain();
  }
  const fmtMd = x => `${x.m}/${x.d}(${DOW[x.w]})`;
  const periodLabel = () => { const [y1, m1] = appr.from.split('-').map(Number), [y2, m2] = appr.to.split('-').map(Number); return appr.from === appr.to ? `${y1}年${m1}月` : `${y1}年${m1}月〜${y2}年${m2}月`; };
  function renderAppraisalMain() {
    const name = appr.name; const a = apprOf(name); const col = apprCollect(name); const st = apprStats(name);
    const byTag = {}; APPR_ITEMS.forEach(i => byTag[i.id] = []);
    col.days.forEach(x => x.tags.forEach(t => byTag[t].push(x)));
    const untagged = col.days.filter(x => !x.tags.length && (x.rate === 3 || x.rate === -1 || x.mgr.trim()));
    const taggedDays = col.days.filter(x => x.tags.length).length;
    const rateCount = { 3: 0, 2: 0, 1: 0, '-1': 0 }; col.days.forEach(x => { if (x.rate) rateCount[x.rate]++; });
    let h = `<div class="report-head">
      <div><h2>${esc(name)} <small>人事考課 ${periodLabel()}</small></h2>
        <div class="report-kpis">
          <span>出勤 <b>${col.work}</b>日</span><span>日次評価 ◎${rateCount[3]} ○${rateCount[2]} △${rateCount[1]} ×${rateCount[-1]}</span>
          <span>考課タグ付き <b>${taggedDays}</b>日</span>
          <span>採点 <b>${st.scored}</b>/${APPR_ITEMS.length}項目</span>
          ${st.avg != null ? `<span>平均 <b>${st.avg.toFixed(2)}</b></span><span>合計 <b>${st.total}</b></span>` : ''}
          ${st.basic != null ? `<span>基礎 <b>${st.basic.toFixed(2)}</b></span>` : ''}${st.guide != null ? `<span>行動指針 <b>${st.guide.toFixed(2)}</b></span>` : ''}
        </div>
        <div class="appr-meta">
          <label>評価年月日 <input type="date" id="apprDate" value="${esc(a.date || '')}"></label>
          <label>評価者 <input id="apprEvaluator" value="${esc(a.evaluator || '')}" placeholder="氏名"></label>
          <span class="hint">${APPR_NOTE}</span>
        </div>
      </div>
      <div class="report-actions no-print">
        <button class="btn" id="apprExportBtn">この人をExcel書出</button>
        <button class="btn" id="apprPrintBtn">印刷</button>
      </div>
    </div>`;
    if (untagged.length) {
      h += `<div class="appr-untagged no-print"><b>考課項目が付いていない特筆日が ${untagged.length} 日あります</b>（◎・×・上長コメントあり）。根拠に使うには月報でタグを付けてください：
        ${untagged.slice(0, 40).map(x => `<a href="#" class="ut" data-k="${x.k}" data-d="${x.d}" title="${esc((x.mgr || x.note).slice(0, 80))}">${fmtMd(x)}${x.rate ? RATE_LABEL(x.rate) : ''}</a>`).join(' ')}${untagged.length > 40 ? ' …' : ''}</div>`;
    }
    h += `<table class="appr-table"><thead><tr><th colspan="2">評価項目</th><th class="c-i">項目</th><th class="c-q">具体的評価内容</th><th class="c-e">根拠（月報の日次記録）</th><th class="c-sc">考課<br>1〜5</th><th class="c-rs">評価理由</th></tr></thead><tbody>`;
    let lastGroup = '', lastCat = '';
    APPR_ITEMS.forEach((it, idx) => {
      const ev = byTag[it.id]; const sc = a.scores[it.id] || 0;
      const cnt = { 3: 0, 2: 0, 1: 0, '-1': 0 }; ev.forEach(x => { if (x.rate) cnt[x.rate]++; });
      const grpCell = it.group !== lastGroup ? `<td class="c-g" rowspan="${APPR_ITEMS.filter(x => x.group === it.group).length}"><span class="vt">${esc(it.group)}</span></td>` : '';
      const catCell = it.cat !== lastCat ? `<td class="c-c" rowspan="${APPR_ITEMS.filter(x => x.cat === it.cat).length}">${esc(it.cat)}</td>` : '';
      lastGroup = it.group; lastCat = it.cat;
      h += `<tr data-item="${it.id}">${grpCell}${catCell}<td class="c-i"><b>${esc(it.name)}</b></td>
        <td class="c-q">${esc(it.q)}<button class="desc-btn no-print" title="評価内容解説を表示">解説</button><div class="desc hidden">${esc(it.desc)}</div></td>
        <td class="c-e">${ev.length ? `<div class="ev-sum">${ev.length}日 ${cnt[3] ? `<span class="ev-r r3">◎${cnt[3]}</span>` : ''}${cnt[2] ? `<span class="ev-r r2">○${cnt[2]}</span>` : ''}${cnt[1] ? `<span class="ev-r r1">△${cnt[1]}</span>` : ''}${cnt[-1] ? `<span class="ev-r rx">×${cnt[-1]}</span>` : ''}</div>
          <ul class="ev-list">${ev.map(x => `<li class="rate-${x.rate}"><a href="#" class="ev-d" data-k="${x.k}" data-d="${x.d}">${fmtMd(x)}</a><span class="ev-rate">${RATE_LABEL(x.rate)}</span>${x.a ? `<span class="ev-a" style="background:${colorOf(x.a)}">${esc(shortOf(x.a))}</span>` : ''}<span class="ev-t">${x.mgr ? `<span class="ev-mgr">${esc(x.mgr)}</span>` : ''}${x.note ? `<span class="ev-note">${esc(x.note)}</span>` : ''}</span></li>`).join('')}</ul>` : '<span class="ev-none">根拠となる記録なし</span>'}</td>
        <td class="c-sc"><div class="score-btns">${[1, 2, 3, 4, 5].map(v => `<button data-score="${v}" class="${sc === v ? 'on s' + v : ''}">${v}</button>`).join('')}</div></td>
        <td class="c-rs"><textarea data-item="${it.id}" rows="2" placeholder="どういう判断でこの点数にしたか">${esc(a.reasons[it.id] || '')}</textarea></td>
      </tr>`;
    });
    h += `</tbody><tfoot><tr><td colspan="5" class="tf-l">合計（採点済 ${st.scored}/${APPR_ITEMS.length} 項目）　基礎項目 平均 ${st.basic != null ? st.basic.toFixed(2) : '-'}　行動指針項目 平均 ${st.guide != null ? st.guide.toFixed(2) : '-'}</td><td class="c-sc"><b>${st.total || ''}</b></td><td></td></tr></tfoot></table>`;
    h += `<div class="report-summary"><div class="card" style="grid-column:1/-1"><h3>総評・フィードバック用メモ</h3><textarea id="apprOverall" rows="4" placeholder="面談で伝えること、期待すること、次期の課題など">${esc(a.overall || '')}</textarea></div></div>`;
    const main = $('#apprMain'); main.innerHTML = h;
    // handlers
    const autoGrow = ta => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
    $$('textarea', main).forEach(ta => { autoGrow(ta); ta.addEventListener('input', () => autoGrow(ta)); });
    $$('.appr-table textarea', main).forEach(ta => ta.addEventListener('change', () => { const o = apprOf(name, true); const v = ta.value.trim(); if (v) o.reasons[ta.dataset.item] = v; else delete o.reasons[ta.dataset.item]; save(); }));
    $$('.score-btns button', main).forEach(b => b.onclick = () => { const id = b.closest('tr').dataset.item; const o = apprOf(name, true); const v = +b.dataset.score; if (o.scores[id] === v) delete o.scores[id]; else o.scores[id] = v; save(); renderAppraisal(); });
    $$('.desc-btn', main).forEach(b => b.onclick = () => { const d = b.nextElementSibling; d.classList.toggle('hidden'); b.textContent = d.classList.contains('hidden') ? '解説' : '閉じる'; });
    $$('a.ev-d, a.ut', main).forEach(x => x.onclick = e => { e.preventDefault(); jumpToReport(x.dataset.k, name, +x.dataset.d); });
    $('#apprDate').onchange = e => { apprOf(name, true).date = e.target.value; save(); };
    $('#apprEvaluator').addEventListener('change', e => { apprOf(name, true).evaluator = e.target.value.trim(); save(); });
    $('#apprOverall').addEventListener('change', e => { apprOf(name, true).overall = e.target.value.trim(); save(); });
    $('#apprExportBtn').onclick = () => exportAppraisalExcel([name]);
    $('#apprPrintBtn').onclick = () => printPortrait();
  }
  function printPortrait() {
    let st = $('#printPageStyle'); if (!st) { st = document.createElement('style'); st.id = 'printPageStyle'; document.head.appendChild(st); }
    st.textContent = '@page { size: A4 portrait; margin: 10mm; }';
    const cleanup = () => { st.textContent = ''; window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup); window.print();
  }
  function jumpToReport(k, name, d) {
    const [y, m] = k.split('-').map(Number); const mo = state.months[k]; if (!mo) return;
    const s = mo.staff.find(x => x.name === name); if (!s) return;
    cur = { y, m }; reportStaffId = s.id; renderHeader(); switchView('report');
    const tr = $(`#reportMain tr[data-day="${d}"]`); if (tr) { tr.scrollIntoView({ block: 'center' }); tr.classList.add('flash'); setTimeout(() => tr.classList.remove('flash'), 1600); }
  }
  function exportAppraisalExcel(names) {
    if (typeof XLSX === 'undefined') return toast('Excelライブラリが読み込めていません', true);
    if (!names.length) return toast('対象のスタッフがいません', true);
    const wb = XLSX.utils.book_new();
    const border = { style: 'thin', color: { rgb: '808080' } }; const B = { top: border, bottom: border, left: border, right: border };
    const font = { name: 'Noto Sans JP', sz: 10 }; const fill = hex => ({ patternType: 'solid', fgColor: { rgb: hex.replace('#', '').toUpperCase() } });
    const wrap = { font, border: B, alignment: { vertical: 'top', wrapText: true } };
    const ctr = { font, border: B, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
    const hdr = { font: { ...font, bold: true }, border: B, fill: fill('#D9E1F2'), alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
    const used = new Set();
    names.forEach(name => {
      const a = apprOf(name); const col = apprCollect(name); const st = apprStats(name);
      const byTag = {}; APPR_ITEMS.forEach(i => byTag[i.id] = []); col.days.forEach(x => x.tags.forEach(t => byTag[t].push(x)));
      const ws = {}; const put = (r, c, v, s) => { ws[XLSX.utils.encode_cell({ r, c })] = { v: v == null ? '' : v, t: typeof v === 'number' ? 'n' : 's', s: s || wrap }; };
      const lbl = { font: { ...font, bold: true }, border: B, fill: fill('#F2F2F2'), alignment: { vertical: 'center' } };
      // A=0 空, B=1 評価項目, C=2 項目１, D=3 項目２, E=4 具体的評価内容, F=5 課長考課, G=6 評価内容解説, H=7 評価理由, I=8 根拠
      put(0, 1, '評価年月日', lbl); put(0, 2, a.date || '', { font, border: B });
      put(1, 1, '被評価者', lbl); put(1, 2, name, { font: { ...font, bold: true, sz: 12 }, border: B });
      put(2, 1, '評価者', lbl); put(2, 2, a.evaluator || '', { font, border: B });
      put(3, 1, '評価期間', lbl); put(3, 2, periodLabel(), { font, border: B });
      put(4, 5, APPR_NOTE, { font: { ...font, sz: 9, color: { rgb: 'C00000' } } });
      ['評価項目', '項目１', '項目２', '具体的評価内容', '課長考課', '評価内容解説', '評価理由', '根拠（月報の日次記録）'].forEach((x, i) => put(5, 1 + i, x, hdr));
      let row = 6; const merges = []; let gStart = row, cStart = row, lastG = '', lastC = '';
      APPR_ITEMS.forEach((it, idx) => {
        if (it.group !== lastG) { if (lastG) merges.push({ s: { r: gStart, c: 1 }, e: { r: row - 1, c: 1 } }); gStart = row; lastG = it.group; put(row, 1, it.group, { ...ctr, font: { ...font, bold: true }, fill: fill(it.group === '基礎項目' ? '#FFF2CC' : '#E2EFDA'), alignment: { horizontal: 'center', vertical: 'center', textRotation: 255 } }); }
        if (it.cat !== lastC) { if (lastC) merges.push({ s: { r: cStart, c: 2 }, e: { r: row - 1, c: 2 } }); cStart = row; lastC = it.cat; put(row, 2, it.cat, { ...ctr, font: { ...font, bold: true } }); }
        put(row, 3, it.name, { ...wrap, font: { ...font, bold: true } });
        put(row, 4, it.q, wrap);
        const sc = a.scores[it.id]; put(row, 5, sc || '', { ...ctr, font: { ...font, bold: true, sz: 12 }, fill: sc ? fill(sc >= 4 ? '#DDEBF7' : sc <= 2 ? '#FCE4D6' : '#FFFFFF') : undefined });
        put(row, 6, it.desc, { ...wrap, font: { ...font, sz: 9 } });
        put(row, 7, a.reasons[it.id] || '', wrap);
        const ev = byTag[it.id];
        put(row, 8, ev.map(x => `${x.y}/${x.m}/${x.d}${RATE_LABEL(x.rate)}${x.a ? `[${x.a}]` : ''} ${x.mgr || x.note}`.trim()).join('\n'), { ...wrap, font: { ...font, sz: 9 } });
        row++;
      });
      merges.push({ s: { r: gStart, c: 1 }, e: { r: row - 1, c: 1 } }); merges.push({ s: { r: cStart, c: 2 }, e: { r: row - 1, c: 2 } });
      put(row, 4, '合計', { ...lbl, alignment: { horizontal: 'right' } });
      ws[XLSX.utils.encode_cell({ r: row, c: 5 })] = { t: 'n', f: `SUM(F7:F${row})`, s: { ...ctr, font: { ...font, bold: true, sz: 12 } } };
      put(row, 6, `採点 ${st.scored}/${APPR_ITEMS.length} 項目　基礎項目 平均 ${st.basic != null ? st.basic.toFixed(2) : '-'}　行動指針項目 平均 ${st.guide != null ? st.guide.toFixed(2) : '-'}`, { font });
      row += 2;
      put(row, 1, '総評', lbl); put(row, 2, a.overall || '', wrap); merges.push({ s: { r: row, c: 2 }, e: { r: row, c: 8 } }); row++;
      ws['!merges'] = merges;
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row, c: 8 } });
      ws['!cols'] = [{ wch: 2 }, { wch: 7 }, { wch: 12 }, { wch: 14 }, { wch: 40 }, { wch: 7 }, { wch: 50 }, { wch: 40 }, { wch: 50 }];
      ws['!rows'] = []; for (let r = 6; r < 6 + APPR_ITEMS.length; r++) ws['!rows'][r] = { hpt: Math.max(60, Math.min(220, 15 * (1 + (byTag[APPR_ITEMS[r - 6].id].length || 0)))) };
      let sn = name.replace(/[\\\/\?\*\[\]:]/g, '_').slice(0, 28); let k = 2; const b0 = sn; while (used.has(sn)) sn = `${b0}_${k++}`; used.add(sn);
      XLSX.utils.book_append_sheet(wb, ws, sn);
    });
    XLSX.writeFile(wb, `人事考課表_${appr.from.replace('-', '')}-${appr.to.replace('-', '')}${names.length === 1 ? '_' + names[0] : ''}.xlsx`);
    toast('考課表を書き出しました');
  }

  // ---------- views ----------
  function switchView(v) {
    view = v;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
    ['grid', 'day', 'report', 'appraisal', 'summary', 'settings'].forEach(k => $('#view-' + k).classList.toggle('hidden', k !== v));
    ed.close(); closeTagPicker();
    document.body.classList.toggle('print-report', v === 'report' || v === 'appraisal');
    document.body.classList.toggle('print-appr', v === 'appraisal');
    renderView();
  }
  function renderView() {
    if (view === 'grid') { renderLegend(); renderGrid(); }
    else if (view === 'day') renderDay();
    else if (view === 'report') renderReport();
    else if (view === 'appraisal') renderAppraisal();
    else if (view === 'summary') renderSummary();
    else renderSettings();
  }
  function renderAll() { renderHeader(); refreshDatalists(); renderView(); }
  function gotoMonth(y, m) {
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    ed.close(); cur = { y, m }; sel = null; ensureStaffForMonth(); save(); renderAll();
  }

  // ---------- init ----------
  function init() {
    load();
    const t = new Date();
    const keys = Object.keys(state.months).sort();
    const tk = ym(t.getFullYear(), t.getMonth() + 1);
    if (state.months[tk]) cur = { y: t.getFullYear(), m: t.getMonth() + 1 };
    else if (keys.length) { const [y, m] = keys[keys.length - 1].split('-').map(Number); cur = { y, m }; }
    else cur = { y: t.getFullYear(), m: t.getMonth() + 1 };
    ensureStaffForMonth();

    $('#prevMonth').onclick = () => gotoMonth(cur.y, cur.m - 1);
    $('#nextMonth').onclick = () => gotoMonth(cur.y, cur.m + 1);
    $('#todayBtn').onclick = () => gotoMonth(t.getFullYear(), t.getMonth() + 1);
    $('#monthPicker').onchange = e => { const [y, m] = e.target.value.split('-').map(Number); if (y && m) gotoMonth(y, m); };
    $$('.tab').forEach(b => b.onclick = () => switchView(b.dataset.view));
    $('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;
    $('#exportBtn').onclick = exportExcel;
    $('#importFile').onchange = e => { if (e.target.files[0]) importExcel(e.target.files[0]); e.target.value = ''; };
    $('#printBtn').onclick = () => { if (view === 'report') { $('#reportPrintBtn') && $('#reportPrintBtn').click(); return; } if (view === 'appraisal') { printPortrait(); return; } if (view !== 'grid') switchView('grid'); setTimeout(() => window.print(), 100); };
    $('#showNotes').onchange = renderGrid; $('#showCounts').onchange = renderGrid;
    $('#compactMode').onchange = e => { document.body.classList.toggle('compact', e.target.checked); localStorage.setItem('shiftapp.compact', e.target.checked ? '1' : ''); };
    if (localStorage.getItem('shiftapp.compact')) { $('#compactMode').checked = true; document.body.classList.add('compact'); }
    // menu
    const menu = $('#menuPopup');
    $('#menuBtn').onclick = e => { e.stopPropagation(); menu.classList.toggle('hidden'); };
    document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.classList.add('hidden'); });
    $('#copyPrevBtn').onclick = () => { const src = state.months[prevMonthKey()]; if (!src) return toast('前月のデータがありません', true); if (!confirm('この月のスタッフと予定を、前月のスタッフ構成（予定は空）で置き換えます。よろしいですか？')) return; snapshot(); const mo = month(true); mo.staff = src.staff.map(s => ({ ...clone(s), id: uid() })); mo.shifts = {}; save(); renderAll(); toast('前月のスタッフ構成をコピーしました（予定は空）'); };
    $('#clearMonthBtn').onclick = () => { if (!confirm(`${cur.y}年${cur.m}月 の予定をすべて消去しますか？（スタッフは残ります）`)) return; snapshot(); month(true).shifts = {}; save(); renderAll(); };
    $('#backupBtn').onclick = backup;
    $('#restoreFile').onchange = e => { if (e.target.files[0]) restoreJson(e.target.files[0]); e.target.value = ''; };
    $('#resetBtn').onclick = () => { if (!confirm('すべてのデータを消して初期データ（元のスプレッドシート）に戻します。よろしいですか？')) return; state = freshState(); undoStack.length = 0; redoStack.length = 0; save(); init2(); };
    // day view
    $('#prevDay').onclick = () => shiftDay(-1); $('#nextDay').onclick = () => shiftDay(1);
    $('#dayPicker').onchange = e => { const [y, m, d] = e.target.value.split('-').map(Number); if (!y) return; if (y !== cur.y || m !== cur.m) { cur = { y, m }; ensureStaffForMonth(); } dayViewDate = { y, m, d }; renderAll(); };
    initEditor(); initKeys(); initSettings(); initSync(); initAppraisal();
    $('#reportExportAllBtn').onclick = () => exportReportExcel(month(true).staff);
    init2();
    const hv = (location.hash.match(/view=(grid|day|report|appraisal|summary|settings)/) || [])[1];
    if (hv) switchView(hv);
    // クラウド同期: 起動時に読み込み、タブ復帰時にも確認、閉じる前に未送信があれば送信
    if (sync.on()) sync.pull(true);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sync.on()) sync.pull(true); });
    window.addEventListener('pagehide', () => { if (sync.on() && sync.dirty) { clearTimeout(sync.timer); sync.push(); } });
  }
  function initSync() {
    sync.load();
    $('#syncUrl').value = sync.cfg.url || ''; $('#syncToken').value = sync.cfg.token || ''; $('#syncEnabled').checked = !!sync.cfg.enabled;
    const readForm = () => { sync.cfg.url = $('#syncUrl').value.trim(); sync.cfg.token = $('#syncToken').value.trim(); sync.cfg.enabled = $('#syncEnabled').checked; };
    $('#syncSaveBtn').onclick = async () => {
      readForm();
      if (sync.cfg.enabled && (!sync.cfg.url || !sync.cfg.token)) { toast('URLとトークンを入力してください', true); return; }
      sync.saveCfg(); renderSyncBadge(); toast('同期設定を保存しました');
      if (sync.on()) { sync.setBase(''); await sync.pull(false); }
    };
    $('#syncTestBtn').onclick = async () => {
      readForm(); if (!sync.cfg.url || !sync.cfg.token) return toast('URLとトークンを入力してください', true);
      const b = $('#syncTestBtn'); b.disabled = true; b.textContent = '接続中…';
      try { await sync.test(); toast('接続OK'); } catch (e) { toast('接続失敗: ' + e.message, true); }
      b.disabled = false; b.textContent = '接続テスト';
    };
    $('#syncPullBtn').onclick = async () => { readForm(); if (!sync.on()) return toast('同期が有効になっていません', true); sync.saveCfg(); sync.setBase(''); sync.dirty = false; await sync.pull(false); };
    $('#syncPushBtn').onclick = async () => { readForm(); if (!sync.on()) return toast('同期が有効になっていません', true); sync.saveCfg(); if (!confirm('この端末の内容でクラウドを上書きします。よろしいですか？')) return; await sync.push(true); toast(sync.status === 'ok' ? 'クラウドへ書き込みました' : '書き込みに失敗: ' + sync.lastError, sync.status !== 'ok'); };
    renderSyncBadge();
  }
  function init2() {
    if (!state.months[monthKey()]) { const keys = Object.keys(state.months).sort(); if (keys.length) { const [y, m] = keys[keys.length - 1].split('-').map(Number); cur = { y, m }; } }
    ensureStaffForMonth(); renderAll(); updateUndoButtons();
  }
  function shiftDay(delta) {
    const nd = daysIn(cur.y, cur.m); let d = dayViewDate.d + delta, y = cur.y, m = cur.m;
    if (d < 1) { m--; if (m < 1) { m = 12; y--; } d = daysIn(y, m); } else if (d > nd) { m++; if (m > 12) { m = 1; y++; } d = 1; }
    if (y !== cur.y || m !== cur.m) { cur = { y, m }; ensureStaffForMonth(); }
    dayViewDate = { y, m, d }; renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
  // テスト・デバッグ用フック
  window.__shift = { parseSheet, importExcel, exportExcel, getState: () => state, getCur: () => cur, gotoMonth, switchView, setAppr: (from, to, name) => { appr.from = from; appr.to = to; if (name) appr.name = name; persistAppr(); }, apprCollect, exportAppraisalExcel, save, renderAll, APPR_ITEMS };
})();
