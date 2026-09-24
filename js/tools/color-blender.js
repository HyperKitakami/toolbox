/* ==========================================================================
   color-blender.js — 颜色混合
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 color-blender（MIT），改动：
     1. 界面文案全量中文化
     2. 改用本站的设计系统与组件类名，去掉上游的逐块 createElement 与内联样式
     3. 修复缺陷：上游文本框输入非法色值时没有任何反馈 —— 界面照旧、不报错，
        用户分不清是输入错了还是没生效。现在标红，失焦时回退到当前值。
     4. 修复缺陷：上游把结果挂在 window._blendColors 上供「复制全部」读取，
        污染全局命名空间。改为模块内变量。
     5. 修复缺陷：上游的 HSL 插值把无彩色（s = 0）的色相当成 0 参与计算，
        灰 → 红的过渡会凭空绕经青绿。现在让无彩色借用另一端的色相。
     6. 修复缺陷：上游把插值得到的 h / s / l 先 Math.round 再转 RGB，
        平白多出一次取整误差。现在按浮点算完再取整。
     7. 修复缺陷：HSL 空间下色阶两端的颜色对不上输入值。HSL 按整数百分比存储，
        往返换算有 ±1 误差，端点色因此会漂（#6c5ce7 变成 #6b5be6）。现在两个
        端点直接返回原色，只有中间点才走换算。
     8. 修复不一致：显示色阶用双空格连接，复制全部却用「, 」，两处对不上。统一为「, 」。
     9. 新增 16 种混合模式（W3C Compositing and Blending Level 1），取值与 CSS 的
        mix-blend-mode 对齐 —— 上游只有线性插值，没有任何混合模式。
    10. 新增两色交换、插值空间切换、混合结果色值列表与单块复制反馈
    11. 颜色换算与混合模式改用 js/color-utils.js（见该文件头的改动说明）
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var esc = T.util.esc;
  var C = T.color;

  /* --- DOM --------------------------------------------------------------- */
  var aPicker   = document.getElementById('cb-a-picker');
  var aText     = document.getElementById('cb-a-text');
  var bPicker   = document.getElementById('cb-b-picker');
  var bText     = document.getElementById('cb-b-text');
  var swapBtn   = document.getElementById('cb-swap');

  var pairEl    = document.querySelector('.blend-pair');
  var previewA  = document.getElementById('cb-preview-a');
  var previewB  = document.getElementById('cb-preview-b');

  var modesEl    = document.getElementById('cb-modes');
  var modeNameEl = document.getElementById('cb-mode-name');
  var modeNoteEl = document.getElementById('cb-mode-note');
  var resultEl   = document.getElementById('cb-result');
  var valuesEl   = document.getElementById('cb-result-values');

  var stepsEl    = document.getElementById('cb-steps');
  var stepsValEl = document.getElementById('cb-steps-value');
  var spaceEl    = document.getElementById('cb-space');
  var stripEl    = document.getElementById('cb-strip');
  var countEl    = document.getElementById('cb-strip-count');
  var copyAllBtn = document.getElementById('cb-copy-all');

  if (!aPicker || !bPicker || !modesEl) return;

  if (!C) {
    T.util.toast('颜色引擎未能加载');
    return;
  }

  /* --- 状态 -------------------------------------------------------------- */
  var DEFAULT_A = '#6c5ce7';
  var DEFAULT_B = '#00cec9';

  var colorA = { r: 108, g: 92, b: 231 };
  var colorB = { r: 0, g: 206, b: 201 };
  var hexA = DEFAULT_A;
  var hexB = DEFAULT_B;

  var mode = 'multiply';
  var stripCodes = [];

  var MODES = C.blendModes;
  var modeById = {};
  MODES.forEach(function (m) { modeById[m.id] = m; });

  /* ======================================================================
     一、混合模式面板
     ====================================================================== */

  function renderModes() {
    modesEl.innerHTML = MODES.map(function (m) {
      return '<button class="choice-chip" type="button" data-mode="' + m.id + '" ' +
        'aria-pressed="' + (m.id === mode) + '" ' +
        'title="' + esc(m.name + '（' + m.id + '）') + '">' +
        esc(m.name) + '</button>';
    }).join('');
  }

  function syncMode() {
    var m = modeById[mode] || MODES[0];

    T.util.$$('.choice-chip', modesEl).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode));
    });

    if (modeNameEl) modeNameEl.textContent = m.name;
    if (modeNoteEl) modeNoteEl.textContent = m.note;
  }

  function renderResult() {
    var rgb = C.blendMode(colorA, colorB, mode);
    var hex = C.rgbToHex(rgb.r, rgb.g, rgb.b);
    var hsl = C.rgbToHsl(rgb.r, rgb.g, rgb.b);

    resultEl.style.background = hex;
    resultEl.setAttribute('aria-label', '混合结果 ' + hex);

    var rows = [
      ['HEX', hex],
      ['RGB', 'rgb(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ')'],
      ['HSL', 'hsl(' + hsl.h + ', ' + hsl.s + '%, ' + hsl.l + '%)']
    ];

    valuesEl.innerHTML = rows.map(function (row) {
      return '<button class="value-row" type="button" data-value="' + esc(row[1]) + '">' +
        '<span class="value-label">' + row[0] + '</span>' +
        '<span class="value-text">' + esc(row[1]) + '</span>' +
        '</button>';
    }).join('');
  }

  /* ======================================================================
     二、过渡色阶
     ====================================================================== */

  /**
   * 在 HSL 空间插值。
   *
   * 色相走最短的一边：相差超过 180° 就绕近路，否则红到品红会傻乎乎地
   * 从黄、绿、青、蓝一路转过去。
   *
   * 灰色（s = 0）没有色相可言，rgbToHsl 一律给 0。若直接拿这个 0 参与插值，
   * 灰到红的过渡会经过 0 → 180 → 350 的路径，中间冒出青绿色 —— 上游就是
   * 这么算的。这里让无彩色借用另一端的色相：灰色跟谁混，就走谁那条路。
   */
  function blendHsl(rgb1, rgb2, ratio) {
    /* 两个端点直接返回原色。HSL 按整数百分比存储，rgbToHsl → hslToRgb 的
       往返有 ±1 误差，不特判的话色阶两端的颜色会和输入的颜色对不上。 */
    if (ratio <= 0) return { r: rgb1.r, g: rgb1.g, b: rgb1.b };
    if (ratio >= 1) return { r: rgb2.r, g: rgb2.g, b: rgb2.b };

    var h1 = C.rgbToHsl(rgb1.r, rgb1.g, rgb1.b);
    var h2 = C.rgbToHsl(rgb2.r, rgb2.g, rgb2.b);

    var hue1 = h1.s === 0 ? h2.h : h1.h;
    var hue2 = h2.s === 0 ? h1.h : h2.h;

    var dh = hue2 - hue1;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;

    /* 不预先取整：h / s / l 按浮点算完再交给 hslToRgb，少一次舍入 */
    return C.hslToRgb(
      hue1 + dh * ratio,
      h1.s + (h2.s - h1.s) * ratio,
      h1.l + (h2.l - h1.l) * ratio
    );
  }

  function renderStrip() {
    var steps = parseInt(stepsEl.value, 10);
    if (!isFinite(steps) || steps < 1) steps = 1;
    if (steps > 20) steps = 20;

    stepsValEl.textContent = String(steps);

    var useHsl = spaceEl.value === 'hsl';
    var total = steps + 2;
    var html = '';
    stripCodes = [];

    for (var i = 0; i < total; i++) {
      var ratio = i / (steps + 1);
      var rgb = useHsl
        ? blendHsl(colorA, colorB, ratio)
        : C.blendColors(colorA, colorB, ratio);
      var hex = C.rgbToHex(rgb.r, rgb.g, rgb.b);

      stripCodes.push(hex);
      html += '<button class="color-cell" type="button" data-hex="' + hex + '" ' +
        'title="点击复制 ' + hex + '" aria-label="' + hex + '">' +
        '<span class="color-cell-color" style="background:' + hex + '"></span>' +
        '<span class="color-cell-code">' + hex + '</span></button>';
    }

    stripEl.innerHTML = html;
    countEl.textContent = String(total);
  }

  /* ======================================================================
     三、两色与刷新
     ====================================================================== */

  function renderPair() {
    previewA.style.background = hexA;
    previewB.style.background = hexB;
    if (pairEl) pairEl.setAttribute('aria-label', '底色 ' + hexA + '，叠色 ' + hexB);
  }

  function refresh() {
    renderPair();
    renderResult();
    renderStrip();
  }

  /**
   * 设置某一端的颜色。
   * @param {'a'|'b'} side
   * @param {string|{r,g,b}} input
   * @param {boolean} [keepText] 不覆盖文本框（用户正在输入时用）
   * @returns {boolean} 是否解析成功
   */
  function setColor(side, input, keepText) {
    var rgb = (input && typeof input === 'object') ? input : C.parseColor(input);
    if (!rgb) return false;

    var hex = C.rgbToHex(rgb.r, rgb.g, rgb.b);

    if (side === 'a') {
      colorA = { r: rgb.r, g: rgb.g, b: rgb.b };
      hexA = hex;
      aPicker.value = hex;
      if (!keepText) aText.value = hex;
      aText.classList.remove('input--invalid');
    } else {
      colorB = { r: rgb.r, g: rgb.g, b: rgb.b };
      hexB = hex;
      bPicker.value = hex;
      if (!keepText) bText.value = hex;
      bText.classList.remove('input--invalid');
    }

    refresh();
    return true;
  }

  /* ======================================================================
     四、事件
     ====================================================================== */

  function bindSide(side, pickerEl, textEl) {
    /* 手动输入色值：解析得了就更新，解析不了只标红，不动当前颜色 */
    textEl.addEventListener('input', function () {
      var raw = textEl.value.trim();
      if (!raw) { textEl.classList.remove('input--invalid'); return; }

      if (C.parseColor(raw)) {
        setColor(side, raw, true);
      } else {
        textEl.classList.add('input--invalid');
      }
    });

    /* 失焦时把输入规范化成 hex，顺便清掉标红 */
    textEl.addEventListener('blur', function () {
      var rgb = C.parseColor(textEl.value);
      if (rgb) setColor(side, rgb);
      else textEl.value = side === 'a' ? hexA : hexB;
      textEl.classList.remove('input--invalid');
    });

    pickerEl.addEventListener('input', function () {
      setColor(side, pickerEl.value);
    });
  }

  bindSide('a', aPicker, aText);
  bindSide('b', bPicker, bText);

  /* 切换混合模式 */
  modesEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-mode]');
    if (!btn) return;

    mode = btn.getAttribute('data-mode');
    syncMode();
    renderResult();
  });

  /* 交换两色。混合模式大多分方向，交换后结果会变，这是有意保留的对照。 */
  if (swapBtn) {
    swapBtn.addEventListener('click', function () {
      var rgb = colorA, hex = hexA;
      colorA = colorB; hexA = hexB;
      colorB = rgb;    hexB = hex;

      aPicker.value = hexA;
      bPicker.value = hexB;
      aText.value = hexA;
      bText.value = hexB;
      aText.classList.remove('input--invalid');
      bText.classList.remove('input--invalid');

      refresh();
    });
  }

  /* 过渡色阶的参数 */
  stepsEl.addEventListener('input', renderStrip);
  spaceEl.addEventListener('change', renderStrip);

  /* 点击色值行复制 */
  valuesEl.addEventListener('click', function (e) {
    var row = e.target.closest('[data-value]');
    if (!row) return;
    T.util.copy(row.getAttribute('data-value'), row);
  });

  /* 点击色阶块复制该块 */
  stripEl.addEventListener('click', function (e) {
    var cell = e.target.closest('[data-hex]');
    if (!cell) return;
    T.util.copy(cell.getAttribute('data-hex'), cell);
  });

  /* 复制整条色阶 */
  if (copyAllBtn) {
    copyAllBtn.addEventListener('click', function () {
      T.util.copy(stripCodes.join(', '), copyAllBtn);
    });
  }

  /* ======================================================================
     五、首屏
     ====================================================================== */

  renderModes();
  syncMode();
  setColor('a', DEFAULT_A);
  setColor('b', DEFAULT_B);
})();
