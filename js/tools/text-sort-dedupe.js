/* ==========================================================================
   text-sort-dedupe.js — 文本排序去重（自研）
   --------------------------------------------------------------------------
   设计取舍（自研工具，这一段是它唯一的「来源说明」）：

   1. 流程固定为「删除空行 → 去重 → 排序」，不提供自定义顺序。三者的先后会改变
      结果：「保留末次」说的是输入里的出现次序，先排序再谈「末次」就没有意义了。
      顺序写死在注释与页面底栏里，免得用户对着结果猜。

   2. 排序方式分「字典序」与「码点序」两种，因为它们是两件事：
      字典序走 Intl.Collator('zh-Hans-CN')，中文按拼音；码点序直接比字符串，
      跨环境完全一致但中文按编码排。**并且会检测中文规则是否真的生效** ——
      有些环境的 ICU 没有中文排序数据，Collator 照样构造成功，只是排出来的是
      语言无关的顺序。判据是拿「字(zi)」与「安(an)」比一下：拼音序下 an < zi，
      码点序下 字(U+5B57) < 安(U+5B89)。检测不到就退回码点序，并在状态行写出来，
      不静默给一个看起来正常、读音上却乱掉的顺序。

   3. 数值序**不经过 Number**：把行首的数字拆成「符号 + 整数数字串 + 小数数字串」，
      逐位比较。Number 在 15 位以上就开始丢精度，而排序正是「差一位就排错」的地方。
      去前导零、去后置零之后，等长数字串的字典序就等于数值序，不需要任何转换。
      取不到数字的行一律排在最后（与升序降序无关），且因为排序是稳定的，
      它们彼此之间保持输入里的相对顺序。

   4. 长度序按**码点**计（Array.from），不按 UTF-16 长度 —— emoji 与生僻字
      用 .length 会被算成两个，同一份清单在不同平台上会排出不同的顺序。

   5. 随机打乱走 js/random-utils.js（拒绝采样 + crypto.getRandomValues），
      拿不到安全随机源时**明确报错并把顺序保持原样**，不退回 Math.random ——
      「随机」这类承诺一旦用可预测的源兑现，用户是看不出来的。

   6. 判重键只影响「算不算同一条」，被留下的那一行不会被改写。忽略大小写用
      toLowerCase，不做完整的 Unicode 大小写折叠（ß 与 SS 仍算两条）—— 这件事
      写在页面说明里，比假装做全了要好。

   7. 结尾换行留下的那个空元素单独处理：`a↵b↵` 的 split 结果是三个元素，
      最后那个空串不是一行内容。它不参与删空行、不参与去重、不参与排序，
      只在输出结尾补回那个换行。输入没有结尾换行时也不凭空加一个。

   8. 不用 lookbehind / replaceAll / Array.at 这类较新语法：它们在一些老引擎里是
      **解析期**错误，整个脚本文件加载失败、工具直接白屏，控制台连一行有用的报错都没有。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  /* --- 0. 取元素 + 依赖检查 ---------------------------------------------- */
  var input      = document.getElementById('ts-input');
  var outputEl   = document.getElementById('ts-output');
  var statsEl    = document.getElementById('ts-stats');
  var statusEl   = document.getElementById('ts-status');
  var outFootEl  = document.getElementById('ts-out-foot');
  var footEl     = document.getElementById('ts-foot');
  var warnEl     = document.getElementById('ts-warn');
  var reportEl   = document.getElementById('ts-report');
  var reportFoot = document.getElementById('ts-report-foot');
  var dirRow     = document.getElementById('ts-dir-row');
  var keyRow     = document.getElementById('ts-key-row');
  var resetBtn   = document.getElementById('ts-reset');
  var dlBtn      = document.getElementById('ts-download');
  var clearBtn   = document.querySelector('[data-clear]');
  var demoBtn    = document.querySelector('[data-demo]');
  if (!input || !outputEl) return;

  /* 依赖缺失要吵，不要静默 return —— 静默退出的表现是「结果区一片空白、
     控制台一行错都没有」，用户完全无从下手。 */
  function bail(detail) {
    var box = document.getElementById('ts-output');
    if (!box) return;
    box.textContent = '';
    var wrap = document.createElement('div');
    wrap.className = 'code-empty';
    wrap.innerHTML = '<strong>工具没能初始化</strong>' + detail;
    box.parentNode.appendChild(wrap);
  }

  var util = T.util;
  if (!util || typeof util.renderCode !== 'function' || typeof util.download !== 'function') {
    bail('页面加载到的 js/site.js 是旧版本，缺少这个工具需要的公共方法。请强制刷新（Ctrl+F5）后重试。');
    return;
  }
  var R = T.random;
  if (!R || typeof R.shuffle !== 'function') {
    bail('js/random-utils.js 没有加载成功，「随机打乱」用不了。请强制刷新（Ctrl+F5）后重试。');
    return;
  }

  /* --- 1. 排序口径 -------------------------------------------------------- */

  /* 中文排序规则探针：拼音序下「安(an)」在「字(zi)」前面，码点序下「字」在前
     （U+5B57 < U+5B89）。只靠「Collator 构造成功」判断是不够的 ——
     没有中文排序数据的环境照样能构造出来，只是排出来的顺序与读音无关。 */
  var collator = null;
  var dictIsZh = false;
  try {
    if (window.Intl && typeof window.Intl.Collator === 'function') {
      collator = new window.Intl.Collator('zh-Hans-CN');
      dictIsZh = collator.compare('\u5B57', '\u5B89') > 0;
    }
  } catch (e) {
    collator = null;
    dictIsZh = false;
  }

  function collatorCompare(a, b) {
    var c = collator ? collator.compare(a, b) : 0;
    if (c) return c < 0 ? -1 : 1;
    /* 排序器认为相等时（例如只差变音符号），退回码点序保证结果确定 */
    return codeCompare(a, b);
  }

  function codeCompare(a, b) {
    return a < b ? -1 : (a > b ? 1 : 0);
  }

  /** 实际生效的「字典序」比较函数：拿不到中文规则就用码点序，并把这件事说出来 */
  function dictComparator() {
    return dictIsZh ? collatorCompare : codeCompare;
  }

  /* --- 2. 数值序的精确比较 ------------------------------------------------ */

  /* 行首的数字：允许前导空白与正负号，认得小数与「.5」这种写法；
     后面跟什么不管 —— 「12. 苹果」取的是 12。 */
  var RE_LEADING_NUM = /^\s*([+-]?)(?:(\d+)(?:\.(\d+))?|\.(\d+))/;

  /**
   * 拆成「符号 + 整数数字串 + 小数数字串」（去掉前导零与后置零）。
   * 取不到数字返回 null。全程不经过 Number，20 位整数与超长小数都不丢精度。
   */
  function numKey(line) {
    var m = RE_LEADING_NUM.exec(line);
    if (!m) return null;
    var int = (m[2] || '').replace(/^0+/, '');
    var frac = (m[3] !== undefined ? m[3] : (m[4] || '')).replace(/0+$/, '');
    if (int === '' && frac === '') return { sign: 0, int: '', frac: '' };   /* ±0 */
    return { sign: m[1] === '-' ? -1 : 1, int: int, frac: frac };
  }

  function cmpAbs(a, b) {
    if (a.int.length !== b.int.length) return a.int.length - b.int.length;
    if (a.int !== b.int) return a.int < b.int ? -1 : 1;   /* 等长数字串：字典序就是数值序 */
    var n = a.frac.length > b.frac.length ? a.frac.length : b.frac.length;
    var fa = a.frac, fb = b.frac;
    while (fa.length < n) fa += '0';
    while (fb.length < n) fb += '0';
    if (fa === fb) return 0;
    return fa < fb ? -1 : 1;
  }

  function cmpNumKey(a, b) {
    if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
    if (a.sign === 0) return 0;
    var c = cmpAbs(a, b);
    return a.sign < 0 ? -c : c;
  }

  /* --- 3. 选项 ------------------------------------------------------------ */
  var DEFAULTS = {
    sort: 'none',          /* none | dict | code | num | len | reverse | shuffle */
    dir: 'asc',            /* asc | desc */
    dedupe: 'none',        /* none | first | last | only */
    ignoreCase: false,     /* 判重时忽略大小写 */
    ignoreSpace: false,    /* 判重时忽略首尾空白 */
    dropBlank: false
  };

  /* 有方向的排序方式；「原序反转」「随机打乱」本身就有方向，不受「方向」影响 */
  var WITH_DIRECTION = { dict: 1, code: 1, num: 1, len: 1 };

  var SORT_LABEL = {
    none: '不排序', dict: '字典序', code: '码点序', num: '数值序',
    len: '长度序', reverse: '原序反转', shuffle: '随机打乱'
  };
  var DEDUPE_LABEL = { none: '不去重', first: '保留首次', last: '保留末次', only: '只看重复' };

  var REPORT_LIMIT = 200;

  var state = {};
  Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });

  var DEMO = [
    'banana',
    'Apple',
    'apple',
    '10. 第十项',
    '2. 第二项',
    '',
    'banana',
    '  苹果  ',
    '苹果',
    'Apple'
  ].join('\n');

  /* --- 4. 核心 ------------------------------------------------------------ */

  /** 切行，并把「结尾换行留下的那个空元素」摘出来（见文件头第 7 条） */
  function splitLines(text) {
    var lines = text.split(/\r\n|\r|\n/);
    var endsWithBreak = /(?:\r\n|\r|\n)$/.test(text);
    var phantom = endsWithBreak && lines.length > 1 && lines[lines.length - 1] === '';
    if (phantom) lines.pop();
    return { lines: lines, phantom: phantom };
  }

  function isBlank(line) {
    return line === '' || /^\s+$/.test(line);
  }

  function cpLen(s) {
    return Array.from(s).length;
  }

  /** 判重键：只影响「算不算同一条」 */
  function dedupeKey(line, o) {
    var k = line;
    if (o.ignoreSpace) k = k.trim();
    if (o.ignoreCase) k = k.toLowerCase();
    return k;
  }

  /** 排序（不含随机打乱，那条要走随机源）。比较函数按方式现选：
      「字典序」用语言排序器，「码点序」直接比字符串 —— 两者不能共用一个比较器。 */
  function order(lines, o, env) {
    var mode = o.sort;
    if (mode === 'none' || mode === 'shuffle') return lines.slice();
    if (mode === 'reverse') return lines.slice().reverse();

    var desc = o.dir === 'desc';
    var copy = lines.slice();

    if (mode === 'num') {
      var keyed = copy.map(function (l) { return { l: l, k: numKey(l) }; });
      keyed.sort(function (a, b) {
        if (a.k === null || b.k === null) {
          if (a.k === null && b.k === null) return 0;   /* 稳定排序：保持输入里的相对顺序 */
          return a.k === null ? 1 : -1;                 /* 取不到数字的一律排最后，与方向无关 */
        }
        var n = cmpNumKey(a.k, b.k);
        return desc ? -n : n;
      });
      return keyed.map(function (x) { return x.l; });
    }

    if (mode === 'len') {
      var byLen = copy.map(function (l) { return { l: l, k: cpLen(l) }; });
      byLen.sort(function (a, b) { return desc ? b.k - a.k : a.k - b.k; });
      return byLen.map(function (x) { return x.l; });
    }

    var cmp = mode === 'dict' ? env.cmpDict : codeCompare;
    copy.sort(function (a, b) {
      var c = cmp(a, b);
      return desc ? -c : c;
    });
    return copy;
  }

  /**
   * 纯函数：文本 + 选项 → 结果。
   * @param {string} text
   * @param {object} o    选项
   * @param {object} env  { canShuffle, shuffle, cmpDict }
   */
  function process(text, o, env) {
    var out = {
      text: '', inLines: 0, outLines: 0, dropped: 0, removed: 0,
      groups: [], shuffleFailed: false,
      emptyReason: ''          /* 结果为空时才有值：nodup | blank | filtered */
    };
    if (text === '') return out;

    var sp = splitLines(text);
    var lines = sp.lines;
    out.inLines = lines.length;
    if (!lines.length) { out.emptyReason = 'blank'; return out; }

    /* 1) 删除空行 */
    var kept = [];
    var origOf = [];
    for (var i = 0; i < lines.length; i++) {
      if (o.dropBlank && isBlank(lines[i])) { out.dropped++; continue; }
      kept.push(lines[i]);
      origOf.push(i + 1);          /* 用输入里的行号，方便用户回去定位 */
    }

    /* 2) 判重分组（报告用，按首次出现的顺序） */
    var byKey = Object.create(null);
    for (var j = 0; j < kept.length; j++) {
      var gk = dedupeKey(kept[j], o);
      var g = byKey[gk];
      if (!g) {
        g = byKey[gk] = { count: 0, first: origOf[j], forms: [], seen: Object.create(null) };
        out.groups.push(g);
      }
      g.count++;
      if (!g.seen[kept[j]]) { g.seen[kept[j]] = true; g.forms.push(kept[j]); }
    }

    /* 3) 去重 */
    var result = kept;
    if (!kept.length) {
      /* 全被删空行筛掉，后面没什么可做的 */
    } else if (o.dedupe === 'first') {
      var seenFirst = Object.create(null);
      result = [];
      for (var a = 0; a < kept.length; a++) {
        var ka = dedupeKey(kept[a], o);
        if (seenFirst[ka]) { out.removed++; continue; }
        seenFirst[ka] = true;
        result.push(kept[a]);
      }
    } else if (o.dedupe === 'last') {
      var seenLast = Object.create(null);
      var rev = [];
      for (var b = kept.length - 1; b >= 0; b--) {
        var kb = dedupeKey(kept[b], o);
        if (seenLast[kb]) { out.removed++; continue; }
        seenLast[kb] = true;
        rev.push(kept[b]);
      }
      rev.reverse();
      result = rev;
    } else if (o.dedupe === 'only') {
      var taken = Object.create(null);
      result = [];
      for (var c = 0; c < kept.length; c++) {
        var kc = dedupeKey(kept[c], o);
        if (byKey[kc].count > 1 && !taken[kc]) {
          taken[kc] = true;
          result.push(kept[c]);
        }
      }
      out.removed = kept.length - result.length;
    }

    /* 4) 排序 / 反转 / 打乱 */
    if (o.sort === 'shuffle') {
      if (env.canShuffle) result = env.shuffle(result);
      else out.shuffleFailed = true;      /* 顺序保持原样，由界面明确报出来 */
    } else {
      result = order(result, o, env);
    }

    out.outLines = result.length;
    out.text = result.join('\n') + (sp.phantom && result.length ? '\n' : '');
    if (!result.length) {
      out.emptyReason = (o.dedupe === 'only' && !hasDuplicates(out)) ? 'nodup'
        : (out.dropped && !kept.length ? 'blank' : 'filtered');
    }
    return out;
  }

  function hasDuplicates(res) {
    for (var i = 0; i < res.groups.length; i++) {
      if (res.groups[i].count > 1) return true;
    }
    return false;
  }

  /* --- 5. 渲染 ------------------------------------------------------------ */

  function num(v) { return v.toLocaleString('zh-CN'); }

  function stat(label, value, cls) {
    return '<div class="stat">' +
      '<div class="stat-label">' + util.esc(label) + '</div>' +
      '<div class="stat-value' + (cls ? ' ' + cls : '') + '">' + util.esc(value) + '</div>' +
      '</div>';
  }

  /** 重复行清单：只列出现过两次以上的行，按出现次数降序、次数相同按首次出现 */
  function renderReport(res) {
    var rows = res.groups.filter(function (g) { return g.count > 1; })
      .sort(function (a, b) { return b.count - a.count || a.first - b.first; });

    if (!rows.length) {
      util.emptyHint(reportEl, '没有重复的行',
        '输入里每一行都只出现了一次（按当前的判重口径）。', 'table-empty');
      return { kinds: 0, lines: 0 };
    }

    var shown = rows.slice(0, REPORT_LIMIT);
    var html = '<table class="data-table"><thead><tr>' +
      '<th>次数</th><th>行内容</th><th>首次出现</th>' +
      '</tr></thead><tbody>';
    shown.forEach(function (g) {
      var allBlank = g.forms.every(isBlank);
      var text = allBlank ? '（空行）'
        : g.forms.slice(0, 3).map(function (f) { return f === '' ? '（空行）' : f; }).join(' / ') +
          (g.forms.length > 3 ? ' …' : '');
      html += '<tr>' +
        '<td>' + g.count + '</td>' +
        '<td class="ts-text' + (allBlank ? ' ts-blank' : '') + '">' + util.esc(text) + '</td>' +
        '<td>第 ' + g.first + ' 行</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    reportEl.innerHTML = html;

    var total = 0;
    rows.forEach(function (g) { total += g.count; });
    return { kinds: rows.length, lines: total };
  }

  function sortSummary() {
    var label = SORT_LABEL[state.sort] || state.sort;
    if (state.sort === 'dict' && !dictIsZh) label += '（本环境没有中文排序规则，按码点序）';
    if (WITH_DIRECTION[state.sort]) label += ' · ' + (state.dir === 'desc' ? '降序' : '升序');
    return label;
  }

  function keySummary() {
    if (state.ignoreCase && state.ignoreSpace) return '忽略大小写与首尾空白';
    if (state.ignoreCase) return '忽略大小写';
    if (state.ignoreSpace) return '忽略首尾空白';
    return '精确匹配';
  }

  /* --- 6. 主循环 ---------------------------------------------------------- */

  var groups = Object.create(null);   /* data-opt 的单选胶囊组 */
  var toggles = util.$$('[data-toggle]');

  function update() {
    var text = input.value;

    var env = {
      canShuffle: R.available(),
      shuffle: R.shuffle,
      cmpDict: dictComparator()
    };
    var res = process(text, state, env);

    /* 控件可见性：没有方向的方式不显示「方向」；不去重就不显示「判重口径」。
       用 hidden 属性（base.css 第 3 节有 !important 的兜底规则）。 */
    if (dirRow) dirRow.hidden = !WITH_DIRECTION[state.sort];
    if (keyRow) keyRow.hidden = state.dedupe === 'none';

    /* 结果区。输入为空时第一分支已处理；走到这里说明输入有内容，
       outLines 为 0 就一定意味着结果文本也是空的（join 空数组得到空串）。 */
    if (!text) {
      outputEl.setAttribute('data-placeholder', '处理结果会显示在这里');
      outputEl.textContent = '';
    } else if (!res.outLines) {
      outputEl.setAttribute('data-placeholder',
        res.emptyReason === 'nodup' ? '没有重复的行，「只看重复」的结果是空的'
          : res.emptyReason === 'blank' ? '输入里全是空行，已按「删除空行」删掉'
            : '没有可输出的行：都被去重或删空行筛掉了');
      outputEl.textContent = '';
    } else {
      outputEl.textContent = res.text;
    }

    /* 统计 */
    statsEl.innerHTML =
      stat('输入行', num(res.inLines)) +
      stat('输出行', num(res.outLines)) +
      stat('删除重复', num(res.removed)) +
      stat('删除空行', num(res.dropped));

    if (statusEl) {
      statusEl.textContent = text
        ? num(res.inLines) + ' 行 · ' + num(Array.from(text).length) + ' 字符'
        : '';
    }

    /* 状态行：只有真的出了问题（拿不到安全随机源）或口径降级时才出声 */
    if (warnEl) {
      if (text && res.shuffleFailed) {
        util.setStatus(warnEl, 'error',
          '随机打乱需要 crypto.getRandomValues，当前环境拿不到，顺序保持原样');
      } else if (text && state.sort === 'dict' && !dictIsZh) {
        util.setStatus(warnEl, 'warn',
          '当前环境拿不到中文排序规则，「字典序」已按码点序处理');
      } else {
        util.setStatus(warnEl, '', '');
      }
    }

    var rep = renderReport(res);

    if (outFootEl) {
      if (!text) {
        outFootEl.textContent = '处理顺序：删除空行 → 去重 → 排序';
      } else {
        var bits = [];
        if (res.removed) bits.push('去重删掉 ' + num(res.removed) + ' 行');
        if (res.dropped) bits.push('删空行 ' + num(res.dropped) + ' 行');
        bits.push(res.inLines === res.outLines && !res.removed && !res.dropped
          ? '行数与顺序都没有变化'
          : num(res.inLines) + ' 行 → ' + num(res.outLines) + ' 行');
        outFootEl.textContent = bits.join(' · ');
      }
    }

    if (reportFoot) {
      reportFoot.textContent = rep.kinds
        ? '重复的行共 ' + num(rep.kinds) + ' 种、合计 ' + num(rep.lines) + ' 行' +
          (rep.kinds > REPORT_LIMIT ? '（清单只列出前 ' + REPORT_LIMIT + ' 条）' : '')
        : '把文本粘贴到左边，这里会列出重复出现的行。';
    }

    if (footEl) {
      if (!text) {
        footEl.textContent = '把文本粘贴到左边，这里会列出处理口径。';
      } else {
        var parts = ['排序：' + sortSummary(), '去重：' + (DEDUPE_LABEL[state.dedupe] || state.dedupe)];
        if (state.dedupe !== 'none') parts.push('判重：' + keySummary());
        parts.push(state.dropBlank ? '删除空行' : '空行原样保留');
        footEl.textContent = parts.join(' · ');
      }
    }
  }

  /* 首屏同步渲染一次，不要走防抖 —— 否则首屏有 70ms 空白，测试也会读到空 DOM */
  var render = util.debounce(update, 70);

  /* --- 7. 事件 ------------------------------------------------------------ */

  input.addEventListener('input', render);

  /* 单选胶囊：data-opt + data-value */
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

  function syncUI() {
    Object.keys(groups).forEach(function (key) {
      groups[key].forEach(function (c) {
        c.setAttribute('aria-pressed', String(c.getAttribute('data-value') === state[key]));
      });
    });
    toggles.forEach(function (c) {
      c.setAttribute('aria-pressed', String(!!state[c.getAttribute('data-toggle')]));
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });
      syncUI();
      update();
      util.toast('已恢复默认选项');
    });
  }

  if (dlBtn) {
    dlBtn.addEventListener('click', function () {
      var text = outputEl.textContent;
      if (!text) { util.toast('没有可下载的内容'); return; }
      if (!util.download('sorted.txt', text)) util.toast('当前环境不支持下载');
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
