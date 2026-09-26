/* ==========================================================================
   password-strength.js — 密码强度检测
   --------------------------------------------------------------------------
   【自研】上游 praticulus 有 password-generator，没有强度检测，所以这一份没有
   可移植对象，改动清单也就没有 —— 下面写清设计取舍。

   一、为什么不做「字符集 × 长度」
     那是**上界**，不是强度。`P@ssw0rd` 按它算有 52 比特、会被判成「强」，
     而它命中「password + 两处 l33t 替换」，实际只剩 4 比特。
     所以本工具把两个数**并排**给出来，让差距自己说话。

   二、估算模型放在 js/password-utils.js
     那一份是纯函数，只吃字符串、吐结构化结果（段落拆解 + 代价 + 发现），
     本文件只管把它画出来。这么分有两个原因：
       1. 模型里全是分支（词表、l33t、序列、重复、日期、动态规划），
          用 DOM 断言去覆盖每个分支非常别扭，抽成纯函数就能逐条测；
       2. 强度分档与爆破时间换算本来就要和密码生成器共用（同一份实现，
          否则「生成器说一般、检测说弱」）。

   三、页面上的三条硬约束
     1. **密码不进任何持久化**：不写 localStorage / sessionStorage、不进 URL、
        不写任何表单。这个页面没有草稿功能是有意的 —— 别的工具都有。
     2. **所有含密码文本的节点都用 textContent 建**，绝不拼 HTML 字符串。
        告警文案里会带用户密码的片段（「命中了 password」），拼串就是一个 XSS 口子。
     3. **「片段」这一列跟着显示 / 隐藏走**：密码遮着的时候，拆解表里的片段
        也要遮起来，否则等于把密码按段摊开摆给人看。

   四、有意不做的
     - **批量检测**：见页面说明区。强度检测的价值在解释，排成一张只有数字的表
       就只剩一个分数，而分数最容易被误读。
     - **不给「建议的新密码」**：那会把用户引向本工具造的密码，而这里没有
       密码学安全的随机源可用（那是生成器的事，用 crypto.getRandomValues）。
     - **不做与用户名 / 邮箱的相似度检查**：那需要知道用户名，属于另一个用途
       （注册流程里的强度提示），粘一个密码进来单独看，没有这个上下文。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;

  var listBox = document.getElementById('ps-findings');

  /**
   * 依赖缺失时**不要静默 return** —— 页面看起来正常、结果区一片空白，
   * 控制台只有一行 TypeError，光看页面完全看不出问题。
   */
  function bail(detail) {
    if (!listBox) return;
    var div = document.createElement('div');
    div.className = 'code-empty';
    var strong = document.createElement('strong');
    strong.textContent = '页面依赖的脚本没有加载成功';
    div.appendChild(strong);
    div.appendChild(document.createTextNode(
      detail + '请强制刷新（Ctrl+F5 / Cmd+Shift+R）后重试。'));
    listBox.textContent = '';
    listBox.appendChild(div);
  }

  if (!T || !T.util) { bail('js/registry.js 或 js/site.js 没有加载成功。'); return; }
  if (typeof T.util.debounce !== 'function') { bail('加载到的是旧版 js/site.js。'); return; }

  var P = T.password;
  if (!P) { bail('js/password-utils.js 没有加载成功。'); return; }

  /* --- 1. 取元素 --------------------------------------------------------- */

  var inputEl     = document.getElementById('ps-input');
  var revealBtn   = document.getElementById('ps-reveal');
  var strengthEl  = document.getElementById('ps-strength');
  var levelEl     = document.getElementById('ps-level');
  var verdictEl   = document.getElementById('ps-verdict');
  var classesEl   = document.getElementById('ps-classes');
  var statusEl    = document.getElementById('ps-status');
  var attacksEl   = document.getElementById('ps-attacks');
  var statsEl     = document.getElementById('ps-stats');
  var patternsEl  = document.getElementById('ps-patterns');
  var segCountEl  = document.getElementById('ps-seg-count');
  if (!inputEl || !strengthEl || !statsEl || !patternsEl) return;

  var demoBtn  = document.querySelector('[data-demo]');
  var clearBtn = document.querySelector('[data-clear]');

  var DEMO = 'P@ssw0rd2024';

  /* --- 2. 状态 ----------------------------------------------------------- */

  var revealed = false;   /* 「显示」开着的时候，拆解表里的片段也亮出来 */
  var model = null;       /* 最近一次的分析结果 */

  /* 词表：拿不到也能跑（词表相关的那几项会退化成「没查」并挂提示） */
  P.readWordlist();

  /* --- 3. 渲染 ----------------------------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   /* 一律 textContent：文案里带密码片段 */
    return n;
  }

  /** 遮住正文，按码点个数给圆点（不是按 UTF-16 长度，emoji 才不会被算成两个） */
  function mask(text) {
    var n = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length) i++;
      n++;
    }
    var out = '';
    for (var k = 0; k < n; k++) out += '•';
    return out;
  }

  /**
   * 文案里用 `反引号` 标代码片段、用 **双星号** 标强调。这里把它们拆成交替的
   * 文本 / <code> / <strong> 节点。
   *
   * **不能换成 innerHTML**：这些文案里带着用户密码的片段（「命中了 `password`」），
   * 拼 HTML 就是一个 XSS 口子。改成建节点之后，任何字符都只是文本。
   *
   * @param {boolean} [hideCode] 为真时把 <code> 里的内容换成圆点 ——
   *        「隐藏」开着的时候，密码片段不能在说明文案里露出来，否则那个开关就是假的。
   */
  function richText(parent, text, hideCode) {
    String(text == null ? '' : text).split('`').forEach(function (part, i) {
      if (!part) return;
      if (i % 2 === 1) {
        parent.appendChild(el('code', 'mono', hideCode ? mask(part) : part));
        return;
      }
      /* 反引号之外的部分再处理 **强调** */
      part.split('**').forEach(function (p, k) {
        if (!p) return;
        parent.appendChild(k % 2 === 1 ? el('strong', null, p) : document.createTextNode(p));
      });
    });
    return parent;
  }

  function setStatus(kind, text) {
    if (!statusEl) return;
    statusEl.textContent = '';
    if (!text) return;
    var span = el('span', kind ? 'is-' + kind : '', text);
    statusEl.appendChild(span);
  }

  function statGrid(items) {
    statsEl.textContent = '';
    items.forEach(function (it) {
      var cell = el('div', 'stat');
      cell.appendChild(el('div', 'stat-label', it.label));
      var v = el('div', 'stat-value' + (it.small ? ' stat-value--sm' : '') +
        (it.cls ? ' ' + it.cls : ''), it.value);
      cell.appendChild(v);
      statsEl.appendChild(cell);
    });
  }

  function paintEmpty() {
    strengthEl.setAttribute('data-level', '0');
    levelEl.textContent = '';
    if (verdictEl) verdictEl.textContent = '在上面输入一个密码，这里会立刻给出结论。';
    if (classesEl) classesEl.textContent = '';

    statGrid([
      { label: '长度', value: '—' },
      { label: '字符集大小', value: '—' },
      { label: '朴素上界', value: '—' },
      { label: '有效熵', value: '—' }
    ]);

    attacksEl.textContent = '';
    P.ATTACKS.forEach(function (a) {
      var row = el('div', 'value-row');
      row.appendChild(el('span', 'value-label', a.name));
      row.appendChild(el('span', 'value-text', '—'));
      attacksEl.appendChild(row);
    });

    if (segCountEl) segCountEl.textContent = '';
    patternsEl.textContent = '';
    T.util.emptyHint(patternsEl, '还没有内容',
      '输入一个密码，这里会列出它被拆成了哪几段、每段被认成了什么。', 'ps-empty');

    listBox.textContent = '';
    T.util.emptyHint(listBox, '还没有内容',
      '弱在哪里、可以怎么改，都会写在这里。', 'ps-empty');

    setStatus('', '输入不会离开本机 · 本页不保存草稿，刷新即消失');
  }

  function paintStrength(m) {
    strengthEl.setAttribute('data-level', String(m.level.level));
    levelEl.textContent = m.level.label;
    if (verdictEl) {
      verdictEl.textContent = m.level.note + '。按最省的拆法约 ' +
        m.bits.toFixed(1) + ' 比特' +
        (m.naiveBits - m.bits >= 4
          ? '，而「每个字符都独立随机」的算法会算成 ' + m.naiveBits.toFixed(1) + ' 比特。'
          : '。');
    }
  }

  function paintClasses(m) {
    if (!classesEl) return;
    if (!m.classes.length) { classesEl.textContent = ''; return; }
    var parts = m.classes.map(function (c) { return c.label + ' ×' + c.count; });
    classesEl.textContent = '字符构成：' + parts.join(' · ');
  }

  function paintStats(m) {
    statGrid([
      { label: '长度', value: String(m.length) + ' 位' },
      { label: '字符集大小', value: String(m.charset) + ' 种' },
      { label: '朴素上界', value: m.naiveBits.toFixed(1) + ' 比特', small: true },
      {
        label: '有效熵',
        value: m.bits.toFixed(1) + ' 比特',
        small: true,
        cls: m.level.level <= 1 ? 'stat-value--danger'
          : m.level.level === 2 ? 'stat-value--warn' : 'stat-value--ok'
      }
    ]);
  }

  function paintAttacks(m) {
    attacksEl.textContent = '';
    P.ATTACKS.forEach(function (a) {
      var row = el('div', 'value-row');
      row.appendChild(el('span', 'value-label', a.name));
      row.appendChild(el('span', 'value-text', P.crackTimeFromBits(m.bits, a.perSec)));
      attacksEl.appendChild(row);
    });
  }

  function paintPatterns(m) {
    if (segCountEl) {
      segCountEl.textContent = m.segments.length
        ? '共 ' + m.segments.length + ' 段' : '';
    }
    patternsEl.textContent = '';

    if (!m.segments.length) {
      T.util.emptyHint(patternsEl, '没有拆解结果',
        m.tooLong
          ? '输入超过 512 位，本轮只给了朴素估计，没有做模式化拆解。'
          : '没有可以展示的段落。', 'ps-empty');
      return;
    }

    var table = el('table', 'data-table');
    var thead = el('thead');
    var hrow = el('tr');
    ['片段', '判定', '代价', '说明'].forEach(function (h) {
      hrow.appendChild(el('th', null, h));
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = el('tbody');
    m.segments.forEach(function (s) {
      var tr = el('tr');
      var seg = el('td', 'ps-seg', revealed ? s.text : mask(s.text));
      /* 遮着的时候别给 title —— 悬停会把它泄出来 */
      if (revealed) seg.setAttribute('title', s.text);
      tr.appendChild(seg);
      tr.appendChild(el('td', null, s.kindLabel));
      tr.appendChild(el('td', 'ps-cost', s.bits.toFixed(1) + ' 比特'));
      tr.appendChild(richText(el('td'), s.note, !revealed));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    patternsEl.appendChild(table);
  }

  function paintFindings(m) {
    listBox.textContent = '';
    if (!m.warnings.length) {
      T.util.emptyHint(listBox, '没有特别要提醒的', '没命中已知模式，长度也够。', 'ps-empty');
      return;
    }
    m.warnings.forEach(function (w) {
      var box = el('div', 'ps-finding');
      box.setAttribute('data-level', w.level);
      box.appendChild(richText(el('p', 'ps-finding-title'), w.title, !revealed));
      box.appendChild(richText(el('p', 'ps-finding-text'), w.text, !revealed));
      listBox.appendChild(box);
    });
  }

  function render() {
    if (!model || model.empty) { paintEmpty(); return; }
    paintStrength(model);
    paintClasses(model);
    paintStats(model);
    paintAttacks(model);
    paintPatterns(model);
    paintFindings(model);
    setStatus(model.tooLong ? 'warn' : '', model.tooLong
      ? '输入超过 512 位，本轮只给了朴素估计（模式化拆解是平方级耗时）'
      : '输入不会离开本机 · 本页不保存草稿，刷新即消失');
  }

  function analyze() {
    model = P.estimate(inputEl.value);
    render();
  }

  var onInput = T.util.debounce(analyze, 150);

  /* --- 4. 事件 ----------------------------------------------------------- */

  inputEl.addEventListener('input', onInput);

  /* 显示 / 隐藏。文案换的是**动作**（「显示」↔「隐藏」），不是状态名，
     所以不用 aria-pressed —— 那个属性表示「按钮所指的东西处于开启状态」，
     配动作型文案会读成「隐藏，已按下」，反而绕。
     当前是遮着还是亮着，看输入框本身就知道了。 */
  function setRevealed(on) {
    revealed = on;
    inputEl.setAttribute('type', on ? 'text' : 'password');
    if (revealBtn) revealBtn.textContent = on ? '隐藏' : '显示';
    render();
  }

  if (revealBtn) {
    revealBtn.addEventListener('click', function () {
      setRevealed(!revealed);
      inputEl.focus();
    });
  }

  if (demoBtn) {
    demoBtn.addEventListener('click', function () {
      inputEl.value = DEMO;
      /* 示例是给人看的，顺手亮出来（用户自己的密码才默认遮着） */
      setRevealed(true);
      analyze();
      inputEl.focus();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      inputEl.value = '';
      model = null;
      paintEmpty();
      inputEl.focus();
    });
  }

  /* --- 5. 首屏 ----------------------------------------------------------- */

  model = null;
  paintEmpty();
})();
