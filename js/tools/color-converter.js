/* ==========================================================================
   color-converter.js — 颜色格式转换
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 color-converter（MIT），改动：
     1. 界面文案全量中文化
     2. 改用本站的设计系统与组件类名；五种色值做成可点击复制的列表
     3. 命名颜色表（148 项）挪进公共模块 js/color-utils.js，
        以 closestName() / namedToRgb() 暴露，后续调色板类工具可复用
     4. 色值解析统一走 ColorUtils.parseColor（含浏览器兜底），
        于是颜色名、hwb()、8 位 HEX 都能直接输入
     5. 修复缺陷：上游直接 hexToRgb(picker.value) 而不判空，
        解析失败会带着 null 继续往下算；现在统一做兜底
     6. 透明度滑杆的轨道会随颜色与透明度实时变化，直观显示当前 alpha
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var esc = T.util.esc;
  var C = T.color;

  /* --- DOM --------------------------------------------------------------- */
  var inputEl  = document.getElementById('cc-input');
  var pickerEl = document.getElementById('cc-picker');
  var swatchEl = document.getElementById('cc-swatch');
  var valuesEl = document.getElementById('cc-values');
  var cssNameEl = document.getElementById('cc-css-name');

  var alphaToggle = document.getElementById('cc-alpha-toggle');
  var alphaSlider = document.getElementById('cc-alpha-slider');
  var alphaValueEl = document.getElementById('cc-alpha-value');

  if (!inputEl || !pickerEl || !swatchEl) return;

  if (!C) {
    T.util.toast('颜色引擎未能加载');
    return;
  }

  /* --- 状态 -------------------------------------------------------------- */
  var DEFAULT = '#6c5ce7';
  var currentRgb = { r: 108, g: 92, b: 231 };

  /* ======================================================================
     一、渲染
     ====================================================================== */

  function getAlpha() {
    if (!alphaToggle || !alphaToggle.checked) return 1;
    return parseInt(alphaSlider.value, 10) / 100;
  }

  /** 两位小数的 alpha，去掉多余的 0 */
  function alphaText(a) {
    return String(Math.round(a * 100) / 100);
  }

  function renderValues(rgb, hsl, cmyk, hwb, alpha) {
    var hasAlpha = alpha < 1;
    var hex = C.rgbToHex(rgb.r, rgb.g, rgb.b);
    var rows = [];

    if (hasAlpha) {
      var a255 = Math.round(alpha * 255).toString(16);
      if (a255.length === 1) a255 = '0' + a255;
      rows.push(['HEX', hex + a255]);
      rows.push(['RGB', 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' + alphaText(alpha) + ')']);
      rows.push(['HSL', 'hsla(' + hsl.h + ', ' + hsl.s + '%, ' + hsl.l + '%, ' + alphaText(alpha) + ')']);
    } else {
      rows.push(['HEX', hex]);
      rows.push(['RGB', 'rgb(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ')']);
      rows.push(['HSL', 'hsl(' + hsl.h + ', ' + hsl.s + '%, ' + hsl.l + '%)']);
    }

    rows.push(['CMYK', 'cmyk(' + cmyk.c + '%, ' + cmyk.m + '%, ' + cmyk.y + '%, ' + cmyk.k + '%)']);
    rows.push(['HWB', 'hwb(' + hwb.h + ' ' + hwb.w + '% ' + hwb.b + '%)']);

    valuesEl.innerHTML = rows.map(function (row) {
      return '<button class="value-row" type="button" data-value="' + esc(row[1]) + '">' +
        '<span class="value-label">' + row[0] + '</span>' +
        '<span class="value-text">' + esc(row[1]) + '</span>' +
        '</button>';
    }).join('');
  }

  function renderCssName(rgb) {
    if (!cssNameEl) return;

    var closest = C.closestName(rgb);
    cssNameEl.innerHTML =
      '<span class="css-name-swatch" style="background:' + closest.name + '"></span>' +
      '<span>' + (closest.exact ? 'CSS 颜色名：' : '最接近的 CSS 颜色名：') +
      '<strong>' + esc(closest.name) + '</strong>' +
      (closest.exact ? '（精确匹配）' : '（距离 ' + closest.distance + '）') +
      '</span>';
  }

  /** 让滑杆的轨道从透明渐变到当前色，直观反映 alpha */
  function renderAlphaTrack(rgb) {
    if (!alphaSlider) return;
    var hex = C.rgbToHex(rgb.r, rgb.g, rgb.b);
    alphaSlider.style.background =
      'linear-gradient(90deg, transparent, ' + hex + ')';
  }

  function render() {
    var alpha = getAlpha();
    var hasAlpha = alpha < 1;
    var hex = C.rgbToHex(currentRgb.r, currentRgb.g, currentRgb.b);

    swatchEl.style.background = hasAlpha
      ? 'rgba(' + currentRgb.r + ',' + currentRgb.g + ',' + currentRgb.b + ',' + alpha + ')'
      : hex;
    swatchEl.setAttribute('aria-label', '当前颜色 ' + hex + (hasAlpha ? '，透明度 ' + Math.round(alpha * 100) + '%' : ''));

    renderValues(
      currentRgb,
      C.rgbToHsl(currentRgb.r, currentRgb.g, currentRgb.b),
      C.rgbToCmyk(currentRgb.r, currentRgb.g, currentRgb.b),
      C.rgbToHwb(currentRgb.r, currentRgb.g, currentRgb.b),
      alpha
    );
    renderCssName(currentRgb);
    renderAlphaTrack(currentRgb);
  }

  /* ======================================================================
     二、主流程
     ====================================================================== */

  /**
   * 设置当前颜色。
   * @param {string|object} value 色值字符串或 {r,g,b}
   * @param {object} [opts] { keepInput: true } 时不覆盖文本输入框
   * @returns {boolean} 是否解析成功
   */
  function setColor(value, opts) {
    var rgb = (value && typeof value === 'object') ? value : C.parseColor(value);
    if (!rgb) return false;

    currentRgb = { r: rgb.r, g: rgb.g, b: rgb.b };
    var hex = C.rgbToHex(rgb.r, rgb.g, rgb.b);

    pickerEl.value = hex;
    if (!opts || !opts.keepInput) inputEl.value = hex;
    inputEl.classList.remove('input--invalid');

    render();
    return true;
  }

  /* ======================================================================
     三、事件
     ====================================================================== */

  /* 文本输入：解析得了就更新，解析不了只标红，不动当前颜色 */
  inputEl.addEventListener('input', function () {
    var raw = inputEl.value.trim();
    if (!raw) { inputEl.classList.remove('input--invalid'); return; }

    if (C.parseColor(raw)) {
      setColor(raw, { keepInput: true });
    } else {
      inputEl.classList.add('input--invalid');
    }
  });

  inputEl.addEventListener('blur', function () {
    if (!C.parseColor(inputEl.value)) {
      inputEl.value = C.rgbToHex(currentRgb.r, currentRgb.g, currentRgb.b);
    }
    inputEl.classList.remove('input--invalid');
  });

  /* 系统取色盘 */
  pickerEl.addEventListener('input', function () {
    setColor(pickerEl.value);
  });

  /* 透明度 */
  if (alphaToggle) {
    alphaToggle.addEventListener('change', function () {
      alphaSlider.disabled = !alphaToggle.checked;
      render();
    });
  }

  if (alphaSlider) {
    alphaSlider.addEventListener('input', function () {
      if (alphaValueEl) alphaValueEl.textContent = alphaSlider.value + '%';
      render();
    });
  }

  /* 点击色值行复制 */
  valuesEl.addEventListener('click', function (e) {
    var row = e.target.closest('[data-value]');
    if (!row) return;
    T.util.copy(row.getAttribute('data-value'), row);
  });

  /* ======================================================================
     四、首屏
     ====================================================================== */

  if (alphaSlider) alphaSlider.disabled = !(alphaToggle && alphaToggle.checked);
  if (alphaValueEl && alphaSlider) alphaValueEl.textContent = alphaSlider.value + '%';

  setColor(DEFAULT);
})();
