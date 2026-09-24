/* ==========================================================================
   color-picker.js — 取色器
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 color-picker（MIT），改动：
     1. 界面文案全量中文化
     2. 改用本站的设计系统与组件类名；色值行做成可点击复制的列表
     3. 修复缺陷：上游直接 ColorUtils.hexToRgb(用户输入)，而它不做校验，
         非法输入会静默变成黑色。现在解析失败时把输入框标红并保持原色。
     4. 复制改用带降级的公共实现，并给出反馈
     5. 背景色支持手动输入与前后景交换
     6. 颜色换算与对比度改用 js/color-utils.js（同批移植，见该文件头的改动说明）
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var esc = T.util.esc;
  var C = T.color;

  /* --- DOM --------------------------------------------------------------- */
  var pickerEl  = document.getElementById('cp-picker');
  var hexEl     = document.getElementById('cp-hex');
  var swatchEl  = document.getElementById('cp-swatch');
  var valuesEl  = document.getElementById('cp-values');
  var shadesEl  = document.getElementById('cp-shades');
  var eyedropBtn = document.getElementById('cp-eyedrop');

  var fgLabelEl = document.getElementById('cp-fg');
  var bgEl      = document.getElementById('cp-bg');
  var bgTextEl  = document.getElementById('cp-bg-text');
  var swapBtn   = document.getElementById('cp-swap');
  var ratioEl   = document.getElementById('cp-ratio');
  var previewEl = document.getElementById('cp-preview');
  var badgesEl  = document.getElementById('cp-badges');

  if (!pickerEl || !hexEl || !swatchEl) return;

  if (!C) {
    T.util.toast('颜色引擎未能加载');
    return;
  }

  /* --- 常量与状态 -------------------------------------------------------- */
  var WHITE = { r: 255, g: 255, b: 255 };
  var BLACK = { r: 0, g: 0, b: 0 };
  var DEFAULT = '#6c5ce7';

  var currentHex = DEFAULT;
  var currentRgb = { r: 108, g: 92, b: 231 };

  /* ======================================================================
     一、渲染
     ====================================================================== */

  function renderValues(rgb, hsl, cmyk) {
    var rows = [
      ['HEX', currentHex],
      ['RGB', 'rgb(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ')'],
      ['HSL', 'hsl(' + hsl.h + ', ' + hsl.s + '%, ' + hsl.l + '%)'],
      ['CMYK', 'cmyk(' + cmyk.c + '%, ' + cmyk.m + '%, ' + cmyk.y + '%, ' + cmyk.k + '%)']
    ];

    valuesEl.innerHTML = rows.map(function (row) {
      return '<button class="value-row" type="button" data-value="' + esc(row[1]) + '">' +
        '<span class="value-label">' + row[0] + '</span>' +
        '<span class="value-text">' + esc(row[1]) + '</span>' +
        '</button>';
    }).join('');
  }

  /** 以当前色为中心，两侧各生成 5 级加白 / 加黑 */
  function renderShades(rgb) {
    var steps = [];
    for (var i = 5; i >= 1; i--) steps.push(C.blendColors(rgb, WHITE, i / 5));
    steps.push(rgb);
    for (var j = 1; j <= 5; j++) steps.push(C.blendColors(rgb, BLACK, j / 5));

    shadesEl.innerHTML = steps.map(function (c) {
      var hex = C.rgbToHex(c.r, c.g, c.b);
      return '<button class="shade-swatch" type="button" data-color="' + hex + '" ' +
        'style="background:' + hex + '" title="' + hex + '" aria-label="' + hex + '"></button>';
    }).join('');
  }

  /** 读取背景色输入，解析不了就退回白色 */
  function readBg() {
    var rgb = C.parseColor(bgTextEl.value) || C.hexToRgb(bgEl.value);
    return rgb || WHITE;
  }

  function renderContrast() {
    var bgRgb = readBg();
    var bgHex = C.rgbToHex(bgRgb.r, bgRgb.g, bgRgb.b);

    /* 让两个背景输入保持同步 */
    bgEl.value = bgHex;
    bgTextEl.classList.toggle('input--invalid',
      bgTextEl.value.trim() !== '' && C.parseColor(bgTextEl.value) === null);

    var ratio = C.contrastRatio(currentRgb, bgRgb);
    var rounded = Math.round(ratio * 100) / 100;

    if (fgLabelEl) fgLabelEl.textContent = currentHex;
    if (ratioEl) {
      ratioEl.textContent = rounded + ':1';
      ratioEl.className = 'badge ' +
        (ratio >= 4.5 ? 'badge--pass' : ratio >= 3 ? 'badge--warn' : 'badge--fail');
    }

    if (previewEl) {
      previewEl.style.color = currentHex;
      previewEl.style.backgroundColor = bgHex;
    }

    if (badgesEl) {
      badgesEl.innerHTML = C.wcagLevels(ratio).map(function (lv) {
        return '<span class="badge badge--' + (lv.pass ? 'pass' : 'fail') + '">' +
          (lv.pass ? '✓' : '✗') + ' ' + esc(lv.label) +
          '<span class="faint"> ≥' + lv.need + '</span></span>';
      }).join('');
    }
  }

  /* ======================================================================
     二、主流程
     ====================================================================== */

  /**
   * 设置当前颜色。
   * @param {string|object} input 色值字符串或 {r,g,b}
   * @param {object} [opts] { keepHex: true } 时不覆盖 HEX 输入框（用户正在输入）
   * @returns {boolean} 是否解析成功
   */
  function setColor(input, opts) {
    var rgb = (input && typeof input === 'object') ? input : C.parseColor(input);
    if (!rgb) return false;

    currentRgb = { r: rgb.r, g: rgb.g, b: rgb.b };
    currentHex = C.rgbToHex(rgb.r, rgb.g, rgb.b);

    pickerEl.value = currentHex;
    if (!opts || !opts.keepHex) hexEl.value = currentHex;
    hexEl.classList.remove('input--invalid');

    swatchEl.style.background = currentHex;
    swatchEl.setAttribute('aria-label', '当前颜色 ' + currentHex);

    renderValues(currentRgb, C.rgbToHsl(rgb.r, rgb.g, rgb.b), C.rgbToCmyk(rgb.r, rgb.g, rgb.b));
    renderShades(currentRgb);
    renderContrast();

    return true;
  }

  /* ======================================================================
     三、事件
     ====================================================================== */

  /* 系统取色盘 */
  pickerEl.addEventListener('input', function () {
    setColor(pickerEl.value);
  });

  /* 手动输入色值：解析得了就更新，解析不了只标红，不动当前颜色 */
  hexEl.addEventListener('input', function () {
    var raw = hexEl.value.trim();
    if (!raw) { hexEl.classList.remove('input--invalid'); return; }

    var rgb = C.parseColor(raw);
    if (rgb) {
      setColor(rgb, { keepHex: true });
    } else {
      hexEl.classList.add('input--invalid');
    }
  });

  /* 失焦时把输入规范化成 hex，顺便清掉标红 */
  hexEl.addEventListener('blur', function () {
    var rgb = C.parseColor(hexEl.value);
    if (rgb) setColor(rgb);
    else hexEl.value = currentHex;
    hexEl.classList.remove('input--invalid');
  });

  /* 点击色值行复制 */
  valuesEl.addEventListener('click', function (e) {
    var row = e.target.closest('[data-value]');
    if (!row) return;
    T.util.copy(row.getAttribute('data-value'), row);
  });

  /* 点击色阶切换颜色 */
  shadesEl.addEventListener('click', function (e) {
    var sw = e.target.closest('[data-color]');
    if (!sw) return;
    setColor(sw.getAttribute('data-color'));
  });

  /* 背景色 */
  bgEl.addEventListener('input', function () {
    bgTextEl.value = bgEl.value;
    renderContrast();
  });

  bgTextEl.addEventListener('input', function () {
    renderContrast();
  });

  bgTextEl.addEventListener('blur', function () {
    var rgb = C.parseColor(bgTextEl.value);
    if (rgb) {
      bgTextEl.value = C.rgbToHex(rgb.r, rgb.g, rgb.b);
      bgTextEl.classList.remove('input--invalid');
      renderContrast();
    } else {
      bgTextEl.value = C.rgbToHex(readBg().r, readBg().g, readBg().b);
      bgTextEl.classList.remove('input--invalid');
    }
  });

  if (swapBtn) {
    swapBtn.addEventListener('click', function () {
      var bgHex = C.rgbToHex(readBg().r, readBg().g, readBg().b);
      bgTextEl.value = currentHex;
      bgEl.value = currentHex;
      setColor(bgHex);
    });
  }

  /* 屏幕取色（仅 Chromium 系支持） */
  if (eyedropBtn && 'EyeDropper' in window) {
    eyedropBtn.hidden = false;
    eyedropBtn.addEventListener('click', function () {
      new window.EyeDropper().open().then(function (result) {
        setColor(String(result.sRGBHex).toLowerCase());
      }).catch(function () { /* 用户按 Esc 取消，静默处理 */ });
    });
  }

  /* ======================================================================
     四、首屏
     ====================================================================== */

  setColor(DEFAULT);
})();
