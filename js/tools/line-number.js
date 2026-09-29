/* ==========================================================================
   line-number.js — 批量加行号（自研）
   --------------------------------------------------------------------------
   设计取舍（自研工具，这一段是它唯一的「来源说明」）：

   1. 拼行只用一个模型：`前缀 + [序号 + 分隔符] + 原文 + 后缀`，行尾模式下把
      「序号 + 分隔符」整段挪到原文后面。不另开一条分支去处理「行尾编号」——
      两条分支各写一遍拼接，迟早在前后缀的落点上分叉。关掉序号时它退化成
      `前缀 + 原文 + 后缀`，不需要第三套逻辑。

   2. 序号格式是一张「整数 → 字符串」的转换表，超出格式范围时返回 null，
      由调用方回落到十进制**并计数上报**。罗马数字标准只定义到 3999、
      中文数字的万/亿/万亿分节到 16 位为止 —— 这些边界是真的存在，
      静默输出一个看着正常的错值比不输出更糟，所以底栏会写出有几行回落了。

   3. 补零只对十进制与十六进制开。字母 / 罗马 / 中文的「宽度」不是数值宽度，
      给它们补零会得到 `00i` 这种既不是罗马数字也不是数字的东西；
      开关在这种情况下连同位数下拉一起隐藏，而不是留着按了没反应。

   4. 「结尾换行产生的空元素」单独处理：`a↵b↵` 的 split 结果是三个元素，
      最后那个空串不是一行内容。如果按空行规则走，「也编号」会凭空多出一个
      `3. `、「删除空行」会把结尾的换行吃掉 —— 两种都不是用户要的。所以它
      永远原样保留。

   5. 预览的着色只包一层 `<span>`，不增删任何字符。于是 `textContent`
      就等于输出文本，「复制」可以直接走站点的通用机制（data-copy-target），
      不必像空白清理那样另写一份 state.out 的复制逻辑。行数超过 2 万时
      降级成纯文本（不套标记），避免一次性塞进几十万个节点把页面卡死。

   6. 「这行已经有序号了」只是一个提示，**绝不改结果**。它是启发式判定，
      判错了也不能动用户的文本，所以阈值定得保守（至少 3 行、过半命中），
      而且正则要求分隔符后面真的有空白，免得把 `2026-09-29` 这类日期算进去。

   7. 不用 lookbehind / replaceAll / Array.at 这类较新语法：它们在一些老引擎里是
      **解析期**错误，整个脚本文件加载失败、工具直接白屏，控制台连一行有用的报错都没有。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  /* --- 0. 取元素 + 依赖检查 ---------------------------------------------- */
  var input      = document.getElementById('ln-input');
  var outputEl   = document.getElementById('ln-output');
  var statsEl    = document.getElementById('ln-stats');
  var statusEl   = document.getElementById('ln-status');
  var outFootEl  = document.getElementById('ln-out-foot');
  var footEl     = document.getElementById('ln-foot');
  var warnEl     = document.getElementById('ln-warn');
  var sepEl      = document.getElementById('ln-sep');
  var startEl    = document.getElementById('ln-start');
  var stepEl     = document.getElementById('ln-step');
  var prefixEl   = document.getElementById('ln-prefix');
  var suffixEl   = document.getElementById('ln-suffix');
  var padWidthEl = document.getElementById('ln-pad-width');
  var padNoteEl  = document.getElementById('ln-pad-note');
  var resetBtn   = document.getElementById('ln-reset');
  var dlBtn      = document.getElementById('ln-download');
  var clearBtn   = document.querySelector('[data-clear]');
  var demoBtn    = document.querySelector('[data-demo]');
  if (!input || !outputEl) return;

  /* 依赖缺失要吵，不要静默 return —— 静默退出的表现是「结果区一片空白、
     控制台一行错都没有」，用户完全无从下手。 */
  function bail(detail) {
    var box = document.getElementById('ln-output');
    if (!box) return;
    box.textContent = '';
    var wrap = document.createElement('div');
    wrap.className = 'code-empty';
    wrap.innerHTML = '<strong>工具没能初始化</strong>' + detail;
    box.parentNode.appendChild(wrap);
  }

  var util = T.util;
  if (!util || typeof util.readInt !== 'function' || typeof util.download !== 'function') {
    bail('页面加载到的 js/site.js 是旧版本，缺少这个工具需要的公共方法。请强制刷新（Ctrl+F5）后重试。');
    return;
  }

  /* --- 1. 序号格式 -------------------------------------------------------- */
  /* 每个转换函数返回字符串，或 null 表示「这个数超出该格式的范围」。
     调用方回落到十进制并把行数报出来，不静默给一个看着正常的错值。 */

  /* 中文数字：分节处理，每四位一节，节内用 十 / 百 / 千，节间用 万 / 亿 / 万亿。 */
  var CN_DIGIT = '零一二三四五六七八九';
  var CN_UNIT = ['', '十', '百', '千'];
  var CN_SEC = ['', '万', '亿', '万亿'];
  var CN_MAX = 1e16;   /* 再往上 CN_SEC 不够用，回落成十进制 */

  /** 1–9999 的中文写法；1001 → 一千零一，1100 → 一千一百 */
  function cnSection(n) {
    var s = '';
    var zero = false;          /* 低位出现过 0，等下一个非零位补「零」 */
    for (var u = 0; n > 0; u++) {
      var d = n % 10;
      n = Math.floor(n / 10);
      if (d === 0) {
        if (s !== '') zero = true;
      } else {
        if (zero) { s = '零' + s; zero = false; }
        s = CN_DIGIT.charAt(d) + CN_UNIT[u] + s;
      }
    }
    return s;
  }

  function cnNumber(n) {
    if (n === 0) return '零';
    if (n < 0) return '负' + cnNumber(-n);
    if (!isFinite(n) || n >= CN_MAX) return null;
    n = Math.floor(n);

    /* 先切节（低位在前），再从高位往低位拼 —— 从低位拼的话，
       「本节不足四位要补零」这条判据会落到错误的节上
       （一万二千 会被算成 一万零二千）。 */
    var secs = [];
    var m = n;
    while (m > 0) { secs.push(m % 10000); m = Math.floor(m / 10000); }

    var out = '';
    for (var i = secs.length - 1; i >= 0; i--) {
      var sec = secs[i];
      if (sec === 0) {
        /* 整节为零：只有后面还有非零节时才留一个「零」的位置 */
        var below = false;
        for (var k = i - 1; k >= 0; k--) { if (secs[k] !== 0) { below = true; break; } }
        if (below && out.charAt(out.length - 1) !== '零') out += '零';
        continue;
      }
      /* 本节没有千位、又不是最高节 → 与上面隔开了一个零 */
      if (i < secs.length - 1 && sec < 1000 && out.charAt(out.length - 1) !== '零') out += '零';
      out += cnSection(sec) + CN_SEC[i];
    }
    /* 「十」不带「一」，但只在该数最高位的那一节（10 → 十，110 → 一百一十） */
    if (out.charAt(0) === '一' && out.charAt(1) === '十') out = out.slice(1);
    return out;
  }

  var ROMAN = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ];

  function romanNumber(n, upper) {
    if (n < 1 || n > 3999 || n !== Math.floor(n)) return null;
    var s = '';
    for (var i = 0; i < ROMAN.length; i++) {
      while (n >= ROMAN[i][0]) { s += ROMAN[i][1]; n -= ROMAN[i][0]; }
    }
    return upper ? s : s.toLowerCase();
  }

  /** 电子表格列名式的字母序号：1 → a、26 → z、27 → aa（不是 ba） */
  function alphaLabel(n, upper) {
    if (n < 1 || n !== Math.floor(n)) return null;
    var s = '';
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode((upper ? 65 : 97) + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function hexLabel(n) {
    return n < 0 ? '-' + (-n).toString(16) : n.toString(16);
  }

  function labelFor(n, format) {
    if (format === 'hex') return hexLabel(n);
    if (format === 'alpha') return alphaLabel(n, false);
    if (format === 'ALPHA') return alphaLabel(n, true);
    if (format === 'roman') return romanNumber(n, false);
    if (format === 'ROMAN') return romanNumber(n, true);
    if (format === 'cn') return cnNumber(n);
    return String(n);
  }

  /** 补零按总位数算：-7 补到 3 位是 -07（负号占一位），位数超了不截断 */
  function padLabel(s, width) {
    var sign = '';
    if (s.charAt(0) === '-') { sign = '-'; s = s.slice(1); }
    var need = width - sign.length - s.length;
    while (need > 0) { s = '0' + s; need--; }
    return sign + s;
  }

  /* 前缀 / 后缀 / 分隔符里的转义。只认 \t 与 \\：\n 会让「一行进、一行出」
     这个前提失效，所以按字面输出，并在选项面板底栏写明。 */
  var RE_ESC = /\\(t|\\)/g;
  function unescape(raw) {
    return String(raw).replace(RE_ESC, function (m, c) { return c === 't' ? '\t' : '\\'; });
  }

  /* --- 2. 选项 ------------------------------------------------------------ */
  var DEFAULTS = {
    enabled: true,
    format: 'number',
    position: 'start',
    start: 1,
    step: 1,
    padZero: false,
    padWidth: 3,
    blank: 'keep'          /* keep | number | drop */
  };

  /* 分隔符与前后缀是自由文本，真值只存在输入框里：每次渲染现读一遍塞进
     state 交给 process()，DEFAULTS 不管它们（重置时用这一份写回输入框）。
     这样就不存在「state 与输入框谁说了算」的问题。 */
  var TEXT_DEFAULTS = { sep: '. ', prefix: '', suffix: '' };

  var START_MIN = -999999999999, START_MAX = 999999999999;
  var STEP_MIN = -1000000, STEP_MAX = 1000000;

  var MARK_LIMIT = 20000;   /* 超过这个行数就不再套预览标记 */

  var state = {};
  Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });

  var DEMO = [
    '准备周会的材料',
    '给供应商回邮件',
    '',
    '复核上周的报销单',
    '整理 Q4 的数据口径',
    '更新部署文档'
  ].join('\n');

  /* --- 3. 核心：切行与拼行 ------------------------------------------------ */

  /**
   * 把文本切成行，并标出「结尾换行留下的那个空元素」。
   * `a↵b↵` → lines ['a','b','']，最后那个空串不是一行内容（见文件头第 4 条）。
   */
  function splitLines(text) {
    var lines = text.split(/\r\n|\r|\n/);
    var endsWithBreak = /(?:\r\n|\r|\n)$/.test(text);
    var phantom = endsWithBreak && lines.length > 1 && lines[lines.length - 1] === '';
    return { lines: lines, phantom: phantom };
  }

  function isBlank(line) {
    return line === '' || /^\s+$/.test(line);
  }

  /* 「这行看起来已经有序号了」的粗判，只用来提示。
     分隔符后面必须真的有空白（或本身就是「、」），否则 `2026-09-29` 这种
     日期、`3.14` 这种小数都会被算成「已有行号」。 */
  var RE_EXISTING = /^\s*(?:[0-9]{1,4}|[IVXLCDMivxlcdm]{1,7}|[A-Za-z]|[一二三四五六七八九十百千]{1,6})\s*(?:[.):|>](?=\s)|、|-(?!\d)(?=\s))/;

  function countExisting(lines, phantom) {
    var hit = 0, total = 0;
    var last = phantom ? lines.length - 1 : lines.length;
    for (var i = 0; i < last; i++) {
      if (isBlank(lines[i])) continue;
      total++;
      if (RE_EXISTING.test(lines[i])) hit++;
    }
    return { hit: hit, total: total };
  }

  /**
   * 纯函数：文本 + 选项 → 输出。
   * @returns {{text:string, marks:Array, inLines:number, outLines:number,
   *            numbered:number, blankKept:number, dropped:number,
   *            fallback:number, existing:Object}}
   *   marks[i] 是输出第 i 行里「新增部分」的 [start,end) 区间；没有新增时为 null。
   */
  function process(text, o) {
    var empty = {
      text: '', marks: [], inLines: 0, outLines: 0, numbered: 0,
      blankKept: 0, dropped: 0, fallback: 0, existing: { hit: 0, total: 0 }
    };
    if (text === '') return empty;

    var sp = splitLines(text);
    var lines = sp.lines;
    var sep = unescape(o.sep);
    var prefix = unescape(o.prefix);
    var suffix = unescape(o.suffix);
    var numeric = o.format === 'number' || o.format === 'hex';
    var usePad = o.padZero && numeric;

    var out = [];
    var marks = [];
    var numbered = 0, blankKept = 0, dropped = 0, fallback = 0;
    var n = o.start;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      /* 结尾换行留下的空元素：原样保留，不编号、不删除、不加前后缀 */
      if (sp.phantom && i === lines.length - 1) {
        out.push(line);
        marks.push(null);
        continue;
      }

      if (isBlank(line)) {
        if (o.blank === 'drop') { dropped++; continue; }
        if (o.blank === 'keep') {
          blankKept++;
          out.push(line);
          marks.push(null);
          continue;
        }
        /* blank === 'number'：继续往下走，空行也照常编号 */
      }

      var label = null;
      if (o.enabled) {
        label = labelFor(n, o.format);
        if (label === null) { label = String(n); fallback++; }
        if (usePad) label = padLabel(label, o.padWidth);
        n += o.step;
        numbered++;
      }

      var pieces = [];
      var numBefore = o.enabled && o.position === 'start';
      if (prefix) pieces.push([prefix, true]);
      if (o.enabled && numBefore) {
        pieces.push([label, true]);
        if (sep) pieces.push([sep, true]);
      }
      pieces.push([line, false]);
      if (o.enabled && !numBefore) {
        if (sep) pieces.push([sep, true]);
        pieces.push([label, true]);
      }
      if (suffix) pieces.push([suffix, true]);

      var str = '', at = 0, ms = [];
      for (var k = 0; k < pieces.length; k++) {
        var txt = pieces[k][0];
        if (pieces[k][1]) ms.push([at, at + txt.length]);
        str += txt;
        at += txt.length;
      }
      out.push(str);
      marks.push(ms.length ? ms : null);
    }

    return {
      text: out.join('\n'),
      marks: marks,
      inLines: lines.length - (sp.phantom ? 1 : 0),
      outLines: out.length - (sp.phantom ? 1 : 0),
      numbered: numbered,
      blankKept: blankKept,
      dropped: dropped,
      fallback: fallback,
      existing: countExisting(lines, sp.phantom)
    };
  }

  /* --- 4. 渲染 ------------------------------------------------------------ */

  /** 把一行按 marks 里的区间切段，新增部分套一层标记（只包 span，不增删字符） */
  function markHtml(line, ranges) {
    var out = '';
    var at = 0;
    for (var i = 0; i < ranges.length; i++) {
      var s = ranges[i][0], e = ranges[i][1];
      if (s > at) out += util.esc(line.slice(at, s));
      out += '<span class="ln-mark">' + util.esc(line.slice(s, e)) + '</span>';
      at = e;
    }
    return out + util.esc(line.slice(at));
  }

  function renderHtml(res) {
    var lines = res.text.split('\n');
    var buf = [];
    for (var i = 0; i < lines.length; i++) {
      buf.push(res.marks[i] ? markHtml(lines[i], res.marks[i]) : util.esc(lines[i]));
    }
    return buf.join('\n');
  }

  function num(v) { return v.toLocaleString('zh-CN'); }

  function stat(label, value, cls) {
    return '<div class="stat">' +
      '<div class="stat-label">' + util.esc(label) + '</div>' +
      '<div class="stat-value' + (cls ? ' ' + cls : '') + '">' + util.esc(value) + '</div>' +
      '</div>';
  }

  var FORMAT_NAME = {
    number: '数字', hex: '十六进制', alpha: '小写字母', ALPHA: '大写字母',
    roman: '罗马数字（小写）', ROMAN: '罗马数字（大写）', cn: '中文数字'
  };

  /* --- 5. 受限整数输入 ---------------------------------------------------- */

  /**
   * 读整数输入框：空或非法时标红并返回 null，由调用方决定回落到哪个值
   * （起始值 / 步长都是负数也合法，不能用 util.readInt 的「空 → 下限」那条口径）。
   */
  function readIntOrNull(el, min, max) {
    if (!el) return null;
    var raw = String(el.value).trim();
    if (raw === '') {
      el.classList.remove('input--invalid');
      return null;
    }
    var v = Number(raw);
    var ok = isFinite(v) && v === Math.floor(v) && v >= min && v <= max;
    el.classList.toggle('input--invalid', !ok);
    return ok ? v : null;
  }

  /* --- 6. 主循环 ---------------------------------------------------------- */

  var padChip = document.querySelector('[data-toggle="padZero"]');
  var groups = Object.create(null);   /* data-opt 的单选胶囊组 */
  var toggles = util.$$('[data-toggle]');
  var blankChips = util.$$('[data-blank]');
  var sepChips = util.$$('[data-sep]');

  function syncSepChips() {
    sepChips.forEach(function (c) {
      c.setAttribute('aria-pressed', String(c.getAttribute('data-sep') === sepEl.value));
    });
  }

  function update() {
    var text = input.value;

    /* 输入过程中的非法值不写回（用户还在打字），只沿用上一次的有效值；
       失焦时再规范化，见下面的 blur 处理。 */
    var sv = readIntOrNull(startEl, START_MIN, START_MAX);
    if (sv !== null) state.start = sv;
    var tv = readIntOrNull(stepEl, STEP_MIN, STEP_MAX);
    if (tv !== null) state.step = tv;

    state.sep = sepEl.value;
    state.prefix = prefixEl.value;
    state.suffix = suffixEl.value;
    if (padWidthEl) state.padWidth = Number(padWidthEl.value) || DEFAULTS.padWidth;

    var numeric = state.format === 'number' || state.format === 'hex';

    /* 补零对字母 / 罗马 / 中文没有意义，控件连同位数下拉一起收起。
       state.padZero 保留用户的选择 —— 切回数字格式时它会自己回来，
       不把「当前是否生效」和「用户选过什么」混成一个字段。 */
    if (padChip) padChip.hidden = !numeric;
    if (padWidthEl) padWidthEl.hidden = !numeric;
    if (padNoteEl) {
      padNoteEl.textContent = numeric
        ? '仅「数字」与「十六进制」格式有效'
        : '当前格式的序号宽度不固定，没有补零这回事';
    }

    var res = process(text, state);

    if (!text) {
      outputEl.setAttribute('data-placeholder', '编号结果会显示在这里');
      outputEl.innerHTML = '';
    } else if (res.outLines === 0) {
      outputEl.setAttribute('data-placeholder', '没有可输出的行：输入里全是空行，而空行设置为「删除」');
      outputEl.innerHTML = '';
    } else if (res.outLines > MARK_LIMIT) {
      /* 行数太多就不套标记：几十万个节点会把页面卡死。
         纯文本同样是完整的输出，复制与下载不受影响。 */
      outputEl.textContent = res.text;
    } else {
      outputEl.innerHTML = renderHtml(res);
    }

    /* 统计 */
    statsEl.innerHTML =
      stat('输入行', num(res.inLines)) +
      stat('输出行', num(res.outLines)) +
      stat('已编号', num(res.numbered)) +
      stat('输出字符', num(Array.from(res.text).length));

    if (statusEl) {
      statusEl.textContent = text
        ? num(res.inLines) + ' 行 · ' + num(Array.from(text).length) + ' 字符'
        : '';
    }

    if (outFootEl) {
      if (!text) {
        outFootEl.textContent = '预览里用主题色标出的部分就是工具加上去的';
      } else {
        var bits = ['预览里用主题色标出的是新增部分'];
        if (res.dropped) bits.push('已删除 ' + num(res.dropped) + ' 个空行');
        if (res.fallback) {
          bits.push('有 ' + num(res.fallback) + ' 行的序号超出该格式的范围，已按十进制输出');
        }
        outFootEl.textContent = bits.join(' · ');
      }
    }

    /* 「已经有序号」只是提示，不改结果 */
    if (warnEl) {
      var ex = res.existing;
      if (state.enabled && ex.hit >= 3 && ex.hit * 2 >= ex.total) {
        util.setStatus(warnEl, 'warn',
          '输入的 ' + num(ex.total) + ' 行里有 ' + num(ex.hit) +
          ' 行看起来已经有序号了，再编号会叠成两层');
      } else {
        util.setStatus(warnEl, '', '');
      }
    }

    if (footEl) {
      if (!text) {
        footEl.textContent = '把文本粘贴到左边，这里会列出处理结果。';
      } else {
        var parts = [];
        if (state.enabled) {
          parts.push('序号：「' + (FORMAT_NAME[state.format] || state.format) + '」格式');
          parts.push(state.position === 'start' ? '加在行首' : '加在行尾');
          parts.push('从 ' + state.start + ' 起、步长 ' + state.step);
          if (state.padZero && numeric) parts.push('补零到 ' + state.padWidth + ' 位');
        } else {
          parts.push('没有编号，只加前后缀');
        }
        parts.push(state.blank === 'keep' ? '空行原样保留'
          : (state.blank === 'number' ? '空行也编号' : '空行整行删除'));
        footEl.textContent = parts.join(' · ');
      }
    }
  }

  /* 首屏同步渲染一次，不要走防抖 —— 否则首屏有 70ms 空白，测试也会读到空 DOM */
  var render = util.debounce(update, 70);

  /* --- 7. 事件 ------------------------------------------------------------ */

  input.addEventListener('input', render);

  /* 单选胶囊：data-opt + data-value，同一 key 下只有一个 aria-pressed="true" */
  util.$$('[data-opt]').forEach(function (chip) {
    var key = chip.getAttribute('data-opt');
    if (!groups[key]) groups[key] = [];
    groups[key].push(chip);

    chip.addEventListener('click', function () {
      state[key] = chip.getAttribute('data-value');
      groups[key].forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === chip));
      });
      update();
    });
  });

  /* 开关胶囊 */
  toggles.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var key = chip.getAttribute('data-toggle');
      state[key] = !state[key];
      chip.setAttribute('aria-pressed', String(state[key]));
      update();
    });
  });

  /* 空行：三选一 */
  blankChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      state.blank = chip.getAttribute('data-blank');
      blankChips.forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === chip));
      });
      update();
    });
  });

  /* 分隔符预设只负责往输入框里写值 —— 输入框是唯一真值来源，
     胶囊的高亮跟着输入框的内容走（手打一个 . 也会把预设点亮）。 */
  sepChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      sepEl.value = chip.getAttribute('data-sep');
      syncSepChips();
      update();
    });
  });
  sepEl.addEventListener('input', function () { syncSepChips(); render(); });

  [prefixEl, suffixEl].forEach(function (el) {
    if (el) el.addEventListener('input', render);
  });

  if (padWidthEl) {
    padWidthEl.addEventListener('change', function () { update(); });
  }

  /* 起始值 / 步长：输入时实时算，失焦时把就近的合法值写回并清掉标红 */
  [startEl, stepEl].forEach(function (el) {
    if (!el) return;
    el.addEventListener('input', render);
    el.addEventListener('blur', function () {
      var isStart = el === startEl;
      var v = readIntOrNull(el, isStart ? START_MIN : STEP_MIN, isStart ? START_MAX : STEP_MAX);
      if (v === null) v = isStart ? state.start : state.step;
      el.value = String(v);
      el.classList.remove('input--invalid');
      update();
    });
  });

  function syncUI() {
    Object.keys(groups).forEach(function (key) {
      groups[key].forEach(function (c) {
        c.setAttribute('aria-pressed', String(c.getAttribute('data-value') === state[key]));
      });
    });
    toggles.forEach(function (c) {
      c.setAttribute('aria-pressed', String(!!state[c.getAttribute('data-toggle')]));
    });
    blankChips.forEach(function (c) {
      c.setAttribute('aria-pressed', String(c.getAttribute('data-blank') === state.blank));
    });
    if (padWidthEl) padWidthEl.value = String(state.padWidth);
    syncSepChips();
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });
      sepEl.value = TEXT_DEFAULTS.sep;
      prefixEl.value = TEXT_DEFAULTS.prefix;
      suffixEl.value = TEXT_DEFAULTS.suffix;
      startEl.value = String(DEFAULTS.start);
      stepEl.value = String(DEFAULTS.step);
      startEl.classList.remove('input--invalid');
      stepEl.classList.remove('input--invalid');
      syncUI();
      update();
      util.toast('已恢复默认选项');
    });
  }

  if (dlBtn) {
    dlBtn.addEventListener('click', function () {
      /* 标记只包 span，textContent 就是完整的输出文本 */
      var text = outputEl.textContent;
      if (!text) { util.toast('没有可下载的内容'); return; }
      if (!util.download('numbered.txt', text)) util.toast('当前环境不支持下载');
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

  /* --- 8. 首屏 ------------------------------------------------------------ */
  syncUI();
  update();
})();
