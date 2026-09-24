/* ==========================================================================
   markdown-to-html.js — Markdown 转 HTML
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 markdown-to-html（MIT），改动：
     1. 界面文案全量中文化
     2. 改用本站的设计系统与组件类名；预览区改用 .md-preview 样式
     3. 移除 Prism 依赖（上游为此引入 prism.min.js 与上百个语言组件），
        改为内置的轻量 HTML 记号化着色
     4. localStorage 键名改为 toolbox-md2html，并在页面上明确告知
     5. 新增输出结构统计；行号视图改用 T.util.renderCode 公共实现
     6. 解析改为防抖执行
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var esc = T.util.esc;

  /* --- DOM --------------------------------------------------------------- */
  var inputEl   = document.getElementById('md-input');
  var codeEl    = document.getElementById('md-code');
  var previewEl = document.getElementById('md-preview');
  var htmlTextEl = document.getElementById('md-html-text');
  var statsEl   = document.getElementById('md-stats');
  var statusEl  = document.getElementById('md-status');
  var badgeEl   = document.getElementById('md-badge');
  var sizeEl    = document.getElementById('md-size');
  var twEl      = document.getElementById('md-tailwind');

  var tabCode    = document.getElementById('md-tab-code');
  var tabPreview = document.getElementById('md-tab-preview');
  var downloadBtn = document.getElementById('md-download');

  var demoBtn  = document.querySelector('[data-demo]');
  var clearBtn = document.querySelector('[data-clear]');

  if (!inputEl || !codeEl || !previewEl) return;

  /* --- 常量 -------------------------------------------------------------- */
  var STORAGE_KEY = 'toolbox-md2html';
  var MAX_LINES = 20000;
  var MAX_HIGHLIGHT = 200000;   /* 超过则不逐行着色 */

  /* 上游的 Tailwind 工具类映射，原样保留 */
  var TW = {
    H1: 'text-3xl font-bold mb-4', H2: 'text-2xl font-bold mt-6 mb-3', H3: 'text-xl font-semibold mt-4 mb-2',
    H4: 'text-lg font-semibold mt-4 mb-2', P: 'mb-4 leading-relaxed', A: 'text-blue-600 underline',
    UL: 'list-disc pl-6 mb-4', OL: 'list-decimal pl-6 mb-4', LI: 'mb-1',
    BLOCKQUOTE: 'border-l-4 border-gray-300 pl-4 italic my-4', PRE: 'bg-gray-100 rounded p-4 overflow-x-auto mb-4 text-sm',
    CODE: 'font-mono', TABLE: 'table-auto border-collapse my-4 w-full', THEAD: 'bg-gray-100',
    TH: 'border px-3 py-2 text-left', TD: 'border px-3 py-2', HR: 'my-6 border-gray-300', IMG: 'max-w-full h-auto'
  };

  /* --- 状态 -------------------------------------------------------------- */
  var view = 'code';
  var lastRaw = '';        /* 净化后的语义 HTML，预览始终用它 */
  var currentHTML = '';    /* 实际输出，可能含 Tailwind 类 */
  var DEMO = inputEl.value; /* HTML 里预置的示例，作为「载入示例」的模板 */

  var HAS_MD = typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined';

  /* ======================================================================
     一、HTML 着色（替代 Prism）
     ====================================================================== */

  /* 引号内的 > 不算标签结束，所以属性值要单独作为一支 */
  var RE_MARKUP = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/?[A-Za-z](?:"[^"]*"|'[^']*'|[^>"'])*>/g;

  function highlightHtml(src) {
    if (src.length > MAX_HIGHLIGHT) return esc(src);

    var out = '';
    var last = 0;
    var m;

    RE_MARKUP.lastIndex = 0;
    while ((m = RE_MARKUP.exec(src)) !== null) {
      out += esc(src.slice(last, m.index));
      out += highlightTag(m[0]);
      last = m.index + m[0].length;
    }
    out += esc(src.slice(last));
    return out;
  }

  function highlightTag(tag) {
    /* 注释 / CDATA / DOCTYPE。
       注意：marked 与 DOMPurify 都会剥离 HTML 注释，所以在本工具里这条分支
       实际不会命中；保留它是为了让这个着色函数本身对 HTML 是完整的，
       将来 XML 之类的工具可以直接复用。 */
    if (tag.charAt(1) === '!') return '<span class="tok-comment">' + esc(tag) + '</span>';

    var m = tag.match(/^(<\/?)([A-Za-z][\w:.-]*)([\s\S]*?)(\/?>)$/);
    if (!m) return esc(tag);

    var attrs = m[3].replace(
      /([^\s"'>/=]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>`]+)|([^\s"'>/=]+)/g,
      function (all, name, eq, val, bare) {
        if (bare !== undefined) return '<span class="tok-attr">' + esc(bare) + '</span>';
        return '<span class="tok-attr">' + esc(name) + '</span>' + esc(eq) +
               '<span class="tok-str">' + esc(val) + '</span>';
      }
    );

    return esc(m[1]) + '<span class="tok-tag">' + esc(m[2]) + '</span>' + attrs + esc(m[4]);
  }

  /* ======================================================================
     二、转换
     ====================================================================== */

  function addTailwind(html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = html;
    Array.prototype.forEach.call(tpl.content.querySelectorAll('*'), function (el) {
      var c = TW[el.tagName];
      if (c) el.className = el.className ? el.className + ' ' + c : c;
    });
    return tpl.innerHTML;
  }

  function analyzeHtml(html) {
    var doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); }
    catch (e) { return null; }
    if (!doc) return null;
    return {
      headings: doc.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
      links: doc.querySelectorAll('a[href]').length,
      codeBlocks: doc.querySelectorAll('pre').length,
      tables: doc.querySelectorAll('table').length
    };
  }

  /* ======================================================================
     三、渲染
     ====================================================================== */

  function stat(label, value) {
    return '<div class="stat">' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + value + '</div>' +
      '</div>';
  }

  function renderStats(html) {
    if (!statsEl) return;

    if (!html) {
      statsEl.innerHTML =
        stat('输入字符', '0') + stat('HTML 字符', '0') + stat('标题', '0') +
        stat('链接', '0') + stat('代码块', '0') + stat('表格', '0');
      return;
    }

    var a = analyzeHtml(html) || { headings: 0, links: 0, codeBlocks: 0, tables: 0 };
    statsEl.innerHTML =
      stat('输入字符', inputEl.value.length.toLocaleString('zh-CN')) +
      stat('HTML 字符', html.length.toLocaleString('zh-CN')) +
      stat('标题', String(a.headings)) +
      stat('链接', String(a.links)) +
      stat('代码块', String(a.codeBlocks)) +
      stat('表格', String(a.tables));
  }

  function renderCodeView() {
    if (!currentHTML) {
      T.util.emptyHint(codeEl, '还没有内容',
        '在左边写 Markdown，这里会实时生成 HTML；也可以点上面的「载入示例」看看效果。');
      return;
    }
    T.util.renderCode(codeEl, currentHTML, highlightHtml, { maxLines: MAX_LINES });
  }

  function paint() {
    if (view === 'preview') {
      codeEl.hidden = true;
      previewEl.hidden = false;
      previewEl.innerHTML = lastRaw;
    } else {
      previewEl.hidden = true;
      codeEl.hidden = false;
      renderCodeView();
    }

    if (tabCode) tabCode.setAttribute('aria-pressed', String(view === 'code'));
    if (tabPreview) tabPreview.setAttribute('aria-pressed', String(view === 'preview'));
  }

  function updateSize() {
    if (!sizeEl) return;
    var n = inputEl.value.length;
    sizeEl.textContent = n ? n.toLocaleString('zh-CN') + ' 字符' : '';
  }

  /* ======================================================================
     四、主流程
     ====================================================================== */

  var saveDraft = T.util.debounce(function () {
    try { localStorage.setItem(STORAGE_KEY, inputEl.value); } catch (e) {}
  }, 400);

  function build() {
    updateSize();
    if (!HAS_MD) return;

    var src = inputEl.value;

    if (!src.trim()) {
      lastRaw = '';
      currentHTML = '';
      if (htmlTextEl) htmlTextEl.textContent = '';
      if (badgeEl) { badgeEl.textContent = '—'; badgeEl.className = 'badge'; }
      statusEl.innerHTML = '';
      renderStats(null);
      paint();
      saveDraft();
      return;
    }

    var raw;
    try {
      raw = DOMPurify.sanitize(marked.parse(src));
    } catch (e) {
      statusEl.innerHTML = '<span class="is-error">转换失败：' + esc(e.message) + '</span>';
      return;
    }

    lastRaw = raw;
    currentHTML = (twEl && twEl.checked) ? addTailwind(raw) : raw;
    if (htmlTextEl) htmlTextEl.textContent = currentHTML;

    if (badgeEl) {
      badgeEl.textContent = (twEl && twEl.checked) ? '含 Tailwind 类' : '语义 HTML';
      badgeEl.className = 'badge badge--accent';
    }

    renderStats(currentHTML);

    var lines = currentHTML.split('\n').length;
    statusEl.innerHTML = '<span class="is-ok">✓ 已生成 HTML</span>' +
      '<span class="faint"> · ' + lines + ' 行 · ' +
      currentHTML.length.toLocaleString('zh-CN') + ' 字符</span>';

    paint();
    saveDraft();
  }

  var buildDebounced = T.util.debounce(build, 120);

  /* ======================================================================
     五、下载
     ====================================================================== */

  function download() {
    if (!currentHTML) { T.util.toast('还没有可下载的内容'); return; }
    try {
      var blob = new Blob([currentHTML], { type: 'text/html;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'converted.html';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      T.util.toast('已开始下载');
    } catch (e) {
      T.util.toast('当前环境不支持下载');
    }
  }

  /* ======================================================================
     六、事件
     ====================================================================== */

  inputEl.addEventListener('input', buildDebounced);

  if (twEl) twEl.addEventListener('change', build);

  if (tabCode) {
    tabCode.addEventListener('click', function () { view = 'code'; paint(); });
  }
  if (tabPreview) {
    tabPreview.addEventListener('click', function () { view = 'preview'; paint(); });
  }
  if (downloadBtn) downloadBtn.addEventListener('click', download);

  if (demoBtn) {
    demoBtn.addEventListener('click', function () {
      inputEl.value = DEMO;
      build();
      inputEl.focus();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      inputEl.value = '';
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      build();
      inputEl.focus();
    });
  }

  /* ======================================================================
     七、首屏
     ====================================================================== */

  if (!HAS_MD) {
    /* 内置库没加载出来（离线、被拦截、文件缺失）时给出明确提示，
       而不是在第一次调用 marked 时才炸掉 */
    statusEl.innerHTML = '<span class="is-error">Markdown 引擎未能加载</span>' +
      '<span class="err-raw">请确认 js/vendor/marked.umd.js 与 js/vendor/purify.min.js 存在且完整，然后刷新页面。</span>';
    codeEl.className = 'code-view code-view--wrap';
    T.util.emptyHint(codeEl, '引擎未加载', '本工具依赖仓库内的两个自托管库，请检查文件是否完整。');
    renderStats(null);
    return;
  }

  marked.setOptions({ gfm: true, breaks: false });

  /* 有草稿就恢复草稿，否则用 HTML 里预置的示例 */
  var saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  if (saved !== null) inputEl.value = saved;

  build();
})();
