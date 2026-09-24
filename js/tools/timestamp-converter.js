/* ==========================================================================
   timestamp-converter.js — 时间戳转换
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 timestamp-converter（MIT，作者 Jamal Tantaoui /
   Iris Digital）。改动清单：

   一、中文化与设计系统
     1. 界面文案全量中文化（含状态行、错误提示、批量表头）
     2. 改用本站的 .panel / .tool-body / .value-list / .data-table / .tool-status 等组件，
        删掉上游的 CSS 依赖与内联样式，颜色只用 CSS 变量
     3. 上游的 js/common.js（copyToClipboard / showToast）未引入，复制改用本站的
        data-copy-target 全局代理，提示改用 T.util.toast

   二、修复的缺陷（都先用探针跑出可复现的结果，见 .temporary/timestamp/probe-upstream.mjs）

     1. **19 位纳秒时间戳被当成微秒。** 上游按「位数」分档：`digits <= 11` 秒、
        `<= 14` 毫秒、否则一律当微秒 —— 没有纳秒档。实测输入
        `1717200000000000000`（Go / Rust / ClickHouse 里常见的 ns 时间戳）会算出
        `+056385-11-26`（公元 56385 年），**而且不报任何错**，用户完全看不出问题。
        本工具按数量级分四档（秒 / 毫秒 / 微秒 / 纳秒）。
     2. **带小数的秒级时间戳解析不了。** 上游用 `/^-?\d+$/` 判数字，`1717200000.5`
        落到 `new Date('1717200000.5')` → Invalid Date → 报「无法解析」。
        而同样形态的 `1.5` 却被 V8 当日期解析成 `2001-01-04` —— 同一个写法，
        长的失败、短的给出毫无意义的结果。本工具一条正则同时接受整数与小数。
     3. **`+` 开头的数字解析不了。** `/^-?\d+$/` 不接受 `+1717200000`，
        落到 Date 解析后返回 null。
     4. **裸日期的时区口径没有告知。** 按 ECMAScript 规定，`2026-01-01` 是 **UTC 零点**，
        而 `2026-01-01T00:00:00` 是**本地零点**、`2026/01/01` 又是本地零点 ——
        三个看起来一样的写法给出两个不同的结果（UTC+8 下相差 8 小时）。
        上游既不提示也没有开关，用户只会以为工具算错了。本工具在状态行标注实际口径，
        并提供「裸日期按本地零点解释」的开关。
     5. **自动判定单位的结果不告诉用户。** 位数启发式在边界上必然有歧义
        （14 位既可能是毫秒也可能是微秒），上游既不说明也不允许覆盖。
        本工具把判定结果写进状态行，并允许手动指定单位。
     6. **清空时抹掉了 URL 末尾的斜杠。** 上游 `history.replaceState(null, '', location.pathname)`，
        站点是目录式 URL（`/tools/timestamp-converter/`），这会把末尾斜杠去掉、
        多触发一次重定向。改用 `pathname + search`。
     7. **批量没有行数上限。** 上游一次性渲染全部行，贴几千行会卡住页面。
        本工具上限 500 行并在界面上写明。

   三、新增
     - 单位可手动指定（自动 / 秒 / 毫秒 / 微秒 / 纳秒），「自动」的判定结果实时可见
     - 时区对照表：本地时区 + 13 个常用时区，可再加一个自定义时区
     - 结果行与时区行都可点复制；时区表可复制成 TSV
     - 时间戳与日期双向：输入框既接受时间戳也接受日期字符串（沿用上游设计）

   四、口径说明（不是缺陷，但要写清楚）
     - `relative()` 用 365 天当年、30 天当月 —— 沿用上游口径，说明区写明了
     - 上游的 `hour12: false` 曾怀疑会在午夜产出 `24:00:00`（ICU 的 h24 行为）。
       **实测本机 ICU 给的是 h23，复现不出来，所以不列为缺陷。** 但本工具仍改用
       `formatToParts` 自己拼字符串：上游的时区行格式受 locale 影响
       （`en-GB` 产出 `Thu, 01 Jan 2026, 00:00:00 UTC`），拼接方式不可控，
       而且换成 `formatToParts` 后 h23 / h24 的差异从根上不存在。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;

  /**
   * 依赖缺失时**不要静默 return** —— 结果区一片空白，光看页面完全看不出哪里坏了。
   */
  function bail(detail) {
    var box = document.getElementById('ts-rows');
    if (!box) return;
    var div = document.createElement('div');
    div.className = 'code-empty';
    var strong = document.createElement('strong');
    strong.textContent = '页面依赖的脚本没有加载成功';
    div.appendChild(strong);
    div.appendChild(document.createTextNode(
      detail + '请强制刷新（Ctrl+F5 / Cmd+Shift+R）后重试。'));
    box.textContent = '';
    box.appendChild(div);
  }

  if (!T || !T.util) {
    bail('js/registry.js 或 js/site.js 没有加载成功。');
    return;
  }
  if (typeof T.util.debounce !== 'function' || typeof T.util.emptyHint !== 'function') {
    bail('加载到的是旧版 js/site.js。');
    return;
  }

  var esc = T.util.esc;

  /* ======================================================================
     一、常量
     ====================================================================== */

  /* 数字输入的单位。mult = 换算成毫秒要乘的系数；auto 用数量级判断。 */
  var UNITS = [
    { id: 'auto', name: '自动', mult: null },
    { id: 's',    name: '秒',   mult: 1e3 },
    { id: 'ms',   name: '毫秒', mult: 1 },
    { id: 'us',   name: '微秒', mult: 1e-3 },
    { id: 'ns',   name: '纳秒', mult: 1e-6 }
  ];
  var UNIT_MAP = {};
  UNITS.forEach(function (u) { UNIT_MAP[u.id] = u; });

  var UNIT_LABEL = { s: '秒', ms: '毫秒', us: '微秒', ns: '纳秒' };

  /* 自动分档的数量级边界。取整十次幂，和「位数」等价但连续，
     而且多出上游缺失的纳秒档。 */
  function autoUnit(abs) {
    if (abs < 1e11) return 's';
    if (abs < 1e14) return 'ms';
    if (abs < 1e17) return 'us';
    return 'ns';
  }

  var WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  var LOCAL_TZ = (function () {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch (e) { return 'UTC'; }
  })();

  /* 常用时区。本地时区永远排第一，与它重复的会被去掉。 */
  var CURATED_TZ = [
    'UTC',
    'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Kolkata', 'Asia/Dubai',
    'Europe/London', 'Europe/Paris', 'Europe/Moscow',
    'America/New_York', 'America/Chicago', 'America/Los_Angeles',
    'America/Sao_Paulo', 'Australia/Sydney'
  ];

  var MAX_BATCH = 500;

  var CUSTOM_HINT = '填一个 IANA 时区名（如 Europe/Berlin），会加进下面的对照表';

  /* ======================================================================
     二、时区格式化
     ----------------------------------------------------------------------
     全部走 formatToParts 自己拼字符串，不用 Intl 的 format() ——
     后者会带上 locale 的标点与词序（"Thu, 01 Jan 2026, 00:00:00 UTC"），
     不同引擎还不一样。
     ====================================================================== */

  /* 构造 Intl.DateTimeFormat 不便宜，而批量转换一次要格式化几百行 × 十几个时区，
     所以按时区缓存。时区名是有限的字符串，缓存不会无限增长。 */
  var dtfCache = {};

  function dtfFor(tz) {
    var dtf = dtfCache[tz];
    if (!dtf) {
      dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      dtfCache[tz] = dtf;
    }
    return dtf;
  }

  /** 某时刻在指定时区的墙上时间，拆成 { year, month, day, hour, minute, second } */
  function wallParts(date, tz) {
    var out = {};
    dtfFor(tz).formatToParts(date).forEach(function (p) {
      if (p.type !== 'literal') out[p.type] = p.value;
    });
    return out;
  }

  /** 该时刻在指定时区与 UTC 的偏移（分钟） */
  function offsetMinutes(date, tz) {
    var p = wallParts(date, tz);
    /* 把「墙上的时间」当成 UTC 读回来，与真实时刻的差就是偏移。
       Date.UTC 对 0–99 年会把年份映射成 1900+year，所以用 setUTCFullYear。 */
    var asUTC = new Date(0);
    asUTC.setUTCFullYear(Number(p.year), Number(p.month) - 1, Number(p.day));
    asUTC.setUTCHours(Number(p.hour), Number(p.minute), Number(p.second), 0);
    return Math.round((asUTC.getTime() - date.getTime()) / 60000);
  }

  /** 分钟数 → "+08:00" / "-05:00" */
  function fmtOffset(min) {
    var sign = min < 0 ? '-' : '+';
    var a = Math.abs(min);
    var h = Math.floor(a / 60);
    var m = a % 60;
    return sign + (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /** "2026-09-25 10:17:14" */
  function wallText(date, tz) {
    var p = wallParts(date, tz);
    return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ':' + p.second;
  }

  /** ISO 8601，带该时区的偏移："2026-09-25T10:17:14+08:00" */
  function isoInZone(date, tz) {
    var p = wallParts(date, tz);
    return p.year + '-' + p.month + '-' + p.day + 'T' +
      p.hour + ':' + p.minute + ':' + p.second + fmtOffset(offsetMinutes(date, tz));
  }

  /** 时区名是否可用（拿去构造 Intl.DateTimeFormat 试一次） */
  function validZone(tz) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch (e) { return false; }
  }

  /* ======================================================================
     三、解析
     ====================================================================== */

  /* 整数或小数，允许正负号。不接受千分位逗号、十六进制、Infinity ——
     猜错了比直接报错更难查。 */
  var NUM_RE = /^([+-]?)(\d+)(?:\.(\d+))?$/;
  /* 纯日期写法：2026 / 2026-09 / 2026-09-25 */
  var BARE_DATE_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

  /**
   * 解析输入。
   * @returns {object} 见下面各 return 分支的 kind
   */
  function parseInput(raw, unitId, bareLocal) {
    raw = String(raw == null ? '' : raw).trim();
    if (!raw) return { kind: 'empty' };

    var m = NUM_RE.exec(raw);
    if (m) {
      var digits = m[2].length;
      /* 20 位以上已经没有现实意义，而且 Number() 会开始丢精度 */
      if (digits > 20) return { kind: 'bad', reason: 'tooLong' };

      var sign = m[1] === '-' ? -1 : 1;
      var value = Number(m[2] + (m[3] ? '.' + m[3] : ''));
      var unit = unitId === 'auto' ? autoUnit(Math.abs(Number(m[2]))) : unitId;
      var ms = Math.round(sign * value * UNIT_MAP[unit].mult);

      if (!isFinite(ms)) return { kind: 'bad', reason: 'outOfRange' };
      var d = new Date(ms);
      if (isNaN(d.getTime())) return { kind: 'bad', reason: 'outOfRange' };

      return {
        kind: 'ok', date: d, source: 'number',
        unit: unit, auto: unitId === 'auto', digits: digits
      };
    }

    /* 裸日期：ECMAScript 规定按 UTC 零点，本工具给一个开关改成按本地零点 */
    var bm = BARE_DATE_RE.exec(raw);
    if (bm && bareLocal) {
      var y = Number(bm[1]), mo = Number(bm[2] || 1), day = Number(bm[3] || 1);
      var local = new Date(0);
      local.setFullYear(y, mo - 1, day);
      local.setHours(0, 0, 0, 0);
      if (!isNaN(local.getTime())) {
        return { kind: 'ok', date: local, source: 'bareLocal', bare: true };
      }
    }

    var parsed = new Date(raw);
    if (isNaN(parsed.getTime())) return { kind: 'bad', reason: 'unparseable' };

    return { kind: 'ok', date: parsed, source: 'date', bare: !!bm };
  }

  /* ======================================================================
     四、相对时间
     ====================================================================== */

  /* 口径沿用上游：一年按 365 天、一月按 30 天。说明区写明了这一点。 */
  var REL_UNITS = [
    ['年', 31536000], ['个月', 2592000], ['天', 86400],
    ['小时', 3600], ['分钟', 60], ['秒', 1]
  ];

  function relativeText(date) {
    var diff = date.getTime() - Date.now();
    var future = diff > 0;
    var s = Math.abs(diff) / 1000;

    for (var i = 0; i < REL_UNITS.length; i++) {
      var v = Math.floor(s / REL_UNITS[i][1]);
      if (v >= 1) return v + ' ' + REL_UNITS[i][0] + (future ? '后' : '前');
    }
    return '刚刚';
  }

  /* ======================================================================
     五、DOM
     ====================================================================== */

  var inputEl   = document.getElementById('ts-input');
  var unitsEl   = document.getElementById('ts-units');
  var bareEl    = document.getElementById('ts-bare-local');
  var statusEl  = document.getElementById('ts-status');
  var isoBox    = document.getElementById('ts-iso');
  var isoText   = document.getElementById('ts-iso-text');
  var rowsEl    = document.getElementById('ts-rows');
  var zonesEl   = document.getElementById('ts-zones');
  var customEl  = document.getElementById('ts-custom-tz');
  var customHint = document.getElementById('ts-custom-hint');
  var copyZonesBtn = document.getElementById('ts-copy-zones');
  var batchEl   = document.getElementById('ts-batch');
  var batchBody = document.getElementById('ts-batch-body');
  var batchWrap = document.getElementById('ts-batch-wrap');
  var batchStatus = document.getElementById('ts-batch-status');
  var nowBtn    = document.getElementById('ts-now');
  var shareBtn  = document.getElementById('ts-share');
  var clearBtn  = document.getElementById('ts-clear');
  var copyBtn   = document.getElementById('ts-copy');
  var runBatchBtn = document.getElementById('ts-run-batch');
  var copyBatchBtn = document.getElementById('ts-copy-batch');

  if (!inputEl || !rowsEl || !zonesEl) return;

  var state = { unit: 'auto', bareLocal: false, date: null, meta: null, custom: null };

  /* ======================================================================
     六、渲染
     ====================================================================== */

  /* 每行的 id 显式给出 —— 别从标签推导：标签里的中文会被 \w 过滤掉，
     「Unix 秒」和「Unix 毫秒」会压成同一个 id。 */
  function row(id, label, value, extraCls) {
    return '<button class="value-row' + (extraCls ? ' ' + extraCls : '') + '" type="button" ' +
      'title="点击复制" data-copy-target="#ts-v-' + id + '">' +
      '<span class="value-label">' + esc(label) + '</span>' +
      '<span class="value-text" id="ts-v-' + id + '">' + esc(value) + '</span>' +
      '</button>';
  }

  function setCopyable(on) {
    [isoBox, copyBtn].forEach(function (b) {
      if (!b) return;
      if (on) b.setAttribute('data-copy-target', '#ts-iso-text');
      else b.removeAttribute('data-copy-target');
    });
  }

  function renderEmpty(message) {
    isoText.textContent = '—';
    setCopyable(false);
    T.util.emptyHint(rowsEl, '还没有可解析的内容',
      '在上方填一个时间戳（如 1717200000）或日期字符串（如 2026-06-01T00:00:00Z）。');
    zonesEl.innerHTML = '';
    if (copyZonesBtn) copyZonesBtn.disabled = true;
    statusEl.innerHTML = message || '输入一个时间戳或日期';
  }

  function renderError(reason, raw) {
    isoText.textContent = '—';
    setCopyable(false);
    T.util.emptyHint(rowsEl, '解析不了这段输入',
      reason === 'tooLong'
        ? '数字超过 20 位。这个长度的时间戳不存在，请检查是不是复制多了。'
        : '时间戳请填纯数字（秒 / 毫秒 / 微秒 / 纳秒），日期请用 ISO 8601 之类的标准写法。');
    zonesEl.innerHTML = '';
    if (copyZonesBtn) copyZonesBtn.disabled = true;
    statusEl.innerHTML = '<span class="is-error">' + esc(
      reason === 'tooLong' ? '数字太长（超过 20 位）'
        : reason === 'outOfRange' ? '超出可表示的日期范围（约公元 ±27 万年）'
          : '不是合法的时间戳或日期') + '</span>' +
      '<span class="err-raw">原始输入：' + esc(raw) + '</span>';
  }

  function renderResult(date, meta) {
    state.date = date;
    state.meta = meta;

    var ms = date.getTime();
    var secs = Math.floor(ms / 1000);
    var isoUTC = date.toISOString();

    isoText.textContent = isoUTC;
    setCopyable(true);

    rowsEl.innerHTML =
      row('unix-s', 'Unix 秒', String(secs)) +
      row('unix-ms', 'Unix 毫秒', String(ms)) +
      row('iso-utc', 'ISO 8601 (UTC)', isoUTC) +
      row('iso-local', 'ISO 8601 (本地)', isoInZone(date, LOCAL_TZ)) +
      row('rfc', 'RFC 1123 (UTC)', date.toUTCString()) +
      row('local', '本地时间', wallText(date, LOCAL_TZ)) +
      row('zone', '本地时区', LOCAL_TZ + ' ' + fmtOffset(offsetMinutes(date, LOCAL_TZ))) +
      row('weekday', '星期', WEEKDAYS[date.getDay()]) +
      row('rel', '相对现在', relativeText(date));

    renderZones(date);
    renderStatus(meta);
  }

  function renderStatus(meta) {
    var parts = [];

    if (meta.source === 'number') {
      if (meta.auto) {
        parts.push('按 ' + meta.digits + ' 位数字判定为「' + UNIT_LABEL[meta.unit] + '」');
      } else {
        parts.push('已按「' + UNIT_LABEL[meta.unit] + '」解释');
      }
    } else if (meta.source === 'bareLocal') {
      parts.push('裸日期按本地零点解释');
    } else if (meta.bare) {
      /* 裸日期按 ECMAScript 规定是 UTC 零点，这里把它换算成本地时间告诉用户，
         免得看到 ISO 值比自己写的那天早一天以为算错了 */
      parts.push('裸日期按 UTC 零点解释（本地为 ' + wallText(meta.date, LOCAL_TZ) + '）');
    }

    var html = esc(parts.join(' · '));

    var year = meta.date.getUTCFullYear();
    if (year < 1 || year > 9999) {
      html += '<span class="is-warn"> · 年份超出 1–9999，多数系统的时间库处理不了</span>';
    }
    statusEl.innerHTML = html || '解析成功';
  }

  function zoneList() {
    var list = [LOCAL_TZ];
    if (state.custom && state.custom !== LOCAL_TZ) list.push(state.custom);
    CURATED_TZ.forEach(function (z) {
      if (list.indexOf(z) === -1) list.push(z);
    });
    return list;
  }

  function renderZones(date) {
    var zones = zoneList();
    /* id 用下标而不是时区名：`Etc/GMT+8` 与 `Etc/GMT-8` 把非单词字符换成下划线后
       会撞成同一个 id */
    zonesEl.innerHTML = zones.map(function (z, i) {
      var off = offsetMinutes(date, z);
      var text = wallText(date, z) + ' ' + fmtOffset(off);
      var isLocal = z === LOCAL_TZ;
      return '<button class="value-row' + (isLocal ? ' ts-local' : '') + '" type="button" ' +
        'title="点击复制" data-copy-target="#ts-z-' + i + '">' +
        '<span class="value-label">' + esc(z + (isLocal ? '（本地）' : '')) + '</span>' +
        '<span class="value-text" id="ts-z-' + i + '">' + esc(text) + '</span>' +
        '</button>';
    }).join('');
    if (copyZonesBtn) copyZonesBtn.disabled = false;
  }

  /* ======================================================================
     七、主流程
     ====================================================================== */

  function update() {
    var raw = inputEl.value;
    var res = parseInput(raw, state.unit, state.bareLocal);

    if (res.kind === 'empty') { renderEmpty(); return; }
    if (res.kind === 'bad') { renderError(res.reason, raw.trim()); return; }
    renderResult(res.date, res);
  }

  var debounced = T.util.debounce(update, 90);

  /* ======================================================================
     八、批量
     ====================================================================== */

  function batchLines() {
    return batchEl.value.split('\n')
      .map(function (l) { return l.trim(); })
      .filter(Boolean);
  }

  function runBatch() {
    var all = batchLines();
    if (!all.length) {
      batchWrap.hidden = true;
      batchStatus.textContent = '一行填一个时间戳或日期';
      return;
    }

    var lines = all.slice(0, MAX_BATCH);
    var bad = 0;

    batchBody.innerHTML = lines.map(function (line) {
      var res = parseInput(line, state.unit, state.bareLocal);
      if (res.kind !== 'ok') {
        bad++;
        return '<tr><td>' + esc(line) + '</td>' +
          '<td colspan="3" class="cell-error">解析不了</td></tr>';
      }
      var d = res.date;
      return '<tr><td>' + esc(line) + '</td>' +
        '<td>' + Math.floor(d.getTime() / 1000) + '</td>' +
        '<td>' + d.toISOString() + '</td>' +
        '<td>' + esc(wallText(d, LOCAL_TZ)) + '</td></tr>';
    }).join('');

    batchWrap.hidden = false;
    batchStatus.textContent = '已转换 ' + lines.length + ' 行' +
      (bad ? '，其中 ' + bad + ' 行解析不了' : '') +
      (all.length > MAX_BATCH ? '（输入 ' + all.length + ' 行，只处理前 ' + MAX_BATCH + ' 行）' : '');
  }

  /* ======================================================================
     九、事件
     ====================================================================== */

  unitsEl.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-unit]');
    if (!chip) return;
    state.unit = chip.getAttribute('data-unit');
    T.util.$$('.choice-chip', unitsEl).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-unit') === state.unit));
    });
    update();
    if (!batchWrap.hidden) runBatch();
  });

  inputEl.addEventListener('input', debounced);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); update(); }
  });

  if (bareEl) {
    bareEl.addEventListener('change', function () {
      state.bareLocal = bareEl.checked;
      update();
    });
  }

  if (nowBtn) {
    nowBtn.addEventListener('click', function () {
      inputEl.value = String(Math.floor(Date.now() / 1000));
      update();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      inputEl.value = '';
      /* 只清掉 hash，别动 pathname —— 站点是目录式 URL，
         location.pathname 会把末尾斜杠抹掉，多一次重定向（上游的缺陷） */
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      update();
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', function () {
      var raw = inputEl.value.trim();
      if (!raw) { T.util.toast('还没有可分享的内容'); return; }
      location.hash = 't=' + encodeURIComponent(raw);
      T.util.copy(location.href, shareBtn);
      T.util.toast('分享链接已复制');
    });
  }

  if (customEl) {
    customEl.addEventListener('input', function () {
      var v = customEl.value.trim();
      if (!v) {
        state.custom = null;
        customEl.classList.remove('input--invalid');
        customHint.textContent = CUSTOM_HINT;
        if (state.date) renderZones(state.date);
        return;
      }
      if (validZone(v)) {
        state.custom = v;
        customEl.classList.remove('input--invalid');
        customHint.textContent = '已加入对照表';
        if (state.date) renderZones(state.date);
      } else {
        /* 输入过程中只标红，不动对照表 —— 编辑时每敲一个字符都可能短暂非法，
           这时把行撤掉会闪。与「非法输入标红 + 失焦回退」的约定一致。 */
        customEl.classList.add('input--invalid');
        customHint.textContent = '不认识这个时区名';
      }
    });

    /* 失焦时回退成上一个合法值并清掉标红 */
    customEl.addEventListener('blur', function () {
      if (!customEl.classList.contains('input--invalid')) return;
      customEl.value = state.custom || '';
      customEl.classList.remove('input--invalid');
      customHint.textContent = state.custom ? '已加入对照表' : CUSTOM_HINT;
    });
  }

  if (copyZonesBtn) {
    copyZonesBtn.addEventListener('click', function () {
      if (!state.date) { T.util.toast('还没有可复制的内容'); return; }
      var lines = ['时区\t当地时间\t与 UTC 的偏移'];
      zoneList().forEach(function (z) {
        lines.push(z + '\t' + wallText(state.date, z) + '\t' + fmtOffset(offsetMinutes(state.date, z)));
      });
      T.util.copy(lines.join('\n'), copyZonesBtn);
    });
  }

  if (batchEl) batchEl.addEventListener('input', T.util.debounce(runBatch, 90));
  if (runBatchBtn) runBatchBtn.addEventListener('click', runBatch);

  if (copyBatchBtn) {
    copyBatchBtn.addEventListener('click', function () {
      var lines = batchLines().slice(0, MAX_BATCH);
      if (!lines.length) { T.util.toast('还没有可复制的内容'); return; }
      var out = ['输入\tUnix 秒\tISO 8601 (UTC)\t本地时间'];
      lines.forEach(function (line) {
        var res = parseInput(line, state.unit, state.bareLocal);
        out.push(res.kind === 'ok'
          ? [line, Math.floor(res.date.getTime() / 1000), res.date.toISOString(),
             wallText(res.date, LOCAL_TZ)].join('\t')
          : [line, '', '', ''].join('\t'));
      });
      T.util.copy(out.join('\n'), copyBatchBtn);
    });
  }

  /* ======================================================================
     十、首屏
     ====================================================================== */

  unitsEl.innerHTML = UNITS.map(function (u) {
    return '<button class="choice-chip" type="button" data-unit="' + u.id + '" ' +
      'aria-pressed="' + (u.id === state.unit) + '">' + esc(u.name) + '</button>';
  }).join('');

  /* 自定义时区用 datalist 补全而不是 400 项的下拉 ——
     上游把一个完整的 IANA 列表塞进 <select>，既难找又占空间。
     supportedValuesOf 是可选能力，拿不到就纯手填。 */
  var tzDatalist = document.getElementById('ts-tz-list');
  if (tzDatalist && typeof Intl.supportedValuesOf === 'function') {
    try {
      Intl.supportedValuesOf('timeZone').forEach(function (z) {
        var o = document.createElement('option');
        o.value = z;
        tzDatalist.appendChild(o);
      });
    } catch (e) { /* 拿不到列表不影响手填 */ }
  }

  if (customHint) customHint.textContent = CUSTOM_HINT;

  /* 分享链接优先，其次填当前时间戳 */
  var hash = location.hash.match(/t=([^&]+)/);
  inputEl.value = hash ? decodeURIComponent(hash[1]) : String(Math.floor(Date.now() / 1000));
  update();                     /* 首屏同步渲染，不走防抖 */
  runBatch();
})();
