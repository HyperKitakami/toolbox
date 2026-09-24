/* ==========================================================================
   gradient-generator.js — 渐变生成器
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 gradient-generator（MIT），改动：
     1. 界面文案全量中文化，预设名称也改成中文
     2. 改用本站的设计系统与组件类名；色标列表由逐行 createElement 改为
        一次性 innerHTML + 事件委托
     3. 修复缺陷：上游的「添加色标」把新色标放在「最后一个位置 + 到 100 的一半」。
        默认的 0% / 100% 两个色标算出来还是 100% —— 新色标和末尾完全重合，
        点完按钮看不出任何变化。现在插在空隙最大的区间中点。
     4. 修复缺陷：上游文本框输入非法色值时没有任何反馈。现在标红 + 失焦回退。
     5. 修复无障碍：删除按钮只有一个 × 字形，没有可读的名字，补上 aria-label；
        预览区原来挂 aria-live 但没有文本，读屏会念一个空 div，改成 role="img"。
     6. 修复缺陷：上游完全随机取 RGB，经常得到两个几乎一样的灰，渐变糊成一片。
        现在先取基准色相，让各色标沿色相环铺开（跨度 40°–180°），
        饱和度与明度也限制在有彩色的区间里。
     7. 新增色标位置轴，拖动位置滑杆时能直接看到各色标落在轴的哪儿
     8. 新增「重复」开关，生成 repeating-* 渐变
     9. 去掉上游的 HAS_COLOR_UTILS 非阻塞降级。本站的 color-utils.js 是同仓库文件，
        不存在「被拦截器挡掉」这种情况，统一成与其他颜色工具一致的退出方式。
    10. 颜色换算改用 js/color-utils.js（见该文件头的改动说明）
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var esc = T.util.esc;
  var C = T.color;

  /* --- DOM --------------------------------------------------------------- */
  var typeEl    = document.getElementById('gg-type');
  var angleEl   = document.getElementById('gg-angle');
  var angleGroup = document.getElementById('gg-angle-group');
  var repeatEl  = document.getElementById('gg-repeat');
  var addBtn    = document.getElementById('gg-add-stop');
  var stopsEl   = document.getElementById('gg-stops');
  var previewEl = document.getElementById('gg-preview');
  var axisEl    = document.getElementById('gg-axis');
  var cssEl     = document.getElementById('gg-css');
  var cssTextEl = document.getElementById('gg-css-text');
  var copyBtn   = document.getElementById('gg-copy');
  var randomBtn = document.getElementById('gg-random');
  var presetsEl = document.getElementById('gg-presets');

  if (!typeEl || !stopsEl || !previewEl) return;

  if (!C) {
    T.util.toast('颜色引擎未能加载');
    return;
  }

  /* --- 常量 -------------------------------------------------------------- */
  var MIN_STOPS = 2;
  var MAX_STOPS = 10;

  /* 预设色标写成 [色值, 位置] 的数组，比逐个建对象紧凑 */
  var PRESETS = [
    { name: '日落',   stops: [['#ee9ca7', 0], ['#ffdde1', 100]] },
    { name: '海洋',   stops: [['#2193b0', 0], ['#6dd5ed', 100]] },
    { name: '极光',   stops: [['#00c9ff', 0], ['#92fe9d', 100]] },
    { name: '天鹅绒', stops: [['#c33764', 0], ['#1d2671', 100]] },
    { name: '蜜桃',   stops: [['#ffecd2', 0], ['#fcb69f', 100]] },
    { name: '霓虹',   stops: [['#12c2e9', 0], ['#c471ed', 50], ['#f64f59', 100]] },
    { name: '森林',   stops: [['#134e5e', 0], ['#71b280', 100]] },
    { name: '糖果',   stops: [['#fc5c7d', 0], ['#6a82fb', 100]] },
    { name: '火焰',   stops: [['#f12711', 0], ['#f5af19', 100]] },
    { name: '冰霜',   stops: [['#000428', 0], ['#004e92', 100]] }
  ];

  /* --- 状态 -------------------------------------------------------------- */
  var stops = [{ color: '#6c5ce7', position: 0 }, { color: '#00cec9', position: 100 }];
  var type = 'linear';
  var angle = 135;
  var repeating = false;

  /* ======================================================================
     一、生成 CSS
     ====================================================================== */

  function gradientCss() {
    var colorStr = stops.map(function (s) {
      return s.color + ' ' + s.position + '%';
    }).join(', ');

    var prefix = repeating ? 'repeating-' : '';
    var head;

    if (type === 'radial') head = prefix + 'radial-gradient(circle';
    else if (type === 'conic') head = prefix + 'conic-gradient(from ' + angle + 'deg';
    else head = prefix + 'linear-gradient(' + angle + 'deg';

    return head + ', ' + colorStr + ')';
  }

  /**
   * 找一个空隙最大的区间，把新色标插在中间。
   *
   * 上游用的是「最后一个位置 + 到 100 的一半」—— 默认的 0% / 100% 两个色标
   * 算出来还是 100%，新色标和末尾完全重合，点完按钮看不出任何变化。
   * 并列时取靠后的空隙，观感上更像往后追加。
   */
  function nextStopPosition() {
    var sorted = stops.map(function (s) { return s.position; })
      .sort(function (a, b) { return a - b; });

    var bestGap = -1;
    var bestPos = 50;

    for (var i = 0; i < sorted.length - 1; i++) {
      var gap = sorted[i + 1] - sorted[i];
      if (gap >= bestGap) {
        bestGap = gap;
        bestPos = Math.round((sorted[i] + sorted[i + 1]) / 2);
      }
    }

    return bestPos;
  }

  /* ======================================================================
     二、渲染
     ====================================================================== */

  function renderStops() {
    var canRemove = stops.length > MIN_STOPS;

    stopsEl.innerHTML = stops.map(function (s, i) {
      var n = i + 1;

      return '<div class="grad-stop" data-idx="' + i + '">' +
        '<input type="color" class="color-input color-input--sm" value="' + esc(s.color) + '" ' +
          'aria-label="第 ' + n + ' 个色标的颜色">' +
        '<input type="text" class="input input--mono grad-stop-hex" value="' + esc(s.color) + '" ' +
          'spellcheck="false" autocomplete="off" autocapitalize="off" ' +
          'aria-label="第 ' + n + ' 个色标的色值">' +
        '<input type="range" class="range grad-stop-pos" min="0" max="100" value="' + s.position + '" ' +
          'aria-label="第 ' + n + ' 个色标的位置">' +
        '<span class="num-value grad-stop-posval">' + s.position + '%</span>' +
        (canRemove
          ? '<button class="btn btn--icon btn--sm grad-stop-del" type="button" ' +
            'data-del="' + i + '" title="删除这个色标" aria-label="删除第 ' + n + ' 个色标">×</button>'
          : '') +
        '</div>';
    }).join('');
  }

  /** 色标位置轴：把每个色标按位置摆在一根细轴上 */
  function renderAxis() {
    axisEl.innerHTML = stops.map(function (s) {
      return '<span class="grad-axis-mark" style="left:' + s.position + '%;background:' + esc(s.color) + '" ' +
        'title="' + s.position + '%"></span>';
    }).join('');
  }

  function renderPresets() {
    presetsEl.innerHTML = PRESETS.map(function (p, i) {
      var css = 'linear-gradient(135deg, ' + p.stops.map(function (s) {
        return s[0] + ' ' + s[1] + '%';
      }).join(', ') + ')';

      return '<button class="grad-preset" type="button" data-preset="' + i + '" ' +
        'aria-label="套用预设：' + esc(p.name) + '">' +
        '<span class="grad-preset-swatch" style="background:' + css + '"></span>' +
        '<span class="grad-preset-name">' + esc(p.name) + '</span></button>';
    }).join('');
  }

  function update() {
    var css = gradientCss();

    previewEl.style.background = css;
    previewEl.setAttribute('aria-label', '渐变预览：' + css);
    cssTextEl.textContent = 'background: ' + css + ';';

    if (addBtn) addBtn.disabled = stops.length >= MAX_STOPS;

    renderAxis();
  }

  /** 径向渐变没有角度，把它连同标签一起收起来 */
  function syncAngle() {
    if (!angleGroup) return;
    angleGroup.style.display = (type === 'linear' || type === 'conic') ? '' : 'none';
  }

  /* ======================================================================
     三、随机
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
   * 随机一套渐变。
   *
   * 上游是完全随机取 RGB —— 经常得到两个几乎一样的灰，渐变糊成一片。
   * 这里先取一个基准色相，再让各色标沿色相环铺开（跨度 40°–180°），
   * 饱和度与明度也限制在有彩色的区间里，出来的结果至少是「能用」的。
   */
  function randomGradient() {
    var count = 2 + Math.floor(rand() * 2);        /* 2 或 3 个色标 */
    var hue = Math.floor(rand() * 360);
    var spread = 40 + Math.floor(rand() * 141);    /* 40°–180° */

    stops = [];
    for (var i = 0; i < count; i++) {
      var c = C.hslToRgb(
        hue + Math.round(spread * i / (count - 1)),
        45 + Math.floor(rand() * 51),              /* 45%–95% */
        35 + Math.floor(rand() * 36)               /* 35%–70% */
      );

      stops.push({
        color: C.rgbToHex(c.r, c.g, c.b),
        position: Math.round(i / (count - 1) * 100)
      });
    }

    angle = Math.floor(rand() * 360);
    angleEl.value = String(angle);

    renderStops();
    update();
  }

  /* ======================================================================
     四、事件
     ====================================================================== */

  typeEl.addEventListener('change', function () {
    type = typeEl.value;
    syncAngle();
    update();
  });

  angleEl.addEventListener('input', function () {
    var v = parseInt(angleEl.value, 10);
    if (!isFinite(v)) return;          /* 输入框被清空时保持原角度 */
    angle = Math.max(0, Math.min(360, v));
    update();
  });

  if (repeatEl) {
    repeatEl.addEventListener('change', function () {
      repeating = repeatEl.checked;
      update();
    });
  }

  /* 色标列表：事件委托，避免每次重渲染都重新绑定 */
  stopsEl.addEventListener('input', function (e) {
    var row = e.target.closest('[data-idx]');
    if (!row) return;

    var i = Number(row.getAttribute('data-idx'));

    if (e.target.classList.contains('grad-stop-pos')) {
      stops[i].position = parseInt(e.target.value, 10);
      row.querySelector('.grad-stop-posval').textContent = e.target.value + '%';
      update();
      return;
    }

    if (e.target.classList.contains('grad-stop-hex')) {
      var raw = e.target.value.trim();
      if (!raw) { e.target.classList.remove('input--invalid'); return; }

      var rgb = C.parseColor(raw);
      if (rgb) {
        stops[i].color = C.rgbToHex(rgb.r, rgb.g, rgb.b);
        row.querySelector('.color-input').value = stops[i].color;
        e.target.classList.remove('input--invalid');
        update();
      } else {
        e.target.classList.add('input--invalid');
      }
      return;
    }

    if (e.target.type === 'color') {
      stops[i].color = e.target.value;
      var hexInput = row.querySelector('.grad-stop-hex');
      hexInput.value = e.target.value;
      hexInput.classList.remove('input--invalid');
      update();
    }
  });

  /* 失焦时把色值规范化。blur 不冒泡，所以用 focusout。 */
  stopsEl.addEventListener('focusout', function (e) {
    if (!e.target.classList || !e.target.classList.contains('grad-stop-hex')) return;

    var row = e.target.closest('[data-idx]');
    var i = Number(row.getAttribute('data-idx'));
    var rgb = C.parseColor(e.target.value);

    if (rgb) {
      stops[i].color = C.rgbToHex(rgb.r, rgb.g, rgb.b);
      e.target.value = stops[i].color;
      row.querySelector('.color-input').value = stops[i].color;
    } else {
      e.target.value = stops[i].color;
    }

    e.target.classList.remove('input--invalid');
    update();
  });

  stopsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del]');
    if (!btn) return;

    stops.splice(Number(btn.getAttribute('data-del')), 1);
    renderStops();
    update();
  });

  if (addBtn) {
    addBtn.addEventListener('click', function () {
      if (stops.length >= MAX_STOPS) {
        T.util.toast('最多 ' + MAX_STOPS + ' 个色标');
        return;
      }

      stops.push({ color: '#ffffff', position: nextStopPosition() });
      renderStops();
      update();
    });
  }

  presetsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-preset]');
    if (!btn) return;

    var preset = PRESETS[Number(btn.getAttribute('data-preset'))];
    stops = preset.stops.map(function (s) {
      return { color: s[0], position: s[1] };
    });

    renderStops();
    update();
  });

  if (randomBtn) randomBtn.addEventListener('click', randomGradient);

  /* R 键随机。焦点在输入框里时不触发。 */
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'r' || e.key === 'R') randomGradient();
  });

  /* 复制 CSS：点代码框或点按钮都行 */
  function copyCss() {
    T.util.copy(cssTextEl.textContent, cssEl);
  }

  cssEl.addEventListener('click', copyCss);
  cssEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      copyCss();
    }
  });

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      T.util.copy(cssTextEl.textContent, copyBtn);
    });
  }

  /* ======================================================================
     五、首屏
     ====================================================================== */

  renderPresets();
  renderStops();
  syncAngle();
  update();
})();
