/* ==========================================================================
   base-converter.js — 进制转换
   --------------------------------------------------------------------------
   自研工具：参考仓库 jamalofski/praticulus 里没有对应实现。

   设计取舍（自研工具没有上游来源说明，这里是唯一的「为什么这么做」）：

   1. **全程用 BigInt，不用 Number。** `Number('0xffffffffffffffff')` 得到
      18446744073709552000，最后三位已经错了；`(255).toString(2)` 这类写法在
      超过 2^53 之后同样不可靠。进制转换的典型用途（位运算、颜色、内存地址、
      编码）本来就经常落在 64 位范围里，所以从解析到输出都用 BigInt，
      任意位数都精确。

   2. **BigInt 用调用形式而不是字面量。** `0n` 这样的**字面量**是解析期语法 ——
      老引擎加载整个文件就会失败，连累同文件里其它功能。`BigInt(0)` 是运行时不可用，
      可以用 `typeof BigInt === 'function'` 检测后优雅降级。

   3. **不做小数转换。** 十进制小数在二进制下大多是无限循环的（0.1 → 0.000110011…），
      任何截断值都需要用户自己判断精度够不够；而「进制转换」的实际用途几乎全是整数。
      给一个截断值反而容易被当成精确值，所以带小数点的输入直接报错并说明原因。

   4. **不做补码的「智能」判断，而是绑定在位宽上。** 补码只在特定位宽下才有意义
      （−1 在 8 位下是 0xff，在 16 位下是 0xffff）。所以负数转补码只在用户
      显式选了 8 / 16 / 32 / 64 位时才发生，并且只作用于**二进制与十六进制** ——
      八进制和十进制的补码写法没人用，加了只会让人困惑。

   5. **`0x` / `0b` / `0o` 前缀优先于源进制选择，且不回落。** 这与所有编程语言的
      字面量规则一致：`0b1010` 就是二进制，`0b1f` 就是语法错误。
      如果前缀解释失败就悄悄改用源进制，反而会给出一个没人预期的结果。

   6. **剥掉输入里的分隔符。** 二进制经常写成 `1010 1010`、`1010_1010` 或
      `1010,1010`，从代码或日志里粘过来时这些都在，直接剥掉比让用户手改省事。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;

  /**
   * 依赖缺失时**不要静默 return** —— 结果区一片空白，光看页面完全看不出哪里坏了。
   */
  function bail(detail) {
    var box = document.getElementById('bc-rows');
    if (!box) return;
    var div = document.createElement('div');
    div.className = 'code-empty';
    var strong = document.createElement('strong');
    strong.textContent = '这个工具没法运行';
    div.appendChild(strong);
    div.appendChild(document.createTextNode(detail));
    box.textContent = '';
    box.appendChild(div);
  }

  if (!T || !T.util) {
    bail('js/registry.js 或 js/site.js 没有加载成功。请强制刷新（Ctrl+F5 / Cmd+Shift+R）后重试。');
    return;
  }
  if (typeof T.util.debounce !== 'function' || typeof T.util.emptyHint !== 'function') {
    bail('加载到的是旧版 js/site.js。请强制刷新（Ctrl+F5 / Cmd+Shift+R）后重试。');
    return;
  }
  /* BigInt 是运行时能力，缺了只是这个工具不能用，不影响同文件的其它逻辑 */
  if (typeof BigInt !== 'function') {
    bail('这个浏览器没有 BigInt，无法精确处理大整数。请换用较新的 Chrome / Edge / Firefox / Safari。');
    return;
  }

  var esc = T.util.esc;

  /* ======================================================================
     一、常量
     ====================================================================== */

  var DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
  var ZERO = BigInt(0);
  var ONE = BigInt(1);

  var MAX_LEN = 2000;          /* 输入位数上限，避免离谱输入把页面卡住 */

  var RADIX_CHOICES = [
    { id: '2', name: '2' }, { id: '8', name: '8' },
    { id: '10', name: '10' }, { id: '16', name: '16' },
    { id: 'custom', name: '自定义' }
  ];

  var WIDTH_CHOICES = [
    { id: 'none', name: '不补齐' },
    { id: '8', name: '8 位' }, { id: '16', name: '16 位' },
    { id: '32', name: '32 位' }, { id: '64', name: '64 位' }
  ];

  var RADIX_NAME = {
    2: '二进制', 3: '三进制', 4: '四进制', 5: '五进制', 6: '六进制',
    7: '七进制', 8: '八进制', 9: '九进制', 10: '十进制', 11: '十一进制',
    12: '十二进制', 16: '十六进制', 20: '二十进制', 32: '三十二进制', 36: '三十六进制'
  };

  function radixName(n) {
    return RADIX_NAME[n] || (n + ' 进制');
  }

  function repeat(s, n) {
    return n > 0 ? new Array(n + 1).join(s) : '';
  }

  /* ======================================================================
     二、BigInt ↔ 任意进制字符串
     ====================================================================== */

  /**
   * 按 radix 解析数字串。
   * @returns {{ok: true, value: BigInt} | {ok: false, index: number, ch: string}}
   */
  function parseInBase(s, radix) {
    var body = s;
    var neg = false;
    if (body.charAt(0) === '-') { neg = true; body = body.slice(1); }
    else if (body.charAt(0) === '+') { body = body.slice(1); }

    var big = ZERO;
    var R = BigInt(radix);
    for (var i = 0; i < body.length; i++) {
      var d = DIGITS.indexOf(body.charAt(i).toLowerCase());
      if (d < 0 || d >= radix) return { ok: false, index: i, ch: body.charAt(i) };
      big = big * R + BigInt(d);
    }
    return { ok: true, value: neg ? -big : big };
  }

  /** BigInt → 任意进制字符串（0–9a–z，radix ≤ 36） */
  function toBaseString(big, radix, upper) {
    if (big === ZERO) return '0';
    var neg = big < ZERO;
    var n = neg ? -big : big;
    var R = BigInt(radix);
    var parts = [];
    while (n > ZERO) {
      parts.push(DIGITS.charAt(Number(n % R)));
      n = n / R;
    }
    var out = parts.reverse().join('');
    return (neg ? '-' : '') + (upper ? out.toUpperCase() : out);
  }

  /* ======================================================================
     三、位宽与补码
     ====================================================================== */

  /**
   * 按 width 位取补码（只对负数有意义）。
   * @returns {BigInt|null} null 表示这个值放不进该位宽的有符号范围
   */
  function twosComplement(big, width) {
    var W = BigInt(width);
    var mod = ONE << W;
    var half = ONE << (W - ONE);
    if (big < -half || big > half - ONE) return null;
    return big < ZERO ? big + mod : big;
  }

  function padLeft(s, n) {
    return s.length >= n ? s : repeat('0', n - s.length) + s;
  }

  /**
   * 按目标进制格式化，位宽只作用于二进制与十六进制。
   * @returns {{text: string, overflow: boolean}}
   */
  function formatIn(big, radix, opts) {
    var w = opts.width;
    var upper = opts.upper;

    if (!w || (radix !== 2 && radix !== 16)) {
      return { text: toBaseString(big, radix, upper), overflow: false };
    }
    var tc = twosComplement(big, w);
    if (tc === null) {
      return { text: toBaseString(big, radix, upper), overflow: true };
    }
    var s = toBaseString(tc, radix, upper);
    return { text: padLeft(s, radix === 2 ? w : w / 4), overflow: false };
  }

  /* ======================================================================
     四、分组显示
     ====================================================================== */

  /** 二进制每 4 位一空格（从右往左分） */
  function groupBits(s) {
    var parts = [];
    for (var i = s.length; i > 0; i -= 4) {
      parts.unshift(s.slice(Math.max(0, i - 4), i));
    }
    return parts.join(' ');
  }

  /** 十进制千分位 */
  function group3(s) {
    var parts = [];
    for (var i = s.length; i > 0; i -= 3) {
      parts.unshift(s.slice(Math.max(0, i - 3), i));
    }
    return parts.join(',');
  }

  /** 十六进制按字节分组：1234 → "12 34" */
  function byteView(hex) {
    var s = hex.length % 2 ? '0' + hex : hex;
    var parts = [];
    for (var i = 0; i < s.length; i += 2) parts.push(s.slice(i, i + 2));
    return parts.join(' ');
  }

  /* ======================================================================
     五、DOM
     ====================================================================== */

  var inputEl   = document.getElementById('bc-input');
  var srcBox    = document.getElementById('bc-src');
  var srcCustom = document.getElementById('bc-src-custom');
  var srcWrap   = document.getElementById('bc-src-custom-wrap');
  var dstBox    = document.getElementById('bc-dst');
  var dstCustom = document.getElementById('bc-dst-custom');
  var dstWrap   = document.getElementById('bc-dst-custom-wrap');
  var dstLabel  = document.getElementById('bc-dst-label');
  var widthBox  = document.getElementById('bc-width');
  var upperEl   = document.getElementById('bc-upper');
  var mainBox   = document.getElementById('bc-main');
  var mainText  = document.getElementById('bc-main-text');
  var rowsEl    = document.getElementById('bc-rows');
  var statsEl   = document.getElementById('bc-stats');
  var statusEl  = document.getElementById('bc-status');
  var copyAllBtn = document.getElementById('bc-copy-all');
  var copyBtn   = document.getElementById('bc-copy');

  if (!inputEl || !rowsEl || !mainText || !srcBox || !dstBox || !widthBox) return;
  if (!statsEl || !statusEl || !srcCustom || !dstCustom) {
    bail('页面结构不完整。请强制刷新后重试。');
    return;
  }

  var state = { src: '10', dst: '16', width: null, upper: false };

  /* 源进制 / 目标进制：'custom' 时读数字输入框 */
  function srcRadix() {
    return state.src === 'custom' ? T.util.readInt(srcCustom, 2, 36) : Number(state.src);
  }
  function dstRadix() {
    return state.dst === 'custom' ? T.util.readInt(dstCustom, 2, 36) : Number(state.dst);
  }

  /* ======================================================================
     六、渲染
     ====================================================================== */

  function row(id, label, value) {
    return '<button class="value-row" type="button" title="点击复制" ' +
      'data-copy-target="#bc-v-' + id + '">' +
      '<span class="value-label">' + esc(label) + '</span>' +
      '<span class="value-text" id="bc-v-' + id + '">' + esc(value) + '</span>' +
      '</button>';
  }

  function stat(label, value) {
    return '<div class="stat"><div class="stat-label">' + esc(label) + '</div>' +
      '<div class="stat-value stat-value--sm">' + esc(value) + '</div></div>';
  }

  function setCopyable(on) {
    [mainBox, copyBtn].forEach(function (b) {
      if (!b) return;
      if (on) b.setAttribute('data-copy-target', '#bc-main-text');
      else b.removeAttribute('data-copy-target');
    });
  }

  function renderEmpty(message) {
    mainText.textContent = '—';
    setCopyable(false);
    T.util.emptyHint(rowsEl, '还没有输入数值',
      '在左上角填一个数字，并选好它的进制，这里会列出其它进制的写法。');
    statsEl.innerHTML = '';
    statusEl.textContent = message || '输入一个数字';
  }

  var REASON = {
    prefixOnly: '前缀后面没有数字',
    tooLong: '输入位数超过 ' + MAX_LEN + ' 位',
    noDigits: '没有可解析的数字'
  };

  function renderError(reason, raw, extra) {
    mainText.textContent = '—';
    setCopyable(false);
    T.util.emptyHint(rowsEl, '解析不了这段输入', extra || REASON[reason] || REASON.noDigits);
    statsEl.innerHTML = '';

    var text = reason === 'tooLong' ? REASON.tooLong : '不是合法的数字';
    statusEl.innerHTML = '<span class="is-error">' + esc(text) + '</span>' +
      '<span class="err-raw">原始输入：' + esc(raw) + '</span>';
  }

  /* ======================================================================
     七、主流程
     ====================================================================== */

  /* 0x / 0b / 0o 前缀（与编程语言的整数字面量规则一致） */
  var PREFIX_RE = /^([+-]?)0([xXbBoO])([\s\S]*)$/;
  var PREFIX_RADIX = { x: 16, b: 2, o: 8 };

  function update() {
    var raw = inputEl.value.trim();
    if (!raw) { renderEmpty(); return; }

    /* 二进制常写成 1010 1010 / 1010_1010 / 1010,1010，统一剥掉 */
    var cleaned = raw.replace(/[_\s,\u00a0\u202f\u2009]/g, '');
    if (!cleaned) { renderEmpty(); return; }

    var radix = srcRadix();
    var body = cleaned;
    var prefixed = false;

    var pm = PREFIX_RE.exec(cleaned);
    if (pm) {
      radix = PREFIX_RADIX[pm[2].toLowerCase()];
      body = pm[1] + pm[3];
      prefixed = true;
      if (!body.replace(/^[+-]/, '')) {
        renderError('prefixOnly', raw, '前缀 0' + pm[2] + ' 后面没有数字。');
        return;
      }
    }

    if (body.replace(/^[+-]/, '').length > MAX_LEN) {
      renderError('tooLong', raw);
      return;
    }

    var parsed = parseInBase(body, radix);
    if (!parsed.ok) {
      var hint = '第 ' + (parsed.index + 1) + ' 个字符「' + parsed.ch + '」不是 ' +
        radix + ' 进制的合法数字（只允许 ' + DIGITS.slice(0, Math.min(radix, 36)) + '）。';
      if (prefixed) {
        hint += '前缀 0' + pm[2] + ' 表示按 ' + radix + ' 进制解析；' +
          '如果想按其它进制解析，请去掉前缀。';
      }
      renderError('digit', raw, hint);
      return;
    }

    renderResult(parsed.value, radix, prefixed, raw);
  }

  var debounced = T.util.debounce(update, 90);

  function renderResult(big, srcR, prefixed, raw) {
    var dstR = dstRadix();
    var opts = { width: state.width, upper: state.upper };

    var main = formatIn(big, dstR, opts);
    mainText.textContent = main.text;
    setCopyable(true);
    if (dstLabel) dstLabel.textContent = radixName(dstR);

    var bin = formatIn(big, 2, opts);
    var oct = toBaseString(big, 8, false);
    var dec = toBaseString(big, 10, false);
    var hex = formatIn(big, 16, opts);

    var rows = row('bin', '二进制', groupBits(bin.text)) +
      row('oct', '八进制', oct) +
      row('dec', '十进制', (dec.charAt(0) === '-' ? '-' : '') +
        group3(dec.replace(/^-/, ''))) +
      row('hex', '十六进制', hex.text);

    /* 两个字节以上才给字节视图 —— 单字节时它就是十六进制那一行。
       有符号时用 hex 行的结果（选了位宽的话那里已经是补码），这样
       「按位宽看内存里的样子」和字节视图是一致的。 */
    var hexForBytes = hex.text.charAt(0) === '-' ? hex.text.slice(1) : hex.text;
    if (hexForBytes.length > 2) {
      rows += row('bytes', '字节视图', byteView(hexForBytes));
    }
    rowsEl.innerHTML = rows;

    renderStats(big, dstR, main);
    renderStatus(big, srcR, dstR, prefixed, raw, main);
  }

  function renderStats(big, dstR, main) {
    var abs = big < ZERO ? -big : big;
    var binStr = toBaseString(abs, 2, false);
    var bits = big === ZERO ? 1 : binStr.length;
    var ones = (binStr.match(/1/g) || []).length;
    var hexDigits = toBaseString(abs, 16, false).length;

    statsEl.innerHTML =
      stat('二进制位', bits + ' 位') +
      stat('字节数', Math.ceil(bits / 8) + ' 字节') +
      stat('置 1 位', big < ZERO ? '—' : ones + ' 位') +
      stat('结果位数', main.text.replace(/^[+-]/, '').length + ' 位');
  }

  function renderStatus(big, srcR, dstR, prefixed, raw, main) {
    var parts = [];

    if (prefixed) {
      parts.push('按前缀解释为' + radixName(srcR));
    } else {
      parts.push('按' + radixName(srcR) + '解析');
    }
    if (raw !== raw.trim() || /[_\s,\u00a0\u202f\u2009]/.test(raw)) {
      parts.push('已剥掉输入里的分隔符');
    }

    var html = esc(parts.join(' · '));

    if (main.overflow) {
      html += '<span class="is-warn"> · 这个值放不进 ' + state.width +
        ' 位有符号整数（' + toBaseString(-(ONE << (BigInt(state.width) - ONE)), 10, false) +
        ' … ' + toBaseString((ONE << (BigInt(state.width) - ONE)) - ONE, 10, false) +
        '），已按任意精度原样显示</span>';
    }
    if (big < ZERO && !state.width) {
      html += '<span class="faint"> · 负数按「符号 + 绝对值」显示，不做补码；' +
        '选一个位宽可以看补码写法</span>';
    }
    if (big < ZERO && state.width && (dstR === 2 || dstR === 16)) {
      html += '<span class="faint"> · 负数已按 ' + state.width + ' 位补码显示</span>';
    }
    statusEl.innerHTML = html;
  }

  /* ======================================================================
     八、选项控件
     ====================================================================== */

  function renderChips(box, choices, current, attr) {
    box.innerHTML = choices.map(function (c) {
      return '<button class="choice-chip" type="button" data-' + attr + '="' + c.id + '" ' +
        'aria-pressed="' + (c.id === current) + '">' + esc(c.name) + '</button>';
    }).join('');
  }

  function syncChips(box, attr, current) {
    T.util.$$('.choice-chip', box).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-' + attr) === current));
    });
  }

  function bindRadixChips(box, attr, key, wrap) {
    box.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-' + attr + ']');
      if (!chip) return;
      state[key] = chip.getAttribute('data-' + attr);
      syncChips(box, attr, state[key]);
      wrap.hidden = state[key] !== 'custom';
      update();
    });
  }

  /* ======================================================================
     九、事件
     ====================================================================== */

  inputEl.addEventListener('input', debounced);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); update(); }
  });

  bindRadixChips(srcBox, 'src', 'src', srcWrap);
  bindRadixChips(dstBox, 'dst', 'dst', dstWrap);

  /* 自定义进制的数字输入：非法标红 + 失焦回退（与站内其它工具一致） */
  [[srcCustom, 2, 36], [dstCustom, 2, 36]].forEach(function (pair) {
    var el = pair[0], min = pair[1], max = pair[2];
    el.addEventListener('input', debounced);
    el.addEventListener('blur', function () {
      if (!el.classList.contains('input--invalid')) return;
      el.value = String(T.util.readInt(el, min, max));
      el.classList.remove('input--invalid');
      update();
    });
  });

  widthBox.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-width]');
    if (!chip) return;
    var id = chip.getAttribute('data-width');
    state.width = id === 'none' ? null : Number(id);
    syncChips(widthBox, 'width', id);
    update();
  });

  if (upperEl) {
    upperEl.addEventListener('change', function () {
      state.upper = upperEl.checked;
      update();
    });
  }

  if (copyAllBtn) {
    copyAllBtn.addEventListener('click', function () {
      if (!mainText.textContent || mainText.textContent === '—') {
        T.util.toast('还没有可复制的内容');
        return;
      }
      var lines = [radixName(dstRadix()) + '\t' + mainText.textContent];
      T.util.$$('.value-row', rowsEl).forEach(function (r) {
        lines.push(r.querySelector('.value-label').textContent + '\t' +
          r.querySelector('.value-text').textContent);
      });
      T.util.copy(lines.join('\n'), copyAllBtn);
    });
  }

  /* ======================================================================
     十、首屏
     ====================================================================== */

  renderChips(srcBox, RADIX_CHOICES, state.src, 'src');
  renderChips(dstBox, RADIX_CHOICES, state.dst, 'dst');
  renderChips(widthBox, WIDTH_CHOICES, 'none', 'width');

  srcCustom.value = '10';
  dstCustom.value = '16';
  srcWrap.hidden = true;
  dstWrap.hidden = true;

  update();                     /* 首屏同步渲染，不走防抖 */
})();
