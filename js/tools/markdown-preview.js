/* ==========================================================================
   markdown-preview.js — Markdown 实时预览
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 markdown-preview（MIT），改动：
     1. 界面文案全量中文化
     2. 改用本站的设计系统与组件类名；预览复用 .md-preview
     3. 修复缺陷：localStorage 未包 try/catch。在禁用存储的浏览器环境里
        getItem 会抛 SecurityError，直接让整个脚本挂掉，编辑器也一起废掉。
     4. 修复按钮语义：上游的「Clear」实际是恢复默认示例而不是清空，
        标签与行为不符。这里拆成「清空」与「恢复示例」两个按钮。
     5. 新增文档大纲（点击跳转到预览中的对应标题）
     6. 新增统计面板（字符 / 标题 / 链接 / 图片 / 代码块 / 阅读时长）
     7. 重新渲染时保留预览的滚动位置，避免写作时被弹回顶部
     8. 复制 / 下载改用带降级的公共实现，并给出反馈
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var esc = T.util.esc;

  /* --- DOM --------------------------------------------------------------- */
  var inputEl   = document.getElementById('mp-input');
  var previewEl = document.getElementById('mp-preview');
  var outlineEl = document.getElementById('mp-outline');
  var outlineCountEl = document.getElementById('mp-outline-count');
  var statsEl   = document.getElementById('mp-stats');
  var sizeEl    = document.getElementById('mp-size');

  var copyMdBtn    = document.getElementById('mp-copy-md');
  var copyHtmlBtn  = document.getElementById('mp-copy-html');
  var downloadBtn  = document.getElementById('mp-download');
  var resetBtn     = document.getElementById('mp-reset');
  var clearBtn     = document.getElementById('mp-clear');

  if (!inputEl || !previewEl) return;

  /* --- 常量与状态 -------------------------------------------------------- */
  var STORAGE_KEY = 'toolbox-md-preview';

  /* HTML 里预置的示例，作为「恢复示例」的模板 */
  var DEMO = inputEl.value;
  var currentHTML = '';

  var HAS_MD = typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined';

  /* ======================================================================
     一、渲染
     ====================================================================== */

  function num(n) { return Number(n).toLocaleString('zh-CN'); }

  function stat(label, value) {
    return '<div class="stat">' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + value + '</div>' +
      '</div>';
  }

  function renderStats() {
    if (!statsEl) return;

    if (!HAS_MD || !currentHTML) {
      statsEl.innerHTML =
        stat('字符数', num(inputEl.value.length)) +
        stat('标题', '0') + stat('链接', '0') + stat('图片', '0') +
        stat('代码块', '0') + stat('阅读时长', '—');
      return;
    }

    statsEl.innerHTML =
      stat('字符数', num(inputEl.value.length)) +
      stat('标题', String(previewEl.querySelectorAll('h1,h2,h3,h4,h5,h6').length)) +
      stat('链接', String(previewEl.querySelectorAll('a[href]').length)) +
      stat('图片', String(previewEl.querySelectorAll('img').length)) +
      stat('代码块', String(previewEl.querySelectorAll('pre').length)) +
      stat('阅读时长', T.util.formatDuration(T.util.readingMinutes(previewEl.textContent)));
  }

  /**
   * 从渲染结果里抽出标题，生成可点击的大纲。
   * 顺便给每个标题补上 id，供跳转使用（marked 默认不加 id）。
   */
  function renderOutline() {
    if (!outlineEl) return;

    if (!HAS_MD || !currentHTML) {
      T.util.emptyHint(outlineEl, '还没有大纲', '文档里出现标题后，这里会列出可跳转的目录。', 'outline-empty');
      if (outlineCountEl) outlineCountEl.textContent = '0';
      return;
    }

    var hs = previewEl.querySelectorAll('h1,h2,h3,h4,h5,h6');
    var items = [];

    for (var i = 0; i < hs.length; i++) {
      var el = hs[i];
      var id = 'mp-h-' + i;
      el.id = id;
      items.push({
        id: id,
        level: Number(el.tagName.charAt(1)),
        text: el.textContent.trim() || '（无标题）'
      });
    }

    if (!items.length) {
      T.util.emptyHint(outlineEl, '还没有大纲', '文档里出现标题后，这里会列出可跳转的目录。', 'outline-empty');
    } else {
      outlineEl.innerHTML = items.map(function (it) {
        return '<button class="outline-item outline-item--l' + it.level + '" type="button" ' +
          'data-target="' + it.id + '" title="' + esc(it.text) + '">' +
          esc(it.text) + '</button>';
      }).join('');
    }

    if (outlineCountEl) outlineCountEl.textContent = String(items.length);
  }

  function render() {
    updateSize();

    if (!HAS_MD) return;

    var src = inputEl.value;

    if (!src.trim()) {
      currentHTML = '';
      T.util.emptyHint(previewEl, '还没有内容', '在左边写 Markdown，这里会实时渲染。', 'md-empty');
      renderOutline();
      renderStats();
      return;
    }

    var html;
    try {
      html = DOMPurify.sanitize(marked.parse(src));
    } catch (e) {
      T.util.emptyHint(previewEl, '渲染失败', e.message, 'md-empty');
      currentHTML = '';
      renderOutline();
      renderStats();
      return;
    }

    /* 换掉 innerHTML 会让滚动位置回到顶部，写作时体验很差，这里保留 */
    var keepTop = previewEl.scrollTop;
    currentHTML = html;
    previewEl.innerHTML = html;
    previewEl.scrollTop = keepTop;

    /* 注意：大纲锚点（id="mp-h-N"）只加在 DOM 上，不写回 currentHTML。
       「复制 HTML」给出去的是干净的语义 HTML，不带这些工具内部的 id。 */
    renderOutline();
    renderStats();
  }

  function updateSize() {
    if (!sizeEl) return;
    var n = inputEl.value.length;
    sizeEl.textContent = n ? num(n) + ' 字符' : '';
  }

  /* ======================================================================
     二、草稿
     ====================================================================== */

  var saveDraft = T.util.debounce(function () {
    try { localStorage.setItem(STORAGE_KEY, inputEl.value); } catch (e) {}
  }, 500);

  function dropDraft() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  /* ======================================================================
     三、下载
     ====================================================================== */

  function downloadHTML() {
    if (!currentHTML) { T.util.toast('还没有可下载的内容'); return; }
    try {
      var blob = new Blob([currentHTML], { type: 'text/html;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'preview.html';
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
     四、事件
     ====================================================================== */

  inputEl.addEventListener('input', function () {
    render();
    saveDraft();
  });

  /* 大纲跳转：用 getBoundingClientRect 算相对偏移，
     比 offsetTop 稳（.md-preview 不是定位元素，offsetParent 可能是 body） */
  if (outlineEl) {
    outlineEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-target]');
      if (!btn) return;
      var el = previewEl.querySelector('#' + btn.getAttribute('data-target'));
      if (!el) return;

      var r = el.getBoundingClientRect();
      var pr = previewEl.getBoundingClientRect();
      previewEl.scrollTop += (r.top - pr.top) - 8;
    });
  }

  if (copyMdBtn) {
    copyMdBtn.addEventListener('click', function () {
      if (!inputEl.value) return;
      T.util.copy(inputEl.value, copyMdBtn);
    });
  }

  if (copyHtmlBtn) {
    copyHtmlBtn.addEventListener('click', function () {
      if (!currentHTML) return;
      T.util.copy(currentHTML, copyHtmlBtn);
    });
  }

  if (downloadBtn) downloadBtn.addEventListener('click', downloadHTML);

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      inputEl.value = DEMO;
      render();
      saveDraft();
      inputEl.focus();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      inputEl.value = '';
      dropDraft();
      render();
      inputEl.focus();
    });
  }

  /* ======================================================================
     五、首屏
     ====================================================================== */

  if (!HAS_MD) {
    /* 内置库没加载出来时给出明确提示，而不是在第一次调用 marked 时才炸掉 */
    T.util.emptyHint(previewEl, 'Markdown 引擎未能加载',
      '请确认 js/vendor/marked.umd.js 与 js/vendor/purify.min.js 存在且完整，然后刷新页面。',
      'md-empty');
    renderStats();
    return;
  }

  /* breaks: true —— 单个换行也渲染成换行，与写作时所见一致。
     这一点与「Markdown 转 HTML」不同，那边用的是标准 CommonMark 行为。 */
  marked.setOptions({ gfm: true, breaks: true });

  /* 有草稿就恢复草稿，否则用 HTML 里预置的示例。
     localStorage 在禁用存储的环境会抛错，必须包起来，否则整个脚本都会挂掉。 */
  var saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  if (saved !== null) inputEl.value = saved;

  render();
})();
