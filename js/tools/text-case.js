/* ==========================================================================
   text-case.js — 文本大小写转换
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 text-case（MIT，作者 Jamal Tantaoui /
   Iris Digital）。逐条改动清单：

   1. 【算法错误】驼峰边界只切 ([a-z0-9])([A-Z])，缩写词后面接单词时不切：
      getHTTPResponse → get_httpresponse、XMLHttpRequest → xmlhttp_request、
      HTTPServer → httpserver、parseHTMLString → parse_htmlstring。
      补一遍 ([A-Z]+)([A-Z][a-z]) 先切缩写词的尾巴，现在得到
      get_http_response / xml_http_request / http_server / parse_html_string。
   2. 【静默丢数据】词元字符只认 [A-Za-z0-9]，其余一律当分隔符：
      café → caf（丢了 é）、用户姓名 → 空串、привет мир → 空串，
      界面上什么都不显示也不报错。改成保留常见非拉丁字母
      （拉丁扩展 / 希腊 / 西里尔 / 希伯来 / 阿拉伯 / 假名 / CJK / 韩文）。
      中文没有大小写，转出来还是原样，但至少不会被悄悄删掉。
   3. 【可观察】Title Case 用 /\b\w/g 找词首，撇号被当成词边界：
      don't stop → Don'T Stop。改成扫描式，撇号夹在字母之间时不算边界，
      现在得到 Don't Stop；下划线同时按分隔符处理
      （snake_case here → Snake_Case Here，与 hello-world 的处理保持一致）。
   4. Sentence case 改扫描式：标点表补上中文的 。！？ 与省略号 …，且中英标点分开处理 ——
      英文的 . ! ? 要求后面有空白才算换句（hello!world 不会被拆成两句），
      中文标点后面通常不加空格，直接生效（中文。test → 中文。Test）。
      原实现用 (^\s*\w|[.!?]\s+\w) 只认 ASCII 的 .!?，且首字符是引号或括号时不大写。
   5. aLtErNaTiNg 原来用 /[a-z]/i 判断字母，带重音的 é 不参与交替计数。
      改成「有大小写概念的字符」才计数 —— é 算（É），中文不算，
      这样一段中文插在中间不会把交替的节奏打乱。
   6. 中文化 + 改用本项目的设计系统：.panel / .value-list / .value-row /
      .tool-notes，10 种风格按用途拆成「命名风格」（5 种，输出单个标识符）与
      「整段文本大小写」（5 种，保留换行）两块。
   7. 复制改用 site.js 的 data-copy-target 全局代理（整行可点），
      删掉上游自带的 copyToClipboard 与 Copy 按钮；空输入时给空状态提示，
      而不是十行空白结果。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  /* --- 0. 取元素 + 依赖检查 ---------------------------------------------- */
  var input     = document.getElementById('tc-input');
  var namingBox = document.getElementById('tc-naming');
  var blockBox  = document.getElementById('tc-block');
  var statusEl  = document.getElementById('tc-status');
  var tokensEl  = document.getElementById('tc-tokens');
  var namingFoot = document.getElementById('tc-naming-foot');
  var clearBtn  = document.querySelector('[data-clear]');
  var demoBtn   = document.querySelector('[data-demo]');
  if (!input || !namingBox || !blockBox) return;

  /* 依赖缺失要吵，不要静默 return —— 静默退出的表现是「结果区一片空白、
     控制台一行错都没有」，用户完全无从下手。 */
  function bail(detail) {
    var box = document.getElementById('tc-naming');
    if (!box) return;
    box.innerHTML = '<div class="code-empty"><strong>工具没能初始化</strong>' + detail + '</div>';
  }

  var util = T.util;
  if (!util || typeof util.emptyHint !== 'function' || typeof util.esc !== 'function') {
    bail('页面加载到的 js/site.js 是旧版本，缺少这个工具需要的公共方法。请强制刷新（Ctrl+F5）后重试。');
    return;
  }

  /* --- 1. 词元切分 -------------------------------------------------------- */

  /* 词元字符：拉丁字母数字 + 常见非拉丁字母。
     刻意排除 U+00D7（×）与 U+00F7（÷）—— 它们夹在 \u00C0-\u024F 里但不是字母。
     上游只认 [A-Za-z0-9]，café 会变成 caf、中文输入会变成空串。 */
  var RE_WORD_CHAR = /[0-9A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u1E00-\u1EFF\u0370-\u03FF\u0400-\u04FF\u0530-\u058F\u0590-\u05FF\u0600-\u06FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;

  /* 大小写边界：先切缩写词的尾巴，再切普通驼峰。两遍缺一不可 ——
     只做第二遍是上游的写法，getHTTPResponse 会变成 get httpresponse。 */
  var RE_ACRONYM_BOUNDARY = /([A-Z]+)([A-Z][a-z])/g;
  var RE_CAMEL_BOUNDARY = /([a-z0-9])([A-Z])/g;

  function isWordChar(ch) { return RE_WORD_CHAR.test(ch); }

  /* 「有大小写概念」的字符：é 有（É）、中文没有。交替大小写只数这些字符。 */
  function hasCase(ch) {
    return ch.toLowerCase() !== ch || ch.toUpperCase() !== ch;
  }

  function tokens(s) {
    var spaced = String(s == null ? '' : s)
      .replace(RE_ACRONYM_BOUNDARY, '$1 $2')
      .replace(RE_CAMEL_BOUNDARY, '$1 $2');

    var out = [];
    var cur = '';
    for (var i = 0; i < spaced.length; i++) {
      var ch = spaced.charAt(i);
      if (isWordChar(ch)) {
        cur += ch;
      } else if (cur) {
        out.push(cur);
        cur = '';
      }
    }
    if (cur) out.push(cur);

    return out.map(function (w) { return w.toLowerCase(); });
  }

  function cap(w) {
    return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }

  /* --- 2. 十种写法 -------------------------------------------------------- */

  var NAMING = [
    { label: 'camelCase',     fn: function (ts) { return ts.map(function (w, i) { return i ? cap(w) : w; }).join(''); } },
    { label: 'PascalCase',    fn: function (ts) { return ts.map(cap).join(''); } },
    { label: 'snake_case',    fn: function (ts) { return ts.join('_'); } },
    { label: 'kebab-case',    fn: function (ts) { return ts.join('-'); } },
    { label: 'CONSTANT_CASE', fn: function (ts) { return ts.join('_').toUpperCase(); } }
  ];

  /* 句末标点分两套：英文的 . ! ? 后面通常带空格，中文的 。！？… 后面通常不带。
     所以英文标点要「等一个空白」才算换句（hello!world 不会被拆成两句），
     中文标点直接生效（中文。test → 中文。Test）。 */
  var RE_SENTENCE_END_ASCII = /[.!?]/;
  var RE_SENTENCE_END_CJK = /[。！？…]/;
  var RE_SPACE = /\s/;

  /** 每个词的首字母大写，其余小写。撇号夹在字母之间时不算词边界。 */
  function titleCase(s) {
    var lower = String(s == null ? '' : s).toLowerCase();
    var out = '';
    var prevWord = false;
    for (var i = 0; i < lower.length; i++) {
      var ch = lower.charAt(i);
      if (isWordChar(ch)) {
        out += prevWord ? ch : ch.toUpperCase();
        prevWord = true;
      } else {
        out += ch;
        /* 撇号（直引号与弯引号）夹在词内：don't → Don't，而不是 Don'T */
        if (ch !== "'" && ch !== '\u2019') prevWord = false;
      }
    }
    return out;
  }

  /** 句首字母大写。中文标点后直接换句，英文标点要求后面有空白。 */
  function sentenceCase(s) {
    var lower = String(s == null ? '' : s).toLowerCase();
    var out = '';
    var atStart = true;    /* 下一个字母可以大写 */
    var afterEnd = false;  /* 刚遇到英文句末标点，等一个空白确认换句 */
    for (var i = 0; i < lower.length; i++) {
      var ch = lower.charAt(i);
      if (RE_SENTENCE_END_CJK.test(ch)) {
        out += ch;
        atStart = true;
        afterEnd = false;
        continue;
      }
      if (RE_SENTENCE_END_ASCII.test(ch)) {
        out += ch;
        afterEnd = true;
        continue;
      }
      if (RE_SPACE.test(ch)) {
        out += ch;
        if (afterEnd) { atStart = true; afterEnd = false; }
        continue;
      }
      if (atStart && hasCase(ch)) {
        out += ch.toUpperCase();
        atStart = false;
        afterEnd = false;
        continue;
      }
      out += ch;
      /* 只有词元字符才结束「句首」状态：开头的引号、括号不该让后面的字母失去大写机会 */
      if (isWordChar(ch)) atStart = false;
      afterEnd = false;
    }
    return out;
  }

  function alternating(s) {
    var str = String(s == null ? '' : s);
    var out = '';
    var j = 0;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (hasCase(ch)) {
        out += (j % 2) ? ch.toUpperCase() : ch.toLowerCase();
        j++;
      } else {
        out += ch;
      }
    }
    return out;
  }

  var BLOCK = [
    { label: '全部大写',    fn: function (s) { return String(s).toUpperCase(); } },
    { label: '全部小写',    fn: function (s) { return String(s).toLowerCase(); } },
    { label: '词首大写',    fn: titleCase },
    { label: '句首大写',    fn: sentenceCase },
    { label: '交替大小写',  fn: alternating }
  ];

  var DEMO = 'getHTTPResponse_from my-variable name';

  /* --- 3. 渲染 ------------------------------------------------------------ */

  /**
   * 把一组结果渲染成可整行点击复制的列表。
   * 每次重建整块结构（包括 .value-list 本身）—— 空状态提示是直接
   * innerHTML 覆盖容器的，缓存里面的节点会让后续渲染写进脱离文档的元素。
   */
  function rowsHtml(items, values, idPrefix) {
    return '<div class="value-list tc-list">' + items.map(function (item, i) {
      var id = idPrefix + '-' + i;
      return '<button class="value-row" type="button" title="点击复制这一行" ' +
        'data-copy-target="#' + id + '">' +
        '<span class="value-label">' + util.esc(item.label) + '</span>' +
        '<span class="value-text" id="' + id + '">' + util.esc(values[i]) + '</span>' +
        '</button>';
    }).join('') + '</div>';
  }

  function update() {
    var text = input.value;
    var ts = tokens(text);

    if (!text) {
      util.emptyHint(namingBox, '还没有结果',
        '在左侧输入变量名或一段文本，这里会实时列出五种命名风格。', 'match-empty');
      util.emptyHint(blockBox, '还没有结果',
        '输入文本后，这里会列出整段大小写的结果。', 'match-empty');
    } else {
      if (ts.length) {
        namingBox.innerHTML = rowsHtml(NAMING, NAMING.map(function (c) { return c.fn(ts); }), 'tc-n');
      } else {
        util.emptyHint(namingBox, '切不出词元',
          '这段文本里没有可以组成标识符的字符，只剩下标点或符号。', 'match-empty');
      }
      blockBox.innerHTML = rowsHtml(BLOCK, BLOCK.map(function (c) { return c.fn(text); }), 'tc-b');
    }

    if (statusEl) {
      statusEl.textContent = text ? '切出 ' + ts.length + ' 个词元' : '';
    }
    if (tokensEl) {
      /* 把切出来的词元摆出来：结果不符合预期时，用户一眼能看出是切词切错了还是转换错了 */
      var head = ts.slice(0, 12).map(function (w) { return w; }).join(' · ');
      tokensEl.textContent = ts.length
        ? '词元：' + head + (ts.length > 12 ? ' …（共 ' + ts.length + ' 个）' : '')
        : '';
    }
    if (namingFoot) {
      var lines = text ? text.split(/\r\n|\r|\n/).length : 0;
      namingFoot.textContent = lines > 1
        ? '已把 ' + lines + ' 行合并成一个标识符；点任意一行复制'
        : '把文本切成词元后重新拼接，点任意一行复制';
    }
  }

  /* 首屏同步渲染一次，不要走防抖 —— 否则首屏有 70ms 空白，测试也会读到空 DOM */
  var render = util.debounce(update, 70);

  /* --- 4. 事件 ------------------------------------------------------------ */
  input.addEventListener('input', render);

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

  /* --- 5. 首屏 ------------------------------------------------------------ */
  update();
})();
