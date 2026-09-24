/* ==========================================================================
   json-formatter.js — JSON 格式化 / 压缩 / 校验
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 json-formatter（MIT），改动：
     1. 全量中文化（界面文案、状态提示、解析报错）
     2. 改用本站的设计系统与组件类名，去掉原有内联样式
     3. 重写语法高亮：上游先 escapeHtml（把 " 转成 &quot;）再跑四条靠引号
        匹配的正则，导致键名与字符串值完全没有着色，而字符串里的数字反被
        误标成数字。改为单遍扫描的记号化，一次成型、不回头重扫。
     4. 补齐数组元素的着色（上游只处理冒号后面的值，数组里的元素不着色）
     5. 报错信息把 position 换算成行列并翻译成中文说明
     6. 复制改为带降级的实现；新增统计面板、自动换行开关、Ctrl+Enter 快捷键
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var esc = T.util.esc;

  /* --- DOM --------------------------------------------------------------- */
  var inputEl    = document.getElementById('jf-input');
  var outputEl   = document.getElementById('jf-output');
  var outputTextEl = document.getElementById('jf-output-text');
  var statusEl   = document.getElementById('jf-status');
  var statsEl    = document.getElementById('jf-stats');
  var modeEl     = document.getElementById('jf-mode');
  var sizeEl     = document.getElementById('jf-size');
  var indentEl   = document.getElementById('jf-indent');
  var wrapEl     = document.getElementById('jf-wrap');

  var formatBtn   = document.getElementById('jf-format');
  var minifyBtn   = document.getElementById('jf-minify');
  var validateBtn = document.getElementById('jf-validate');
  var downloadBtn = document.getElementById('jf-download');
  var uploadBtn   = document.getElementById('jf-upload');
  var fileEl      = document.getElementById('jf-file');

  var demoBtn  = document.querySelector('[data-demo]');
  var clearBtn = document.querySelector('[data-clear]');

  if (!inputEl || !outputEl) return;

  /* --- 常量 -------------------------------------------------------------- */
  var MAX_LINES = 20000;   /* 超过则不渲染行号与着色，避免卡顿 */

  var DEMO = [
    '{',
    '  "name": "工具箱",',
    '  "version": 2,',
    '  "private": true,',
    '  "tags": ["json", "格式化", "developer"],',
    '  "author": {',
    '    "handle": "hyperkitakami",',
    '    "contact": {',
    '      "email": "hello@example.com",',
    '      "site": "https://example.com"',
    '    }',
    '  },',
    '  "stats": {',
    '    "stars": 1280,',
    '    "ratio": 0.875,',
    '    "big": 6.02e23,',
    '    "deprecated": null,',
    '    "archived": false',
    '  }',
    '}'
  ].join('\n');

  /* --- 状态 -------------------------------------------------------------- */
  var rawOutput = '';

  /* ======================================================================
     一、语法高亮
     ----------------------------------------------------------------------
     单遍扫描：按出现顺序识别 字符串 / 数字 / 字面量，中间的空白与括号
     原样转义输出。这样不会出现「已经插入的 HTML 被后续正则再次匹配」的
     问题，也不会把字符串里的数字当成数字。
     ====================================================================== */

  /* 顺序不能变：字符串优先，否则字符串里的数字会被当成数字 */
  var RE_TOKEN = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;

  function highlightLine(line) {
    var out = '';
    var last = 0;
    var m;

    RE_TOKEN.lastIndex = 0;
    while ((m = RE_TOKEN.exec(line)) !== null) {
      out += esc(line.slice(last, m.index));

      var tok = m[0];
      if (tok.charAt(0) === '"') {
        /* 后面紧跟冒号的字符串是键名，否则是字符串值 */
        var isKey = /^\s*:/.test(line.slice(m.index + tok.length));
        out += '<span class="tok-' + (isKey ? 'key' : 'str') + '">' + esc(tok) + '</span>';
      } else if (tok === 'true' || tok === 'false' || tok === 'null') {
        out += '<span class="tok-bool">' + esc(tok) + '</span>';
      } else {
        out += '<span class="tok-num">' + esc(tok) + '</span>';
      }

      last = m.index + tok.length;
    }

    out += esc(line.slice(last));
    return out;
  }

  function viewClass() {
    return 'code-view' + (wrapEl && wrapEl.checked ? ' code-view--wrap' : '');
  }

  function renderOutput(str) {
    outputEl.className = viewClass();
    if (!str) { setEmpty(); return 0; }
    return T.util.renderCode(outputEl, str, highlightLine, { maxLines: MAX_LINES });
  }

  function setEmpty() {
    outputEl.className = viewClass();
    T.util.emptyHint(outputEl, '还没有内容',
      '粘贴 JSON 后会自动格式化，也可以点上面的「载入示例」看看效果。');
    if (outputTextEl) outputTextEl.textContent = '';
    if (modeEl) { modeEl.textContent = '—'; modeEl.className = 'badge'; }
    rawOutput = '';
  }

  /* ======================================================================
     二、结构统计
     ====================================================================== */

  function analyze(root) {
    var acc = { objects: 0, arrays: 0, keys: 0, items: 0, depth: 0 };

    (function walk(node, level) {
      if (node === null || typeof node !== 'object') return;
      if (level > acc.depth) acc.depth = level;

      if (Array.isArray(node)) {
        acc.arrays++;
        acc.items += node.length;
        for (var i = 0; i < node.length; i++) walk(node[i], level + 1);
        return;
      }

      acc.objects++;
      var ks = Object.keys(node);
      acc.keys += ks.length;
      for (var j = 0; j < ks.length; j++) walk(node[ks[j]], level + 1);
    })(root, 1);

    return acc;
  }

  function rootType(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'Array';
    if (typeof v === 'object') return 'Object';
    return typeof v;
  }

  function stat(label, value, cls) {
    return '<div class="stat">' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value' + (cls ? ' ' + cls : '') + '">' + value + '</div>' +
      '</div>';
  }

  function renderStats(parsed, lineCount) {
    if (!statsEl) return;

    if (parsed === undefined) {
      statsEl.innerHTML =
        stat('根类型', '—', 'stat-value--sm') +
        stat('键总数', '0') +
        stat('最大层级', '0') +
        stat('对象', '0') +
        stat('数组', '0') +
        stat('行数', '0');
      return;
    }

    var a = analyze(parsed);
    statsEl.innerHTML =
      stat('根类型', esc(rootType(parsed)), 'stat-value--sm') +
      stat('键总数', a.keys.toLocaleString('zh-CN')) +
      stat('最大层级', String(a.depth)) +
      stat('对象', String(a.objects)) +
      stat('数组', String(a.arrays)) +
      stat('行数', String(lineCount || 0));
  }

  /* ======================================================================
     三、报错信息
     ====================================================================== */

  /* 现代 V8 的报错里已经带 (line X column Y)，只有少数几种没有 */
  var ERR_RULES = [
    [/^Unexpected end of JSON input/,
      'JSON 内容不完整，可能有括号或引号没有闭合'],
    [/^Unexpected token '(.+?)',[\s\S]*is not valid JSON/,
      '这里出现了意料之外的字符 $1，不是合法的 JSON'],
    [/^Unexpected non-whitespace character after JSON/,
      'JSON 已经结束，后面还有多余内容'],
    [/^Expected property name or '\}'/,
      '这里应该是属性名（用双引号包裹）或右花括号'],
    [/^Expected double-quoted property name/,
      '属性名必须用双引号包裹，且对象里不能有尾随逗号'],
    [/^Expected ',' or '\}' after property value/,
      '属性值后面缺少逗号，或者应该是右花括号'],
    [/^Expected ',' or '\]' after array element/,
      '数组元素后面缺少逗号，或者应该是右方括号'],
    [/^Unexpected number/,
      '数字格式不合法（例如前导零、小数点位置不对）'],
    [/^Unterminated string/,
      '字符串没有闭合，缺少结尾的双引号'],
    [/^Bad escaped character/,
      '含有非法的转义字符（合法写法：\\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX）'],
    [/^Bad control character in string literal/,
      '字符串里含有未转义的控制字符，换行要写成 \\n、制表符要写成 \\t'],
    [/^Bad Unicode escape/,
      'Unicode 转义格式不合法，应为 \\uXXXX']
  ];

  function translateError(msg) {
    for (var i = 0; i < ERR_RULES.length; i++) {
      var m = msg.match(ERR_RULES[i][0]);
      if (m) return ERR_RULES[i][1].replace(/\$(\d)/g, function (_, d) { return m[Number(d)] || ''; });
    }
    return '';
  }

  function posToLineCol(text, pos) {
    var head = text.substring(0, pos);
    var lines = head.split('\n');
    return { line: lines.length, col: lines[lines.length - 1].length + 1 };
  }

  function errorHtml(e, text) {
    var msg = e.message;
    var line = null, col = null;

    var lc = msg.match(/\(line (\d+) column (\d+)\)/i);
    if (lc) {
      line = lc[1]; col = lc[2];
    } else {
      var pm = msg.match(/position\s+(\d+)/i);
      if (pm && text) {
        var p = posToLineCol(text, parseInt(pm[1], 10));
        line = p.line; col = p.col;
      }
    }

    var cn = translateError(msg);
    var where = line ? '第 ' + line + ' 行，第 ' + col + ' 列：' : '';

    return '<span class="is-error">' + esc(where) + esc(cn || '解析失败') + '</span>' +
           '<span class="err-raw">' + esc(msg.replace(/\s*\(line \d+ column \d+\)/i, '')) + '</span>';
  }

  function okStatus(parsed, extra) {
    var desc = rootType(parsed);
    var a = analyze(parsed);
    var detail = desc === 'Array'
      ? '数组，' + a.items + ' 个元素'
      : desc === 'Object'
        ? '对象，' + a.keys + ' 个键'
        : desc;

    statusEl.innerHTML = '<span class="is-ok">✓ 合法的 JSON</span>' +
      '<span class="faint"> · ' + esc(detail) + (extra ? ' · ' + esc(extra) : '') + '</span>';
  }

  function failStatus(e, text) {
    statusEl.innerHTML = errorHtml(e, text);
  }

  /* ======================================================================
     四、三种操作
     ====================================================================== */

  function getIndent() {
    var v = indentEl ? indentEl.value : '2';
    return v === 'tab' ? '\t' : parseInt(v, 10);
  }

  function formatJSON() {
    var text = inputEl.value;
    if (!text.trim()) { setEmpty(); statusEl.innerHTML = ''; renderStats(undefined); return; }

    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      failStatus(e, text);
      renderStats(undefined);
      return;
    }

    var formatted = JSON.stringify(parsed, null, getIndent());
    rawOutput = formatted;
    if (outputTextEl) outputTextEl.textContent = formatted;
    if (modeEl) { modeEl.textContent = '已格式化'; modeEl.className = 'badge badge--accent'; }

    var n = renderOutput(formatted);
    renderStats(parsed, n);
    okStatus(parsed, n + ' 行');
  }

  function minifyJSON() {
    var text = inputEl.value;
    if (!text.trim()) { setEmpty(); statusEl.innerHTML = ''; renderStats(undefined); return; }

    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      failStatus(e, text);
      renderStats(undefined);
      return;
    }

    var minified = JSON.stringify(parsed);
    var saved = text.length - minified.length;
    var pct = text.length ? Math.round((saved / text.length) * 100) : 0;

    rawOutput = minified;
    if (outputTextEl) outputTextEl.textContent = minified;
    if (modeEl) { modeEl.textContent = '已压缩'; modeEl.className = 'badge badge--accent'; }

    var n = renderOutput(minified);
    renderStats(parsed, n);
    okStatus(parsed, minified.length + ' 字符，比原文省 ' + saved + ' 字符（' + pct + '%）');
  }

  function validateJSON() {
    var text = inputEl.value;
    if (!text.trim()) { statusEl.innerHTML = '<span class="faint">还没有输入内容</span>'; renderStats(undefined); return; }

    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      failStatus(e, text);
      renderStats(undefined);
      return;
    }

    /* 仅校验：不动输出区，但统计反映的是刚解析成功的内容 */
    renderStats(parsed, text.split('\n').length);
    okStatus(parsed);
  }

  /* ======================================================================
     五、复制 / 下载 / 上传
     ====================================================================== */

  function download() {
    if (!rawOutput) { T.util.toast('还没有可下载的内容'); return; }
    var ok = T.util.download('formatted.json', rawOutput, 'application/json;charset=utf-8');
    T.util.toast(ok ? '已开始下载' : '当前环境不支持下载');
  }

  function readFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      inputEl.value = String(ev.target.result || '');
      updateSize();
      formatJSON();
    };
    reader.onerror = function () { T.util.toast('文件读取失败'); };
    reader.readAsText(file);
  }

  function updateSize() {
    if (!sizeEl) return;
    var n = inputEl.value.length;
    sizeEl.textContent = n ? n.toLocaleString('zh-CN') + ' 字符' : '';
  }

  /* ======================================================================
     六、事件
     ====================================================================== */

  if (formatBtn) formatBtn.addEventListener('click', formatJSON);
  if (minifyBtn) minifyBtn.addEventListener('click', minifyJSON);
  if (validateBtn) validateBtn.addEventListener('click', validateJSON);
  if (downloadBtn) downloadBtn.addEventListener('click', download);

  if (uploadBtn && fileEl) {
    uploadBtn.addEventListener('click', function () { fileEl.click(); });
    fileEl.addEventListener('change', function (e) {
      readFile(e.target.files && e.target.files[0]);
      e.target.value = '';
    });
  }

  inputEl.addEventListener('input', updateSize);

  /* 粘贴后自动格式化 —— paste 事件早于 value 更新，所以要等一拍 */
  inputEl.addEventListener('paste', function () {
    setTimeout(function () { updateSize(); formatJSON(); }, 40);
  });

  /* Ctrl / Cmd + Enter 触发格式化 */
  inputEl.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      formatJSON();
    }
  });

  if (indentEl) {
    indentEl.addEventListener('change', function () {
      if (rawOutput) formatJSON();
    });
  }

  if (wrapEl) {
    wrapEl.addEventListener('change', function () { outputEl.className = viewClass(); });
  }

  if (demoBtn) {
    demoBtn.addEventListener('click', function () {
      inputEl.value = DEMO;
      updateSize();
      formatJSON();
      inputEl.focus();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      inputEl.value = '';
      updateSize();
      setEmpty();
      renderStats(undefined);
      statusEl.innerHTML = '';
      inputEl.focus();
    });
  }

  /* ======================================================================
     七、首屏
     ====================================================================== */

  updateSize();
  setEmpty();
  renderStats(undefined);
})();
