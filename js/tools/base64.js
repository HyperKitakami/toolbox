/* ==========================================================================
   base64.js — Base64 编解码
   --------------------------------------------------------------------------
   来源：jamalofski/praticulus 的 `base64/index.html` + `js/tools/base64.js`（MIT）。
   本文件是移植版，上游依赖的 `js/common.js`（escapeHtml / showToast /
   copyToClipboard）未引入，改用本站的 `T.util`。

   【改动清单】

   一、全量中文化。界面文案、状态行、错误提示、文件信息全部改成中文。

   二、统一到本站设计系统。上游的内联样式与自有类名换成
   `.panel` / `.tool-body` / `.toolbar` / `.output` / `.stat-grid` /
   `.drop-zone` / `.tool-status`；复制改用全局的 `T.util.copy`
   （带降级 + 按钮反馈），不再自绘 toast。

   三、修掉上游的六处缺陷（逐条都有可复现的现象）：

     1) **自动判定把普通英文单词当成 Base64。** 上游 `isBase64()` 只查
        「字符集 + 长度%4<=2」，不看解出来是什么。实测把 EFF 7776 个常用英文
        单词逐个喂进去，**6103 个（78.5%）会被判成 Base64** —— 于是往输入框
        打一个 `hello` 就会走解码分支，得到一个未捕获的 `URIError`，
        界面只显示一句 `Error: Invalid Base64 string`。
        现在两道闸门：① 解出来的字节**必须是合法的 UTF-8 文本**；
        ② **纯 ASCII 字母的串一律按文本处理**（Base64 里带数字或填充是常态，
        而英文单词几乎都是纯字母）。加上这一条后同样的 7776 个词**一个都不误判**。
        代价是「全字母且无填充」的 Base64（如 `YWJj`）会被当成文本 ——
        点一下「Base64 解码」即可，页面上有明确说明。

     2) **把「合法 Base64 但内容不是 UTF-8 文本」报成「Invalid Base64 string」。**
        解出来的字节只要不是合法 UTF-8（二进制文件的 Base64 都是这样），
        `decodeURIComponent` 就抛 URIError，被上层统一的 catch 吞掉，
        报出来的原因**不是真原因**。现在分开报，并且不再空手而归：
        结果区给出**十六进制字节视图**，状态行说明「这是合法的 Base64，
        但它解出来不是 UTF-8 文本，共 N 字节」。

     3) **不认 MIME 折行。** 邮件与 MIME 里的 Base64 每 76 字符折一次行，
        上游 `isBase64()` 的正则不允许换行，于是这种串被判成普通文本、
        自动判定把它**再编码一遍**。现在判定与解码都先剥掉全部 ASCII 空白。

     4) **复制裸调 `navigator.clipboard.writeText`。** 非安全上下文
        （http 的非 localhost、file://）里 `navigator.clipboard` 不存在，
        直接 TypeError，而且发生在 `showToast` 之前 —— 用户点「复制」什么都
        不会发生、也没有任何提示。现在走 `T.util.copy`。

     5) **`unescape(encodeURIComponent())` / `escape()` 已废弃**，且遇到
        孤立代理项（粘贴损坏、半个 emoji）会抛 `URIError: URI malformed`。
        现在用 `TextEncoder` / `TextDecoder`，没有就退回原写法
        （调用形式 + 特性检测，不做语法假设）。
        顺带补一处上游没有的可见性：`TextEncoder` 会把**不成对**的代理项
        **静默**换成 U+FFFD（�）—— 不报错、看不出丢了什么。现在显式数一遍，
        在状态行里说明「有 N 个代理项被替换」，这是用户唯一能发现字符丢了的机会。

     6) **文件类型为空时拼出 `data:;base64,`。** 上游直接把 `file.type`
        拼进 Data URL，某些来源（拖放的 .md、无扩展名文件）type 是空串，
        得到的是一个没有 MIME 的坏 Data URL。现在回退 `application/octet-stream`。
        图片预览也从 `imagePreview.innerHTML = '<img src="…">'` 改成
        DOM 建节点 + `.src` 赋值：Data URL 是用户数据的直接产物，
        不该经过 HTML 解析。

   四、新增（上游没有的）：
     - 非法字符**定位到第几个字符**、`=` 位置校验、长度校验，各给一句中文原因；
     - 统计面板（输入字符 / 字节 / 结果字符 / 体积变化）；
     - 「结果换到输入」按上一次的方向反向再跑一遍（上游只是搬字符串，
       换过去之后要用户自己再点按钮）；
     - 分块 `String.fromCharCode`，几 MB 的文件不会因为参数过多爆栈；
     - 自动判定对「二进制内容的 Base64」保持保守（不当成文本去解），
       但在状态行点出「这串本身也是合法的 Base64，解出来是 N 字节的非文本内容」
       并指路到「Base64 解码」—— 既不会误判，也不让用户两头落空；
     - 结果区与文件卡的「复制」都带回退与反馈。

   【保留的上游设计】输入框 + 编码/解码双按钮 + URL 安全字符集与自动判定两个开关 +
   文件拖放 + 体积计数 + 图片预览 + 「交换」「清空」。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) { console.warn('[base64] registry.js 未加载'); return; }

  var U = T.util;

  /* --- 0. 取元素 --------------------------------------------------------- */
  var inputEl = document.getElementById('b64-input');
  var outEl = document.getElementById('b64-output');
  if (!inputEl || !outEl) return;

  var statusEl = document.getElementById('b64-status');
  var statsEl = document.getElementById('b64-stats');
  var urlEl = document.getElementById('b64-urlsafe');
  var autoEl = document.getElementById('b64-auto');
  var encodeBtn = document.getElementById('b64-encode');
  var decodeBtn = document.getElementById('b64-decode');
  var swapBtn = document.getElementById('b64-swap');
  var dropEl = document.getElementById('b64-drop');
  var fileEl = document.getElementById('b64-file');
  var fileCard = document.getElementById('b64-filecard');
  var fileNameEl = document.getElementById('b64-filename');
  var fileMetaEl = document.getElementById('b64-filemeta');
  var previewEl = document.getElementById('b64-preview');
  var copyB64Btn = document.getElementById('b64-copy-b64');
  var copyUrlBtn = document.getElementById('b64-copy-dataurl');
  var demoBtn = document.querySelector('[data-demo]');
  var clearBtn = document.querySelector('[data-clear]');

  /* 示例是一段常见的 JWT 头部 Base64：填进去会被自动判成 Base64 并解码，
     一眼就能看懂「自动判定方向」在做什么 */
  var DEMO = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';

  /* 依赖缺失要吵，不要静默退出（踩过的坑：页面看起来正常、结果区一片空白，
     控制台只有一行 TypeError，光看页面完全看不出问题）。 */
  function bail(msg) {
    if (!outEl) return;
    outEl.textContent = msg;
    outEl.classList.add('b64-bail');
  }
  if (!U || typeof U.esc !== 'function' || typeof U.debounce !== 'function' ||
      typeof U.copy !== 'function') {
    bail('加载到的是旧版 js/site.js，工具无法运行。请强制刷新（Ctrl+F5）后重试。');
    return;
  }

  /* --- 1. 字节 ↔ Base64 -------------------------------------------------- */

  var hasCodec = typeof TextEncoder === 'function' && typeof TextDecoder === 'function';

  /**
   * 字符串 → UTF-8 字节。
   * 没有 TextEncoder 时退回 `unescape(encodeURIComponent())`（老引擎）——
   * 那条路径遇到不成对的代理项会抛 URIError，由调用方接住。
   * TextEncoder 不会抛，它把落单的代理项换成 U+FFFD，所以那种情况
   * 由 `countLoneSurrogates()` 单独数出来、在状态行里讲清楚。
   */
  function textToBytes(str) {
    if (hasCodec) return new TextEncoder().encode(str);
    var bin = unescape(encodeURIComponent(str));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xFF;
    return out;
  }

  /**
   * UTF-8 字节 → 字符串。字节不是合法 UTF-8 时返回 **null**
   * （而不是抛异常或给出带替换符的乱码）—— 调用方据此区分
   * 「Base64 本身有问题」与「解出来是二进制」。
   */
  function bytesToText(bytes) {
    if (hasCodec) {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch (e) { return null; }
    }
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(bin)); } catch (e) { return null; }
  }

  /* 分块再调 fromCharCode：一次性传几百万个参数会爆栈（几 MB 的文件就会撞上） */
  var CHUNK = 0x8000;

  function bytesToBase64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xFF;
    return out;
  }

  /* --- 2. 字符集与填充 --------------------------------------------------- */

  /* 判定与解码前都先剥掉所有 ASCII 空白：MIME 的 Base64 每 76 字符折一次行，
     上游不认识这种写法，会把整段当成普通文本再编码一遍。 */
  function stripWs(s) { return String(s == null ? '' : s).replace(/[\t\n\f\r ]+/g, ''); }

  /* URL 安全（RFC 4648 §5）：+ → -、/ → _，并省略末尾的 = 填充 */
  function toUrlSafe(b64) {
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* 解码时两种字符集都收：先把 - _ 还原成 + /，再统一补填充。
     填充只是书写习惯，不一致时以「去掉后重新补」为准，不报错。 */
  function toStandard(b64) {
    return b64.replace(/-/g, '+').replace(/_/g, '/');
  }
  function pad(b64) {
    var r = b64.length % 4;
    return r ? b64 + '===='.slice(r) : b64;
  }

  /**
   * 校验一段 Base64，返回 null 表示通过，否则返回 `{ title, text }`。
   * 三个分支给的原因各不相同 —— 上游把「非法字符」「长度不对」「内容不是文本」
   * 一律报成 `Invalid Base64 string`，用户看不出该改哪里。
   */
  function validateBase64(raw) {
    var s = stripWs(raw);
    if (!s) return { title: '还没有内容', text: '把 Base64 串粘进左边的输入框。' };

    var std = toStandard(s);

    /* ① 非法字符：指出是第几个 */
    var bad = std.search(/[^A-Za-z0-9+/=]/);
    if (bad >= 0) {
      var shown = s.charAt(bad);
      return {
        title: '第 ' + (bad + 1) + ' 个字符「' + shown + '」不是 Base64 字符',
        text: 'Base64 只允许 A–Z a–z 0–9 + /（URL 安全用 - _），末尾最多两个 =。' +
              '如果这里面混着引号、换行说明或别的文字，先把它们去掉。'
      };
    }

    /* ② 填充位置：只能出现在结尾、最多两个 */
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(std)) {
      var eq = s.indexOf('=');
      return {
        title: '「=」的位置不对（第 ' + (eq + 1) + ' 个字符）',
        text: '填充只能出现在结尾、最多连续两个。这里后面还有内容 —— ' +
              '多半是两段 Base64 被粘在一起了，或者串里混进了说明文字。'
      };
    }

    /* ③ 长度：去掉填充后长度 % 4 余 1 的串不可能是任何 Base64 */
    var body = std.replace(/=+$/, '');
    if (body.length % 4 === 1) {
      return {
        title: '长度不合法（去掉填充后 ' + body.length + ' 个字符，% 4 余 1）',
        text: 'Base64 是 4 个字符一组，余数是 1 说明**中间少了一个或多了几个字符**。' +
              '常见原因是复制时截断 —— 回头对一下原文。'
      };
    }

    return null;
  }

  /* --- 3. 自动判定 ------------------------------------------------------- */

  /**
   * 按 Base64 的「形态」检查一遍，能解就返回 `{ bytes, text }`
   * （`text` 为 null 表示解出来不是 UTF-8 文本），不满足形态返回 null。
   *
   * 形态的判据：剥掉空白后长度 ≥ 4、不是纯 ASCII 字母、字符集合法、
   * 去掉填充后长度 % 4 ≠ 1、atob 能吃下去。
   */
  function inspectAsBase64(raw) {
    var s = stripWs(raw);
    if (s.length < 4) return null;
    /* 纯 ASCII 字母一律当普通单词：Base64 带数字或填充是常态，
       英文单词几乎都是纯字母。实测 EFF 7776 个常用词这样能压到 0 误判。 */
    if (/^[A-Za-z]+$/.test(s)) return null;

    var std = toStandard(s);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(std)) return null;

    var body = std.replace(/=+$/, '');
    if (body.length % 4 === 1) return null;

    var bytes;
    try { bytes = base64ToBytes(pad(body)); } catch (e) { return null; }
    return { count: bytes.length, text: bytesToText(bytes) };
  }

  /**
   * 「这串东西该按 Base64 解吗」。
   *
   * 上游只查字符集与长度，实测 EFF 7776 个常用英文单词里 **78.5%** 会被误判
   * （`hello`、`test`、`content` 全中），于是打一个单词进去就报
   * `Invalid Base64 string`。这里加两道闸门：
   *   ① 解出来的字节必须是合法的 UTF-8 文本；
   *   ② 纯 ASCII 字母的串一律按文本处理。
   * 加完之后同样的 7776 个词零误判。
   *
   * 代价是**漏判**，而且是两个方向都漏：
   *   - 全字母且无填充的 Base64（如 `YWJj`）→ 当文本；
   *   - 解出来是二进制的 Base64（如图片的）→ 也当文本。
   * 这是刻意的：宁可漏判也不能误判 —— 漏判只是多点一下按钮，
   * 误判会把用户的正常文本搅成一堆乱码或一份毫无意义的字节视图。
   * 第二种情况不让你两头落空：编码结果的状态行会给出提示
   * （见 doEncode 里的 `alt`），告诉你这串同时也能当 Base64 解。
   */
  function looksLikeBase64(raw) {
    var info = inspectAsBase64(raw);
    return !!(info && info.text !== null);
  }

  /* --- 4. 渲染 ----------------------------------------------------------- */

  var state = {
    mode: null,      /* 'encode' | 'decode' | 'file' | null */
    out: '',         /* 结果区当前显示的原文（供复制/交换用，不是 DOM 里那份） */
    bytes: 0,
    dataUrl: '',
    binary: false,   /* 解码结果是十六进制字节视图，不是文本 */
    file: null       /* 最近一次读进来的文件：{ name, mime, size, b64 } */
  };

  function setStatus(kind, title, extra) {
    if (!statusEl) return;
    statusEl.textContent = '';
    if (!title) return;
    var span = document.createElement('span');
    if (kind) span.className = 'is-' + kind;
    span.textContent = title;
    statusEl.appendChild(span);
    if (extra) {
      var raw = document.createElement('span');
      raw.className = 'err-raw';
      raw.textContent = extra;
      statusEl.appendChild(raw);
    }
  }

  function statGrid(items) {
    if (!statsEl) return;
    statsEl.textContent = '';
    items.forEach(function (it) {
      var cell = document.createElement('div');
      cell.className = 'stat';
      var label = document.createElement('div');
      label.className = 'stat-label';
      label.textContent = it.label;
      var value = document.createElement('div');
      value.className = 'stat-value' + (it.small ? ' stat-value--sm' : '');
      if (it.cls) value.classList.add(it.cls);
      value.textContent = it.value;
      cell.appendChild(label);
      cell.appendChild(value);
      statsEl.appendChild(cell);
    });
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  function ratioStr(outChars, inChars) {
    if (!inChars || !outChars) return '—';
    return '×' + (outChars / inChars).toFixed(2);
  }

  /* 把结果写进结果区并刷新统计。text 是**原样**的内容，
     绝不写进 DOM 之后再用 textContent 读回来（可能被规范化）。 */
  function renderResult(text, meta) {
    state.mode = meta.mode;
    state.out = text;
    state.bytes = meta.bytes;
    state.binary = !!meta.hex;
    outEl.classList.remove('b64-bail');
    outEl.classList.toggle('b64-out', meta.mode === 'encode' || meta.mode === 'file');
    outEl.classList.toggle('b64-hex', !!meta.hex);
    outEl.textContent = text;

    /* 「输入字符数」一律取输入框里的**原始长度**（折行的 Base64 会把换行也算进去，
       与用户看到的那个框一致），不按剥掉空白后的长度算。 */
    var inChars = inputEl.value.length;
    if (meta.mode === 'file') {
      statGrid([
        { label: '文件大小', value: fmtSize(meta.bytes), small: true },
        { label: 'Base64 长度', value: String(text.length), small: true },
        { label: '结果 / 文件', value: ratioStr(text.length, meta.bytes) },
        { label: '文件类型', value: meta.mime || '未知', small: true }
      ]);
    } else if (meta.mode === 'decode') {
      statGrid([
        { label: '输入字符数', value: String(inChars) },
        { label: '解出字节数', value: String(meta.bytes) },
        {
          label: '结果字符数',
          value: meta.hex ? '（字节视图）' : String(text.length),
          small: meta.hex
        },
        {
          label: '字节 / 输入', value: inChars ? (meta.bytes / inChars).toFixed(3) : '—'
        }
      ]);
    } else {
      statGrid([
        { label: '输入字符数', value: String(inChars) },
        { label: '输入字节数（UTF-8）', value: String(meta.bytes) },
        { label: '结果字符数', value: String(text.length) },
        { label: '结果 / 输入', value: ratioStr(text.length, inChars) }
      ]);
    }

    /* 字节视图与文件结果没有「换回输入」的合理含义：换过去要么是十六进制数字串、
       要么是一整份文件的 Base64，再跑一遍都没有意义。禁用之外把原因写进 title，
       否则用户只会看到一个灰按钮、不知道为什么。 */
    var swappable = (meta.mode === 'encode' || meta.mode === 'decode') && !meta.hex;
    if (swapBtn) {
      swapBtn.disabled = !swappable;
      swapBtn.title = swappable
        ? '把结果放回输入框，并按反方向再跑一遍'
        : '当前结果没有可以换回输入的形式';
    }
  }

  function clearResult() {
    state.mode = null;
    state.out = '';
    state.bytes = 0;
    state.binary = false;
    state.dataUrl = '';
    outEl.textContent = '';
    outEl.classList.remove('b64-out', 'b64-hex', 'b64-bail');
    /* 占位统计：留四个空格子，别让面板在没有结果时看起来是坏的 */
    statGrid([
      { label: '输入字符数', value: '—' },
      { label: '字节数', value: '—' },
      { label: '结果字符数', value: '—' },
      { label: '结果 / 输入', value: '—' }
    ]);
    if (swapBtn) {
      swapBtn.disabled = true;
      swapBtn.title = '还没有可以换回输入的结果';
    }
  }

  /* --- 4b. 不成对的代理项 ------------------------------------------------- */

  /**
   * 数一数有多少个「落单的」代理项。
   *
   * emoji 这类增补平面字符在 JS 里是两个码元；只有半个时（粘贴损坏、
   * 从别处截断）TextEncoder 会**静默**把它换成 U+FFFD（�）——
   * 不报错，看不出丢了什么。所以这里显式数一下，在状态行里讲出来。
   */
  function countLoneSurrogates(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) i++;   /* 成对：是一个完整的 emoji */
        else n++;
      } else if (c >= 0xDC00 && c <= 0xDFFF) {
        n++;                                    /* 落单的低位 */
      }
    }
    return n;
  }

  /* --- 5. 两个方向 ------------------------------------------------------- */

  function doEncode(fromAuto) {
    var text = inputEl.value;
    if (text === '') {
      clearResult();
      setStatus('', fromAuto ? '' : '输入为空，没有要编码的内容。');
      return;
    }

    var lone = countLoneSurrogates(text);
    var bytes;
    try {
      bytes = textToBytes(text);
    } catch (e) {
      /* 只有「没有 TextEncoder」的老引擎会走到这里：
         退回路径用的 encodeURIComponent 遇到不成对的代理项会抛 URIError。 */
      setStatus('error', '这段文本里有无法编码的字符（多半是半个 emoji 或粘贴损坏）',
        fromAuto ? '自动判定已跳过，先清掉异常字符再试。' : e.message);
      clearResult();
      return;
    }

    var b64 = bytesToBase64(bytes);
    if (urlEl && urlEl.checked) b64 = toUrlSafe(b64);

    renderResult(b64, { mode: 'encode', bytes: bytes.length });

    var head = (fromAuto ? '自动判定为普通文本，已按 UTF-8 编码 · ' : '已编码 · ') +
      text.length + ' 字符 → ' + b64.length + ' 字符' +
      (urlEl && urlEl.checked ? '（URL 安全字符集，已省略 = 填充）' : '');

    if (lone) {
      /* 别把「静默换成 U+FFFD」藏起来：这是用户唯一能发现字符丢了的机会 */
      setStatus('warn',
        head + ' —— 但里面有 ' + lone + ' 个不成对的代理项，已被替换成 U+FFFD（\uFFFD）',
        '成对的代理项（完整的 emoji）能原样编码，只有落单的半个会被替换。回头检查一下输入。');
      return;
    }

    /* 自动判定只认「解得出 UTF-8 文本」的 Base64，所以图片、压缩包的 Base64
       不会自动解 —— 那样做会把普通文本搅成乱码。但不该让用户两头落空：
       如果这串形态上也是合法 Base64（且带 = + / 这类明确标记，不是碰巧全字母），
       就在状态行里点出来，告诉他点一下「Base64 解码」就能看到字节视图。 */
    var alt = fromAuto ? inspectAsBase64(text) : null;
    if (alt && alt.text === null && /[+/=]/.test(stripWs(text))) {
      setStatus('warn', head,
        '不过它本身也是合法的 Base64，解出来是 ' + alt.count +
        ' 字节的非文本内容（多半是文件）。想看那份十六进制字节视图，点「Base64 解码」。');
      return;
    }

    setStatus('ok', head);
  }

  function doDecode(fromAuto) {
    var raw = inputEl.value;
    var problem = validateBase64(raw);
    if (problem) {
      setStatus('error', problem.title, problem.text);
      clearResult();
      return;
    }

    var s = stripWs(raw);
    var bytes;
    try {
      bytes = base64ToBytes(pad(toStandard(s).replace(/=+$/, '')));
    } catch (e) {
      /* 理论上走不到这里：上面的校验已经排掉了 atob 会拒绝的形态 */
      setStatus('error', '这段 Base64 解不开', e.message);
      clearResult();
      return;
    }

    var text = bytesToText(bytes);
    if (text !== null) {
      renderResult(text, { mode: 'decode', bytes: bytes.length });
      setStatus('ok',
        (fromAuto ? '自动判定为 Base64，已解码 · ' : '已解码 · ') +
        raw.length + ' 字符 → ' + bytes.length + ' 字节 → ' + text.length + ' 字符');
      return;
    }

    /* 合法 Base64，但内容不是 UTF-8 文本。上游在这里报「Invalid Base64 string」，
       原因不对 —— 串本身完全合法。给字节视图，让工具还能用。 */
    renderResult(hexDump(bytes), { mode: 'decode', bytes: bytes.length, hex: true });
    setStatus('warn',
      '这段 Base64 是合法的，但它解出来的不是 UTF-8 文本（共 ' + bytes.length + ' 字节）',
      '多半是文件内容。结果区给的是按字节的十六进制视图；' +
      '要文本请确认原文用的就是 UTF-8 —— 其它编码本站不猜。');
  }

  function hexDump(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i++) {
      parts.push((bytes[i] < 16 ? '0' : '') + bytes[i].toString(16).toUpperCase());
    }
    return parts.join(' ');
  }

  /* --- 6. 输入变化 ------------------------------------------------------- */

  function refresh() {
    if (autoEl && !autoEl.checked) {
      /* 自动判定关掉时只提示，不动结果 —— 用户可能是想手动指定方向 */
      setStatus('', inputEl.value ? '自动判定已关：点下面的按钮决定编码还是解码。' : '');
      return;
    }
    if (!stripWs(inputEl.value)) {
      clearResult();
      setStatus('', '');
      return;
    }
    if (looksLikeBase64(inputEl.value)) doDecode(true);
    else doEncode(true);
  }

  var onInput = U.debounce(refresh, 90);

  /* --- 7. 文件 ----------------------------------------------------------- */

  /* 从 state.file 重新渲染一次。单独抽出来是因为「URL 安全字符集」这个开关
     改变时要重算输出的写法 —— 不能像上游那样直接回到输入框那条路，
     否则文件结果会被一个空输入框清掉。 */
  function paintFile() {
    var f = state.file;
    if (!f) return;
    var shown = (urlEl && urlEl.checked) ? toUrlSafe(f.b64) : f.b64;
    var dataUrl = 'data:' + f.mime + ';base64,' + f.b64;
    state.dataUrl = dataUrl;

    renderResult(shown, { mode: 'file', bytes: f.size, mime: f.mime });

    if (fileNameEl) fileNameEl.textContent = f.name;
    if (fileMetaEl) {
      fileMetaEl.textContent = fmtSize(f.size) + ' · ' + f.mime +
        ' · Base64 ' + f.b64.length + ' 字符';
    }
    if (previewEl) {
      /* 只给图片做预览，且体积有上限：几 MB 的图把 Data URL 塞进 src 会明显卡。
         Data URL 来自用户文件，所以用 DOM 节点 + .src 赋值，不拼 HTML 字符串。 */
      if (/^image\//.test(f.type) && f.size <= 4 * 1048576) {
        previewEl.src = dataUrl;
        previewEl.hidden = false;
        previewEl.alt = f.name + ' 的预览';
      } else {
        previewEl.removeAttribute('src');
        previewEl.hidden = true;
      }
    }
    if (fileCard) fileCard.hidden = false;
  }

  function readFile(file) {
    if (!file) return;
    var name = file.name || '未命名';
    var type = file.type || '';
    /* 上游直接拼 file.type：type 为空时得到 `data:;base64,…`，
       是一个没有 MIME 的坏 Data URL。拖放的 .md / 无扩展名文件就是这个下场。 */
    var mime = type || 'application/octet-stream';

    var reader = new FileReader();
    reader.onerror = function () {
      setStatus('error', '读不了这个文件', name);
    };
    reader.onload = function (e) {
      var bytes = new Uint8Array(e.target.result);
      state.file = {
        name: name, type: type, mime: mime,
        size: bytes.length, b64: bytesToBase64(bytes)
      };
      paintFile();
      setStatus('ok', '已读取文件并编码 · ' + name + '（' + fmtSize(bytes.length) + '）');
    };
    reader.readAsArrayBuffer(file);
  }

  function resetFile() {
    state.file = null;
    state.dataUrl = '';
    if (fileCard) fileCard.hidden = true;
    if (previewEl) { previewEl.removeAttribute('src'); previewEl.hidden = true; }
  }

  /* --- 8. 事件 ----------------------------------------------------------- */

  inputEl.addEventListener('input', onInput);

  if (encodeBtn) encodeBtn.addEventListener('click', function () { doEncode(false); inputEl.focus(); });
  if (decodeBtn) decodeBtn.addEventListener('click', function () { doDecode(false); inputEl.focus(); });

  /* 「结果换到输入」：按上一次的方向反向再跑一遍，而不是像上游那样只搬字符串、
     还要用户自己再点一次按钮。 */
  if (swapBtn) {
    swapBtn.addEventListener('click', function () {
      if (!state.out || state.mode === null || state.binary) {
        setStatus('warn', '还没有可以交换的结果',
          state.binary ? '当前是字节视图，换回输入没有意义。' : '先编码或解码一次。');
        return;
      }
      var next = state.mode === 'encode' ? 'decode' : 'encode';
      inputEl.value = state.out;
      if (next === 'decode') doDecode(false); else doEncode(false);
      inputEl.focus();
    });
  }

  if (urlEl) urlEl.addEventListener('change', function () {
    /* 文件结果要按新写法重算，不能走输入框那条路（输入框里没有那个文件） */
    if (state.mode === 'file' && state.file) paintFile(); else refresh();
  });
  if (autoEl) autoEl.addEventListener('change', function () {
    if (autoEl.checked) refresh(); else setStatus('', inputEl.value ? '自动判定已关：点下面的按钮决定编码还是解码。' : '');
  });

  if (copyB64Btn) {
    copyB64Btn.addEventListener('click', function () {
      if (!state.out) return;
      U.copy(state.out, copyB64Btn);
    });
  }
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', function () {
      if (!state.dataUrl) return;
      U.copy(state.dataUrl, copyUrlBtn);
    });
  }

  /* 拖放与点选文件。拖放路径在 jsdom 里测不到（没有 DataTransfer），
     点选路径可以测 —— 见 scripts/tests/base64.mjs。 */
  if (dropEl && fileEl) {
    dropEl.addEventListener('click', function () { fileEl.click(); });
    dropEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileEl.click(); }
    });
    fileEl.addEventListener('change', function () {
      if (fileEl.files && fileEl.files[0]) readFile(fileEl.files[0]);
      fileEl.value = '';
    });
    dropEl.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropEl.classList.add('drop-zone--active');
    });
    dropEl.addEventListener('dragleave', function () {
      dropEl.classList.remove('drop-zone--active');
    });
    dropEl.addEventListener('drop', function (e) {
      e.preventDefault();
      dropEl.classList.remove('drop-zone--active');
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) readFile(dt.files[0]);
    });
  }

  if (demoBtn) {
    demoBtn.addEventListener('click', function () {
      inputEl.value = DEMO;
      if (autoEl) autoEl.checked = true;
      refresh();
      inputEl.focus();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      inputEl.value = '';
      clearResult();
      resetFile();
      setStatus('', '');
      inputEl.focus();
    });
  }

  /* Ctrl/Cmd + Enter 直接编码（与其它工具一致：不抢普通按键） */
  inputEl.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      doEncode(false);
    }
  });

  /* --- 9. 首屏 ----------------------------------------------------------- */

  /* 不预填内容：空状态由 .output 的 data-placeholder 承担，
     统计留四个占位格子。首屏这一下不走防抖，免得测试第一次断言读到空 DOM。 */
  clearResult();
  refresh();
})();
