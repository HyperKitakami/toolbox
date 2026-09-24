/* ==========================================================================
   color-utils.js — 颜色换算与对比度计算
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 js/color-utils.js（MIT）。颜色类工具共用，
   挂在 window.TOOLBOX.color 上，需在 registry.js 之后加载。

   改动：
     1. hexToRgb 加了校验。上游不做校验，非法输入经 parseInt 得到 NaN，
        (NaN >> 16) & 255 变成 0，于是静默返回黑色 —— 错了也看不出来。
        现在校验失败返回 null。
     2. parseColor 增加浏览器解析兜底。借 getComputedStyle 让浏览器自己
        规范化颜色值，于是颜色名（tomato）、#rrggbbaa、CSS Color 4 的
        rgb(255 0 0) / hsl(120 50% 50%) 语法都能解析，且零依赖。
     3. rgbToHsl 把 360 归一成 0（h 应落在 [0, 360)）。
     4. luminance 的阈值改用 0.04045 —— WCAG 2.2 与 sRGB 规范当前的取值，
        上游用的 0.03928 是 WCAG 2.0/2.1 的旧值。
     5. 新增 wcagLevels()，把 AA / AAA 的阈值集中到一处。
     6. 新增 blendMode() / BLEND_MODES，按 W3C 合成与混合规范实现 16 种混合模式。
        上游没有混合模式，只有线性插值；颜色混合工具需要前者，故补齐。
     7. 新增 fixContrast() / maxContrast()。上游的建议修复只朝一个方向调明度，
        中灰到浅灰那一段背景会漏掉有解的答案，详见函数注释。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var RE_HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

  /* ======================================================================
     一、基础换算
     ====================================================================== */

  /** 解析 #rgb / #rrggbb；非法输入返回 null（上游会静默返回黑色） */
  function hexToRgb(hex) {
    var s = String(hex == null ? '' : hex).trim();
    if (!RE_HEX.test(s)) return null;

    s = s.replace(/^#/, '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];

    var n = parseInt(s, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  /** 各通道裁到 0–255 并补零，永远返回小写 #rrggbb */
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      var h = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('');
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }

    /* 接近正红时 Math.round 会得到 360，归一成 0 */
    return { h: Math.round(h * 360) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    s /= 100; l /= 100;

    var r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;

      var hue2rgb = function (t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };

      r = hue2rgb(h + 1 / 3);
      g = hue2rgb(h);
      b = hue2rgb(h - 1 / 3);
    }

    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

  function rgbToCmyk(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var k = 1 - Math.max(r, g, b);
    if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
    return {
      c: Math.round(((1 - r - k) / (1 - k)) * 100),
      m: Math.round(((1 - g - k) / (1 - k)) * 100),
      y: Math.round(((1 - b - k) / (1 - k)) * 100),
      k: Math.round(k * 100)
    };
  }

  function cmykToRgb(c, m, y, k) {
    c /= 100; m /= 100; y /= 100; k /= 100;
    return {
      r: Math.round(255 * (1 - c) * (1 - k)),
      g: Math.round(255 * (1 - m) * (1 - k)),
      b: Math.round(255 * (1 - y) * (1 - k))
    };
  }

  /**
   * HWB：色相 / 白度 / 黑度。
   * 色相与 HSL 相同；白度取最小分量，黑度取 1 - 最大分量。
   * 注意 w / b 按整数百分比存储，往返换算会有 ±1 误差。
   */
  function rgbToHwb(r, g, b) {
    return {
      h: rgbToHsl(r, g, b).h,
      w: Math.round(Math.min(r, g, b) / 255 * 100),
      b: Math.round((1 - Math.max(r, g, b) / 255) * 100)
    };
  }

  function hwbToRgb(h, w, b) {
    w /= 100; b /= 100;

    /* 白 + 黑超过 100%，按灰度处理 */
    if (w + b >= 1) {
      var gray = Math.round(w / (w + b) * 255);
      return { r: gray, g: gray, b: gray };
    }

    var pure = hslToRgb(h, 100, 50);
    var mix = function (v) { return Math.round((v / 255 * (1 - w - b) + w) * 255); };
    return { r: mix(pure.r), g: mix(pure.g), b: mix(pure.b) };
  }

  /* ======================================================================
     二、对比度
     ====================================================================== */

  /**
   * 相对亮度。
   * 阈值 0.04045 取自 WCAG 2.2 与 sRGB 规范；上游用的 0.03928 是
   * WCAG 2.0 / 2.1 的旧值（两者差异极小，只在通道值约 10.0–10.3 时有区别）。
   */
  function luminance(r, g, b) {
    var a = [r, g, b].map(function (v) {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  function contrastRatio(rgb1, rgb2) {
    var l1 = luminance(rgb1.r, rgb1.g, rgb1.b);
    var l2 = luminance(rgb2.r, rgb2.g, rgb2.b);
    var lighter = Math.max(l1, l2);
    var darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  /** WCAG 的四档标准，阈值集中在这里 */
  function wcagLevels(ratio) {
    return [
      { label: 'AA 正文', need: 4.5, pass: ratio >= 4.5 },
      { label: 'AA 大字', need: 3, pass: ratio >= 3 },
      { label: 'AAA 正文', need: 7, pass: ratio >= 7 },
      { label: 'AAA 大字', need: 4.5, pass: ratio >= 4.5 }
    ];
  }

  /** 给定背景色，任何前景色对它的对比度上限（黑与白之中较大的那个） */
  function maxContrast(bg) {
    var l = luminance(bg.r, bg.g, bg.b);
    return Math.max((l + 0.05) / 0.05, 1.05 / (l + 0.05));
  }

  /**
   * 在保持色相与饱和度的前提下调整前景色的明度，直到对比度达到目标。
   *
   * 上游的「建议修复」只朝一个方向调：背景亮就压暗、背景暗就提亮。
   * 但亮度在 0.18–0.5 之间的背景（#707070 到 #bcbcbc 那一大片灰）往亮调
   * 根本到不了 4.5:1，而往暗调轻松可达 —— 明明有解却报「无法修复」。
   * 这里两个方向同时向外扩，先命中的就是改动最小的解。
   *
   * @param {{r,g,b}} fg     前景色
   * @param {{r,g,b}} bg     背景色
   * @param {number} target  目标对比度
   * @returns {{ok:true, rgb:object, delta:number} |
   *           {ok:false, reason:'already'|'impossible'}}
   *          delta 是明度的改动量（0–100 的百分点）
   */
  function fixContrast(fg, bg, target) {
    if (contrastRatio(fg, bg) >= target) return { ok: false, reason: 'already' };

    var hsl = rgbToHsl(fg.r, fg.g, fg.b);

    for (var d = 1; d <= 100; d++) {
      var levels = [hsl.l - d, hsl.l + d];
      for (var i = 0; i < 2; i++) {
        var l = levels[i];
        if (l < 0 || l > 100) continue;

        var rgb = hslToRgb(hsl.h, hsl.s, l);
        if (contrastRatio(rgb, bg) >= target) {
          return { ok: true, rgb: rgb, delta: d };
        }
      }
    }

    return { ok: false, reason: 'impossible' };
  }

  /** 两色之间按比例线性插值（ratio 0 → rgb1，1 → rgb2）。这是「过渡」，不是混合模式。 */
  function blendColors(rgb1, rgb2, ratio) {
    return {
      r: Math.round(rgb1.r + (rgb2.r - rgb1.r) * ratio),
      g: Math.round(rgb1.g + (rgb2.g - rgb1.g) * ratio),
      b: Math.round(rgb1.b + (rgb2.b - rgb1.b) * ratio)
    };
  }

  /* ======================================================================
     三、混合模式
     ----------------------------------------------------------------------
     按 W3C《Compositing and Blending Level 1》§9.1 的混合函数实现。
     https://www.w3.org/TR/compositing-1/#blending

     记号沿用规范：Cb = 底色（backdrop，下层），Cs = 叠色（source，上层），
     两者都是 [0, 1] 的分量值。B(Cb, Cs) 就是下面这些函数。

     注意：规范里的混合只处理颜色，不处理 alpha。本实现同样只接受不透明色，
     不做 alpha 合成（Porter-Duff）—— 少一个维度，也少一类难以解释的结果。
     ====================================================================== */

  var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };

  /* --- 可分离混合模式：逐通道独立计算 ------------------------------------ */

  function multiplyF(cb, cs) { return cb * cs; }
  function screenF(cb, cs) { return cb + cs - cb * cs; }

  /** HardLight 的第一参是底色；overlay 就是把它反过来用 */
  function hardLightF(cb, cs) {
    return cs <= 0.5 ? multiplyF(cb, 2 * cs) : screenF(cb, 2 * cs - 1);
  }

  var SEPARABLE = {
    normal: function (cb, cs) { return cs; },
    multiply: multiplyF,
    screen: screenF,
    overlay: function (cb, cs) { return hardLightF(cs, cb); },
    darken: function (cb, cs) { return Math.min(cb, cs); },
    lighten: function (cb, cs) { return Math.max(cb, cs); },
    difference: function (cb, cs) { return Math.abs(cb - cs); },
    exclusion: function (cb, cs) { return cb + cs - 2 * cb * cs; },
    'color-dodge': function (cb, cs) {
      if (cb === 0) return 0;
      if (cs === 1) return 1;
      return Math.min(1, cb / (1 - cs));
    },
    'color-burn': function (cb, cs) {
      if (cb === 1) return 1;
      if (cs === 0) return 0;
      return 1 - Math.min(1, (1 - cb) / cs);
    },
    'hard-light': hardLightF,
    'soft-light': function (cb, cs) {
      if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
      /* D(Cb)：规范里的分段函数，暗部用三次曲线、亮部用开方 */
      var d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cb + (2 * cs - 1) * (d - cb);
    }
  };

  /* --- 不可分离混合模式：要动色相 / 饱和度 / 明度，必须三个通道一起算 ---- */

  function lum(c) { return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; }

  /** 把溢出的分量按比例压回 [0, 1]，同时尽量保住明度 */
  function clipColor(c) {
    var l = lum(c);
    var n = Math.min(c.r, c.g, c.b);
    var x = Math.max(c.r, c.g, c.b);
    var out = { r: c.r, g: c.g, b: c.b };

    if (n < 0) {
      var dn = l - n;
      out.r = l + (out.r - l) * l / dn;
      out.g = l + (out.g - l) * l / dn;
      out.b = l + (out.b - l) * l / dn;
    }
    if (x > 1) {
      var dx = x - l;
      out.r = l + (out.r - l) * (1 - l) / dx;
      out.g = l + (out.g - l) * (1 - l) / dx;
      out.b = l + (out.b - l) * (1 - l) / dx;
    }
    return out;
  }

  /** 把颜色整体平移到目标明度，再夹回合法区间 */
  function setLum(c, l) {
    var d = l - lum(c);
    return clipColor({ r: c.r + d, g: c.g + d, b: c.b + d });
  }

  function sat(c) { return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b); }

  /**
   * 把颜色的饱和度改成 s，色相与相对比例保持不变。
   * 规范的做法是把三个分量排序后线性映射：最小值归 0、最大值取 s，
   * 中间值按原比例落位。所以要先记住排序前的通道位置，算完再放回去。
   */
  function setSat(c, s) {
    var ch = [c.r, c.g, c.b];
    var order = [0, 1, 2].sort(function (a, b) { return ch[a] - ch[b]; });
    var mn = ch[order[0]], md = ch[order[1]], mx = ch[order[2]];
    var out = [0, 0, 0];

    if (mx > mn) {
      out[order[1]] = (md - mn) * s / (mx - mn);
      out[order[2]] = s;
    }
    return { r: out[0], g: out[1], b: out[2] };
  }

  var NON_SEPARABLE = {
    hue: function (cb, cs) { return setLum(setSat(cs, sat(cb)), lum(cb)); },
    saturation: function (cb, cs) { return setLum(setSat(cb, sat(cs)), lum(cb)); },
    color: function (cb, cs) { return setLum(cs, lum(cb)); },
    luminosity: function (cb, cs) { return setLum(cb, lum(cs)); }
  };

  /** 混合模式清单：id 与 CSS 的 mix-blend-mode 取值一致 */
  var BLEND_MODES = [
    { id: 'normal', name: '正常', note: '不做计算，直接用叠色盖住底色。' },
    { id: 'multiply', name: '正片叠底', note: '两色相乘，结果只会更暗。白色不改变底色，黑色得到黑色。' },
    { id: 'screen', name: '滤色', note: '反相后相乘再反相，结果只会更亮。黑色不改变底色，白色得到白色。' },
    { id: 'overlay', name: '叠加', note: '按底色明暗分流：底色暗处正片叠底、亮处滤色，对比度被拉开。' },
    { id: 'darken', name: '变暗', note: '逐通道取较暗的那个值。' },
    { id: 'lighten', name: '变亮', note: '逐通道取较亮的那个值。' },
    { id: 'color-dodge', name: '颜色减淡', note: '用叠色给底色提亮，叠色越接近白色效果越强，容易过曝成纯白。' },
    { id: 'color-burn', name: '颜色加深', note: '用叠色给底色压暗，叠色越接近黑色效果越强，容易压成纯黑。' },
    { id: 'hard-light', name: '强光', note: '按叠色明暗分流：叠色亮处滤色、暗处正片叠底，是叠加的换位版本。' },
    { id: 'soft-light', name: '柔光', note: '像打一层柔光，暗处轻微压暗、亮处轻微提亮，过渡比强光柔和。' },
    { id: 'difference', name: '差值', note: '两色相减取绝对值。同色混合得到黑色。' },
    { id: 'exclusion', name: '排除', note: '与差值类似但对比更弱，同色混合得到中灰而不是黑。' },
    { id: 'hue', name: '色相', note: '取叠色的色相，保留底色的饱和度与明度。' },
    { id: 'saturation', name: '饱和度', note: '取叠色的饱和度，保留底色的色相与明度。' },
    { id: 'color', name: '颜色', note: '取叠色的色相与饱和度，保留底色的明度 —— 上色时最常用。' },
    { id: 'luminosity', name: '明度', note: '取叠色的明度，保留底色的色相与饱和度。' }
  ];

  var MODE_IDS = BLEND_MODES.map(function (m) { return m.id; });

  /**
   * 计算两色的混合结果。
   * @param {{r,g,b}} backdrop 底色（下层）
   * @param {{r,g,b}} source   叠色（上层）
   * @param {string} mode      模式 id，未知值按 normal 处理
   * @returns {{r,g,b}} 0–255 的整数结果
   */
  function blendMode(backdrop, source, mode) {
    if (MODE_IDS.indexOf(mode) < 0) mode = 'normal';

    var cb = { r: backdrop.r / 255, g: backdrop.g / 255, b: backdrop.b / 255 };
    var cs = { r: source.r / 255, g: source.g / 255, b: source.b / 255 };
    var out;

    if (NON_SEPARABLE[mode]) {
      out = NON_SEPARABLE[mode](cb, cs);
    } else {
      var f = SEPARABLE[mode];
      out = { r: f(cb.r, cs.r), g: f(cb.g, cs.g), b: f(cb.b, cs.b) };
    }

    return {
      r: Math.round(clamp01(out.r) * 255),
      g: Math.round(clamp01(out.g) * 255),
      b: Math.round(clamp01(out.b) * 255)
    };
  }

  /* ======================================================================
     四、通用颜色解析
     ====================================================================== */

  var probeEl = null;

  /**
   * 借浏览器自己解析颜色：塞进 style.color 再读 computed style，
   * 能拿到规范化的 rgb()。颜色名、#rrggbbaa、rgb(255 0 0)、
   * hsl(120 50% 50%) 这些都能覆盖，不需要自己写正则或颜色名表。
   */
  function parseViaCss(str) {
    if (typeof document === 'undefined' || !document.body) return null;

    if (!probeEl) {
      probeEl = document.createElement('span');
      probeEl.style.display = 'none';
      probeEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(probeEl);
    }

    probeEl.style.color = '';
    probeEl.style.color = str;
    if (!probeEl.style.color) return null;   /* 浏览器不认这个值 */

    var computed = window.getComputedStyle(probeEl).color;
    var m = computed.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
  }

  /**
   * 解析用户输入的颜色。支持：
   *   #rgb / #rrggbb / rgb(255,0,0) / rgb(255 0 0) / rgb(100%,0%,0%)
   *   hsl(120,50%,50%) / hsl(120 50% 50%) / 颜色名 / #rrggbbaa / rgba(...)
   * 解析不了返回 null。
   */
  function parseColor(str) {
    var s = String(str == null ? '' : str).trim();
    if (!s) return null;

    if (RE_HEX.test(s)) return hexToRgb(s);

    /* 百分比或数字形式的 rgb() */
    var rgbMatch = s.match(/^rgba?\s*\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)/i);
    if (rgbMatch) {
      var ch = function (v) {
        return v.charAt(v.length - 1) === '%'
          ? Math.round(Math.min(100, parseFloat(v)) * 255 / 100)
          : Math.max(0, Math.min(255, Math.round(parseFloat(v))));
      };
      return { r: ch(rgbMatch[1]), g: ch(rgbMatch[2]), b: ch(rgbMatch[3]) };
    }

    /* hsl() / hsla()，角度单位 deg 可选 */
    var hslMatch = s.match(/^hsla?\s*\(\s*([\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%?\s*[,\s]\s*([\d.]+)%?/i);
    if (hslMatch) return hslToRgb(+hslMatch[1], +hslMatch[2], +hslMatch[3]);

    /* 其余交给浏览器：颜色名、#rrggbbaa、lab() 之类 */
    return parseViaCss(s);
  }

  /* ======================================================================
     五、CSS 命名颜色
     ----------------------------------------------------------------------
     浏览器能解析颜色名，但没有「反查最接近的名字」的 API，所以这张表必须自带。
     表里的数值与浏览器自己的颜色库一致 —— 测试里会逐个用 parseColor 交叉验证。
     ====================================================================== */

  var NAMED_COLORS = {
    aliceblue:[240,248,255],antiquewhite:[250,235,215],aqua:[0,255,255],aquamarine:[127,255,212],
    azure:[240,255,255],beige:[245,245,220],bisque:[255,228,196],black:[0,0,0],
    blanchedalmond:[255,235,205],blue:[0,0,255],blueviolet:[138,43,226],brown:[165,42,42],
    burlywood:[222,184,135],cadetblue:[95,158,160],chartreuse:[127,255,0],chocolate:[210,105,30],
    coral:[255,127,80],cornflowerblue:[100,149,237],cornsilk:[255,248,220],crimson:[220,20,60],
    cyan:[0,255,255],darkblue:[0,0,139],darkcyan:[0,139,139],darkgoldenrod:[184,134,11],
    darkgray:[169,169,169],darkgreen:[0,100,0],darkgrey:[169,169,169],darkkhaki:[189,183,107],
    darkmagenta:[139,0,139],darkolivegreen:[85,107,47],darkorange:[255,140,0],darkorchid:[153,50,204],
    darkred:[139,0,0],darksalmon:[233,150,122],darkseagreen:[143,188,143],darkslateblue:[72,61,139],
    darkslategray:[47,79,79],darkslategrey:[47,79,79],darkturquoise:[0,206,209],darkviolet:[148,0,211],
    deeppink:[255,20,147],deepskyblue:[0,191,255],dimgray:[105,105,105],dimgrey:[105,105,105],
    dodgerblue:[30,144,255],firebrick:[178,34,34],floralwhite:[255,250,240],forestgreen:[34,139,34],
    fuchsia:[255,0,255],gainsboro:[220,220,220],ghostwhite:[248,248,255],gold:[255,215,0],
    goldenrod:[218,165,32],gray:[128,128,128],green:[0,128,0],greenyellow:[173,255,47],
    grey:[128,128,128],honeydew:[240,255,240],hotpink:[255,105,180],indianred:[205,92,92],
    indigo:[75,0,130],ivory:[255,255,240],khaki:[240,230,140],lavender:[230,230,250],
    lavenderblush:[255,240,245],lawngreen:[124,252,0],lemonchiffon:[255,250,205],lightblue:[173,216,230],
    lightcoral:[240,128,128],lightcyan:[224,255,255],lightgoldenrodyellow:[250,250,210],lightgray:[211,211,211],
    lightgreen:[144,238,144],lightgrey:[211,211,211],lightpink:[255,182,193],lightsalmon:[255,160,122],
    lightseagreen:[32,178,170],lightskyblue:[135,206,250],lightslategray:[119,136,153],lightslategrey:[119,136,153],
    lightsteelblue:[176,196,222],lightyellow:[255,255,224],lime:[0,255,0],limegreen:[50,205,50],
    linen:[250,240,230],magenta:[255,0,255],maroon:[128,0,0],mediumaquamarine:[102,205,170],
    mediumblue:[0,0,205],mediumorchid:[186,85,211],mediumpurple:[147,112,219],mediumseagreen:[60,179,113],
    mediumslateblue:[123,104,238],mediumspringgreen:[0,250,154],mediumturquoise:[72,209,204],
    mediumvioletred:[199,21,133],midnightblue:[25,25,112],mintcream:[245,255,250],mistyrose:[255,228,225],
    moccasin:[255,228,181],navajowhite:[255,222,173],navy:[0,0,128],oldlace:[253,245,230],
    olive:[128,128,0],olivedrab:[107,142,35],orange:[255,165,0],orangered:[255,69,0],
    orchid:[218,112,214],palegoldenrod:[238,232,170],palegreen:[152,251,152],paleturquoise:[175,238,238],
    palevioletred:[219,112,147],papayawhip:[255,239,213],peachpuff:[255,218,185],peru:[205,133,63],
    pink:[255,192,203],plum:[221,160,221],powderblue:[176,224,230],purple:[128,0,128],
    rebeccapurple:[102,51,153],red:[255,0,0],rosybrown:[188,143,143],royalblue:[65,105,225],
    saddlebrown:[139,69,19],salmon:[250,128,114],sandybrown:[244,164,96],seagreen:[46,139,87],
    seashell:[255,245,238],sienna:[160,82,45],silver:[192,192,192],skyblue:[135,206,235],
    slateblue:[106,90,205],slategray:[112,128,144],slategrey:[112,128,144],snow:[255,250,250],
    springgreen:[0,255,127],steelblue:[70,130,180],tan:[210,180,140],teal:[0,128,128],
    thistle:[216,191,216],tomato:[255,99,71],turquoise:[64,224,208],violet:[238,130,238],
    wheat:[245,222,179],white:[255,255,255],whitesmoke:[245,245,245],yellow:[255,255,0],
    yellowgreen:[154,205,50]
  };

  /**
   * 找出与给定 RGB 最接近的 CSS 命名颜色。
   * 返回 { name, distance, rgb, exact }，distance 是 RGB 空间的欧氏距离。
   */
  function closestName(rgb) {
    var best = null;
    var bestDist = Infinity;

    for (var name in NAMED_COLORS) {
      if (!Object.prototype.hasOwnProperty.call(NAMED_COLORS, name)) continue;
      var c = NAMED_COLORS[name];
      var dr = rgb.r - c[0], dg = rgb.g - c[1], db = rgb.b - c[2];
      var dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) { bestDist = dist; best = name; }
    }

    var rounded = Math.round(Math.sqrt(bestDist));
    return { name: best, distance: rounded, rgb: NAMED_COLORS[best], exact: rounded === 0 };
  }

  /** 按名字查 RGB，查不到返回 null */
  function namedToRgb(name) {
    var c = NAMED_COLORS[String(name == null ? '' : name).trim().toLowerCase()];
    return c ? { r: c[0], g: c[1], b: c[2] } : null;
  }

  /* ======================================================================
     对外接口
     ====================================================================== */

  T.color = {
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    rgbToHsl: rgbToHsl,
    hslToRgb: hslToRgb,
    rgbToCmyk: rgbToCmyk,
    cmykToRgb: cmykToRgb,
    rgbToHwb: rgbToHwb,
    hwbToRgb: hwbToRgb,
    luminance: luminance,
    contrastRatio: contrastRatio,
    wcagLevels: wcagLevels,
    maxContrast: maxContrast,
    fixContrast: fixContrast,
    blendColors: blendColors,
    blendMode: blendMode,
    blendModes: BLEND_MODES,
    parseColor: parseColor,
    namedColors: NAMED_COLORS,
    closestName: closestName,
    namedToRgb: namedToRgb
  };
})();
