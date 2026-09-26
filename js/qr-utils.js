/* ==========================================================================
   qr-utils.js — 二维码的几何与渲染（共用模块）
   --------------------------------------------------------------------------
   同一份「模块矩阵 → 像素」的几何原本在三个地方各写了一遍：
   qr-generator 的 SVG 预览、qr-generator 的 canvas 导出、以及 TOTP 的
   otpauth 二维码。三处的留白宽度与定位图案判定只要有一处分叉，
   就会有一个渲染结果扫不出来 —— 而「扫不出来」是没法靠肉眼发现的。
   所以按项目约定（同一实现出现第二次就抽出来）收到这里。

   API（window.TOOLBOX.qr）：
     QUIET              四周留白（模块数）。规范要求至少 4，取 4。
     LOGO_RATIO         Logo 边长占二维码边长的比例（0.22，留够纠错余量）。
     isFinder(r, c, n)  某个模块是否落在三个定位图案里。
     shapeOf(style, r, c, n)  该模块画成什么形状（定位图案恒定是方块）。
     roundRectPath(ctx, x, y, w, h, r)  canvas 圆角矩形路径。
     toSvg(qr, opts)    画成 SVG 字符串。
     toCanvas(qr, ctx, opts)  画到 2d 上下文，返回实际边长（像素）。

   设计取舍：
   1. **定位图案一律画方块。** 圆点 / 圆角样式只作用于数据区 ——
      定位图案是扫描器用来对齐与判定版本的三块「回」字，形状被破坏后
      相当一部分扫描器直接读不出来。上游这点是对的，保留。
   2. `toSvg` 的 `dim` 可以是字符串（如 `'100%'`），配 `viewBox` 就是响应式的；
      `toCanvas` 的 `dim` 必须是数字（要算格子边长），所以两者分开取参。
   3. 颜色不在这里决定。调用方给什么用什么 —— 但**反色（浅色模块 + 深色底）
      很多扫描器读不出来**，这是历史实现问题而非规范要求，代价却很高，
      所以调用方有责任保证前景比背景暗。
   ========================================================================== */
