/* ==========================================================================
   contrast-checker.js — 对比度检查
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 contrast-checker（MIT），改动：
     1. 界面文案全量中文化；预览示例换成中文，并按 WCAG 对「大字」的定义标注字号
     2. 改用本站的设计系统与组件类名（badge--pass / badge--fail 等）
     3. 修复缺陷：上游的「建议修复」只朝一个方向调明度 —— 背景亮度 ≤ 0.5 就一律提亮。
        但 #707070 到 #bcbcbc 这一大片灰背景往亮调到不了 4.5:1，往暗调却有解，
        上游会错误地报「无法修复」。现在两个方向同时向外试探，取改动最小的解；
        算法放在 js/color-utils.js 的 fixContrast()，后续工具可复用。
     4. 修复缺陷：上游非法输入只有红框、不做回退；修复后也无法还原。
        现在失焦时回退到当前值，修复后提供「撤销」。
     5. 新增目标级别选择（AA 正文 / AA 大字 / AAA 正文），上游固定按 4.5:1 修
     6. 新增「距下一档还差多少」，以及无解时给出背景色的对比度上限
     7. 新增批量检查：一次算出一组前景色对当前背景色的达标情况
     8. 颜色换算与对比度改用 js/color-utils.js（见该文件头的改动说明）
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var esc = T.util.esc;
  var C = T.color;

  /* --- DOM --------------------------------------------------------------- */
  var fgPicker = document.getElementById('cc-fg-picker');
  var fgText   = document.getElementById('cc-fg-text');
  var bgPicker = document.getElementById('cc-bg-picker');
  var bgText   = document.getElementById('cc-bg-text');
  var swapBtn  = document.getElementById('cc-swap');

  var previewEl = document.getElementById('cc-preview');
  var ratioEl   = document.getElementById('cc-ratio');
  var badgesEl  = document.getElementById('cc-badges');
  var gapEl     = document.getElementById('cc-gap');

  var targetEl  = document.getElementById('cc-target');
  var fixBtn    = document.getElementById('cc-fix');
  var undoBtn   = document.getElementById('cc-undo');
  var fixNoteEl = document.getElementById('cc-fix-note');

  var batchInput = document.getElementById('cc-batch-input');
  var batchBox   = document.getElementById('cc-batch-result');
  var batchClear = document.getElementById('cc-batch-clear');

  if (!fgPicker || !bgPicker || !badgesEl) return;

  if (!C) {
    T.util.toast('颜色引擎未能加载');
    return;
  }

  /* --- 状态 -------------------------------------------------------------- */
  var DEFAULT_FG = '#e4e6ed';
  var DEFAULT_BG = '#0f1117';
  var DEFAULT_BATCH = '#ffffff\n#8b94a3\n#4b5563';

  var fg = { r: 228, g: 230, b: 237 };
  var bg = { r: 15, g: 17, b: 23 };

  /* 建议修复前的色值；null 表示当前没有可撤销的操作 */
  var undoHex = null;

  /* ======================================================================
     一、判定与渲染
     ====================================================================== */

  var round2 = function (n) { return Math.round(n * 100) / 100; };

  /** 比值所在的最高档位 */
  function tierOf(ratio) {
    if (ratio >= 7) return { label: 'AAA 正文', mod: 'pass' };
    if (ratio >= 4.5) return { label: 'AA 正文', mod: 'accent' };
    if (ratio >= 3) return { label: 'AA 大字', mod: 'warn' };
    return { label: '不达标', mod: 'fail' };
  }

  /** 距离下一档还差多少 */
  function gapText(ratio) {
    if (ratio >= 7) return '四档标准全部满足。';

    var next = ratio >= 4.5 ? { need: 7, label: 'AAA 正文' }
             : ratio >= 3   ? { need: 4.5, label: 'AA 正文' }
             :                { need: 3, label: 'AA 大字' };

    return '距「' + next.label + '」' + next.need + ':1 还差 ' + round2(next.need - ratio) + '。';
  }

  function render() {
    var ratio = C.contrastRatio(fg, bg);
    var fgHex = C.rgbToHex(fg.r, fg.g, fg.b);
    var bgHex = C.rgbToHex(bg.r, bg.g, bg.b);

    previewEl.style.color = fgHex;
    previewEl.style.backgroundColor = bgHex;

    ratioEl.textContent = round2(ratio) + ':1';
    ratioEl.className = 'badge badge--' + tierOf(ratio).mod;

    badgesEl.innerHTML = C.wcagLevels(ratio).map(function (lv) {
      return '<span class="badge badge--' + (lv.pass ? 'pass' : 'fail') + '">' +
        (lv.pass ? '✓' : '✗') + ' ' + esc(lv.label) +
        '<span class="faint"> ≥' + lv.need + '</span></span>';
    }).join('');

    if (gapEl) gapEl.textContent = gapText(ratio);
  }

  /* ======================================================================
     二、批量检查
     ====================================================================== */

  function renderBatch() {
    var lines = batchInput.value.split('\n');
    var items = [];

    lines.forEach(function (line, i) {
      var raw = line.trim();
      if (!raw) return;

      var rgb = C.parseColor(raw);
      if (rgb) items.push({ rgb: rgb });
      else items.push({ bad: raw, line: i + 1 });
    });

    if (!items.length) {
      T.util.emptyHint(batchBox, '还没有输入',
        '在上面每行写一个颜色，就会逐个算出它和当前背景色的对比度。', 'table-empty');
      return;
    }

    batchBox.innerHTML = items.map(function (it) {
      if (it.bad) {
        return '<div class="batch-row batch-row--bad">' +
          '<span class="batch-swatch batch-swatch--bad" aria-hidden="true">!</span>' +
          '<span class="batch-hex">' + esc(it.bad) + '</span>' +
          '<span class="batch-ratio">第 ' + it.line + ' 行不是颜色</span>' +
          '</div>';
      }

      var hex = C.rgbToHex(it.rgb.r, it.rgb.g, it.rgb.b);
      var ratio = C.contrastRatio(it.rgb, bg);
      var tier = tierOf(ratio);

      return '<div class="batch-row">' +
        '<span class="batch-swatch" style="background:' + hex + '" aria-hidden="true"></span>' +
        '<span class="batch-hex">' + hex + '</span>' +
        '<span class="batch-ratio">' + round2(ratio) + ':1</span>' +
        '<span class="badge badge--' + tier.mod + '">' + esc(tier.label) + '</span>' +
        '</div>';
    }).join('');
  }

  /* ======================================================================
     三、设色
     ====================================================================== */

  /**
   * 设置前景或背景色。
   * @param {'fg'|'bg'} side
   * @param {string|{r,g,b}} input
   * @param {boolean} [keepText] 不覆盖文本框（用户正在输入时用）
   * @returns {boolean} 是否解析成功
   */
  function setColor(side, input, keepText) {
    var rgb = (input && typeof input === 'object') ? input : C.parseColor(input);
    if (!rgb) return false;

    var hex = C.rgbToHex(rgb.r, rgb.g, rgb.b);

    if (side === 'fg') {
      fg = { r: rgb.r, g: rgb.g, b: rgb.b };
      fgPicker.value = hex;
      if (!keepText) fgText.value = hex;
      fgText.classList.remove('input--invalid');
    } else {
      bg = { r: rgb.r, g: rgb.g, b: rgb.b };
      bgPicker.value = hex;
      if (!keepText) bgText.value = hex;
      bgText.classList.remove('input--invalid');
    }

    render();
    renderBatch();   /* 背景色变了，批量结果要跟着重算 */
    return true;
  }

  function currentHex(side) {
    var c = side === 'fg' ? fg : bg;
    return C.rgbToHex(c.r, c.g, c.b);
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
      else textEl.value = currentHex(side);
      textEl.classList.remove('input--invalid');
    });

    pickerEl.addEventListener('input', function () {
      setColor(side, pickerEl.value);
    });
  }

  bindSide('fg', fgPicker, fgText);
  bindSide('bg', bgPicker, bgText);

  /* 交换两色。对比度是对称的，所以比值不变 —— 预览区会跟着换过来。 */
  if (swapBtn) {
    swapBtn.addEventListener('click', function () {
      var rgb = fg;
      fg = bg;
      bg = rgb;

      fgPicker.value = currentHex('fg');
      bgPicker.value = currentHex('bg');
      fgText.value = fgPicker.value;
      bgText.value = bgPicker.value;
      fgText.classList.remove('input--invalid');
      bgText.classList.remove('input--invalid');

      render();
      renderBatch();
    });
  }

  /* 建议修复：保持色相与饱和度，只调明度到达标 */
  if (fixBtn) {
    fixBtn.addEventListener('click', function () {
      var target = parseFloat(targetEl.value) || 4.5;
      var res = C.fixContrast(fg, bg, target);

      if (res.ok) {
        var before = currentHex('fg');
        var after = C.rgbToHex(res.rgb.r, res.rgb.g, res.rgb.b);

        undoHex = before;
        setColor('fg', res.rgb);
        undoBtn.hidden = false;

        fixNoteEl.textContent = '已把前景色从 ' + before + ' 调到 ' + after +
          '（明度调整 ' + res.delta + ' 个百分点），对比度 ' +
          round2(C.contrastRatio(res.rgb, bg)) + ':1。';
        return;
      }

      if (res.reason === 'already') {
        fixNoteEl.textContent = '当前配色已经达到 ' + target + ':1，无需调整。';
        return;
      }

      /* 无解：背景色的亮度决定了它能达到的对比度上限，这时候要改的是背景色 */
      fixNoteEl.textContent = '保持色相与饱和度的前提下调整明度到不了 ' + target + ':1 —— ' +
        '当前背景色的对比度上限是 ' + round2(C.maxContrast(bg)) + ':1，得换背景色才行。';
    });
  }

  if (undoBtn) {
    undoBtn.addEventListener('click', function () {
      if (!undoHex) return;

      setColor('fg', undoHex);
      undoHex = null;
      undoBtn.hidden = true;
      fixNoteEl.textContent = '已还原到调整前的颜色。';
    });
  }

  /* 批量检查 */
  batchInput.addEventListener('input', T.util.debounce(renderBatch, 90));

  if (batchClear) {
    batchClear.addEventListener('click', function () {
      batchInput.value = '';
      renderBatch();
      batchInput.focus();
    });
  }

  /* ======================================================================
     五、首屏
     ====================================================================== */

  batchInput.value = DEFAULT_BATCH;
  setColor('fg', DEFAULT_FG);
  setColor('bg', DEFAULT_BG);
})();
