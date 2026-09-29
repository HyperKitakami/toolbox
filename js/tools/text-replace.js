/* ==========================================================================
   text-replace.js — 批量查找替换（自研）
   --------------------------------------------------------------------------
   设计取舍（自研工具，这一段是它唯一的「来源说明」）：

   1. **一遍替换是自己用 exec 循环走的，没有用 String.replace。** 两个理由：
      ① 要拿到每一处命中的位置与内容（命中清单与逐条规则的统计都依赖它）；
      ② 纯文本模式下替换内容必须按字面写入 —— 平台的 String.replace 即使
         查找参数是字符串，也会展开替换里的 `$`，`'a'.replace('a', '$1')` 会留下
         字面的 `$1`，`'a'.replace('a', '$&')` 会把匹配塞回去（看起来「没替换」）。
         这种错法不报错、结果却全错，正好是自研一遍能规避的。
      代价是必须自己实现 `$` 展开（expandReplacement）。它逐字对齐平台的
      GetSubstitution：`$$`、`$&`、`$`` 、`$'`、`$n`（组号超出组数时整个 `$n` 按字面
      留下，而不是给空串）、`$<名>`（名字不存在给空串，正则没有具名组时 `$<` 按字面）、
      未参与匹配的组给空串。**测试里拿 String.replace 逐例交叉校验**，不是「自己算一遍
      看着对」。
      空匹配的两条细节也必须对上：零宽命中要手动推进 lastIndex（`a*` 在 `bbb` 上应有
      4 处命中），带 `u` 标志时按码点推进。同样有交叉校验。

   2. **两条路都要解码与编码，不能共用一套。** 纯文本模式要把查找内容先解掉
      `\t / \n / \\` 再转义成正则；正则模式的查找内容直接交给引擎，绝不额外转义
      （否则 `\d` 会变成字面的 `\d`）。替换内容两种模式都先解 `\t / \n / \\`，
      之后只有正则模式才解析 `$` 引用。

   3. **规则按从上到下的顺序执行，每条都在前一条的结果上继续**，这是这个工具相对
      「编辑器里的查找替换」的全部价值所在，所以顺序必须由用户控制（行上有 ↑ ↓），
      并且页面底栏把这个语义写死说明。

   4. **没填查找内容的规则直接跳过。** 空正则会在每个字符位置插一次替换内容，
      那不是用户想要的。跳过这件事**要说出来**（规则表里标「未填查找内容」），
      静默跳过会让人以为规则生效了却没效果。

   5. **正则编译失败只报事实，不猜原因。** 引擎给出的英文原文用 .err-raw 保留下来
      便于搜索，中文那边只说明「是第几条规则」。不同引擎的措辞差别很大，猜一个
      「应该是括号没闭合」猜错了更误导 —— 要交互式调试正则可以走站内的
      「正则表达式测试」。

   6. **命中清单里的行号以该条规则执行时的文本为准。** 前面的规则可能已经增删过换行，
      所以同一处内容在不同规则下不一定是同一行；这一点在页面上写明，不假装它是
      原始文本的行号。

   7. 不用 lookbehind / replaceAll / Array.at 这类较新语法：它们在一些老引擎里是
      **解析期**错误，整个脚本文件加载失败、工具直接白屏，控制台连一行有用的报错都没有。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  /* --- 0. 取元素 + 依赖检查 ---------------------------------------------- */
  var input      = document.getElementById('tr-input');
  var outputEl   = document.getElementById('tr-output');
  var rulesEl    = document.getElementById('tr-rules');
  var statsEl    = document.getElementById('tr-stats');
  var statusEl   = document.getElementById('tr-status');
  var outFootEl  = document.getElementById('tr-out-foot');
  var footEl     = document.getElementById('tr-foot');
  var warnEl     = document.getElementById('tr-warn');
  var ruleRepEl  = document.getElementById('tr-rule-report');
  var hitsEl     = document.getElementById('tr-hits');
  var hitFootEl  = document.getElementById('tr-hit-foot');
  var addBtn     = document.getElementById('tr-add');
  var resetBtn   = document.getElementById('tr-reset');
  var dlBtn      = document.getElementById('tr-download');
  var clearBtn   = document.querySelector('[data-clear]');
  var demoBtn    = document.querySelector('[data-demo]');
  if (!input || !outputEl || !rulesEl) return;

  /* 依赖缺失要吵，不要静默 return —— 静默退出的表现是「结果区一片空白、
     控制台一行错都没有」，用户完全无从下手。 */
  function bail(detail) {
    var box = document.getElementById('tr-output');
    if (!box) return;
    box.textContent = '';
    var wrap = document.createElement('div');
    wrap.className = 'code-empty';
    wrap.innerHTML = '<strong>工具没能初始化</strong>' + detail;
    box.parentNode.appendChild(wrap);
  }

  var util = T.util;
  if (!util || typeof util.download !== 'function' || typeof util.setStatus !== 'function') {
    bail('页面加载到的 js/site.js 是旧版本，缺少这个工具需要的公共方法。请强制刷新（Ctrl+F5）后重试。');
    return;
  }

  /* --- 1. 转义与展开 ------------------------------------------------------ */

  /* 查找 / 替换内容里的转义。只认这三个：\t 制表符、\n 换行、\\ 反斜杠本身。
     正则规则的查找内容不做这层处理（交给正则引擎）。 */
  var RE_ESC = /\\(t|n|\\)/g;
  function unescapeEscapes(s) {
    return String(s).replace(RE_ESC, function (m, c) {
      if (c === 't') return '\t';
      if (c === 'n') return '\n';
      return '\\';
    });
  }

  /** 把纯文本查找内容转义成可以安全放进正则的字面量 */
  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 展开替换内容里的 $ 引用，逐字对齐平台的 String.replace 语义。
   * 采集到的平台行为（见 .temporary/text-replace/probe-replace.mjs，测试里逐例交叉校验）：
   *   $$       → 一个 $                $&       → 整个匹配
   *   $`       → 匹配之前的文本         $'       → 匹配之后的文本
   *   $n       → 第 n 个捕获组；**组号超出实际组数时整个 $n 按字面留下**（$99 → 字面 $99）
   *   $nn      → 优先两位；两位超出组数就退化成一位 + 后面那个数字（$12 → 组1 + "2"）
   *   $<名>    → 具名组；名字不存在给空串；正则没有具名组时 $< 按字面留下
   *   其他 $x  → 字面输出（$0 也是字面，不是「整个匹配」）
   *   组存在但这一处没参与匹配 → 空串
   */
  function expandReplacement(rep, m, text, offset) {
    var out = '';
    var n = rep.length;
    var i = 0;
    while (i < n) {
      var ch = rep.charAt(i);
      if (ch !== '$' || i + 1 >= n) { out += ch; i++; continue; }
      var d = rep.charAt(i + 1);

      if (d === '$') { out += '$'; i += 2; continue; }
      if (d === '&') { out += m[0]; i += 2; continue; }
      if (d === '`') { out += text.slice(0, offset); i += 2; continue; }
      if (d === "'") { out += text.slice(offset + m[0].length); i += 2; continue; }

      if (d >= '1' && d <= '9') {
        var groups = m.length - 1;
        var two = rep.substr(i + 1, 2);
        var twoNum = Number(two);
        if (/^[1-9][0-9]$/.test(two) && twoNum <= groups) {
          out += m[twoNum] === undefined ? '' : m[twoNum];
          i += 3;
          continue;
        }
        var oneNum = Number(d);
        if (oneNum <= groups) {
          out += m[oneNum] === undefined ? '' : m[oneNum];
          i += 2;
          continue;
        }
        out += '$';          /* 组号超出范围：$ 按字面留下，后面的数字照原样走 */
        i++;
        continue;
      }

      if (d === '<' && m.groups) {
        var close = rep.indexOf('>', i + 2);
        if (close > i) {
          var g = m.groups[rep.slice(i + 2, close)];
          out += g === undefined ? '' : g;
          i = close + 1;
          continue;
        }
      }

      out += '$';
      i++;
    }
    return out;
  }

  /* --- 2. 一遍替换 -------------------------------------------------------- */

  /**
   * 用正则跑一遍全局替换，同时把所有命中的位置与内容收下来。
   * @param {string} text
   * @param {RegExp} re        必须带 g
   * @param {string} replacement
   * @param {boolean} literal  true = 替换内容按字面写入（不展开 $）
   * @returns {{text:string, hits:Array}}
   */
  function replacePass(text, re, replacement, literal) {
    var out = '';
    var hits = [];
    var last = 0;
    var line = 1;
    var scanned = 0;
    var m;

    /* 命中位置是递增的，行号跟着扫一遍就够（每处都从头数一遍是 O(n × 命中数)） */
    function lineAt(pos) {
      while (scanned < pos) {
        if (text.charCodeAt(scanned) === 10) line++;
        scanned++;
      }
      return line;
    }

    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      var matched = m[0];
      var produced = literal ? replacement : expandReplacement(replacement, m, text, m.index);
      out += text.slice(last, m.index) + produced;
      last = m.index + matched.length;
      hits.push({ match: matched, produced: produced, line: lineAt(m.index) });

      if (matched === '') {
        /* 零宽命中必须手动推进 lastIndex，否则 exec 一直停在原地。
           带 u 标志时按码点推进 —— 两条都与平台一致。 */
        var step = 1;
        if (re.unicode) {
          var cp = text.codePointAt(m.index);
          step = cp > 0xFFFF ? 2 : 1;
        }
        re.lastIndex = m.index + step;
      }
    }
    out += text.slice(last);
    return { text: out, hits: hits };
  }

  /* --- 3. 选项与规则 ------------------------------------------------------ */
  var DEFAULTS = {
    ignoreCase: false,   /* 忽略大小写（i） */
    wholeWord: false,    /* 用 \b 包住查找内容 */
    flagM: false,        /* ^ $ 匹配每一行的开头结尾 */
    flagS: false,        /* 点号也匹配换行 */
    flagU: false         /* Unicode 模式 */
  };

  var DEMO_TEXT = [
    '订单  A-1001   金额 ¥ 1,200.00',
    '订单  A-1002   金额 ¥ 980.50',
    '订单  A-1003   金额 ¥12,345.00'
  ].join('\n');

  var DEMO_RULES = [
    { mode: 'regex', find: '\\s{2,}', repl: '\\t' },
    { mode: 'regex', find: '¥\\s*', repl: '¥' },
    { mode: 'text', find: 'A-', repl: 'ORD-' }
  ];

  var HIT_LIMIT = 200;
  var MATCH_SHOWN = 60;   /* 命中内容超过这个长度就截断显示 */

  var state = {};
  Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });

  var ruleSeq = 0;
  function makeRule(mode, find, repl) {
    ruleSeq++;
    return { id: 'r' + ruleSeq, enabled: true, mode: mode || 'text', find: find || '', repl: repl || '' };
  }
  state.rules = [makeRule('text', '', '')];

  function findRule(id) {
    for (var i = 0; i < state.rules.length; i++) {
      if (state.rules[i].id === id) return state.rules[i];
    }
    return null;
  }
  function indexOfRule(id) {
    for (var i = 0; i < state.rules.length; i++) {
      if (state.rules[i].id === id) return i;
    }
    return -1;
  }

  /* --- 4. 核心 ------------------------------------------------------------ */

  /** 造出这条规则实际用的正则；编译不了就返回 { error } */
  function buildRegex(rule, o) {
    var src;
    if (rule.mode === 'text') {
      src = escapeRe(unescapeEscapes(rule.find));
      if (o.wholeWord) src = '\\b' + src + '\\b';
    } else {
      src = rule.find;
      if (o.wholeWord) src = '\\b(?:' + src + ')\\b';
    }
    var flags = 'g' + (o.ignoreCase ? 'i' : '') + (o.flagM ? 'm' : '') + (o.flagS ? 's' : '') + (o.flagU ? 'u' : '');
    try {
      return { re: new RegExp(src, flags), flags: flags };
    } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  }

  /**
   * 纯函数：文本 + 选项 → 结果。
   * @returns {{text, report, hits, totalHits, effective, enabledCount, errors}}
   *   report[i] 对应 options.rules[i]：{ status, hits, error }
   *   status: 'off' | 'empty' | 'error' | 'ok'
   */
  function process(text, options) {
    var rules = options.rules;
    var report = [];
    var out = {
      text: text, report: report, hits: [],
      totalHits: 0, effective: 0, enabledCount: 0, errors: []
    };

    /* 先给每条规则定状态 —— 即使还没输入文本，也要能看到
       「未填查找内容」「正则有误」，否则用户写完一条坏正则却什么都看不出来。
       编译成功的正则顺手存下来，第二遍直接用。 */
    var compiled = [];
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      var rep = { status: 'off', hits: 0, error: null };
      report.push(rep);
      compiled.push(null);
      if (!rule.enabled) continue;
      out.enabledCount++;
      if (!rule.find) { rep.status = 'empty'; continue; }
      var built = buildRegex(rule, options);
      if (built.error) {
        rep.status = 'error';
        rep.error = built.error;
        out.errors.push({ index: i + 1, message: built.error });
        continue;
      }
      rep.status = 'ok';
      compiled[i] = built;
    }

    /* 空输入不算「处理过」：空正则能在空串上命中一次，报出来会很奇怪。
       这与「文本是空的」是两回事，所以这里就返回。 */
    if (text === '') return out;

    var cur = text;
    for (var k = 0; k < rules.length; k++) {
      if (!compiled[k]) continue;
      var pass = replacePass(cur, compiled[k].re, unescapeEscapes(rules[k].repl), rules[k].mode === 'text');
      cur = pass.text;
      report[k].hits = pass.hits.length;
      if (pass.hits.length) out.effective++;
      out.totalHits += pass.hits.length;
      for (var h = 0; h < pass.hits.length; h++) {
        out.hits.push({ rule: k + 1, line: pass.hits[h].line, match: pass.hits[h].match });
      }
    }
    out.text = cur;
    return out;
  }

  /* --- 5. 渲染 ------------------------------------------------------------ */

  function num(v) { return v.toLocaleString('zh-CN'); }

  function stat(label, value) {
    return '<div class="stat">' +
      '<div class="stat-label">' + util.esc(label) + '</div>' +
      '<div class="stat-value">' + util.esc(value) + '</div>' +
      '</div>';
  }

  function hex(cp) {
    return 'U+' + ('0000' + cp.toString(16).toUpperCase()).slice(-4);
  }

  /** 把不可见字符变成看得见的记号，长内容截断 */
  function reveal(s, max) {
    var t = String(s);
    if (max && t.length > max) t = t.slice(0, max) + '\u2026';
    var out = '';
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      var cp = t.charCodeAt(i);
      if (ch === ' ') out += '\u00B7';
      else if (ch === '\t') out += '\u2192';
      else if (ch === '\n') out += '\u21B5';
      else if (ch === '\r') out += '\u21B5';
      else if (cp < 0x20 || cp === 0x7F) out += '\u27E6' + hex(cp) + '\u27E7';
      else out += ch;
    }
    return out;
  }

  var STATUS_TEXT = {
    off: '未启用',
    empty: '未填查找内容',
    error: '正则有误',
    ok: '已应用'
  };

  /** 「命中 0 次」要单独说 —— 一律写「已应用」会让人以为这条规则干了活 */
  function statusText(rep) {
    if (rep.status !== 'ok') return STATUS_TEXT[rep.status];
    return rep.hits ? '已应用' : '没有命中';
  }

  /* --- 6. 规则行的构建与渲染 --------------------------------------------- */

  /** 一条规则的 DOM 骨架（用户输入一律走 .value 赋值，不拼进 HTML） */
  function ruleRow(rule) {
    var row = document.createElement('div');
    row.className = 'tr-rule';
    row.setAttribute('data-id', rule.id);
    row.innerHTML =
      '<div class="tr-rule-head">' +
        '<span class="tr-rule-no"></span>' +
        '<button class="choice-chip" type="button" data-act="toggle" aria-pressed="false">启用</button>' +
        '<span class="tr-rule-sep"></span>' +
        '<button class="btn btn--icon tr-icon-btn" type="button" data-act="up" title="上移这条规则">\u2191</button>' +
        '<button class="btn btn--icon tr-icon-btn" type="button" data-act="down" title="下移这条规则">\u2193</button>' +
        '<button class="btn btn--icon tr-icon-btn" type="button" data-act="del" title="删除这条规则">\u00D7</button>' +
      '</div>' +
      '<div class="tr-rule-fields">' +
        '<label class="tr-field"><span class="tr-field-label">查找</span>' +
          '<input class="input input--mono" type="text" data-field="find" spellcheck="false" ' +
          'autocomplete="off" placeholder="要查找的内容"></label>' +
        '<label class="tr-field tr-field--mode"><span class="tr-field-label">方式</span>' +
          '<select class="select" data-field="mode">' +
            '<option value="text">纯文本</option><option value="regex">正则</option>' +
          '</select></label>' +
        '<label class="tr-field"><span class="tr-field-label">替换为</span>' +
          '<input class="input input--mono" type="text" data-field="repl" spellcheck="false" ' +
          'autocomplete="off" placeholder="留空表示删除"></label>' +
      '</div>';

    row.querySelector('[data-field="find"]').value = rule.find;
    row.querySelector('[data-field="repl"]').value = rule.repl;
    row.querySelector('[data-field="mode"]').value = rule.mode;
    return row;
  }

  /**
   * 重建规则列表。只在增删改序时调用 —— 输入过程中重建会把焦点和光标弄丢。
   * @param {string} [focusSel] 重建后要重新聚焦的选择器
   */
  function renderRules(focusSel) {
    rulesEl.textContent = '';
    state.rules.forEach(function (r, i) {
      var row = ruleRow(r);
      row.querySelector('.tr-rule-no').textContent = '规则 ' + (i + 1);
      row.querySelector('[data-act="toggle"]').setAttribute('aria-pressed', String(r.enabled));
      row.classList.toggle('tr-rule--off', !r.enabled);

      var up = row.querySelector('[data-act="up"]');
      var down = row.querySelector('[data-act="down"]');
      up.disabled = i === 0;
      up.title = i === 0 ? '已经是第一条' : '上移这条规则';
      down.disabled = i === state.rules.length - 1;
      down.title = i === state.rules.length - 1 ? '已经是最后一条' : '下移这条规则';
      rulesEl.appendChild(row);
    });
    if (focusSel) {
      var el = rulesEl.querySelector(focusSel);
      if (el) el.focus();
    }
  }

  function renderRuleReport(res) {
    if (!state.rules.length) {
      util.emptyHint(ruleRepEl, '还没有规则',
        '点上面的「添加规则」加一条，或「填入示例」看一个完整的例子。', 'table-empty');
      return;
    }
    var html = '<table class="data-table"><thead><tr>' +
      '<th>序号</th><th>查找</th><th>方式</th><th>命中</th><th>状态</th>' +
      '</tr></thead><tbody>';
    state.rules.forEach(function (rule, i) {
      var rep = res.report[i] || { status: 'off', hits: 0 };
      var shown = rule.mode === 'text' ? reveal(unescapeEscapes(rule.find)) : rule.find;
      if (shown === '') shown = '（空）';
      /* 状态上色：「没有命中」用琥珀色点名（这是用户最想一眼看到的一格），
         正则有误用红；「已应用」不上色 —— 文本分类的主题色本身就是绿的，
         再给它上 --ok 会与「点亮」混在一起（见 SKILL 陷阱 26）。 */
      var cls = rep.status === 'error' ? 'tr-hit-error'
        : rep.status === 'ok' ? (rep.hits ? '' : 'tr-hit-none')
          : 'tr-hit-off';
      html += '<tr>' +
        '<td class="tr-num">规则 ' + (i + 1) + '</td>' +
        '<td class="tr-find">' + util.esc(shown) + '</td>' +
        '<td class="tr-mode">' + (rule.mode === 'text' ? '纯文本' : '正则') + '</td>' +
        '<td class="tr-count">' + (rep.status === 'ok' ? num(rep.hits) : '\u2014') + '</td>' +
        '<td class="tr-status ' + cls + '">' + statusText(rep) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    ruleRepEl.innerHTML = html;
  }

  function renderHits(res) {
    if (!res.hits.length) {
      util.emptyHint(hitsEl, '没有命中',
        '当前规则没有匹配到任何内容（或还没有可执行的规则）。', 'table-empty');
      return;
    }
    var shown = res.hits.slice(0, HIT_LIMIT);
    var html = '<table class="data-table"><thead><tr>' +
      '<th>规则</th><th>行</th><th>命中内容</th>' +
      '</tr></thead><tbody>';
    shown.forEach(function (h) {
      var empty = h.match === '';
      html += '<tr>' +
        '<td class="tr-num">规则 ' + h.rule + '</td>' +
        '<td class="tr-count">' + h.line + '</td>' +
        '<td class="tr-find' + (empty ? ' tr-empty' : '') + '">' +
          util.esc(empty ? '（空匹配）' : reveal(h.match, MATCH_SHOWN)) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    hitsEl.innerHTML = html;
  }

  /* --- 7. 主循环 ---------------------------------------------------------- */

  function flagSummary() {
    var f = '';
    if (state.ignoreCase) f += 'i';
    if (state.flagM) f += 'm';
    if (state.flagS) f += 's';
    if (state.flagU) f += 'u';
    return f || '无';
  }

  function update() {
    var text = input.value;
    var res = process(text, state);

    /* 结果区 */
    if (!text) {
      outputEl.setAttribute('data-placeholder', '替换结果会显示在这里');
      outputEl.textContent = '';
    } else {
      outputEl.textContent = res.text;
    }

    statsEl.innerHTML =
      stat('命中总数', num(res.totalHits)) +
      stat('生效规则', res.effective + ' / ' + res.enabledCount) +
      stat('输入字符', num(Array.from(text).length)) +
      stat('输出字符', num(Array.from(res.text).length));

    if (statusEl) {
      statusEl.textContent = text
        ? num(text.split(/\r\n|\r|\n/).length) + ' 行 · ' + num(Array.from(text).length) + ' 字符'
        : '';
    }

    /* 状态行按优先级只显示一条：正则编译失败 → 全词匹配不生效 → \p{} 忘了开 Unicode。
       正则的错不跟文本空不空挂钩 —— 一边写表达式一边就能看到错在哪条。 */
    if (warnEl) {
      warnEl.textContent = '';
      var uHint = unicodeHint();
      if (res.errors.length) {
        var s1 = document.createElement('span');
        s1.className = 'is-error';
        s1.textContent = '第 ' + res.errors[0].index + ' 条规则的正则表达式无法编译' +
          (res.errors.length > 1 ? '（共 ' + res.errors.length + ' 条有误）' : '') +
          '，已跳过';
        var s2 = document.createElement('span');
        s2.className = 'err-raw';
        s2.textContent = res.errors[0].message;
        warnEl.appendChild(s1);
        warnEl.appendChild(s2);
      } else if (wholeWordUseless()) {
        util.setStatus(warnEl, 'warn',
          '「全词匹配」按 ASCII 词边界（\\b）判断，' +
          '当前的查找内容里没有字母或数字，' +
          '这个开关不会生效');
      } else if (uHint) {
        util.setStatus(warnEl, 'warn',
          '第 ' + uHint + ' 条规则里用了 \\p{…}，但没打开「Unicode」标志 —— ' +
          '不开时 \\p 会被当成字面的 p，匹配不到任何字符类别');
      }
    }

    renderRuleReport(res);
    renderHits(res);

    if (outFootEl) {
      if (!text) {
        outFootEl.textContent = '规则从上到下依次执行，每条都在前一条的结果上继续';
      } else if (!res.enabledCount) {
        outFootEl.textContent = '没有启用的规则，输出与输入相同';
      } else if (!res.totalHits) {
        outFootEl.textContent = '没有命中，输出与输入相同';
      } else {
        outFootEl.textContent = num(res.totalHits) + ' 处命中 · ' +
          num(res.effective) + ' 条规则生效 · ' +
          num(Array.from(text).length) + ' 字符 → ' + num(Array.from(res.text).length) + ' 字符';
      }
    }

    if (hitFootEl) {
      if (!res.hits.length) {
        hitFootEl.textContent = '命中清单会把每一处命中的原文列出来。';
      } else {
        hitFootEl.textContent = '共 ' + num(res.hits.length) + ' 处命中' +
          (res.hits.length > HIT_LIMIT ? '（只列出前 ' + HIT_LIMIT + ' 处）' : '') +
          ' · 行号以该条规则执行时的文本为准 · 超过 ' + MATCH_SHOWN + ' 个字符的命中会截断显示';
      }
    }

    if (footEl) {
      if (!text) {
        footEl.textContent = '把文本粘贴到左边，这里会列出每条规则的执行结果。';
      } else {
        var parts = [
          '规则 ' + state.rules.length + ' 条（启用 ' + res.enabledCount + '）',
          '正则标志 ' + flagSummary(),
          state.ignoreCase ? '忽略大小写' : '区分大小写'
        ];
        if (state.wholeWord) parts.push('全词匹配');
        if (res.errors.length) parts.push(num(res.errors.length) + ' 条正则有误已跳过');
        footEl.textContent = parts.join(' · ');
      }
    }
  }

  /** 「全词匹配」按 \b 判断，而 \b 只认 ASCII 词字符 —— 查找内容里一个都没有时它必然不生效 */
  function wholeWordUseless() {
    if (!state.wholeWord) return false;
    var textRules = 0;
    var anyWordChar = false;
    state.rules.forEach(function (r) {
      if (!r.enabled || r.mode !== 'text' || !r.find) return;
      textRules++;
      if (/[A-Za-z0-9_]/.test(unescapeEscapes(r.find))) anyWordChar = true;
    });
    return textRules > 0 && !anyWordChar;
  }

  /**
   * 正则里写了 \p{…} 却没打开「Unicode」标志，返回规则序号（没有则 null）。
   * 不开 u 时 `\p` 走的是 identity escape，被当成**字面的 p** —— 表达式照样编译通过、
   * 照样「没有命中」，用户完全看不出为什么。这类静默失效必须点出来。
   */
  function unicodeHint() {
    if (state.flagU) return null;
    for (var i = 0; i < state.rules.length; i++) {
      var r = state.rules[i];
      if (r.enabled && r.mode === 'regex' && /\\[pP]\{/.test(r.find)) return i + 1;
    }
    return null;
  }

  /* 首屏同步渲染一次，不要走防抖 —— 否则首屏有 70ms 空白，测试也会读到空 DOM */
  var render = util.debounce(update, 70);

  /* --- 8. 事件 ------------------------------------------------------------ */

  input.addEventListener('input', render);

  /* 规则列表：增删改序走重建，字段改动只更新时间（不重建，免得丢焦点与光标） */
  rulesEl.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    var row = btn.closest('.tr-rule');
    if (!row) return;
    var id = row.getAttribute('data-id');
    var act = btn.getAttribute('data-act');
    var rule = findRule(id);
    var idx = indexOfRule(id);
    if (!rule || idx < 0) return;

    if (act === 'toggle') {
      rule.enabled = !rule.enabled;
      renderRules('[data-id="' + id + '"] [data-act="toggle"]');
      update();
    } else if (act === 'del') {
      state.rules.splice(idx, 1);
      renderRules();
      update();
    } else if (act === 'up' && idx > 0) {
      state.rules.splice(idx - 1, 0, state.rules.splice(idx, 1)[0]);
      renderRules('[data-id="' + id + '"] [data-act="up"]');
      update();
    } else if (act === 'down' && idx < state.rules.length - 1) {
      state.rules.splice(idx + 1, 0, state.rules.splice(idx, 1)[0]);
      renderRules('[data-id="' + id + '"] [data-act="down"]');
      update();
    }
  });

  /* input 与 change 都听：select 在各浏览器/引擎上不一定都补发 input。
     两次写进去的是同一个值，重复 render 也只会被防抖合成一次。 */
  function onFieldChange(e) {
    var el = e.target;
    var field = el && el.getAttribute ? el.getAttribute('data-field') : null;
    if (!field) return;
    var row = el.closest ? el.closest('.tr-rule') : null;
    if (!row) return;
    var rule = findRule(row.getAttribute('data-id'));
    if (!rule) return;
    rule[field] = el.value;
    render();
  }
  rulesEl.addEventListener('input', onFieldChange);
  rulesEl.addEventListener('change', onFieldChange);

  if (addBtn) {
    addBtn.addEventListener('click', function () {
      var r = makeRule('text', '', '');
      state.rules.push(r);
      renderRules('[data-id="' + r.id + '"] [data-field="find"]');
      update();
    });
  }

  /* 开关胶囊 */
  util.$$('[data-toggle]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var key = chip.getAttribute('data-toggle');
      state[key] = !state[key];
      chip.setAttribute('aria-pressed', String(state[key]));
      update();
    });
  });

  function syncUI() {
    util.$$('[data-toggle]').forEach(function (c) {
      c.setAttribute('aria-pressed', String(!!state[c.getAttribute('data-toggle')]));
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });
      state.rules = [makeRule('text', '', '')];
      syncUI();
      renderRules();
      update();
      util.toast('已恢复默认选项');
    });
  }

  if (dlBtn) {
    dlBtn.addEventListener('click', function () {
      var text = outputEl.textContent;
      if (!text) { util.toast('没有可下载的内容'); return; }
      if (!util.download('replaced.txt', text)) util.toast('当前环境不支持下载');
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
      input.value = DEMO_TEXT;
      state.rules = DEMO_RULES.map(function (r) { return makeRule(r.mode, r.find, r.repl); });
      renderRules();
      update();
      input.focus();
    });
  }

  /* --- 9. 首屏 ------------------------------------------------------------ */
  syncUI();
  renderRules();
  update();
})();