(function () {
  'use strict';

  var T = (window.TOOLBOX = window.TOOLBOX || {});

  var QUIET = 4;           /* 四周留白（模块数），规范要求至少 4 */
  var LOGO_RATIO = 0.22;   /* Logo 边长占二维码边长的比例 */

  function isFinder(r, c, n) {
    return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  }

  /**
   * 该模块画成什么形状。'square' / 'rounded' / 'dot'。
   * 定位图案强制方块，理由见文件头。
   */
  function shapeOf(style, r, c, n) {
    if (style === 'square' || isFinder(r, c, n)) return 'square';
    return style === 'dots' ? 'dot' : 'rounded';
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * 画出 SVG。预览与「下载 SVG」用的是同一份输出。
   *
   * shape-rendering 按样式选：方块用 crispEdges（边缘不糊），
   * 圆点与圆角用 geometricPrecision（曲线平滑）。
   *
   * @param {object} qr   qrcode-generator 的实例（已 make()）
   * @param {object} o    { dim, fg, bg, style, quiet, logoDataUrl, logoRatio, label }
   */
  function toSvg(qr, o) {
    o = o || {};
    var fg = o.fg || '#000';
    var bg = o.bg || '#fff';
    var style = o.style || 'square';
    var quiet = o.quiet == null ? QUIET : o.quiet;
    var dim = o.dim == null ? 240 : o.dim;
    var ratio = o.logoRatio == null ? LOGO_RATIO : o.logoRatio;
    var logo = o.logoDataUrl || null;
    var count = qr.getModuleCount();
    var total = count + quiet * 2;
    var shapes = '';
    var r, c, x, y;

    for (r = 0; r < count; r++) {
      for (c = 0; c < count; c++) {
        if (!qr.isDark(r, c)) continue;

        x = c + quiet;
        y = r + quiet;

        var shape = shapeOf(style, r, c, count);
        if (shape === 'square') {
          shapes += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
        } else if (shape === 'dot') {
          shapes += '<circle cx="' + (x + 0.5) + '" cy="' + (y + 0.5) + '" r="0.5"/>';
        } else {
          shapes += '<rect x="' + x + '" y="' + y + '" width="1" height="1" rx="0.3" ry="0.3"/>';
        }
      }
    }

    var svg = '<svg xmlns="http://www.w3.org/2000/svg"' +
      (logo ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : '') +
      ' viewBox="0 0 ' + total + ' ' + total + '" width="' + dim + '" height="' + dim + '"' +
      ' shape-rendering="' + (style === 'square' ? 'crispEdges' : 'geometricPrecision') + '"' +
      ' role="img" aria-label="' + (o.label || '二维码') + '">';

    svg += '<rect width="100%" height="100%" fill="' + bg + '"/>';
    svg += '<g fill="' + fg + '">' + shapes + '</g>';

    if (logo) {
      var ls = total * ratio;
      var pad = ls * 0.12;
      var off = (total - ls) / 2;

      svg += '<rect x="' + (off - pad) + '" y="' + (off - pad) + '" width="' + (ls + pad * 2) +
        '" height="' + (ls + pad * 2) + '" fill="' + bg + '"/>';
      /* href 是 SVG 2 的写法，xlink:href 兼容老工具，两个都写 */
      svg += '<image href="' + logo + '" xlink:href="' + logo + '" x="' + off +
        '" y="' + off + '" width="' + ls + '" height="' + ls +
        '" preserveAspectRatio="xMidYMid meet"/>';
    }

    return svg + '</svg>';
  }

  /**
   * 把二维码画到一个 2d 上下文里，PNG 导出 / 复制图片共用。
   * 返回**实际**边长（会把 dim 收成格子边长的整数倍，否则模块之间会有半像素缝）。
   *
   * @param {object} qr
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} o  { dim, fg, bg, style, quiet, logoImg, logoRatio }
   */
  function toCanvas(qr, ctx, o) {
    o = o || {};
    var fg = o.fg || '#000';
    var bg = o.bg || '#fff';
    var style = o.style || 'square';
    var quiet = o.quiet == null ? QUIET : o.quiet;
    var ratio = o.logoRatio == null ? LOGO_RATIO : o.logoRatio;
    var count = qr.getModuleCount();
    var total = count + quiet * 2;
    var cell = Math.max(1, Math.floor((o.dim || 240) / total));
    var dim = cell * total;
    var r, c, x, y;

    /* 优先用调用方给的 canvas：drawToCanvas(canvas, ctx) 这种签名里
       canvas 与 ctx.canvas 本是同一个，但显式传更稳（某些环境 ctx.canvas 是 null） */
    var cv = o.canvas || ctx.canvas;
    if (cv) { cv.width = dim; cv.height = dim; }

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = fg;

    for (r = 0; r < count; r++) {
      for (c = 0; c < count; c++) {
        if (!qr.isDark(r, c)) continue;

        x = (c + quiet) * cell;
        y = (r + quiet) * cell;

        var shape = shapeOf(style, r, c, count);
        if (shape === 'square') {
          ctx.fillRect(x, y, cell, cell);
        } else if (shape === 'dot') {
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          roundRectPath(ctx, x, y, cell, cell, cell * 0.3);
          ctx.fill();
        }
      }
    }

    if (o.logoImg) {
      var ls = Math.round(dim * ratio);
      var pad = Math.round(ls * 0.12);
      var off = Math.round((dim - ls) / 2);

      ctx.fillStyle = bg;
      ctx.fillRect(off - pad, off - pad, ls + pad * 2, ls + pad * 2);
      ctx.drawImage(o.logoImg, off, off, ls, ls);
    }

    return dim;
  }

  T.qr = {
    QUIET: QUIET,
    LOGO_RATIO: LOGO_RATIO,
    isFinder: isFinder,
    shapeOf: shapeOf,
    roundRectPath: roundRectPath,
    toSvg: toSvg,
    toCanvas: toCanvas
  };
})();
