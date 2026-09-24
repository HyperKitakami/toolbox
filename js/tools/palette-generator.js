/* ==========================================================================
   palette-generator.js — 调色板生成
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 palette-generator（MIT），改动：
     1. 界面文案全量中文化，六种配色方案都配上中文名与说明
     2. 改用本站的设计系统与组件类名，去掉上游的逐块 createElement 与内联样式
     3. 修复缺陷：上游把配色结果挂在 window._paletteColors 上供导出与复制读取，
        污染全局命名空间。改为模块内变量。
     4. 修复缺陷：文本框输入非法色值时没有任何反馈 —— 不报错也不标红。
        现在标红，失焦时回退到当前值。
     5. 修复无障碍问题：上游把空格键绑成「随机」并 preventDefault，
        键盘用户按空格想滚动页面时页面不动、颜色却被换掉。改为 R 键，
        且焦点在输入框里时不触发。
     6. 修复不一致：显示配色用双空格连接、复制却用「, 」，统一为「, 」。
     7. 修复偏色：配色里「偏移 0」的那一项本该是主色本身，但上游把它交给
        hslToRgb 重新算了一遍 —— h/s/l 是取整后的整数，往返换算有 ±1 误差，
        于是主色在结果里偏了一档（#6c5ce7 变 #6b5be6）。现在这一项直接返回原值。
     8. 补上单色方案的说明。上游固定取 20%–80% 五级明度，主色自身的明度不参与，
        界面上不写清楚会让人以为「我的颜色丢了」。
     9. 随机改用 crypto.getRandomValues（带 Math.random 回退），并在 HSL 空间的
        有彩色区间取值 —— 完全随机取 RGB 经常得到发灰或过暗过亮的颜色，配出来没法用。
    10. 新增 11 级明暗色阶。它与「单色」方案不是一回事：单色是配色方案（5 色），
        色阶是给设计令牌用的（11 级、跨度更大）。
    11. 新增 JSON 导出；导出改为点击即复制并给出反馈（上游复制后没有任何提示）
    12. 颜色换算改用 js/color-utils.js（见该文件头的改动说明）
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var esc = T.util.esc;
  var C = T.color;

  /* --- DOM --------------------------------------------------------------- */
  var pickerEl   = document.getElementById('pg-picker');
  var textEl     = document.getElementById('pg-text');
  var randomBtn  = document.getElementById('pg-random');
  var harmonyBox = document.getElementById('pg-harmonies');
  var harmonyNoteEl = document.getElementById('pg-harmony-note');
  var gridEl     = document.getElementById('pg-palette');
  var copyPaletteBtn = document.getElementById('pg-copy-palette');
  var exportBox  = document.querySelector('.palette-export');
  var stripEl    = document.getElementById('pg-shades');
  var copyShadesBtn = document.getElementById('pg-copy-shades');

  if (!pickerEl || !gridEl || !harmonyBox) return;

  if (!C) {
    T.util.toast('颜色引擎未能加载');
    return;
  }

  /* --- 常量 -------------------------------------------------------------- */
  var DEFAULT = '#6c5ce7';

  /* 单色方案的明度级别。沿用上游的取值。 */
  var MONO_LEVELS = [20, 35, 50, 65, 80];

  /* 明暗色阶的明度级别 */
  var SHADE_LEVELS = [95, 90, 82, 72, 62, 52, 42, 34, 26, 18, 12];

  /* 各方案相对主色相的偏移量（度） */
  var HUE_OFFSETS = {
    complementary: [0, 180],
    analogous: [-30, 0, 30],
    triadic: [0, 120, 240],
    split: [0, 150, 210],
    tetradic: [0, 90, 180, 270]
  };

  var HARMONIES = [
    { id: 'complementary', name: '互补',
      note: '色环正对面的一对颜色（相差 180°），对比最强，适合做主色配强调色。' },
    { id: 'analogous', name: '类似',
      note: '取相邻的 ±30°，观感柔和统一，适合做渐层或同一区域的多个层次。' },
    { id: 'triadic', name: '三角',
      note: '等距三分（120°），鲜明又不失衡，是最常用的多色方案。' },
    { id: 'split', name: '分裂互补',
      note: '互补色两侧各取一个（+150° / +210°），比正互补更耐看。' },
    { id: 'tetradic', name: '四方',
      note: '等距四分（90°），颜色最丰富也最难平衡，通常要再分主次。' },
    { id: 'monochromatic', name: '单色',
      note: '只用一个色相，固定取 20%–80% 五级明度 —— 主色自身的明度不参与，所以结果里未必有它。' }
  ];

  var harmonyById = {};
  HARMONIES.forEach(function (h) { harmonyById[h.id] = h; });

  /* --- 状态 -------------------------------------------------------------- */
  var base = { r: 108, g: 92, b: 231 };
  var harmony = 'triadic';
  var paletteColors = [];
  var shadeColors = [];

  /* ======================================================================
     一、配色方案
     ====================================================================== */

  function renderHarmonies() {
    harmonyBox.innerHTML = HARMONIES.map(function (h) {
      return '<button class="choice-chip" type="button" data-harmony="' + h.id + '" ' +
        'aria-pressed="' + (h.id === harmony) + '">' + esc(h.name) + '</button>';
    }).join('');
  }

  function syncHarmony() {
    var cur = harmonyById[harmony] || HARMONIES[0];

    T.util.$$('.choice-chip', harmonyBox).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-harmony') === harmony));
    });

    if (harmonyNoteEl) harmonyNoteEl.textContent = cur.note;
  }

  /**
   * 生成当前方案的配色。
   *
   * 除单色外都沿用主色的饱和度与明度、只改色相 —— 这样出来的几个颜色亮度一致，
   * 摆在一起不会有某个色特别抢眼。hslToRgb 内部会把超出的角度绕回 [0, 360)。
   */
  function buildPalette() {
    var hsl = C.rgbToHsl(base.r, base.g, base.b);

    if (harmony === 'monochromatic') {
      return MONO_LEVELS.map(function (l) {
        var c = C.hslToRgb(hsl.h, hsl.s, l);
        return C.rgbToHex(c.r, c.g, c.b);
      });
    }

    return (HUE_OFFSETS[harmony] || [0]).map(function (d) {
      /* 偏移为 0 的那一项就是主色本身，直接返回原值。
         hslToRgb 拿到的是取整后的 h/s/l，往返换算会有 ±1 误差 ——
         不特判的话，配色里的「主色」会比用户输入的颜色偏一档（#6c5ce7 变 #6b5be6）。 */
      if (d === 0) return C.rgbToHex(base.r, base.g, base.b);

      var c = C.hslToRgb(hsl.h + d, hsl.s, hsl.l);
      return C.rgbToHex(c.r, c.g, c.b);
    });
  }

  /* ======================================================================
     二、明暗色阶
     ====================================================================== */

  /**
   * 明度越靠近两端，饱和度收得越多 —— 浅色不至于发荧光、深色不至于发焦。
   * 系数取 sin 的钟形：两端约 0.45–0.62，中间几级保持主色的饱和度。
   */
  function shadeSaturation(baseS, l) {
    return Math.round(baseS * (0.45 + 0.55 * Math.sin(Math.PI * l / 100)));
  }

  function buildShades() {
    var hsl = C.rgbToHsl(base.r, base.g, base.b);

    return SHADE_LEVELS.map(function (l) {
      var c = C.hslToRgb(hsl.h, shadeSaturation(hsl.s, l), l);
      return C.rgbToHex(c.r, c.g, c.b);
    });
  }

  /* ======================================================================
     三、渲染
     ====================================================================== */

  function renderPalette() {
    paletteColors = buildPalette();

    gridEl.innerHTML = paletteColors.map(function (hex) {
      return '<button class="palette-chip" type="button" data-hex="' + hex + '" ' +
        'title="点击复制 ' + hex + '" aria-label="' + hex + '">' +
        '<span class="palette-chip-color" style="background:' + hex + '"></span>' +
        '<span class="palette-chip-code">' + hex + '</span></button>';
    }).join('');
  }

  function renderShades() {
    shadeColors = buildShades();

    stripEl.innerHTML = shadeColors.map(function (hex) {
      return '<button class="color-cell" type="button" data-hex="' + hex + '" ' +
        'title="点击复制 ' + hex + '" aria-label="' + hex + '">' +
        '<span class="color-cell-color" style="background:' + hex + '"></span>' +
        '<span class="color-cell-code">' + hex + '</span></button>';
    }).join('');
  }

  function refresh() {
    renderPalette();
    renderShades();
  }

  /* ======================================================================
     四、导出
     ====================================================================== */

  var EXPORTS = {
    css: function (colors) {
      return ':root {\n' + colors.map(function (c, i) {
        return '  --color-' + (i + 1) + ': ' + c + ';';
      }).join('\n') + '\n}';
    },
    scss: function (colors) {
      return colors.map(function (c, i) {
        return '$color-' + (i + 1) + ': ' + c + ';';
      }).join('\n');
    },
    tailwind: function (colors) {
      return 'colors: {\n' + colors.map(function (c, i) {
        return "  'color-" + (i + 1) + "': '" + c + "',";
      }).join('\n') + '\n}';
    },
    json: function (colors) {
      return JSON.stringify(colors, null, 2);
    }
  };

  /* ======================================================================
     五、设色
     ====================================================================== */

  function rand() {
    if (window.crypto && window.crypto.getRandomValues) {
      var a = new Uint32Array(1);
      window.crypto.getRandomValues(a);
      return a[0] / 4294967296;
    }
    return Math.random();
  }

  /**
   * 取一个「能用」的随机色。
   * 完全随机取 RGB 经常落在发灰或过暗过亮的区间，配出来没法看，
   * 所以在 HSL 空间的有彩色范围里取：饱和度 35%–95%、明度 30%–70%。
   */
  function randomColor() {
    return C.hslToRgb(
      Math.floor(rand() * 360),
      35 + Math.floor(rand() * 61),
      30 + Math.floor(rand() * 41)
    );
  }

  /**
   * 设置主色。
   * @param {string|{r,g,b}} input
   * @param {boolean} [keepText] 不覆盖文本框（用户正在输入时用）
   * @returns {boolean} 是否解析成功
   */
  function setBase(input, keepText) {
    var rgb = (input && typeof input === 'object') ? input : C.parseColor(input);
    if (!rgb) return false;

    base = { r: rgb.r, g: rgb.g, b: rgb.b };
    var hex = C.rgbToHex(rgb.r, rgb.g, rgb.b);

    pickerEl.value = hex;
    if (!keepText) textEl.value = hex;
    textEl.classList.remove('input--invalid');

    refresh();
    return true;
  }

  /* ======================================================================
     六、事件
     ====================================================================== */

  pickerEl.addEventListener('input', function () {
    setBase(pickerEl.value);
  });

  /* 手动输入色值：解析得了就更新，解析不了只标红，不动当前颜色 */
  textEl.addEventListener('input', function () {
    var raw = textEl.value.trim();
    if (!raw) { textEl.classList.remove('input--invalid'); return; }

    if (C.parseColor(raw)) setBase(raw, true);
    else textEl.classList.add('input--invalid');
  });

  textEl.addEventListener('blur', function () {
    var rgb = C.parseColor(textEl.value);
    if (rgb) setBase(rgb);
    else textEl.value = C.rgbToHex(base.r, base.g, base.b);
    textEl.classList.remove('input--invalid');
  });

  harmonyBox.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-harmony]');
    if (!btn) return;

    harmony = btn.getAttribute('data-harmony');
    syncHarmony();
    renderPalette();
  });

  if (randomBtn) {
    randomBtn.addEventListener('click', function () {
      setBase(randomColor());
    });
  }

  /* R 键随机。上游绑的是空格，那会劫持页面滚动。 */
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'r' || e.key === 'R') setBase(randomColor());
  });

  /* 点色块复制 */
  gridEl.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-hex]');
    if (!chip) return;
    T.util.copy(chip.getAttribute('data-hex'), chip);
  });

  stripEl.addEventListener('click', function (e) {
    var cell = e.target.closest('[data-hex]');
    if (!cell) return;
    T.util.copy(cell.getAttribute('data-hex'), cell);
  });

  if (copyPaletteBtn) {
    copyPaletteBtn.addEventListener('click', function () {
      T.util.copy(paletteColors.join(', '), copyPaletteBtn);
    });
  }

  if (copyShadesBtn) {
    copyShadesBtn.addEventListener('click', function () {
      T.util.copy(shadeColors.join(', '), copyShadesBtn);
    });
  }

  if (exportBox) {
    exportBox.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-export]');
      if (!btn) return;

      var build = EXPORTS[btn.getAttribute('data-export')];
      if (!build) return;

      T.util.copy(build(paletteColors), btn);
    });
  }

  /* ======================================================================
     七、首屏
     ====================================================================== */

  renderHarmonies();
  syncHarmony();
  setBase(DEFAULT);
})();
