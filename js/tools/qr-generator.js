/* ==========================================================================
   qr-generator.js — 二维码生成
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 qr-generator（MIT），改动：
     1. 界面文案全量中文化；默认示例换成本站自己的地址
     2. 改用本站的设计系统与组件类名，去掉上游的内联样式与 d-none 之类
     3. **预览从 canvas 改成 SVG**。canvas 预览在缩放时会糊，而且拿不到 2d 上下文
        的环境（无头浏览器、装了隐私插件的浏览器）整个工具都会白屏。
        SVG 是矢量的，放到多大都清晰，也更容易验证。导出 PNG 时才临时建一个
        离屏 canvas，并在拿不到上下文时明确告知用户改用 SVG。
     4. 修复缺陷：上游自己写了一份相对亮度 relLum，阈值用的还是 0.03928
        （WCAG 2.0/2.1 的旧值）。这里直接用 js/color-utils.js 的 luminance
        与 contrastRatio，不再重复实现。
     5. 修复缺陷：iCalendar 与 vCard 的文本字段没有转义。标题里带个逗号或分号，
        生成的 ICS / VCF 结构就坏了。按 RFC 5545 / RFC 6350 补上转义。
     6. 修复缺陷：上游在 canvas 上设过一次 imageRendering，但两个分支的取值效果
        完全相同，等于什么都没做。这里改成在 SVG 上按样式选 shape-rendering：
        方块用 crispEdges、圆点与圆角用 geometricPrecision。
     7. 导出 SVG 的 <image> 同时写 href 与 xlink:href —— href 是 SVG 2 的写法，
        xlink:href 兼容老工具，只写一个总有一边不认。
     8. 新增内容字节数与「反色 / 低对比度」提示（提示复用 color-utils 的亮度计算）
     9. 新增前后景对调按钮
    10. 去掉上游的 HAS_QR 非阻塞降级 —— 本站的内置库就在同一个仓库里，
        不存在「被拦截器挡掉」的情况，统一成与其他工具一致的退出方式。
    11. 二维码编码由内置的 qrcode-generator（MIT）完成，自托管在
        js/vendor/qrcode.umd.js，不通过 CDN 加载。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var esc = T.util.esc;
  var C = T.color;

  if (typeof qrcode === 'undefined') {
    T.util.toast('二维码引擎未能加载');
    return;
  }

  if (!C) {
    T.util.toast('颜色引擎未能加载');
    return;
  }

  /* qrcode-generator 默认按 Latin-1 处理字符串，中文会变成乱码。
     换成库自带的 UTF-8 编码器 —— 这是它提供的官方扩展点。 */
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

  /* --- 常量 -------------------------------------------------------------- */
  var QUIET = 4;           /* 四周留白（模块数），规范要求至少 4 */
  var LOGO_RATIO = 0.22;   /* Logo 边长占二维码边长的比例 */
  var MIN_SIZE = 120;
  var MAX_SIZE = 640;

  var MODES = [
    { id: 'text',     name: '文本' },
    { id: 'wifi',     name: 'WiFi' },
    { id: 'vcard',    name: '名片' },
    { id: 'email',    name: '邮件' },
    { id: 'sms',      name: '短信' },
    { id: 'phone',    name: '电话' },
    { id: 'whatsapp', name: 'WhatsApp' },
    { id: 'geo',      name: '位置' },
    { id: 'event',    name: '日程' }
  ];

  var LEVEL_NAME = { L: 'L（约 7%）', M: 'M（约 15%）', Q: 'Q（约 25%）', H: 'H（约 30%）' };

  var FIELD_IDS = [
    'qr-text',
    'qr-wifi-ssid', 'qr-wifi-pass', 'qr-wifi-enc', 'qr-wifi-hidden',
    'qr-vc-name', 'qr-vc-phone', 'qr-vc-email', 'qr-vc-org', 'qr-vc-url',
    'qr-email-to', 'qr-email-subject', 'qr-email-body',
    'qr-sms-to', 'qr-sms-body', 'qr-phone-to',
    'qr-wa-to', 'qr-wa-body', 'qr-geo-lat', 'qr-geo-lng',
    'qr-ev-title', 'qr-ev-location', 'qr-ev-start', 'qr-ev-end', 'qr-ev-desc',
    'qr-ec', 'qr-style', 'qr-size', 'qr-fg', 'qr-bg'
  ];

  /* --- DOM --------------------------------------------------------------- */
  var modesEl    = document.getElementById('qr-modes');
  var previewEl  = document.getElementById('qr-preview');
  var statusEl   = document.getElementById('qr-status');
  var sizeEl     = document.getElementById('qr-size');
  var sizeValEl  = document.getElementById('qr-size-value');
  var ecSel      = document.getElementById('qr-ec');
  var fgEl       = document.getElementById('qr-fg');
  var bgEl       = document.getElementById('qr-bg');
  var invertBtn  = document.getElementById('qr-invert');
  var pngBtn     = document.getElementById('qr-png');
  var svgBtn     = document.getElementById('qr-svg');
  var copyBtn    = document.getElementById('qr-copy');
  var logoInput  = document.getElementById('qr-logo');
  var logoPreview = document.getElementById('qr-logo-preview');
  var logoClearBtn = document.getElementById('qr-logo-clear');

  if (!modesEl || !previewEl) return;

  /* --- 状态 -------------------------------------------------------------- */
  var mode = 'text';
  var lastQr = null;
  var logoImg = null;
  var logoDataUrl = null;
  var timer = null;

  /* ======================================================================
     一、内容拼装
     ====================================================================== */

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  /** WIFI: 格式里这几个字符必须转义，否则网络名里带个分号就串位了 */
  function wifiEsc(s) {
    return String(s).replace(/([\\;,:"])/g, '\\$1');
  }

  /** iCalendar / vCard 的文本转义：反斜杠、分号、逗号、换行 */
  function textEsc(s) {
    return String(s).replace(/([\\;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
  }

  /** datetime-local 的值转成 iCalendar 的本地时间写法：20260924T120000 */
  function icalDate(v) {
    return v ? v.replace(/[-:]/g, '') + '00' : '';
  }

  function payload() {
    if (mode === 'text') return document.getElementById('qr-text').value;

    if (mode === 'wifi') {
      var ssid = val('qr-wifi-ssid');
      if (!ssid) return '';

      var enc = val('qr-wifi-enc');
      var pass = val('qr-wifi-pass');
      var w = 'WIFI:T:' + enc + ';S:' + wifiEsc(ssid) + ';';
      if (enc !== 'nopass') w += 'P:' + wifiEsc(pass) + ';';
      if (document.getElementById('qr-wifi-hidden').checked) w += 'H:true;';
      return w + ';';
    }

    if (mode === 'vcard') {
      var fn = val('qr-vc-name');
      var tel = val('qr-vc-phone');
      var mail = val('qr-vc-email');
      if (!fn && !tel && !mail) return '';

      var v = ['BEGIN:VCARD', 'VERSION:3.0'];
      if (fn) v.push('N:' + textEsc(fn), 'FN:' + textEsc(fn));
      if (tel) v.push('TEL:' + textEsc(tel));
      if (mail) v.push('EMAIL:' + textEsc(mail));
      if (val('qr-vc-org')) v.push('ORG:' + textEsc(val('qr-vc-org')));
      if (val('qr-vc-url')) v.push('URL:' + textEsc(val('qr-vc-url')));
      v.push('END:VCARD');
      return v.join('\n');
    }

    if (mode === 'email') {
      var to = val('qr-email-to');
      if (!to) return '';

      var q = [];
      if (val('qr-email-subject')) q.push('subject=' + encodeURIComponent(val('qr-email-subject')));
      if (val('qr-email-body')) q.push('body=' + encodeURIComponent(val('qr-email-body')));
      return 'mailto:' + to + (q.length ? '?' + q.join('&') : '');
    }

    if (mode === 'sms') {
      var num = val('qr-sms-to');
      if (!num) return '';
      var msg = val('qr-sms-body');
      return 'SMSTO:' + num + (msg ? ':' + msg : '');
    }

    if (mode === 'phone') {
      var p = val('qr-phone-to');
      return p ? 'tel:' + p : '';
    }

    if (mode === 'whatsapp') {
      var digits = val('qr-wa-to').replace(/[^0-9]/g, '');
      if (!digits) return '';
      var t = val('qr-wa-body');
      return 'https://wa.me/' + digits + (t ? '?text=' + encodeURIComponent(t) : '');
    }

    if (mode === 'geo') {
      var lat = val('qr-geo-lat');
      var lng = val('qr-geo-lng');
      return (lat && lng) ? 'geo:' + lat + ',' + lng : '';
    }

    /* 剩下的就是日程 */
    var title = val('qr-ev-title');
    if (!title) return '';

    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'SUMMARY:' + textEsc(title)];
    var st = icalDate(val('qr-ev-start'));
    var en = icalDate(val('qr-ev-end'));

    if (st) lines.push('DTSTART:' + st);
    if (en) lines.push('DTEND:' + en);
    if (val('qr-ev-location')) lines.push('LOCATION:' + textEsc(val('qr-ev-location')));
    if (val('qr-ev-desc')) lines.push('DESCRIPTION:' + textEsc(val('qr-ev-desc')));
    lines.push('END:VEVENT', 'END:VCALENDAR');

    return lines.join('\n');
  }

  /* ======================================================================
     二、取值
     ====================================================================== */

  function styleValue() { return document.getElementById('qr-style').value; }
  function fgValue() { return fgEl.value; }
  function bgValue() { return bgEl.value; }

  function sizeValue() {
    var v = parseInt(sizeEl.value, 10);
    if (!isFinite(v)) return 320;
    return Math.max(MIN_SIZE, Math.min(MAX_SIZE, v));
  }

  /** UTF-8 下的字节数。没有 TextEncoder 时按编码规则手算。 */
  function utf8Length(s) {
    if (window.TextEncoder) return new TextEncoder().encode(s).length;

    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }   /* 代理对 */
      else n += 3;
    }
    return n;
  }

  /** 三个定位角必须保持实心方块 —— 扫描器靠它们定位 */
  function isFinder(r, c, n) {
    return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  }

  /**
   * 前景应该比背景暗。反色的二维码很多扫描器读不出来 ——
   * 这是历史实现问题，不是规范要求，但实际扫不出来的概率很高。
   * 亮度与对比度直接用 color-utils 的实现。
   */
  function contrastWarning() {
    var fgRgb = C.hexToRgb(fgValue());
    var bgRgb = C.hexToRgb(bgValue());
    if (!fgRgb || !bgRgb) return '';

    var lf = C.luminance(fgRgb.r, fgRgb.g, fgRgb.b);
    var lb = C.luminance(bgRgb.r, bgRgb.g, bgRgb.b);

    if (lb < lf) return '背景比前景暗，反色的二维码很多扫描器读不出来。';

    var ratio = C.contrastRatio(fgRgb, bgRgb);
    if (ratio < 3) return '对比度只有 ' + (Math.round(ratio * 100) / 100) + ':1，可能扫不出来。';

    return '';
  }

  /* ======================================================================
     三、渲染
     ====================================================================== */

  /**
   * 生成 SVG 字符串。预览与「下载 SVG」用的是同一份输出。
   *
   * shape-rendering 按样式选：方块用 crispEdges（边缘不糊），
   * 圆点与圆角用 geometricPrecision（曲线平滑）。
   */
  function buildSvg(qr) {
    var fg = fgValue();
    var bg = bgValue();
    var style = styleValue();
    var dim = sizeValue();
    var count = qr.getModuleCount();
    var total = count + QUIET * 2;
    var shapes = '';
    var r, c, x, y;

    for (r = 0; r < count; r++) {
      for (c = 0; c < count; c++) {
        if (!qr.isDark(r, c)) continue;

        x = c + QUIET;
        y = r + QUIET;

        if (style === 'square' || isFinder(r, c, count)) {
          shapes += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
        } else if (style === 'dots') {
          shapes += '<circle cx="' + (x + 0.5) + '" cy="' + (y + 0.5) + '" r="0.5"/>';
        } else {
          shapes += '<rect x="' + x + '" y="' + y + '" width="1" height="1" rx="0.3" ry="0.3"/>';
        }
      }
    }

    var svg = '<svg xmlns="http://www.w3.org/2000/svg"' +
      (logoDataUrl ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : '') +
      ' viewBox="0 0 ' + total + ' ' + total + '" width="' + dim + '" height="' + dim + '"' +
      ' shape-rendering="' + (style === 'square' ? 'crispEdges' : 'geometricPrecision') + '"' +
      ' role="img" aria-label="二维码">';

    svg += '<rect width="100%" height="100%" fill="' + bg + '"/>';
    svg += '<g fill="' + fg + '">' + shapes + '</g>';

    if (logoDataUrl) {
      var ls = total * LOGO_RATIO;
      var pad = ls * 0.12;
      var off = (total - ls) / 2;

      svg += '<rect x="' + (off - pad) + '" y="' + (off - pad) + '" width="' + (ls + pad * 2) +
        '" height="' + (ls + pad * 2) + '" fill="' + bg + '"/>';
      /* href 是 SVG 2 的写法，xlink:href 兼容老工具，两个都写 */
      svg += '<image href="' + logoDataUrl + '" xlink:href="' + logoDataUrl + '" x="' + off +
        '" y="' + off + '" width="' + ls + '" height="' + ls +
        '" preserveAspectRatio="xMidYMid meet"/>';
    }

    return svg + '</svg>';
  }

  function emptyPreview(title, desc) {
    previewEl.innerHTML = '<div class="qr-empty"><strong>' + esc(title) + '</strong>' +
      esc(desc) + '</div>';
  }

  function setEnabled(on) {
    pngBtn.disabled = !on;
    svgBtn.disabled = !on;
    if (copyBtn) copyBtn.disabled = !on;
  }

  function render() {
    var text = payload();

    if (!text) {
      lastQr = null;
      emptyPreview('还没有内容', '在上面填点东西，二维码就出来了。');
      statusEl.textContent = '';
      setEnabled(false);
      return;
    }

    var level = ecSel.value;
    var qr;

    try {
      qr = qrcode(0, level);
      qr.addData(text);
      qr.make();
    } catch (e) {
      lastQr = null;
      emptyPreview('内容太长了', '单个二维码放不下，缩短内容或把纠错等级调低一档再试。');
      statusEl.innerHTML = '<span class="is-error">超出单个二维码的容量</span>';
      setEnabled(false);
      return;
    }

    lastQr = qr;

    var count = qr.getModuleCount();
    var warn = contrastWarning();

    previewEl.innerHTML = buildSvg(qr);

    statusEl.innerHTML =
      '<span>' + count + '×' + count + ' 模块 · ' + esc(LEVEL_NAME[level] || level) +
      ' · ' + utf8Length(text) + ' 字节 · ' + sizeValue() + 'px</span>' +
      (warn ? ' <span class="is-warn">' + esc(warn) + '</span>' : '');

    setEnabled(true);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(render, 150);
  }

  /* ======================================================================
     四、导出
     ====================================================================== */

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 把二维码画到一个 2d 上下文里，PNG 导出与复制图片共用 */
  function drawToCanvas(canvas, ctx) {
    var count = lastQr.getModuleCount();
    var total = count + QUIET * 2;
    var cell = Math.max(1, Math.floor(sizeValue() / total));
    var dim = cell * total;
    var style = styleValue();
    var r, c, x, y;

    canvas.width = dim;
    canvas.height = dim;

    ctx.fillStyle = bgValue();
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = fgValue();

    for (r = 0; r < count; r++) {
      for (c = 0; c < count; c++) {
        if (!lastQr.isDark(r, c)) continue;

        x = (c + QUIET) * cell;
        y = (r + QUIET) * cell;

        if (style === 'square' || isFinder(r, c, count)) {
          ctx.fillRect(x, y, cell, cell);
        } else if (style === 'dots') {
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          roundRectPath(ctx, x, y, cell, cell, cell * 0.3);
          ctx.fill();
        }
      }
    }

    if (logoImg) {
      var ls = Math.round(dim * LOGO_RATIO);
      var pad = Math.round(ls * 0.12);
      var off = Math.round((dim - ls) / 2);

      ctx.fillStyle = bgValue();
      ctx.fillRect(off - pad, off - pad, ls + pad * 2, ls + pad * 2);
      ctx.drawImage(logoImg, off, off, ls, ls);
    }

    return dim;
  }

  function newCanvas() {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext && canvas.getContext('2d');
    return ctx ? { canvas: canvas, ctx: ctx } : null;
  }

  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* 预览走 SVG，只有导出 PNG 才需要 canvas —— 拿不到就明确说，别静默失败 */
  pngBtn.addEventListener('click', function () {
    if (!lastQr) return;

    var c = newCanvas();
    if (!c) {
      T.util.toast('当前环境拿不到 canvas，改用「下载 SVG」吧');
      return;
    }

    drawToCanvas(c.canvas, c.ctx);

    if (!c.canvas.toBlob) {
      T.util.toast('当前环境不支持导出 PNG，改用「下载 SVG」吧');
      return;
    }

    c.canvas.toBlob(function (blob) {
      if (!blob) { T.util.toast('生成图片失败'); return; }
      downloadBlob(blob, 'qrcode.png');
    }, 'image/png');
  });

  svgBtn.addEventListener('click', function () {
    if (!lastQr) return;
    downloadBlob(new Blob([buildSvg(lastQr)], { type: 'image/svg+xml' }), 'qrcode.svg');
  });

  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard || !navigator.clipboard.write) {
    copyBtn.hidden = true;
  } else {
    copyBtn.addEventListener('click', function () {
      if (!lastQr) return;

      var c = newCanvas();
      if (!c) { T.util.toast('当前环境拿不到 canvas'); return; }

      drawToCanvas(c.canvas, c.ctx);
      c.canvas.toBlob(function (blob) {
        if (!blob) { T.util.toast('生成图片失败'); return; }
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          .then(function () { T.util.toast('已复制到剪贴板'); })
          .catch(function () { T.util.toast('复制失败'); });
      }, 'image/png');
    });
  }

  /* ======================================================================
     五、Logo
     ====================================================================== */

  if (logoInput) {
    logoInput.addEventListener('change', function () {
      var file = logoInput.files && logoInput.files[0];
      if (!file) return;

      var reader = new FileReader();

      reader.onload = function () {
        var url = reader.result;
        var img = new Image();

        img.onload = function () {
          logoImg = img;
          logoDataUrl = url;
          logoPreview.src = url;
          logoPreview.hidden = false;
          logoClearBtn.hidden = false;

          /* 被 Logo 盖住的部分全靠纠错补回来，所以强制拉到 H */
          ecSel.value = 'H';
          ecSel.disabled = true;

          render();
        };

        img.onerror = function () {
          statusEl.innerHTML = '<span class="is-error">这个图片读不出来</span>';
        };

        img.src = url;
      };

      reader.readAsDataURL(file);
    });
  }

  if (logoClearBtn) {
    logoClearBtn.addEventListener('click', function () {
      logoImg = null;
      logoDataUrl = null;
      logoInput.value = '';
      logoPreview.src = '';
      logoPreview.hidden = true;
      logoClearBtn.hidden = true;
      ecSel.disabled = false;
      render();
    });
  }

  /* ======================================================================
     六、模式切换与事件
     ====================================================================== */

  function renderModes() {
    modesEl.innerHTML = MODES.map(function (m) {
      return '<button class="choice-chip" type="button" data-mode="' + m.id + '" ' +
        'aria-pressed="' + (m.id === mode) + '">' + esc(m.name) + '</button>';
    }).join('');
  }

  function setMode(m) {
    mode = m;

    T.util.$$('.choice-chip', modesEl).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode));
    });

    MODES.forEach(function (x) {
      var panel = document.getElementById('qr-panel-' + x.id);
      if (panel) panel.hidden = (x.id !== mode);
    });

    render();
  }

  modesEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-mode]');
    if (btn) setMode(btn.getAttribute('data-mode'));
  });

  FIELD_IDS.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', schedule);
    el.addEventListener('change', schedule);
  });

  sizeEl.addEventListener('input', function () {
    sizeValEl.textContent = String(sizeValue());
  });

  if (invertBtn) {
    invertBtn.addEventListener('click', function () {
      var fg = fgEl.value;
      fgEl.value = bgEl.value;
      bgEl.value = fg;
      render();
    });
  }

  /* ======================================================================
     七、首屏
     ====================================================================== */

  renderModes();
  setMode('text');
})();
