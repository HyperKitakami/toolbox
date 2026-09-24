/* ==========================================================================
   whitespace-cleaner.js — 空白清理（自研）
   --------------------------------------------------------------------------
   设计取舍（自研工具，这一段是它唯一的「来源说明」）：

   1. 用一张「码位 → 类别」的表驱动全部逻辑，而不是串一串 replace。
      不可见字符分五类（特殊空格 / 零宽 / 方向控制符 / 换行 / 控制字符），处置方式
      各不相同，还要能按类开关。检测报告与清理共用同一张表、同一次扫描 ——
      两处各写一份的话，迟早会出现「报告说检出 3 个、清理却删了 5 个」这种自相矛盾。

   2. 清理顺序固定：换行统一 → 不可见字符 → 制表符 → 逐行空白 → 空行 → 首尾空行。
      顺序会改变结果（先合并连续空格、再删行尾，行尾剩下的那个单空格才会被删掉），
      所以不提供自定义顺序的入口。

   3. 「连续空格」保留行首缩进。缩进在代码与 Markdown 里是有意义的，把行首的连续
      空格一并合并会让粘进来的代码失去层级。要连缩进一起删，请单独开「行首空白」——
      两个开关的职责不重叠。

   4. 字符数按码点（Array.from）统计，不用 .length —— emoji 与生僻字是代理对，
      用 .length 会被算成两个，清理前后一对比就会「凭空多出/少掉」几个字符。

   5. 「显示不可见字符」只改渲染，不改数据。复制与下载始终拿清理后的真实文本，
      因此这两个按钮没有走 data-copy-target 的通用机制（那会复制到带记号的视图），
      而是在 JS 里复制 state.out。

   6. 不用 lookbehind、String.replaceAll、Array.at 这类较新的语法：它们在一些
      老引擎里是**解析期**错误，整个脚本文件加载失败、工具直接白屏，控制台连一行
      有用的报错都没有。凡是要「在某处之后切分」，一律改成扫描式或字符串操作。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  /* --- 0. 取元素 + 依赖检查 ---------------------------------------------- */
  var input    = document.getElementById('ws-input');
  var outputEl = document.getElementById('ws-output');
  var statsEl  = document.getElementById('ws-stats');
  var reportEl = document.getElementById('ws-report');
  var statusEl = document.getElementById('ws-status');
  var footEl   = document.getElementById('ws-foot');
  var revealBtn = document.getElementById('ws-reveal');
  var copyBtn  = document.getElementById('ws-copy');
  var dlBtn    = document.getElementById('ws-download');
  var resetBtn = document.getElementById('ws-reset');
  var tabWEl   = document.getElementById('ws-tab-width');
  var clearBtn = document.querySelector('[data-clear]');
  var demoBtn  = document.querySelector('[data-demo]');
  if (!input || !outputEl) return;

  /* 依赖缺失要吵，不要静默 return —— 静默退出的表现是「结果区一片空白、
     控制台一行错都没有」，用户完全无从下手（踩过一次，两个工具同时无输出）。 */
  function bail(detail) {
    var box = document.getElementById('ws-output');
    if (!box) return;
    box.innerHTML = '<div class="code-empty"><strong>工具没能初始化</strong>' + detail + '</div>';
  }

  var util = T.util;
  if (!util || typeof util.renderCode !== 'function' || typeof util.emptyHint !== 'function') {
    bail('页面加载到的 js/site.js 是旧版本，缺少这个工具需要的公共方法。请强制刷新（Ctrl+F5）后重试。');
    return;
  }

  /* --- 1. 不可见字符表 ---------------------------------------------------- */
  /* [码位, 中文名, 通用缩写, 类别, 是否换行语义]
     类别：space（视觉上是空格）/ zero（零宽）/ bidi（方向控制）/ ctrl（控制字符）
     名称按 Unicode 官方名称意译，缩写沿用通行写法，方便用户拿去搜索。 */
  var INVISIBLE = [
    /* —— 特殊空格：长得像空格，但不是 U+0020 —— */
    [0x00A0, '不换行空格', 'NBSP', 'space', false],
    [0x1680, '欧甘文空格标记', 'OGHAM', 'space', false],
    [0x2000, '对开空格', 'EN QUAD', 'space', false],
    [0x2001, '全身空格', 'EM QUAD', 'space', false],
    [0x2002, '半角空格', 'EN SPACE', 'space', false],
    [0x2003, '全角空格（EM）', 'EM SPACE', 'space', false],
    [0x2004, '三分之一全身空格', '3/EM', 'space', false],
    [0x2005, '四分之一全身空格', '4/EM', 'space', false],
    [0x2006, '六分之一全身空格', '6/EM', 'space', false],
    [0x2007, '数字空格', 'FIGURE', 'space', false],
    [0x2008, '标点空格', 'PUNCT', 'space', false],
    [0x2009, '窄空格', 'THIN', 'space', false],
    [0x200A, '发丝空格', 'HAIR', 'space', false],
    [0x202F, '窄不换行空格', 'NNBSP', 'space', false],
    [0x205F, '数学中空格', 'MMSP', 'space', false],
    [0x3000, '全角表意空格', 'IDEOGRAPHIC', 'space', false],
    /* —— 零宽字符：占位置但不显示 —— */
    [0x200B, '零宽空格', 'ZWSP', 'zero', false],
    [0x200C, '零宽不连字', 'ZWNJ', 'zero', false],
    [0x200D, '零宽连字', 'ZWJ', 'zero', false],
    [0x2060, '单词连接符', 'WORD JOINER', 'zero', false],
    [0xFEFF, '零宽不换行空格（BOM）', 'ZWNBSP', 'zero', false],
    [0x00AD, '软连字符', 'SOFT HYPHEN', 'zero', false],
    [0x180E, '蒙古文元音分隔符', 'MVS', 'zero', false],
    /* —— 方向控制符：Trojan Source 那类「藏字符」手法的主角 —— */
    [0x200E, '从左到右标记', 'LRM', 'bidi', false],
    [0x200F, '从右到左标记', 'RLM', 'bidi', false],
    [0x061C, '阿拉伯字母标记', 'ALM', 'bidi', false],
    [0x202A, '从左到右嵌入', 'LRE', 'bidi', false],
    [0x202B, '从右到左嵌入', 'RLE', 'bidi', false],
    [0x202C, '方向格式化结束', 'PDF', 'bidi', false],
    [0x202D, '从左到右覆盖', 'LRO', 'bidi', false],
    [0x202E, '从右到左覆盖', 'RLO', 'bidi', false],
    [0x2066, '从左到右隔离', 'LRI', 'bidi', false],
    [0x2067, '从右到左隔离', 'RLI', 'bidi', false],
    [0x2068, '首强字符隔离', 'FSI', 'bidi', false],
    [0x2069, '隔离结束', 'PDI', 'bidi', false],
    /* —— 换行语义的字符：只受「统一为 LF」控制，关了就连它们一起原样保留 ——
       不归进「控制字符」，否则用户会发现「关掉换行统一，行分隔符还是没了」。 */
    [0x000B, '垂直制表符', 'VT', 'line', true],
    [0x000C, '换页符', 'FF', 'line', true],
    [0x0085, '下一行符', 'NEL', 'line', true],
    [0x2028, '行分隔符', 'LS', 'line', true],
    [0x2029, '段分隔符', 'PS', 'line', true]
  ];

  var MAP = Object.create(null);
  INVISIBLE.forEach(function (d) {
    MAP[d[0]] = { cp: d[0], name: d[1], alias: d[2], kind: d[3], line: d[4] };
  });

  /* 扫描用的字符类：上表的全部码位 + 表外的 C0 / C1 控制符与 DEL。
     刻意**不含** \t(09) \n(0A) \r(0D) —— 它们是正常内容，另有专门的选项处理。 */
  var RE_INVISIBLE = new RegExp(
    '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F' +
    '\\u00A0\\u00AD\\u061C\\u1680\\u180E\\u2000-\\u200F\\u2028\\u2029' +
    '\\u202A-\\u202F\\u205F\\u2060\\u2066-\\u2069\\u3000\\uFEFF]', 'g');

  /* 换行语义的字符：打开「统一为 LF」时先统一成 \n，
     其余换行符（CRLF / CR / NEL / VT / FF / LS / PS）在这里一次收口。 */
  var RE_BREAKS = /\r\n|\r|\u000B|\u000C|\u0085|\u2028|\u2029/g;

  /** 该码位属于哪一类；表外的控制字符返回 'ctrl'，其余返回 null */
  function kindOf(cp) {
    var def = MAP[cp];
    if (def) return def.kind;
    if (cp <= 0x1F || (cp >= 0x7F && cp <= 0x9F)) return 'ctrl';
    return null;
  }

  function hex(cp) {
    var h = cp.toString(16).toUpperCase();
    return 'U+' + ('0000' + h).slice(-4);
  }

  /* --- 2. 选项 ------------------------------------------------------------ */
  var DEFAULTS = {
    trimEnd: true,       /* 删除每行末尾的空格与制表符 */
    trimStart: false,    /* 删除每行开头的空白（缩进） */
    collapse: true,      /* 合并连续空格 */
    tabs: false,         /* 制表符转空格 */
    tabWidth: 4,
    specialSpace: true,  /* 特殊空格 → 普通空格 */
    zero: true,          /* 删除零宽字符 */
    bidi: true,          /* 删除方向控制符 */
    control: true,       /* 删除控制字符 */
    newlines: true,      /* 各种换行符统一为 LF */
    trimEdges: true,     /* 删除文档首尾的空行 */
    blank: 'collapse'    /* keep | collapse | remove */
  };

  var state = {};
  Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });
  state.reveal = false;

  var DEMO = [
    '这是一段从网页上复制来的文本：行内有多余空格，  行尾也有空格。   ',
    '    这一行前面有四个空格，看起来像缩进。',
    '',
    '',
    '上面隔了两个空行。',
    '\t这一行用制表符开头，中间还有\t制表符分隔的两列。',
    '',
    '这里混进了看不见的字符：零宽空格\u200B、软连字符\u00AD与方向标记\u200E。',
    '全角空格\u3000与不换行空格\u00A0看起来都和普通空格一样。',
    '   ',
    '最后一行前面有三个空格，行尾也是空格。 '
  ].join('\n');

  /* --- 3. 核心：扫描与清理 ------------------------------------------------ */

  /** 统计原文里各类不可见字符的个数（清理与报告共用这张表） */
  function scan(text) {
    var counts = Object.create(null);
    var total = 0;
    text.replace(RE_INVISIBLE, function (ch) {
      var cp = ch.charCodeAt(0);
      counts[cp] = (counts[cp] || 0) + 1;
      total++;
      return ch;
    });
    return { counts: counts, total: total };
  }

  /** 可见空白的概览：行尾带空白的行、连续空格处数、空行数 */
  function whitespaceStats(text) {
    var lines = text.split(/\r\n|\r|\n/);
    var trailing = 0;
    var blank = 0;
    var runs = 0;
    lines.forEach(function (l) {
      if (/[ \t]+$/.test(l)) trailing++;
      if (/^[ \t]*$/.test(l)) blank++;
      var m = l.match(/[ \t]{2,}/g);
      if (m) runs += m.length;
    });
    return { trailing: trailing, blank: blank, runs: runs, lines: lines.length };
  }

  function spaces(n) {
    return new Array(n + 1).join(' ');
  }

  /** 单行处理：行首 → 行内合并 → 行尾 */
  function cleanLine(line, o) {
    var out = line;
    if (o.trimStart) out = out.replace(/^[ \t]+/, '');
    if (o.collapse) {
      if (o.trimStart) {
        out = out.replace(/[ \t]{2,}/g, ' ');
      } else {
        /* 保留行首缩进，只合并行内空白 —— 否则粘进来的代码会失去层级 */
        var lead = /^[ \t]*/.exec(out)[0];
        out = lead + out.slice(lead.length).replace(/[ \t]{2,}/g, ' ');
      }
    }
    if (o.trimEnd) out = out.replace(/[ \t]+$/, '');
    return out;
  }

  function clean(text, o) {
    var t = text;

    /* 1) 换行统一 */
    if (o.newlines) t = t.replace(RE_BREAKS, '\n');

    /* 2) 不可见字符 */
    t = t.replace(RE_INVISIBLE, function (ch) {
      var kind = kindOf(ch.charCodeAt(0));
      if (kind === 'space') return o.specialSpace ? ' ' : ch;
      if (kind === 'zero') return o.zero ? '' : ch;
      if (kind === 'bidi') return o.bidi ? '' : ch;
      if (kind === 'line') return o.newlines ? '\n' : ch;
      return o.control ? '' : ch;
    });

    /* 3) 制表符 */
    if (o.tabs) t = t.replace(/\t/g, spaces(o.tabWidth));

    /* 4) 逐行空白 */
    t = t.split('\n').map(function (l) { return cleanLine(l, o); }).join('\n');

    /* 5) 空行 */
    if (o.blank === 'collapse') t = t.replace(/\n{3,}/g, '\n\n');
    else if (o.blank === 'remove') t = t.replace(/\n{2,}/g, '\n');

    /* 6) 文档首尾的空行 */
    if (o.trimEdges) t = t.replace(/^\n+/, '').replace(/\n+$/, '');

    return t;
  }

  /* --- 4. 渲染 ------------------------------------------------------------ */

  /** 把一行渲染成「看得见」的版本：空格 ·、制表符 →、行尾 ¶、残留不可见字符标码位 */
  function revealHtml(line) {
    /* 先整体转义再逐字符扫描：转义只影响 & < > " '，不可见字符都是 BMP 内的
       单个 UTF-16 单元，转义后位置与长度都不变，可以安全地按下标走一遍。 */
    var s = util.esc(line);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var cp = s.charCodeAt(i);
      if (ch === ' ') out += '<span class="ws-mark">\u00B7</span>';
      else if (ch === '\t') out += '<span class="ws-mark">\u2192</span>';
      else if (kindOf(cp)) out += '<span class="ws-residue">\u27E6' + hex(cp) + '\u27E7</span>';
      else out += ch;
    }
    return out + '<span class="ws-mark">\u00B6</span>';
  }

  function num(n) { return n.toLocaleString('zh-CN'); }

  function stat(label, value, cls) {
    return '<div class="stat">' +
      '<div class="stat-label">' + util.esc(label) + '</div>' +
      '<div class="stat-value' + (cls ? ' ' + cls : '') + '">' + util.esc(value) + '</div>' +
      '</div>';
  }

  function renderStats(before, after, sc) {
    var delta = before.chars - after.chars;
    var deltaText = delta > 0 ? '\u2212' + num(delta) : (delta < 0 ? '+' + num(-delta) : '0');
    var deltaCls = delta > 0 ? 'stat-value--ok' : (delta < 0 ? 'stat-value--warn' : '');
    statsEl.innerHTML =
      stat('原始字符', num(before.chars)) +
      stat('清理后', num(after.chars)) +
      stat('字符变化', deltaText, deltaCls) +
      stat('不可见字符', num(sc.total), sc.total ? 'stat-value--warn' : '');
  }

  /** 报告里的处理结论：跟着当前选项走，用户一关就能看到「已保留」 */
  function actionOf(row, o) {
    if (row.kind === 'space') return o.specialSpace
      ? { text: '已转为普通空格', done: true } : { text: '已保留', done: false };
    if (row.kind === 'zero') return o.zero
      ? { text: '已删除', done: true } : { text: '已保留', done: false };
    if (row.kind === 'bidi') return o.bidi
      ? { text: '已删除', done: true } : { text: '已保留', done: false };
    if (row.kind === 'line') return o.newlines
      ? { text: '已统一为换行', done: true } : { text: '已保留', done: false };
    return o.control ? { text: '已删除', done: true } : { text: '已保留', done: false };
  }

  function buildRows(sc) {
    var rows = [];
    INVISIBLE.forEach(function (d) {
      var n = sc.counts[d[0]];
      if (n) rows.push({ cp: d[0], cpText: hex(d[0]), name: d[1], alias: d[2], kind: d[3], line: d[4], n: n });
    });

    /* 表外的控制字符（C0 / C1 / DEL）合并成一行，免得报告被几十个冷门码位撑爆 */
    var rest = Object.keys(sc.counts).map(Number).filter(function (cp) { return !MAP[cp]; });
    if (rest.length) {
      rest.sort(function (a, b) { return sc.counts[b] - sc.counts[a] || a - b; });
      var total = rest.reduce(function (s, cp) { return s + sc.counts[cp]; }, 0);
      rows.push({
        cp: rest[0],
        cpText: rest.length === 1 ? hex(rest[0]) : '多种',
        name: '其他控制字符',
        alias: rest.slice(0, 6).map(hex).join(' ') + (rest.length > 6 ? ' …' : ''),
        kind: 'ctrl', line: false, n: total
      });
    }

    rows.sort(function (a, b) { return b.n - a.n || a.cp - b.cp; });
    return rows;
  }

  function renderReport(sc, o) {
    var rows = buildRows(sc);
    if (!rows.length) {
      util.emptyHint(reportEl, '没有检出不可见字符',
        '特殊空格、零宽字符、方向控制符与控制字符都没有出现。', 'table-empty');
      return;
    }
    var html = '<table class="data-table"><thead><tr>' +
      '<th>码位</th><th>名称</th><th>出现次数</th><th>处理</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var act = actionOf(r, o);
      html += '<tr>' +
        '<td class="ws-cp">' + util.esc(r.cpText) + '</td>' +
        '<td>' + util.esc(r.name) +
          (r.alias ? ' <span class="ws-alias">' + util.esc(r.alias) + '</span>' : '') + '</td>' +
        '<td class="ws-count">' + r.n + '</td>' +
        '<td class="ws-act ' + (act.done ? 'ws-act--done' : 'ws-act--kept') + '">' +
          util.esc(act.text) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    reportEl.innerHTML = html;
  }

  /* --- 5. 主循环 ---------------------------------------------------------- */
  var state$ = state;

  function update() {
    var text = input.value;
    var sc = scan(text);
    var out = clean(text, state$);
    state$.out = out;

    /* 结果区 */
    if (!text) {
      util.emptyHint(outputEl, '还没有内容', '把文本粘贴到左侧，这里会实时显示清理结果。');
    } else if (out === '') {
      util.emptyHint(outputEl, '清理后没有剩余内容', '输入的全是空白或不可见字符，已经被清干净了。');
    } else {
      util.renderCode(outputEl, out, state$.reveal ? revealHtml : null, { maxLines: 20000 });
    }

    /* 统计与报告 */
    renderStats(
      { chars: Array.from(text).length },
      { chars: Array.from(out).length },
      sc
    );
    renderReport(sc, state$);

    var ws = whitespaceStats(text);
    if (statusEl) {
      statusEl.textContent = text
        ? num(Array.from(text).length) + ' 字符 · ' + num(ws.lines) + ' 行'
        : '';
    }
    if (footEl) {
      footEl.textContent = text
        ? (sc.total ? '检出 ' + num(sc.total) + ' 个不可见字符' : '没有检出不可见字符') +
          ' · 行尾空白 ' + num(ws.trailing) + ' 行' +
          ' · 连续空格 ' + num(ws.runs) + ' 处' +
          ' · 空行 ' + num(ws.blank) + ' 行'
        : '把文本粘贴到左侧，这里会列出检测结果。';
    }
  }

  /* 首屏同步渲染一次，不要走防抖 —— 否则首屏有 70ms 空白，测试也会读到空 DOM */
  var render = util.debounce(update, 70);

  /* --- 6. 事件 ------------------------------------------------------------ */

  input.addEventListener('input', render);

  /* 选项胶囊：多选开关 */
  var optChips = util.$$('[data-opt]');
  optChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var key = chip.getAttribute('data-opt');
      state$[key] = !state$[key];
      chip.setAttribute('aria-pressed', String(state$[key]));
      update();
    });
  });

  /* 空行：三选一 */
  var blankChips = util.$$('[data-blank]');
  blankChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      state$.blank = chip.getAttribute('data-blank');
      blankChips.forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === chip));
      });
      update();
    });
  });

  if (tabWEl) {
    tabWEl.addEventListener('change', function () {
      state$.tabWidth = Number(tabWEl.value) || 4;
      update();
    });
  }

  if (revealBtn) {
    revealBtn.addEventListener('click', function () {
      state$.reveal = !state$.reveal;
      revealBtn.setAttribute('aria-pressed', String(state$.reveal));
      update();
    });
  }

  function syncUI() {
    optChips.forEach(function (chip) {
      var key = chip.getAttribute('data-opt');
      chip.setAttribute('aria-pressed', String(!!state$[key]));
    });
    blankChips.forEach(function (chip) {
      chip.setAttribute('aria-pressed', String(chip.getAttribute('data-blank') === state$.blank));
    });
    if (tabWEl) tabWEl.value = String(state$.tabWidth);
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      Object.keys(DEFAULTS).forEach(function (k) { state$[k] = DEFAULTS[k]; });
      syncUI();
      update();
      util.toast('已恢复默认选项');
    });
  }

  /* 复制与下载拿的是清理结果本身，不是屏幕上那份（开了「显示不可见字符」时两者不同） */
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      if (!state$.out) { util.toast('没有可复制的内容'); return; }
      util.copy(state$.out, copyBtn);
    });
  }

  if (dlBtn) {
    dlBtn.addEventListener('click', function () {
      if (!state$.out) { util.toast('没有可下载的内容'); return; }
      if (!util.download('cleaned.txt', state$.out)) util.toast('当前环境不支持下载');
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      input.value = '';
      update();
      input.focus();
    });
  }

  if (demoBtn) {
    demoBtn.addEventListener('click', function () {
      input.value = DEMO;
      update();
      input.focus();
    });
  }

  /* --- 7. 首屏 ------------------------------------------------------------ */
  update();
})();
