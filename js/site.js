/* ==========================================================================
   site.js — 站点运行时
   依赖 registry.js（需先加载）。职责：
     1. 主题切换与持久化
     2. 导航当前页高亮
     3. 首页 / 分类页的工具卡片渲染与筛选
     4. 全局搜索面板（/ 或 Ctrl+K）
     5. 工具页通用能力（相关工具、通用复制按钮）
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) { console.warn('[site] registry.js 未加载'); return; }

  /* --- 0. 基础工具 ------------------------------------------------------- */

  /* 站点根路径：由 site.js 自身的 src 推导，兼容任意目录深度与 file:// */
  function resolveRoot() {
    var el = document.querySelector('script[src*="js/site.js"]');
    var src = el ? (el.getAttribute('src') || '') : '';
    var i = src.indexOf('js/site.js');
    return i >= 0 ? src.slice(0, i) : '/';
  }
  var ROOT = resolveRoot();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function normPath(p) {
    p = String(p).replace(/index\.html$/, '');
    if (p.charAt(p.length - 1) !== '/') p += '/';
    return p;
  }

  function debounce(fn, ms) {
    var id;
    return function () {
      var args = arguments, self = this;
      clearTimeout(id);
      id = setTimeout(function () { fn.apply(self, args); }, ms || 120);
    };
  }

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  /* --- 1. 主题 ----------------------------------------------------------- */
  function initTheme() {
    var btn = $('.theme-toggle');
    if (!btn) return;

    function current() {
      var set = document.documentElement.getAttribute('data-theme');
      if (set === 'dark' || set === 'light') return set;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    function sync() {
      var next = current() === 'dark' ? '切换到浅色主题' : '切换到深色主题';
      btn.setAttribute('aria-label', next);
      btn.setAttribute('title', next);
    }
    btn.addEventListener('click', function () {
      var mode = current() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', mode);
      try { localStorage.setItem('toolbox-theme', mode); } catch (e) {}
      sync();
    });
    sync();
  }

  /* --- 2. 导航高亮 ------------------------------------------------------- */
  function initNav() {
    var here = normPath(location.pathname);
    var hubId = document.body.getAttribute('data-hub');
    $$('.site-nav a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var target;
      try { target = normPath(new URL(href, location.href).pathname); }
      catch (e) { return; }

      var isSelf = target === here;
      var isHub = hubId && href.indexOf('/hubs/' + hubId + '/') >= 0;
      if (isSelf || isHub) a.setAttribute('aria-current', 'page');
    });
  }

  /* --- 3. 卡片渲染 ------------------------------------------------------- */
  function toolCard(t) {
    var hub = T.hubMap[t.hub];
    var accent = hub ? hub.accent : '#2f6bff';
    var ready = t.status === 'ready';
    /* 非上线状态共用一个卡片样式，只有徽章文案与提示不同 */
    var mod = t.status === 'suspended' ? 'suspended' : 'planned';
    var tip = t.status === 'suspended' ? '该工具已挂起，暂不实现' : '该工具尚未实现';

    var top =
      '<div class="tool-card-top">' +
        '<span class="tool-card-icon">' + T.svg(hub ? hub.icon : 'bolt') + '</span>' +
        '<span class="tool-card-name">' + esc(t.name) + '</span>' +
        '<span class="tool-card-hub">' + esc(hub ? hub.name : '') + '</span>' +
      '</div>';

    var body =
      '<p class="tool-card-desc">' + esc(t.desc) + '</p>';

    var foot =
      '<div class="tool-card-foot">' +
        '<span class="badge badge--' + (ready ? 'ready' : mod) + '">' +
          esc(t.statusLabel) +
        '</span>' +
        '<span class="tool-card-tags">' + t.tags.slice(0, 2).map(esc).join(' · ') + '</span>' +
      '</div>';

    if (ready) {
      return '<a class="tool-card" href="' + ROOT + t.path + '" style="--hub-accent:' + accent + '">' +
             top + body + foot + '</a>';
    }
    return '<div class="tool-card tool-card--' + mod + '" style="--hub-accent:' + accent + '" ' +
           'title="' + tip + '">' + top + body + foot + '</div>';
  }

  /** 按状态统计数量，供首页与分类页的筛选胶囊使用 */
  function countByStatus(list) {
    var out = { all: list.length, ready: 0, planned: 0, suspended: 0 };
    list.forEach(function (t) {
      if (out[t.status] != null) out[t.status]++;
    });
    return out;
  }

  /** 给筛选胶囊绑定计数与点击 */
  function bindChips(scope, all, paint) {
    var chips = $$('.chip[data-filter]', scope || document);
    var counts = countByStatus(all);

    $$('[data-count]', scope || document).forEach(function (el) {
      var key = el.getAttribute('data-count');
      if (counts[key] != null) el.textContent = counts[key];
    });

    chips.forEach(function (c) {
      var n = counts[c.getAttribute('data-filter')];
      var slot = c.querySelector('[data-chip-count]');
      if (slot && n != null) slot.textContent = n;
      c.addEventListener('click', function () {
        var filter = c.getAttribute('data-filter');
        paint(filter === 'all' ? all : all.filter(function (t) { return t.status === filter; }));
        chips.forEach(function (x) {
          x.setAttribute('aria-pressed', String(x === c));
        });
      });
    });
  }

  function renderGrid(box, list) {
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<div class="empty-state" style="grid-column:1/-1">' +
        '<strong>这里还没有工具</strong>' +
        '按 <code class="mono">tools/_template/</code> 的结构新建目录，' +
        '再到 <code class="mono">js/registry.js</code> 里加一行即可。</div>';
      return;
    }
    box.innerHTML = list.map(toolCard).join('');
  }

  function renderHubs(box) {
    if (!box) return;
    box.innerHTML = T.hubs.map(function (h) {
      return '<a class="hub-card" href="' + ROOT + 'hubs/' + h.id + '/" style="--hub-accent:' + h.accent + '">' +
        '<div class="hub-card-head">' +
          '<span class="hub-card-icon">' + T.svg(h.icon) + '</span>' +
          '<span class="hub-card-title">' +
            '<span class="hub-card-name">' + esc(h.name) + '</span>' +
            '<span class="hub-card-count">' + h.totalCount + ' 个工具 · ' + h.readyCount + ' 已上线</span>' +
          '</span>' +
        '</div>' +
        '<p class="hub-card-desc">' + esc(h.desc) + '</p>' +
        '<div class="hub-card-tags">' +
          h.tags.map(function (tag) { return '<span class="hub-tag">' + esc(tag) + '</span>'; }).join('') +
        '</div>' +
      '</a>';
    }).join('');
  }

  /* --- 4. 首页 ----------------------------------------------------------- */
  /* hero 里「分类数」「会联网」不是工具状态计数，data-count 那套（见 bindChips）
     只认 ready / planned / suspended，所以单列一支。值一律从 registry 算，
     不在 HTML 里写死 —— 之前「网络请求 0」就是这么过期的。 */
  function paintStats() {
    $$('[data-stat]').forEach(function (el) {
      var key = el.getAttribute('data-stat');
      if (key === 'hubs') el.textContent = String(T.hubs.length);
      else if (key === 'online') el.textContent = String(T.onlineTools().length);
    });
  }

  function initHome() {
    renderHubs($('#hub-grid'));
    paintStats();

    var box = $('#tool-grid');
    if (!box) return;

    var all = T.sortByHot(T.tools);
    bindChips(null, all, function (list) { renderGrid(box, list); });
    renderGrid(box, all);
  }

  /* --- 5. 分类页 --------------------------------------------------------- */
  function initHub() {
    var id = document.body.getAttribute('data-hub');
    if (!id) return;
    var hub = T.hubMap[id];
    if (!hub) return;

    document.documentElement.style.setProperty('--hub-accent', hub.accent);
    $$('[data-hub-icon]').forEach(function (el) { el.innerHTML = T.svg(hub.icon); });

    var box = $('#tool-grid');
    if (!box) return;

    var all = T.sortByHot(hub.tools);
    bindChips(null, all, function (list) { renderGrid(box, list); });
    renderGrid(box, all);
  }

  /* --- 6. 搜索 ----------------------------------------------------------- */
  function initSearch() {
    var overlay = document.createElement('div');
    overlay.className = 'search-overlay';
    overlay.setAttribute('data-open', 'false');
    overlay.innerHTML =
      '<div class="search-panel" role="dialog" aria-modal="true" aria-label="搜索工具">' +
        '<div class="search-input-row">' +
          T.svg('search') +
          '<input class="search-input" type="text" placeholder="搜索工具、分类或标签…" ' +
                 'autocomplete="off" spellcheck="false" aria-label="搜索关键词">' +
          '<button class="btn btn--ghost btn--sm" data-search-close type="button">Esc</button>' +
        '</div>' +
        '<ul class="search-results" role="listbox" aria-label="搜索结果"></ul>' +
        '<div class="search-foot">' +
          '<span><span class="kbd">↑</span><span class="kbd">↓</span> 选择</span>' +
          '<span><span class="kbd">↵</span> 打开</span>' +
          '<span><span class="kbd">Esc</span> 关闭</span>' +
        '</div>' +
      '</div>';

    var input = $('.search-input', overlay);
    var listBox = $('.search-results', overlay);
    var items = [];
    var active = 0;

    document.body.appendChild(overlay);

    function open() {
      overlay.setAttribute('data-open', 'true');
      input.value = '';
      render('');
      input.focus();
    }
    function close() {
      overlay.setAttribute('data-open', 'false');
    }
    function isOpen() { return overlay.getAttribute('data-open') === 'true'; }

    function score(t, q) {
      var name = t.name.toLowerCase();
      var slug = t.slug.toLowerCase();
      var desc = t.desc.toLowerCase();
      var hub = (T.hubMap[t.hub] ? T.hubMap[t.hub].name : '').toLowerCase();
      var tags = t.tags.join(' ').toLowerCase();

      if (name === q) return 100;
      if (name.indexOf(q) === 0) return 90;
      if (name.indexOf(q) > -1) return 78;
      if (slug.indexOf(q) > -1) return 70;
      if (tags.indexOf(q) > -1) return 60;
      if (hub.indexOf(q) > -1) return 50;
      if (desc.indexOf(q) > -1) return 40;
      /* 逐字模糊匹配 */
      var i = 0;
      for (var c = 0; c < q.length; c++) {
        i = name.indexOf(q.charAt(c), i);
        if (i < 0) return 0;
        i++;
      }
      return 20;
    }

    function render(q) {
      q = q.trim().toLowerCase();
      var pool = T.tools.slice();
      var result = q
        ? pool.map(function (t) { return { t: t, s: score(t, q) }; })
              .filter(function (r) { return r.s > 0; })
              .sort(function (a, b) { return b.s - a.s || b.t.hot - a.t.hot; })
              .slice(0, 24)
              .map(function (r) { return r.t; })
        : T.sortByHot(pool).slice(0, 12);

      if (!result.length) {
        listBox.innerHTML = '<li class="search-empty">没有匹配的工具<br>' +
          '换个关键词试试，或到 <a href="' + ROOT + 'about/">关于</a> 页面提建议。</li>';
        items = [];
        return;
      }

      listBox.innerHTML = result.map(function (t, i) {
        var hub = T.hubMap[t.hub];
        var ready = t.status === 'ready';
        return '<li class="search-item" role="option" data-index="' + i + '" ' +
               'data-href="' + (ready ? ROOT + t.path : ROOT + 'hubs/' + t.hub + '/') + '" ' +
               'style="--hub-accent:' + (hub ? hub.accent : '#2f6bff') + '" ' +
               'data-active="' + (i === active) + '">' +
          '<span class="search-item-icon">' + T.svg(hub ? hub.icon : 'bolt') + '</span>' +
          '<span class="search-item-body">' +
            '<span class="search-item-name">' + esc(t.name) +
              (ready ? '' : ' <span class="badge badge--planned">规划中</span>') +
            '</span>' +
            '<span class="search-item-desc">' + esc(t.desc) + '</span>' +
          '</span>' +
          '<span class="search-item-hub">' + esc(hub ? hub.name : '') + '</span>' +
        '</li>';
      }).join('');

      items = $$('.search-item', listBox);
      active = 0;
      syncActive();
    }

    function syncActive() {
      items.forEach(function (el, i) {
        el.setAttribute('data-active', String(i === active));
      });
      var cur = items[active];
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }

    function go(i) {
      var el = items[i];
      if (!el) return;
      var href = el.getAttribute('data-href');
      if (href) location.href = href;
    }

    input.addEventListener('input', debounce(function () { render(input.value); }, 90));
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items.length) { active = (active + 1) % items.length; syncActive(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) { active = (active - 1 + items.length) % items.length; syncActive(); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        go(active);
      }
    });

    listBox.addEventListener('mousemove', function (e) {
      var el = e.target.closest('.search-item');
      if (!el) return;
      var i = Number(el.getAttribute('data-index'));
      if (i !== active) { active = i; syncActive(); }
    });
    listBox.addEventListener('click', function (e) {
      var el = e.target.closest('.search-item');
      if (el) go(Number(el.getAttribute('data-index')));
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('[data-search-close]')) close();
    });

    /* 触发器 */
    $$('.search-trigger, [data-open-search]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); open(); });
    });

    /* 全局快捷键 */
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

      if (isOpen()) {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        return;
      }
      if (e.key === 'Escape') return;

      var cmdK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
      var slash = e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (cmdK || slash) { e.preventDefault(); open(); }
    });
  }

  /* --- 7. 工具页通用 ----------------------------------------------------- */
  function initToolPage() {
    var slug = document.body.getAttribute('data-tool');
    if (!slug) return;

    var tool = T.tools.filter(function (t) { return t.slug === slug; })[0];
    if (!tool) {
      /* 未在 registry 中注册的页面（例如模板页）：不显示「相关工具」 */
      var rel = $('#related-grid');
      if (rel && rel.closest('.related')) rel.closest('.related').remove();
      return;
    }

    var hub = T.hubMap[tool.hub];
    if (hub) {
      document.documentElement.style.setProperty('--hub-accent', hub.accent);
      $$('[data-hub-icon]').forEach(function (el) { el.innerHTML = T.svg(hub.icon); });
    }

    /* 相关工具：同分类，排除自身，最多 3 个 */
    var box = $('#related-grid');
    if (box) {
      var related = T.sortByHot(tool.hub === null ? [] : T.tools.filter(function (t) {
        return t.hub === tool.hub && t.slug !== slug;
      })).slice(0, 3);
      if (related.length) {
        renderGrid(box, related);
      } else {
        var section = box.closest('.related');
        if (section) section.remove();
      }
    }
  }

  /* --- 8. 通用复制按钮 --------------------------------------------------- */
  function copyText(text, btn) {
    function done() {
      if (!btn) return;

      /* 纯文字按钮直接换文案；带子元素的只加状态属性，
         免得 textContent 把内部的图标或结构化内容覆盖掉 */
      if (!btn.children.length) {
        var old = btn.getAttribute('data-label') || btn.textContent;
        btn.setAttribute('data-label', old);
        btn.textContent = '已复制';
        setTimeout(function () { btn.textContent = old; }, 1400);
      }

      btn.setAttribute('data-copied', 'true');
      clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(function () {
        btn.removeAttribute('data-copied');
      }, 1400);
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function initCopy() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-copy-target]');
      if (!btn) return;
      var src = document.querySelector(btn.getAttribute('data-copy-target'));
      if (!src) return;
      var isField = src.tagName === 'INPUT' || src.tagName === 'TEXTAREA';
      var text = isField ? src.value : (src.textContent || '');
      if (!text) return;
      copyText(text, btn);
    });
  }

  /* --- 9. 轻提示 --------------------------------------------------------- */
  var toastTimer = null;

  function toast(message) {
    var el = document.querySelector('.toast');
    if (el) el.remove();
    clearTimeout(toastTimer);

    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = message == null ? '已复制' : String(message);
    document.body.appendChild(el);

    /* requestAnimationFrame 在部分环境（如 jsdom）不存在，退化为定时器 */
    var raf = window.requestAnimationFrame ||
      function (fn) { return setTimeout(fn, 16); };
    raf(function () { el.classList.add('toast--visible'); });
    toastTimer = setTimeout(function () {
      el.classList.remove('toast--visible');
      setTimeout(function () { el.remove(); }, 260);
    }, 1800);
  }

  /* --- 10. 代码视图（各工具共用） ---------------------------------------- */

  /**
   * 把文本渲染成带行号的代码视图。
   * @param {HTMLElement} box   容器，需带 .code-view 类
   * @param {string} text       要显示的文本
   * @param {Function} [highlight] 逐行着色函数 (line) => html；省略则只转义
   * @param {object} [opts]     { maxLines: 20000 } 超过则不渲染行号，避免卡顿
   * @returns {number} 行数
   */
  function renderCode(box, text, highlight, opts) {
    opts = opts || {};
    var maxLines = opts.maxLines || 20000;
    var lines = String(text == null ? '' : text).split('\n');

    if (lines.length > maxLines) {
      box.textContent = text;
      return lines.length;
    }

    var html = '';
    for (var i = 0; i < lines.length; i++) {
      html += '<div class="code-line">' +
        '<span class="code-line-num">' + (i + 1) + '</span>' +
        '<span class="code-line-body">' +
          (highlight ? highlight(lines[i]) : esc(lines[i])) +
        '</span></div>';
    }
    box.innerHTML = html;
    return lines.length;
  }

  /* --- 10b. JSON 语法高亮（JSON 格式化 / JWT 解码共用） ------------------ */

  /* 单遍扫描：按出现顺序识别 字符串 / 数字 / 字面量，中间的空白与括号原样转义输出。
     这样不会出现「已经插入的 HTML 被后续正则再次匹配」的问题，
     也不会把字符串里的数字当成数字（见 json-formatter 的踩坑记录）。
     顺序不能变：字符串优先。 */
  var RE_JSON_TOKEN = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;

  /**
   * 把一行 JSON 渲染成带 .tok-* 着色的 HTML。
   * 逐行调用即可配 renderCode：JSON.stringify 出来的字符串不会跨行。
   * @param {string} line
   * @returns {string} HTML
   */
  function highlightJson(line) {
    var out = '';
    var last = 0;
    var m;

    RE_JSON_TOKEN.lastIndex = 0;
    while ((m = RE_JSON_TOKEN.exec(line)) !== null) {
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

  /**
   * 在容器里显示一条空状态提示。
   * @param {HTMLElement} box
   * @param {string} title
   * @param {string} desc
   * @param {string} [cls] 容器样式类，默认 'code-empty'；
   *                       其余可选：table-empty / outline-empty / md-empty
   */
  function emptyHint(box, title, desc, cls) {
    box.innerHTML = '<div class="' + (cls || 'code-empty') + '">' +
      '<strong>' + esc(title) + '</strong>' + esc(desc) + '</div>';
  }

  /**
   * 往 `.tool-status` 那一行里写状态，带语义色。
   *
   * **语义色的类必须挂在子 `<span>` 上** —— `css/tool.css` 里写的是
   * `.tool-status .is-error` 这个**后代**选择器，写成
   * `el.className = 'tool-status is-error'`（同一个元素）一点都吃不到：
   * 文案还是灰的、加粗也没有，而 `classList.contains('is-error')` 的断言
   * 照样是绿的，只有看截图才发现。
   *
   * 用建节点而不是 innerHTML：状态文案里经常带用户输入的片段
   * （「第 16 个字符」「命中了 xxx」），拼 HTML 就是一个口子。
   *
   * @param {Element} el    `.tool-status` 容器
   * @param {string} level  '' | 'ok' | 'error' | 'warn'
   * @param {string} text   文案；空串表示清空
   */
  function setStatus(el, level, text) {
    if (!el) return;
    el.textContent = '';
    if (!text) return;
    if (!level) { el.textContent = text; return; }
    var span = document.createElement('span');
    span.className = 'is-' + level;
    span.textContent = text;
    el.appendChild(span);
  }

  /* --- 11. 阅读时长估算（字数统计 / Markdown 预览共用） ------------------ */

  /* 中日韩统一表意文字 + 扩展A + 兼容表意文字 + 日文假名 + 韩文谚文 */
  var RE_CJK_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/g;
  /* 英文单词：字母数字串，允许词内撇号与连字符 */
  var RE_LATIN_WORD = /[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g;

  /** 按中文 400 字/分、英文 220 词/分估算阅读分钟数 */
  function readingMinutes(text) {
    var s = String(text == null ? '' : text);
    var cjk = (s.match(RE_CJK_CHAR) || []).length;
    var words = (s.match(RE_LATIN_WORD) || []).length;
    return cjk / 400 + words / 220;
  }

  /** 把分钟数格式化成「N 秒」/「M 分 S 秒」/「M 分钟」 */
  function formatDuration(minutes) {
    if (!minutes || minutes < 1 / 60) return '—';
    var sec = Math.max(1, Math.round(minutes * 60));
    if (sec < 60) return sec + ' 秒';
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return s ? m + ' 分 ' + s + ' 秒' : m + ' 分钟';
  }

  /* --- 12. 受限整数输入 -------------------------------------------------- */

  /**
   * 读一个带上下限的整数输入框的值（随机字符串 / 密码生成器共用）。
   *
   * 非法（空、非数字、小数、越界）时给输入框加上 `.input--invalid` 标红，
   * 并返回**就近的合法值** —— 这样调用方的渲染逻辑不会因为输入非法而崩。
   * 调用方在 `blur` 时把返回值写回输入框、再移除标红即可。
   *
   * @param {HTMLInputElement} el
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function readInt(el, min, max) {
    var raw = String(el.value).trim();
    var n = Number(raw);
    var valid = raw !== '' && isFinite(n) && n === Math.floor(n) && n >= min && n <= max;
    el.classList.toggle('input--invalid', !valid);
    if (valid) return n;
    if (raw === '' || !isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  /* --- 13. 文本下载 ------------------------------------------------------ */

  /**
   * 触发一次文本下载（CSV 查看器 / JSON 格式化 / 占位文本生成共用）。
   *
   * 用 Blob + createObjectURL 而不是 data: URL —— 长文本的 data: URL 会非常长，
   * 部分浏览器对长度有限制。用完立刻 revoke，避免内存泄漏。
   *
   * @param {string} filename 下载文件名
   * @param {string} text     文件内容
   * @param {string} [mime]   默认 text/plain;charset=utf-8
   * @returns {boolean} 是否成功触发；环境不支持时返回 false，由调用方给提示
   */
  function download(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* --- 14. 杂项 ---------------------------------------------------------- */
  function initMisc() {
    var y = String(new Date().getFullYear());
    $$('[data-year]').forEach(function (el) { el.textContent = y; });
  }

  /* --- 启动 -------------------------------------------------------------- */
  var booted = false;
  function boot() {
    if (booted) return;   /* 幂等：避免 DOMContentLoaded 被触发多次时重复注入 UI */
    booted = true;

    initTheme();
    initNav();
    initHome();
    initHub();
    initToolPage();
    initSearch();
    initCopy();
    initMisc();
  }

  /* 对外暴露给各工具的公共方法 */
  T.util = {
    root: ROOT,
    esc: esc,
    debounce: debounce,
    copy: copyText,
    toast: toast,
    renderCode: renderCode,
    highlightJson: highlightJson,
    emptyHint: emptyHint,
    setStatus: setStatus,
    readingMinutes: readingMinutes,
    formatDuration: formatDuration,
    readInt: readInt,
    download: download,
    $: $,
    $$: $$
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
