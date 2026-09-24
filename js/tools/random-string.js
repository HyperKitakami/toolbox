/* ==========================================================================
   random-string.js — 随机字符串生成
   --------------------------------------------------------------------------
   自研工具：参考仓库 jamalofski/praticulus 里没有对应实现。

   与「密码生成器」的分工：这里只做「按字符集与长度取随机串」这一件事，
   面向 ID / token / 盐值 / 测试数据；密码强度评估、口令短语那些交给密码生成器。

   实现要点（也是与常见写法的差别）：

   1. 随机源与取样方式走 `js/random-utils.js`（`window.TOOLBOX.random`）——
      拒绝采样、crypto 可用性判断、字符集定义都在那里统一维护，本文件不再自己实现。
   2. 熵值按**真实取样方式**算：勾了「首字符必须是字母」时第一位只从字母里取，
      所以是 log2(字母数) + (长度-1) × log2(字符集大小)，而不是 长度 × log2(字符集大小)。
   3. 拿不到 crypto.getRandomValues 时**明确报错**，不退回 Math.random。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;

  /**
   * 依赖缺失时**不要静默 return** —— 结果区一片空白，光看页面完全看不出哪里坏了。
   * 这种情形几乎都是「浏览器拿到了旧资源」（缓存里是旧版 site.js，或缺 random-utils.js），
   * 所以提示里直接给出强制刷新的办法。资源引用带的 ?v= 版本号能避免再次发生。
   */
  function bail(detail) {
    var box = document.getElementById('rs-list');
    if (!box) return;
    var div = document.createElement('div');
    div.className = 'code-empty';
    var strong = document.createElement('strong');
    strong.textContent = '页面依赖的脚本没有加载成功';
    div.appendChild(strong);
    div.appendChild(document.createTextNode(
      detail + '请强制刷新（Ctrl+F5 / Cmd+Shift+R）后重试。'));
    box.textContent = '';
    box.appendChild(div);
  }

  if (!T || !T.util) {
    bail('js/registry.js 或 js/site.js 没有加载成功。');
    return;
  }
  if (typeof T.util.readInt !== 'function') {
    bail('加载到的是旧版 js/site.js。');
    return;
  }

  var R = T.random;
  if (!R) {
    bail('js/random-utils.js 没有加载成功。');
    return;
  }

  /* --- 1. 常量 ----------------------------------------------------------- */

  var C = R.CHARSETS;

  var PRESETS = [
    { id: 'alnum',  name: '大小写字母 + 数字', chars: C.upper + C.lower + C.digits },
    { id: 'lower',  name: '小写字母 + 数字',   chars: C.lower + C.digits },
    { id: 'hex',    name: '十六进制',          chars: C.digits + 'abcdef' },
    { id: 'b64url', name: 'Base64 URL 安全',   chars: C.upper + C.lower + C.digits + '-_' },
    { id: 'full',   name: '全部可见字符',      chars: C.upper + C.lower + C.digits + C.symbols },
    { id: 'custom', name: '自定义',            chars: null }
  ];
  var PRESET_MAP = {};
  PRESETS.forEach(function (p) { PRESET_MAP[p.id] = p; });

  var LENGTH_CHIPS = [8, 16, 24, 32, 48, 64, 128];

  var MIN_LENGTH = 1,   MAX_LENGTH = 512;
  var MIN_COUNT  = 1,   MAX_COUNT  = 200;

  /* --- 2. 取元素 --------------------------------------------------------- */

  var presetBox      = document.getElementById('rs-presets');
  var customWrap     = document.getElementById('rs-custom-wrap');
  var charsetInput   = document.getElementById('rs-charset');
  var charsetPreview = document.getElementById('rs-charset-preview');
  var charsetSizeEl  = document.getElementById('rs-charset-size');
  var lengthChipBox  = document.getElementById('rs-length-chips');
  var lengthInput    = document.getElementById('rs-length');
  var countInput     = document.getElementById('rs-count');
  var ambiguousEl    = document.getElementById('rs-exclude-ambiguous');
  var firstLetterEl  = document.getElementById('rs-first-letter');
  var listEl         = document.getElementById('rs-list');
  var statsEl        = document.getElementById('rs-stats');
  var statusEl       = document.getElementById('rs-status');
  var regenBtn       = document.getElementById('rs-regenerate');
  var copyAllBtn     = document.getElementById('rs-copy-all');
  if (!presetBox || !listEl || !lengthInput || !countInput) return;

  var state = { preset: 'alnum', items: [] };

  /* --- 3. 字符集 --------------------------------------------------------- */

  /**
   * 拼出实际使用的字符集：预设或自定义 -> 去重 -> 去掉空白 -> 排除易混字符。
   * @returns {string[]} 去重后的字符数组，保持首次出现的顺序
   */
  function buildCharset() {
    var base = state.preset === 'custom'
      ? charsetInput.value
      : PRESET_MAP[state.preset].chars;

    var set = R.normalizeCharset(base);
    if (ambiguousEl && ambiguousEl.checked) set = R.filterAmbiguous(set);
    return set.split('');
  }

  function lettersOf(charset) {
    return charset.filter(function (c) { return /[A-Za-z]/.test(c); });
  }

  /** 生成一条随机串 */
  function generateOne(charset, length, letters, firstLetter) {
    var set = charset.join('');
    var chars = R.chars(set, length).split('');

    /* 首字符限定为字母：第一位改从字母里取。字符集里没有字母时这项无法满足，
       状态行会给出提示，这里不静默改写用户的其他设置。 */
    if (firstLetter && letters.length) chars[0] = R.pick(letters);

    return chars.join('');
  }

  /** 按真实取样方式估算单条串的熵（比特） */
  function entropyBits(length, size, letterCount, firstLetter) {
    var perChar = R.entropyPerChar(size);
    if (!firstLetter || !letterCount) return length * perChar;
    return R.entropyPerChar(letterCount) + (length - 1) * perChar;
  }

  /* --- 4. 数值输入 ------------------------------------------------------- */

  /** 失焦时把非法的数值写回成合法值并清掉标红（读数逻辑在 T.util.readInt） */
  function commitNumber(el, min, max) {
    if (!el.classList.contains('input--invalid')) return;
    el.value = String(T.util.readInt(el, min, max));
    el.classList.remove('input--invalid');
    update();
  }

  /* --- 5. 渲染 ----------------------------------------------------------- */

  function stat(label, value, cls) {
    return '<div class="stat">' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value ' + (cls || '') + '">' + value + '</div>' +
      '</div>';
  }

  function renderPresets() {
    presetBox.innerHTML = PRESETS.map(function (p) {
      return '<button class="choice-chip" type="button" data-preset="' + p.id + '" ' +
        'aria-pressed="' + (p.id === state.preset) + '">' + T.util.esc(p.name) + '</button>';
    }).join('');
  }

  function renderLengthChips() {
    if (!lengthChipBox) return;
    lengthChipBox.innerHTML = LENGTH_CHIPS.map(function (n) {
      return '<button class="choice-chip" type="button" data-length="' + n + '" ' +
        'aria-pressed="false">' + n + '</button>';
    }).join('');
  }

  function syncPresets() {
    T.util.$$('.choice-chip', presetBox).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-preset') === state.preset));
    });
    if (customWrap) customWrap.hidden = state.preset !== 'custom';
  }

  function syncLengthChips(length) {
    if (!lengthChipBox) return;
    T.util.$$('.choice-chip', lengthChipBox).forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-length')) === length));
    });
  }

  function renderList(items) {
    listEl.innerHTML = items.map(function (s, i) {
      var id = 'rs-item-' + i;
      /* 每行是一个按钮，data-copy-target 指向自己的文本节点，
         复制由 site.js 的全局代理完成，不在这里重写一遍 */
      return '<button class="value-row" type="button" title="点击复制这一条" ' +
        'data-copy-target="#' + id + '">' +
        '<span class="value-label">#' + (i + 1) + '</span>' +
        '<span class="value-text" id="' + id + '">' + T.util.esc(s) + '</span>' +
        '</button>';
    }).join('');
  }

  /* --- 6. 主循环 --------------------------------------------------------- */

  function update() {
    var charset = buildCharset();
    var size = charset.length;
    var letters = lettersOf(charset);
    var length = T.util.readInt(lengthInput, MIN_LENGTH, MAX_LENGTH);
    var count  = T.util.readInt(countInput, MIN_COUNT, MAX_COUNT);
    var firstLetter = !!(firstLetterEl && firstLetterEl.checked);

    charsetPreview.textContent = charset.join('');
    charsetSizeEl.textContent = size ? '共 ' + size + ' 个字符' : '（空）';
    syncLengthChips(length);

    if (!R.available()) {
      state.items = [];
      T.util.emptyHint(listEl, '这个环境没有可用的密码学安全随机源',
        '浏览器没有提供 crypto.getRandomValues。本工具不会退回 Math.random —— ' +
        '可预测的随机数拿来生成 token 等于没生成。');
      statsEl.innerHTML = '';
      statusEl.innerHTML = '<span class="is-error">无法生成：缺少 crypto.getRandomValues</span>';
      return;
    }

    if (!size) {
      state.items = [];
      T.util.emptyHint(listEl, '字符集是空的',
        '至少要保留一个可用字符。检查一下自定义字符集，或者关掉「排除易混字符」。');
      statsEl.innerHTML = '';
      statusEl.innerHTML = '<span class="is-error">无法生成：字符集为空</span>';
      return;
    }

    var items = [];
    for (var i = 0; i < count; i++) {
      items.push(generateOne(charset, length, letters, firstLetter));
    }
    state.items = items;
    renderList(items);

    var bits = entropyBits(length, size, letters.length, firstLetter);
    var bitsCls = bits >= 128 ? 'stat-value--ok'
      : (bits >= 64 ? 'stat-value--warn' : 'stat-value--danger');

    statsEl.innerHTML =
      stat('字符集大小', size + ' 个') +
      stat('单串长度', length + ' 字符') +
      stat('单串熵值', bits.toFixed(1) + ' 比特', bitsCls) +
      stat('本次生成', count + ' 条');

    var warn = (firstLetter && !letters.length)
      ? '字符集里没有字母，首字符限定不生效' : '';

    statusEl.innerHTML = T.util.esc(
      '已生成 ' + count + ' 条，每条 ' + length + ' 个字符，单条约 ' + bits.toFixed(1) + ' 比特熵'
    ) + (warn ? '<span class="is-warn"> · ' + T.util.esc(warn) + '</span>' : '');
  }

  var render = T.util.debounce(update, 90);

  /* --- 7. 事件 ----------------------------------------------------------- */

  presetBox.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-preset]');
    if (!chip) return;
    state.preset = chip.getAttribute('data-preset');
    syncPresets();
    render();
  });

  if (lengthChipBox) {
    lengthChipBox.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-length]');
      if (!chip) return;
      lengthInput.value = chip.getAttribute('data-length');
      lengthInput.classList.remove('input--invalid');
      render();
    });
  }

  if (charsetInput) charsetInput.addEventListener('input', render);
  if (ambiguousEl) ambiguousEl.addEventListener('change', render);
  if (firstLetterEl) firstLetterEl.addEventListener('change', render);

  lengthInput.addEventListener('input', render);
  countInput.addEventListener('input', render);
  lengthInput.addEventListener('blur', function () { commitNumber(lengthInput, MIN_LENGTH, MAX_LENGTH); });
  countInput.addEventListener('blur', function () { commitNumber(countInput, MIN_COUNT, MAX_COUNT); });

  /* 数值输入框里按回车直接重新生成 */
  [lengthInput, countInput].forEach(function (el) {
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); update(); }
    });
  });

  if (regenBtn) regenBtn.addEventListener('click', update);

  if (copyAllBtn) {
    copyAllBtn.addEventListener('click', function () {
      if (!state.items.length) { T.util.toast('还没有可复制的内容'); return; }
      T.util.copy(state.items.join('\n'), copyAllBtn);
    });
  }

  /* --- 8. 首屏 ----------------------------------------------------------- */

  renderPresets();
  renderLengthChips();
  syncPresets();
  update();   /* 首屏同步渲染，不走防抖 */
})();
