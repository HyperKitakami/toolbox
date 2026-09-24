/* ==========================================================================
   diff-checker.js — 文本差异对比
   --------------------------------------------------------------------------
   纯前端实现，无依赖。流程：
     1. prep()      把两侧文本切成带原始行号的记录
     2. diffRecords() 先剥掉公共前后缀，再对中段做 LCS 回溯
     3. buildRows() 把连续的非相同行两两配对成「修改」，并做行内字符级比对
     4. buildDisplay() 折叠过长的未变更块
     5. 渲染并排 / 统一两种视图
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var esc = T.util.esc;

  /* --- DOM --------------------------------------------------------------- */
  var leftEl  = document.getElementById('dc-left');
  var rightEl = document.getElementById('dc-right');
  var viewEl  = document.getElementById('dc-view');
  var statsEl = document.getElementById('dc-stats');
  var badgeEl = document.getElementById('dc-badge');
  var footEl  = document.getElementById('dc-foot');
  var copyBtn = document.getElementById('dc-copy');
  var leftCountEl  = document.getElementById('dc-left-count');
  var rightCountEl = document.getElementById('dc-right-count');

  var optCase  = document.getElementById('dc-opt-case');
  var optWs    = document.getElementById('dc-opt-ws');
  var optBlank = document.getElementById('dc-opt-blank');
  var optWrap  = document.getElementById('dc-opt-wrap');
  var viewRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="dc-view"]'));

  var swapBtn  = document.querySelector('[data-swap]');
  var demoBtn  = document.querySelector('[data-demo]');
  var clearBtn = document.querySelector('[data-clear]');

  if (!leftEl || !rightEl || !viewEl) return;

  /* --- 常量 -------------------------------------------------------------- */
  var LINE_MAX_CELLS   = 4000000;  /* 行级 LCS 的规模上限，超出则退化为整块替换 */
  var INLINE_MAX_CELLS = 60000;    /* 单行字符级 LCS 的规模上限 */
  var INLINE_MAX_ROWS  = 400;      /* 最多对多少行做行内高亮 */
  var COLLAPSE_MIN     = 9;        /* 未变更块超过这个长度才折叠 */
  var COLLAPSE_EDGE    = 3;        /* 折叠时两端各保留的行数 */
  var SIM_MIN          = 0.2;      /* 两行相似度低于此值就不配对，拆成删除 + 新增 */
  var ALIGN_MAX_CELLS  = 100000;   /* 变更块内对齐的规模上限，超出则退化为按位置配对 */

  var DEMO_LEFT = [
    'function greet(name) {',
    "  const msg = 'Hello, ' + name;",
    '  console.log(msg);',
    '  return msg;',
    '}',
    '',
    '// TODO: 支持多语言',
    "const users = ['alice', 'bob'];",
    'users.forEach(u => greet(u));'
  ].join('\n');

  var DEMO_RIGHT = [
    "function greet(name, locale = 'zh') {",
    '  const msg = locale === \'zh\'',
    '    ? `你好，${name}`',
    '    : `Hello, ${name}`;',
    '  console.log(msg);',
    '  return msg;',
    '}',
    '',
    "const users = ['alice', 'bob', 'carol'];",
    'users.forEach(function (u) {',
    '  greet(u);',
    '});'
  ].join('\n');

  /* --- 状态 -------------------------------------------------------------- */
  var state = {
    view: 'split',
    wrap: true,
    rows: [],
    display: [],
    stats: null,
    expanded: Object.create(null),
    tooLarge: false
  };

  /* ======================================================================
     一、差异算法
     ====================================================================== */

  /**
   * LCS 回溯，把连续同类操作合并成组。
   * A / B 可以是字符串数组（行内比对）或记录数组（行级比对），
   * 具体怎么判等由 eq 决定。
   * offA / offB 是 A、B 在各自原始数组中的起始下标，用于回溯出行号。
   * 返回 [{ op: 'equal' | 'del' | 'add', items: [...], ai, bi }, ...]
   *   ai / bi —— 该组第一项在 A / B 中的下标
   */
  function lcsRuns(A, B, eq, offA, offB) {
    offA = offA || 0;
    offB = offB || 0;

    var n = A.length, m = B.length;
    var dp = new Array(n + 1);
    for (var r = 0; r <= n; r++) dp[r] = new Uint32Array(m + 1);

    for (var i = n - 1; i >= 0; i--) {
      var row = dp[i], next = dp[i + 1];
      for (var j = m - 1; j >= 0; j--) {
        if (eq(A[i], B[j])) row[j] = next[j + 1] + 1;
        else row[j] = next[j] >= row[j + 1] ? next[j] : row[j + 1];
      }
    }

    var ops = [];
    function add(op, item, ai, bi) {
      var last = ops[ops.length - 1];
      if (last && last.op === op) { last.items.push(item); return; }
      ops.push({ op: op, items: [item], ai: ai, bi: bi });
    }

    var x = 0, y = 0;
    while (x < n && y < m) {
      if (eq(A[x], B[y])) { add('equal', A[x], offA + x, offB + y); x++; y++; }
      else if (dp[x + 1][y] >= dp[x][y + 1]) { add('del', A[x], offA + x, offB + y); x++; }
      else { add('add', B[y], offA + x, offB + y); y++; }
    }
    while (x < n) { add('del', A[x], offA + x, offB + y); x++; }
    while (y < m) { add('add', B[y], offA + x, offB + y); y++; }
    return ops;
  }

  /** 剥掉公共前后缀后再做 LCS，绝大多数真实场景下能把规模降到很小 */
  function diffRecords(A, B, eq) {
    var n = A.length, m = B.length;
    var ops = [];

    var s = 0;
    while (s < n && s < m && eq(A[s], B[s])) s++;

    var ea = n, eb = m;
    while (ea > s && eb > s && eq(A[ea - 1], B[eb - 1])) { ea--; eb--; }

    if (s > 0) ops.push({ op: 'equal', items: A.slice(0, s), ai: 0, bi: 0 });

    var midA = A.slice(s, ea), midB = B.slice(s, eb);
    if (midA.length && midB.length) {
      if (midA.length * midB.length > LINE_MAX_CELLS) {
        state.tooLarge = true;
        ops.push({ op: 'del', items: midA, ai: s, bi: s });
        ops.push({ op: 'add', items: midB, ai: s, bi: s });
      } else {
        ops = ops.concat(lcsRuns(midA, midB, eq, s, s));
      }
    } else if (midA.length) {
      ops.push({ op: 'del', items: midA, ai: s, bi: s });
    } else if (midB.length) {
      ops.push({ op: 'add', items: midB, ai: s, bi: s });
    }

    if (ea < n) ops.push({ op: 'equal', items: A.slice(ea), ai: ea, bi: eb });
    return ops;
  }

  /* --- 行内字符级比对 ---------------------------------------------------- */
  /* CJK 单字成词；拉丁字母数字串成词；空白串成词；其余符号逐字 */
  var RE_TOKEN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]|[A-Za-z0-9_]+|\s+|[^\s]/g;

  function tokenize(s) {
    return s.match(RE_TOKEN) || [];
  }

  function inlineMark(left, right) {
    var A = tokenize(left), B = tokenize(right);
    if (A.length * B.length > INLINE_MAX_CELLS) {
      return { left: esc(left), right: esc(right) };
    }
    var ops = lcsRuns(A, B, function (a, b) { return a === b; });
    var lh = '', rh = '';
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      var t = esc(o.items.join(''));
      if (o.op === 'equal') { lh += t; rh += t; }
      else if (o.op === 'del') { lh += '<mark class="d-del">' + t + '</mark>'; }
      else { rh += '<mark class="d-add">' + t + '</mark>'; }
    }
    return { left: lh, right: rh };
  }

  /* ======================================================================
     二、文本准备与行配对
     ====================================================================== */

  function prep(text, opts) {
    var raw = text.replace(/\r\n?/g, '\n');
    if (raw.charAt(raw.length - 1) === '\n') raw = raw.slice(0, -1);

    var all = raw === '' ? [] : raw.split('\n');
    var recs = [];
    for (var i = 0; i < all.length; i++) {
      if (opts.ignoreBlank && all[i].trim() === '') continue;
      recs.push({ t: all[i], n: i + 1 });   /* n 始终是原始行号 */
    }
    return { recs: recs, total: all.length };
  }

  function makeKey(opts) {
    return function (rec) {
      var s = rec.t;
      if (opts.ignoreWs) s = s.trim();
      if (opts.ignoreCase) s = s.toLowerCase();
      return s;
    };
  }

  /**
   * 两行的相似度（0–1）：公共前后缀长度相对总长度占比。
   * 只做线性扫描，够快也够用 —— 用来判断「这两行该不该算作同一行的修改」。
   */
  function similarity(a, b) {
    if (a === b) return 1;

    var ta = a.trim(), tb = b.trim();
    if (!ta.length || !tb.length) return 0;

    /* 只差大小写或首尾空白：本质是同一行，给高分 */
    if (ta.toLowerCase() === tb.toLowerCase()) return 0.9;

    var la = ta.length, lb = tb.length;
    /* 长度差太悬殊，直接判为不相似 */
    if (Math.min(la, lb) / Math.max(la, lb) < 0.3) return 0;

    var min = Math.min(la, lb);
    var p = 0;
    while (p < min && ta.charCodeAt(p) === tb.charCodeAt(p)) p++;

    var cap = min - p;
    var s = 0;
    while (s < cap && ta.charCodeAt(la - 1 - s) === tb.charCodeAt(lb - 1 - s)) s++;

    return (2 * (p + s)) / (la + lb);
  }

  /**
   * 在一个变更块内把删除行和新增行对齐。
   *
   * 不能简单地按位置两两配对：如果块首多出一行纯删除，
   * 后面所有行都会整体错位，把毫不相干的两行标成「修改」。
   * 这里用相似度加权的 LCS —— 只有相似度达标的组合才计分，
   * 于是「相似的配对、不相干的各走各路」。
   */
  function alignBlock(dels, adds) {
    var n = dels.length, m = adds.length;
    var steps = [];
    if (!n && !m) return steps;

    /* 规模过大时退化为按位置配对，避免卡顿 */
    if (!n || !m || n * m > ALIGN_MAX_CELLS) {
      var pairs = Math.min(n, m);
      for (var p = 0; p < pairs; p++) steps.push({ kind: 'mod', del: dels[p], add: adds[p] });
      for (var d = pairs; d < n; d++) steps.push({ kind: 'del', del: dels[d] });
      for (var a = pairs; a < m; a++) steps.push({ kind: 'add', add: adds[a] });
      return steps;
    }

    var score = [];   /* score[i][j] = 配对收益，0 表示不配对 */
    for (var i = 0; i < n; i++) {
      score[i] = new Float64Array(m);
      for (var j = 0; j < m; j++) {
        var sim = similarity(dels[i].t, adds[j].t);
        score[i][j] = sim >= SIM_MIN ? 1 + sim : 0;
      }
    }

    var dp = new Array(n + 1);
    for (var r = 0; r <= n; r++) dp[r] = new Float64Array(m + 1);
    for (var x = n - 1; x >= 0; x--) {
      for (var y = m - 1; y >= 0; y--) {
        var best = dp[x + 1][y] >= dp[x][y + 1] ? dp[x + 1][y] : dp[x][y + 1];
        if (score[x][y] > 0) {
          var withPair = score[x][y] + dp[x + 1][y + 1];
          if (withPair > best) best = withPair;
        }
        dp[x][y] = best;
      }
    }

    var i2 = 0, j2 = 0;
    while (i2 < n && j2 < m) {
      if (score[i2][j2] > 0 && dp[i2][j2] === score[i2][j2] + dp[i2 + 1][j2 + 1]) {
        steps.push({ kind: 'mod', del: dels[i2], add: adds[j2] });
        i2++; j2++;
      } else if (dp[i2 + 1][j2] >= dp[i2][j2 + 1]) {
        steps.push({ kind: 'del', del: dels[i2] });
        i2++;
      } else {
        steps.push({ kind: 'add', add: adds[j2] });
        j2++;
      }
    }
    while (i2 < n) { steps.push({ kind: 'del', del: dels[i2] }); i2++; }
    while (j2 < m) { steps.push({ kind: 'add', add: adds[j2] }); j2++; }

    return steps;
  }

  /**
   * 把 LCS 结果整理成渲染用的行数组。
   * 连续的非相同行交给 alignBlock 对齐，相似的配对成 mod，其余保持 del / add。
   */
  function buildRows(L, R, opts) {
    var key = makeKey(opts);
    var eq = function (a, b) { return key(a) === key(b); };

    var ops = diffRecords(L.recs, R.recs, eq);
    var rows = [];
    var modBudget = INLINE_MAX_ROWS;
    var i = 0;

    while (i < ops.length) {
      var op = ops[i];

      if (op.op === 'equal') {
        for (var k = 0; k < op.items.length; k++) {
          rows.push({
            type: 'equal',
            l: L.recs[op.ai + k].n,
            r: R.recs[op.bi + k].n,
            text: op.items[k].t
          });
        }
        i++;
        continue;
      }

      /* 收集一整段连续的变更；记录里自带原始行号 */
      var dels = [], adds = [];
      while (i < ops.length && ops[i].op !== 'equal') {
        var cur = ops[i];
        if (cur.op === 'del') {
          for (var q = 0; q < cur.items.length; q++) dels.push(L.recs[cur.ai + q]);
        } else {
          for (var w = 0; w < cur.items.length; w++) adds.push(R.recs[cur.bi + w]);
        }
        i++;
      }

      var steps = alignBlock(dels, adds);
      for (var p = 0; p < steps.length; p++) {
        var st = steps[p];
        if (st.kind === 'del') {
          rows.push({ type: 'del', l: st.del.n, text: st.del.t });
        } else if (st.kind === 'add') {
          rows.push({ type: 'add', r: st.add.n, text: st.add.t });
        } else {
          var row = { type: 'mod', l: st.del.n, r: st.add.n, left: st.del.t, right: st.add.t };
          if (modBudget > 0) {
            row.inline = inlineMark(row.left, row.right);
            modBudget--;
          }
          rows.push(row);
        }
      }
    }

    return rows;
  }

  /** 把过长的未变更块折叠成一行可点击的提示 */
  function buildDisplay(rows) {
    var out = [];
    var i = 0, runIdx = 0;

    while (i < rows.length) {
      if (rows[i].type !== 'equal') {
        out.push({ kind: 'row', row: rows[i] });
        i++;
        continue;
      }
      var j = i;
      while (j < rows.length && rows[j].type === 'equal') j++;

      var len = j - i;
      if (len > COLLAPSE_MIN) {
        var head = i + COLLAPSE_EDGE;
        var tail = j - COLLAPSE_EDGE;
        for (var x = i; x < head; x++) out.push({ kind: 'row', row: rows[x] });
        out.push({ kind: 'collapse', run: runIdx++, count: tail - head, rows: rows.slice(head, tail) });
        for (var y = tail; y < j; y++) out.push({ kind: 'row', row: rows[y] });
      } else {
        for (var z = i; z < j; z++) out.push({ kind: 'row', row: rows[z] });
      }
      i = j;
    }
    return out;
  }

  /* --- 统计 -------------------------------------------------------------- */
  function computeStats(rows, leftTotal, rightTotal) {
    var add = 0, del = 0, mod = 0, eq = 0, blocks = 0, inBlock = false;

    for (var i = 0; i < rows.length; i++) {
      var t = rows[i].type;
      if (t === 'equal') { eq++; inBlock = false; continue; }
      if (!inBlock) { blocks++; inBlock = true; }
      if (t === 'add') add++;
      else if (t === 'del') del++;
      else mod++;
    }

    var total = rows.length;
    return {
      add: add, del: del, mod: mod, eq: eq,
      blocks: blocks,
      changed: add + del + mod,
      similarity: total ? eq / total : 1,
      leftTotal: leftTotal,
      rightTotal: rightTotal
    };
  }

  /* ======================================================================
     三、渲染
     ====================================================================== */

  function noCell(n) {
    return '<span class="diff-no">' + (n == null ? '' : n) + '</span>';
  }

  function codeCell(html, kind) {
    return '<div class="diff-cell' + (kind ? ' diff-cell--' + kind : '') + '">' + html + '</div>';
  }

  function emptyCell() {
    return '<div class="diff-cell diff-cell--empty"></div>';
  }

  function renderSplitRow(row) {
    if (row.type === 'equal') {
      var t = esc(row.text);
      return '<div class="diff-row">' + noCell(row.l) + codeCell(t, '') +
             noCell(row.r) + codeCell(t, '') + '</div>';
    }
    if (row.type === 'del') {
      return '<div class="diff-row">' + noCell(row.l) + codeCell(esc(row.text), 'del') +
             noCell(null) + emptyCell() + '</div>';
    }
    if (row.type === 'add') {
      return '<div class="diff-row">' + noCell(null) + emptyCell() +
             noCell(row.r) + codeCell(esc(row.text), 'add') + '</div>';
    }
    var m = row.inline || { left: esc(row.left), right: esc(row.right) };
    return '<div class="diff-row">' + noCell(row.l) + codeCell(m.left, 'del') +
           noCell(row.r) + codeCell(m.right, 'add') + '</div>';
  }

  function uniRow(kind, l, r, sign, html) {
    return '<div class="diff-row diff-row--' + kind + '">' +
      noCell(l) + noCell(r) +
      '<span class="diff-sign">' + sign + '</span>' +
      codeCell(html, '') + '</div>';
  }

  function renderUnifiedRow(row) {
    if (row.type === 'equal') return uniRow('eq', row.l, row.r, ' ', esc(row.text));
    if (row.type === 'del') return uniRow('del', row.l, null, '-', esc(row.text));
    if (row.type === 'add') return uniRow('add', null, row.r, '+', esc(row.text));
    var m = row.inline || { left: esc(row.left), right: esc(row.right) };
    return uniRow('del', row.l, null, '-', m.left) + uniRow('add', null, row.r, '+', m.right);
  }

  function renderRow(row) {
    return state.view === 'split' ? renderSplitRow(row) : renderUnifiedRow(row);
  }

  function renderView() {
    if (!state.rows.length) {
      return '<div class="diff-hint"><strong>还没有内容</strong>' +
             '在左右两侧粘贴文本，差异会实时显示在这里。</div>';
    }
    if (!state.stats.changed) {
      return '<div class="diff-hint"><strong>两段文本完全一致</strong>' +
             state.stats.eq + ' 行内容逐行相同，没有发现差异。</div>';
    }

    var out = [];
    for (var i = 0; i < state.display.length; i++) {
      var d = state.display[i];
      if (d.kind === 'row') { out.push(renderRow(d.row)); continue; }
      if (state.expanded[d.run]) {
        for (var k = 0; k < d.rows.length; k++) out.push(renderRow(d.rows[k]));
      } else {
        out.push('<div class="diff-collapse"><button class="diff-expand" type="button" ' +
                 'data-expand="' + d.run + '">⋯ 展开 ' + d.count + ' 行未变更内容</button></div>');
      }
    }
    return out.join('');
  }

  function stat(label, value, tone) {
    return '<div class="stat">' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value' + (tone ? ' stat-value--' + tone : '') + '">' + value + '</div>' +
      '</div>';
  }

  function viewClass() {
    return 'diff-view diff-view--' + state.view + (state.wrap ? ' diff-view--wrap' : '');
  }

  function paint() {
    var s = state.stats;

    if (badgeEl) {
      if (!state.rows.length) {
        badgeEl.textContent = '—';
        badgeEl.className = 'badge';
      } else if (!s.changed) {
        badgeEl.textContent = '完全一致';
        badgeEl.className = 'badge badge--ready';
      } else {
        badgeEl.textContent = s.changed + ' 处变更';
        badgeEl.className = 'badge badge--accent';
      }
    }

    if (statsEl) {
      statsEl.innerHTML =
        stat('新增', s.add, 'ok') +
        stat('删除', s.del, 'danger') +
        stat('修改', s.mod, 'warn') +
        stat('未变', s.eq, '') +
        stat('相似度', Math.round(s.similarity * 100) + '%', '');
    }

    viewEl.className = viewClass();
    viewEl.innerHTML = renderView();
    renderFoot();
  }

  function renderFoot() {
    if (!footEl) return;
    var s = state.stats;
    var parts = [];

    if (s.leftTotal || s.rightTotal) {
      parts.push('原文 ' + s.leftTotal + ' 行');
      parts.push('修改后 ' + s.rightTotal + ' 行');
      if (s.changed) {
        parts.push(s.changed + ' 处变更');
        parts.push(s.blocks + ' 个变更块');
      }
    }
    if (state.tooLarge) parts.push('文本过长，已退化为整块替换，未做精细配对');
    parts.push('输入内容不会离开浏览器');

    footEl.innerHTML = parts.map(function (p) {
      return '<span>' + esc(p) + '</span>';
    }).join('');
  }

  /* --- 导出 unified diff ------------------------------------------------- */
  function toUnifiedText() {
    if (!state.rows.length) return '';
    var out = ['--- 原文', '+++ 修改后'];
    for (var i = 0; i < state.rows.length; i++) {
      var r = state.rows[i];
      if (r.type === 'equal') out.push(' ' + r.text);
      else if (r.type === 'del') out.push('-' + r.text);
      else if (r.type === 'add') out.push('+' + r.text);
      else { out.push('-' + r.left); out.push('+' + r.right); }
    }
    return out.join('\n');
  }

  /* ======================================================================
     四、主循环与事件
     ====================================================================== */

  function update() {
    var opts = {
      ignoreCase: !!(optCase && optCase.checked),
      ignoreWs: !!(optWs && optWs.checked),
      ignoreBlank: !!(optBlank && optBlank.checked)
    };

    state.tooLarge = false;
    state.expanded = Object.create(null);

    var L = prep(leftEl.value, opts);
    var R = prep(rightEl.value, opts);

    if (leftCountEl) leftCountEl.textContent = L.total + ' 行';
    if (rightCountEl) rightCountEl.textContent = R.total + ' 行';

    state.rows = buildRows(L, R, opts);
    state.stats = computeStats(state.rows, L.total, R.total);
    state.display = buildDisplay(state.rows);

    paint();
  }

  var render = T.util.debounce(update, 90);

  leftEl.addEventListener('input', render);
  rightEl.addEventListener('input', render);

  [optCase, optWs, optBlank].forEach(function (el) {
    if (el) el.addEventListener('change', update);
  });

  if (optWrap) {
    optWrap.addEventListener('change', function () {
      state.wrap = optWrap.checked;
      viewEl.className = viewClass();
    });
  }

  viewRadios.forEach(function (radio) {
    radio.addEventListener('change', function () {
      if (!radio.checked) return;
      state.view = radio.value;
      paint();
    });
  });

  /* 展开折叠块：只替换这一段，保留滚动位置 */
  viewEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-expand]');
    if (!btn) return;

    var run = Number(btn.getAttribute('data-expand'));
    var target = null;
    for (var i = 0; i < state.display.length; i++) {
      var d = state.display[i];
      if (d.kind === 'collapse' && d.run === run) { target = d; break; }
    }
    if (!target) return;

    var holder = document.createElement('div');
    holder.innerHTML = target.rows.map(renderRow).join('');

    var frag = document.createDocumentFragment();
    while (holder.firstChild) frag.appendChild(holder.firstChild);

    var block = btn.parentNode;
    block.parentNode.replaceChild(frag, block);
    state.expanded[run] = true;
  });

  if (swapBtn) {
    swapBtn.addEventListener('click', function () {
      var t = leftEl.value;
      leftEl.value = rightEl.value;
      rightEl.value = t;
      update();
    });
  }

  if (demoBtn) {
    demoBtn.addEventListener('click', function () {
      leftEl.value = DEMO_LEFT;
      rightEl.value = DEMO_RIGHT;
      update();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      leftEl.value = '';
      rightEl.value = '';
      update();
      leftEl.focus();
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var text = toUnifiedText();
      if (!text) return;
      T.util.copy(text, copyBtn);
    });
  }

  /* 首屏 */
  update();
})();
