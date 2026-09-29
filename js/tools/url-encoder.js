/* ==========================================================================
   url-encoder.js — URL 编解码
   --------------------------------------------------------------------------
   移植自 Praticulus 的 js/tools/url-encoder.js（MIT，作者 Jamal Tantaoui /
   Iris Digital）。保留下来的：输入框 + 「编码 / 解码 / 编码组件」三个动作、
   「结果换到输入」、输入即处理（自动判定方向），以及 URL 结构拆解面板。

   改动清单
   --------
   1. 全量中文化；统一到本站设计系统（`.panel` / `.toolbar` / `.choice-row` /
      `.stat-grid` / `.data-table` / `.value-list` / `.tool-status`）。
      上游的 `.card` / `.btn-group` / `.status-bar` / `d-none` /
      `.url-part-row` 全部换掉，`js/common.js`（`escapeHtml` / `showToast` /
      `copyToClipboard`）不引入。
   2. **「自动判定方向」只看 `%XX` 在不在，含字面 `%XX` 的普通文本没法编码。**
      上游 `isEncoded = /%[0-9A-Fa-f]{2}/` 一命中就解码，而且是在 `input`
      事件里直接执行 —— 粘一段「进度 100%25」进来会被解成「进度 100%」。
      现在：自动判定要求**整串真的解得开**（每个 `%` 后面都是合法的两位十六进制，
      且解出的字节是合法 UTF-8），不满足就按「编码」处理，并在状态行说明原因；
      自动判定**永远不报错**，报错只发生在用户自己点「解码」的时候。
   3. **解码前 `.trim()`。** 上游 `doDecodeURL` 里那一句会悄悄吃掉首尾空格 ——
      而首尾空格恰恰是最需要被看见的东西（Web 上一大半脏数据就是它）。
      现在原样处理，不 trim。
   4. **`+` 从不被当作空格。** 上游只用 `decodeURIComponent`，而
      application/x-www-form-urlencoded（表单、绝大多数查询串）里空格写作 `+`，
      于是从表单复制出来的查询串，`a+b` 会被解成 `a+b` 而不是 `a b`。
      现在编码侧有「空格编码为 `+`」、解码侧有「`+` 视为空格」两个开关，默认关。
      判「`+` 是不是空格」看的是**输入里那个字符**：`%2B` 解出来必须是字面的加号。
   5. **解码失败只有一句 "Invalid encoded string"。** `decodeURIComponent` 抛的
      URIError 里没有任何位置信息，上游也不解释。现在自己实现百分号解码，
      逐个定位：`%` 后面不是两位十六进制，或字节序列不是合法 UTF-8
      （首字节非法 / 续接字节非法 / 截断 / 过长编码 / 代理项 / 超出码位范围），
      都给出「第几个字符」「哪几个字节」；能用 GBK 兜底时还会给出推测值
      （老站点用 GBK 编码查询串是常见情况，`%C4%E3` 就是「你」）。
   6. **`encodeURI` 与 `decodeURIComponent` 不对称。** 上游编码走 `encodeURI`、
      解码走 `decodeURIComponent`，于是「整条 URL」编码后 `%2F` 会被解回 `/`，
      路径语义被悄悄改掉（`%2F` 是路径段里的字面斜线，`/` 是分隔符）。
      现在模式（组件 / 整条 URL / 严格）同时决定两个方向 —— 整条 URL 模式下
      解码保留保留字的转义，与 `decodeURI` 一致。
   7. **`lastMode` 只写不读**（3 处赋值、0 处读取），删掉。
   8. **占位文案被当成结果内容写进元素里**，`swapIO` 拿它当哨兵比较，
      复制按钮也会把占位文案复制走。改用 `.output` 的 `data-placeholder` 空态。
   9. **复制裸调 `navigator.clipboard`**（没有回退、没有反馈，还复制到占位文案）。
      改走 `T.util.copy` + `data-copy-target`。
   10. 新增：四个统计格、严格模式（RFC 3986 非保留字之外全编码，JWT / OAuth 的
       签名基串要的是这一种）、小写十六进制选项、代理项提示、查询参数逐条拆解
       （参数名 / 原样 / 解码后）、常用字符转义对照表 —— 表里的十六进制是**由字节
       算出来的**，不是抄来的，所以不会出现「表跟实现对不上」。
   11. 上游的 SEO 文案（`.seo-heading` / `.seo-text` / JSON-LD / 内链）不引入 ——
       本站不做爬虫优化，这是既有决定。

   隐私：URL 不是密钥，所以不做遮蔽开关；但沿用安全分类的硬约束 ——
   不写 `localStorage` / `sessionStorage`、不进 URL、不挂表单，
   含用户输入的文本一律 `textContent` 建节点（从不拼 `innerHTML`）。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;

  /* --- 1. 依赖守卫 ------------------------------------------------------- */
  /* 依赖缺失时不要静默 return：结果区一片空白、控制台可能一行错都没有。
     这里用最原始的写法往结果区塞一条看得见的提示。 */
  function header(msg) {
    var box = document.getElementById('ue-output');
    if (box) box.textContent = msg;
  }

  if (!T || !T.util || typeof T.util.setStatus !== 'function') {
    header('公共脚本 js/site.js 没有加载成功（或版本过旧）。请强制刷新后重试。');
    return;
  }
  var util = T.util;

  var ui = {
    input: document.getElementById('ue-input'),
    output: document.getElementById('ue-output'),
    status: document.getElementById('ue-status'),
    stats: document.getElementById('ue-stats'),
    modes: document.getElementById('ue-modes'),
    encodeBtn: document.getElementById('ue-encode'),
    decodeBtn: document.getElementById('ue-decode'),
    swapBtn: document.getElementById('ue-swap'),
    demoBtn: document.querySelector('[data-demo]'),
    clearBtn: document.querySelector('[data-clear]'),
    optSpacePlus: document.getElementById('ue-space-plus'),
    optPlusSpace: document.getElementById('ue-plus-space'),
    optLower: document.getElementById('ue-lower'),
    optAuto: document.getElementById('ue-auto'),
    parts: document.getElementById('ue-parts'),
    partsEmpty: document.getElementById('ue-parts-empty'),
    paramsWrap: document.getElementById('ue-params-wrap'),
    paramsBody: document.getElementById('ue-params'),
    paramsNote: document.getElementById('ue-params-note'),
    refBody: document.getElementById('ue-ref')
  };

  if (!ui.input || !ui.output || !ui.status || !ui.stats || !ui.parts ||
      !ui.paramsWrap || !ui.paramsBody || !ui.paramsNote) {
    header('页面结构不完整：缺少结果区、状态行、统计面板或拆解面板，工具没有启动。');
    return;
  }

  /* --- 2. 小工具 --------------------------------------------------------- */

  function codePoints(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length &&
          s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF) { n++; i++; }
      else n++;
    }
    return n;
  }

  function countPercent(s) {
    var m = String(s).match(/%[0-9A-Fa-f]{2}/g);
    return m ? m.length : 0;
  }

  function countNonAscii(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length &&
          s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF) { n++; i++; }
      else if (c > 0x7F) n++;
    }
    return n;
  }

  /** 落单代理项计数：它会被编码成 U+FFFD（�），这件事必须说出来 */
  function loneSurrogates(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        if (i + 1 < s.length && s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF) i++;
        else n++;
      } else if (c >= 0xDC00 && c <= 0xDFFF) n++;
    }
    return n;
  }

  function group(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function hex2(b, lower) {
    var h = b.toString(16);
    if (h.length < 2) h = '0' + h;
    return lower ? h : h.toUpperCase();
  }

  /* --- 3. UTF-8 --------------------------------------------------------- */

  var utf8Encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;

  function pushUtf8(out, cp) {
    if (cp >= 0xD800 && cp <= 0xDFFF) cp = 0xFFFD;   /* 与 TextEncoder 口径一致 */
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }

  function utf8Bytes(str) {
    if (utf8Encoder) return utf8Encoder.encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var cp = str.codePointAt(i);
      if (cp > 0xFFFF) i++;
      pushUtf8(out, cp);
    }
    return Uint8Array.from(out);
  }

  /**
   * 严格的 UTF-8 解码（RFC 3629）：不接受过长编码、代理项码位、截断的序列。
   * @returns {{ok:true,text:string}|{ok:false,code:string,at:number}}
   *          code: lead / truncated / continuation / overlong / surrogate / range
   */
  function utf8DecodeStrict(bytes) {
    var out = '';
    var i = 0;
    var n = bytes.length;
    while (i < n) {
      var b = bytes[i];
      var len, cp, min;
      if (b < 0x80) { len = 1; cp = b; min = 0; }
      else if ((b & 0xE0) === 0xC0) { len = 2; cp = b & 0x1F; min = 0x80; }
      else if ((b & 0xF0) === 0xE0) { len = 3; cp = b & 0x0F; min = 0x800; }
      else if ((b & 0xF8) === 0xF0) { len = 4; cp = b & 0x07; min = 0x10000; }
      else return { ok: false, code: 'lead', at: i };
      if (i + len > n) return { ok: false, code: 'truncated', at: i };
      for (var k = 1; k < len; k++) {
        var c = bytes[i + k];
        if ((c & 0xC0) !== 0x80) return { ok: false, code: 'continuation', at: i + k };
        cp = (cp << 6) | (c & 0x3F);
      }
      if (cp < min) return { ok: false, code: 'overlong', at: i };
      if (cp > 0x10FFFF) return { ok: false, code: 'range', at: i };
      if (cp >= 0xD800 && cp <= 0xDFFF) return { ok: false, code: 'surrogate', at: i };
      out += String.fromCodePoint(cp);
      i += len;
    }
    return { ok: true, text: out };
  }

  /* --- 4. 百分号编码 / 解码 --------------------------------------------- */

  /* RFC 3986 §2.3 的非保留字是 A-Z a-z 0-9 - . _ ~。下面三张表说的是
     「哪些 ASCII 字符**不**编码」，其余一律编成 %XX：
       component —— encodeURIComponent 的保留集（含 ! ' ( ) * 这几个 sub-delim）；
       uri       —— encodeURI：再放行 ; , / ? : @ & = + $ #；
       strict    —— 只放行非保留字，其余全编码。RFC 3986 §2.3 的字面口径，
                    JWT / OAuth 的签名基串要的就是这一种（那里 ! ' ( ) * 必须编码）。 */
  var ENCODE_SETS = {
    component: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()",
    uri: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'();,/?:@&=+$#",
    strict: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  };

  function allowTable(set) {
    var t = new Array(128);
    for (var i = 0; i < 128; i++) t[i] = false;
    for (var j = 0; j < set.length; j++) t[set.charCodeAt(j)] = true;
    return t;
  }

  var ALLOW = {
    component: allowTable(ENCODE_SETS.component),
    uri: allowTable(ENCODE_SETS.uri),
    strict: allowTable(ENCODE_SETS.strict)
  };

  /* 整条 URL 模式下解码要**保留**的转义，对齐 decodeURI：这些是分隔符，
     解出来会改变 URL 的结构（`%2F` 是路径段里的字面斜线，`/` 是分隔符）。 */
  var URI_RESERVED_DECODE = (function () {
    var t = new Array(128);
    for (var i = 0; i < 128; i++) t[i] = false;
    '; , / ? : @ & = + $ #'.split(' ').forEach(function (c) { t[c.charCodeAt(0)] = true; });
    return t;
  })();

  /**
   * @param {string} text
   * @param {'component'|'uri'|'strict'} mode
   * @param {{lower?:boolean, spaceAsPlus?:boolean}} [opts]
   * @returns {{text:string, escapes:number, byteLength:number}}
   */
  function percentEncode(text, mode, opts) {
    opts = opts || {};
    var allow = ALLOW[mode] || ALLOW.component;
    var bytes = utf8Bytes(text);
    var out = '';
    var escapes = 0;
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b < 0x80 && allow[b]) { out += String.fromCharCode(b); continue; }
      escapes++;
      out += '%' + hex2(b, opts.lower);
    }
    if (opts.spaceAsPlus) out = out.replace(/%20/g, '+');
    return { text: out, escapes: escapes, byteLength: bytes.length };
  }

  function hexVal(c) {
    var n = c.charCodeAt(0);
    if (n >= 48 && n <= 57) return n - 48;
    if (n >= 65 && n <= 70) return n - 55;
    if (n >= 97 && n <= 102) return n - 87;
    return -1;
  }

  function byteList(bytes) {
    var out = [];
    for (var i = 0; i < bytes.length; i++) out.push(hex2(bytes[i]));
    return out.join(' ');
  }

  /**
   * 自己实现百分号解码，为的是能指出**错在哪个字符**。
   * `decodeURIComponent` 抛的 URIError 只有一句 "URI malformed"。
   *
   * @param {string} str
   * @param {'component'|'uri'|'strict'} mode  uri 模式保留保留字的转义（对齐 decodeURI）
   * @param {{plusAsSpace?:boolean}} [opts]
   * @returns {{ok:true,text:string,escapes:number}
   *          |{ok:false,code:'escape',index:number,snippet:string}
   *          |{ok:false,code:'utf8',detail:string,index:number,at:number,byte:number,raw:number[]}}
   */
  function percentDecode(str, mode, opts) {
    opts = opts || {};
    var plusAsSpace = !!opts.plusAsSpace;
    var keepReserved = mode === 'uri';
    var n = str.length;
    var out = '';
    var escapes = 0;
    var bytes = [];   /* 当前累积的字节 */
    var src = [];     /* 与 bytes 一一对应的输入字符位置 */

    function flush() {
      if (!bytes.length) return null;
      var r = utf8DecodeStrict(Uint8Array.from(bytes));
      if (!r.ok) return { code: r.code, at: r.at };
      out += r.text;
      bytes = [];
      src = [];
      return null;
    }

    function utf8Fail(e) {
      return {
        ok: false,
        code: 'utf8',
        detail: e.code,
        index: src[e.at] == null ? 0 : src[e.at],
        at: e.at,
        byte: bytes[e.at],
        raw: bytes.slice()
      };
    }

    var i = 0;
    while (i < n) {
      var ch = str.charAt(i);

      if (ch === '%') {
        var h1 = i + 1 < n ? hexVal(str.charAt(i + 1)) : -1;
        var h2 = i + 2 < n ? hexVal(str.charAt(i + 2)) : -1;
        if (h1 < 0 || h2 < 0) {
          return { ok: false, code: 'escape', index: i, snippet: str.slice(i, i + 3) };
        }
        var b = (h1 << 4) | h2;
        escapes++;
        if (keepReserved && b < 0x80 && URI_RESERVED_DECODE[b]) {
          var e0 = flush();
          if (e0) return utf8Fail(e0);
          out += str.substr(i, 3);
          i += 3;
          continue;
        }
        bytes.push(b);
        src.push(i);
        i += 3;
        continue;
      }

      if (plusAsSpace && ch === '+') {
        var e1 = flush();
        if (e1) return utf8Fail(e1);
        out += ' ';
        i++;
        continue;
      }

      var e2 = flush();
      if (e2) return utf8Fail(e2);
      var cp = str.codePointAt(i);
      out += String.fromCodePoint(cp);
      i += cp > 0xFFFF ? 2 : 1;
    }

    var e3 = flush();
    if (e3) return utf8Fail(e3);
    return { ok: true, text: out, escapes: escapes };
  }

  /* --- 5. GBK 兜底（只在 UTF-8 解不开时给一个推测值） -------------------- */

  var gbkDecoder = null;
  var gbkProbed = false;

  function gbkGuess(bytes) {
    if (!gbkProbed) {
      gbkProbed = true;
      try {
        if (typeof TextDecoder === 'function') {
          var d = new TextDecoder('gbk', { fatal: true });
          d.decode(Uint8Array.from([0x41]));   /* 试一下这个标签认不认 */
          gbkDecoder = d;
        }
      } catch (e) { gbkDecoder = null; }
    }
    if (!gbkDecoder) return null;
    try { return gbkDecoder.decode(Uint8Array.from(bytes)); } catch (e) { return null; }
  }

  /* --- 6. 模式与状态 ----------------------------------------------------- */

  var MODES = [
    { id: 'component', name: '组件', hint: '等价 encodeURIComponent / decodeURIComponent',
      use: '查询参数值、路径段。保留字全部编码' },
    { id: 'uri', name: '整条 URL', hint: '等价 encodeURI / decodeURI',
      use: '完整的网址。保留字 ; , / ? : @ & = + $ # 不编码，解码时也原样保留' },
    { id: 'strict', name: '严格', hint: 'RFC 3986 非保留字之外全编码',
      use: '签名基串（JWT / OAuth）。连 ! \' ( ) * 也要编码' }
  ];

  var state = {
    mode: 'component',
    forced: null,       /* 'encode' | 'decode' | null：用户点了按钮就用它，一动输入就清掉 */
    dir: 'encode',
    output: '',
    ok: true
  };

  function opt(el) { return !!(el && el.checked); }

  /* --- 7. 状态行 --------------------------------------------------------- */

  function setStatusLine(level, text, extra) {
    util.setStatus(ui.status, level, text);
    if (extra) {
      var span = document.createElement('span');
      span.className = 'err-raw';
      span.textContent = extra;
      ui.status.appendChild(span);
    }
  }

  /* --- 8. 统计 ---------------------------------------------------------- */

  var STAT_LABELS = ['输入字符数', '输出字符数', '百分号转义', '非 ASCII 字符'];
  var statValues = [];

  function buildStats() {
    STAT_LABELS.forEach(function (label) {
      var box = document.createElement('div');
      box.className = 'stat';
      var lab = document.createElement('div');
      lab.className = 'stat-label';
      lab.textContent = label;
      var val = document.createElement('div');
      val.className = 'stat-value';
      val.textContent = '0';
      box.appendChild(lab);
      box.appendChild(val);
      ui.stats.appendChild(box);
      statValues.push(val);
    });
  }

  function paintStats(input, dir) {
    var out = state.output;
    var vals = [
      group(codePoints(input)),
      state.ok ? group(codePoints(out)) : '—',
      group(dir === 'encode' ? countPercent(out) : countPercent(input)),
      group(dir === 'encode' ? countNonAscii(input) : countNonAscii(out))
    ];
    for (var i = 0; i < statValues.length; i++) statValues[i].textContent = vals[i];
  }

  /* --- 9. URL 结构拆解 --------------------------------------------------- */

  function decodeTolerant(s) {
    var r = percentDecode(s, 'component', { plusAsSpace: opt(ui.optPlusSpace) });
    return r.ok ? { ok: true, text: r.text } : { ok: false, text: s };
  }

  function defaultPort(protocol) {
    if (protocol === 'https:' || protocol === 'wss:') return '443';
    if (protocol === 'http:' || protocol === 'ws:') return '80';
    if (protocol === 'ftp:') return '21';
    return '无';
  }

  function parseParams(search) {
    var q = search.charAt(0) === '?' ? search.slice(1) : search;
    if (!q) return [];
    var out = [];
    q.split('&').forEach(function (seg, i) {
      if (seg === '') return;
      var eq = seg.indexOf('=');
      out.push({
        n: i + 1,
        raw: seg,
        key: eq < 0 ? seg : seg.slice(0, eq),
        value: eq < 0 ? null : seg.slice(eq + 1)
      });
    });
    return out;
  }

  function parseUrl(raw) {
    var s = raw.trim();
    if (!s) return { state: 'empty' };
    var u = null;
    try { u = new URL(s); } catch (e) { u = null; }
    if (!u) {
      /* 有主机名与点、却没有协议 —— 这是最常见的一种「不是 URL」，
         直接说清楚比一句「无法解析」有用。 */
      if (/^[^\s/?#@]+\.[^\s/?#@]{2,}([/?#]|$)/.test(s) &&
          !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
        return { state: 'no-scheme' };
      }
      return { state: 'invalid' };
    }

    var rows = [];
    rows.push({ label: '协议', value: u.protocol.replace(/:$/, '') || '（无）' });
    rows.push({ label: '主机', value: u.hostname || '（无）' });
    rows.push({ label: '端口', value: u.port || '默认（' + defaultPort(u.protocol) + '）' });
    if (u.username || u.password) {
      rows.push({ label: '用户信息', value: u.username + (u.password ? ' / ' + u.password : '') });
    }
    var path = decodeTolerant(u.pathname);
    rows.push({ label: '路径', value: path.ok ? path.text : u.pathname });
    rows.push({ label: '查询串', value: u.search ? u.search.slice(1) : '（无）' });
    var frag = u.hash ? decodeTolerant(u.hash.slice(1)) : null;
    rows.push({ label: '片段', value: u.hash ? (frag.ok ? frag.text : u.hash.slice(1)) : '（无）' });

    var params = parseParams(u.search);
    var unresolved = 0;
    var parsed = params.map(function (p) {
      var k = decodeTolerant(p.key);
      var v = p.value === null ? null : decodeTolerant(p.value);
      if (!k.ok || (v && !v.ok)) unresolved++;
      return {
        n: p.n,
        rawValue: p.value,          /* 原样（未解码）的值，用来与解码后对照 */
        key: k.text,
        keyOk: k.ok,
        value: v === null ? null : v.text,
        valueOk: !v || v.ok
      };
    });

    return { state: 'ok', rows: rows, params: parsed, unresolved: unresolved };
  }

  function renderParts(info) {
    ui.parts.textContent = '';
    ui.paramsBody.textContent = '';

    if (info.state !== 'ok') {
      ui.parts.hidden = true;
      ui.paramsWrap.hidden = true;
      ui.paramsNote.hidden = true;
      ui.partsEmpty.hidden = false;
      var strong = document.createElement('strong');
      var text = document.createElement('span');
      if (info.state === 'empty') {
        strong.textContent = '还没有输入';
        text.textContent = '在左边填一条绝对 URL（带 http:// 或 https://），这里会把它拆成协议、主机、路径、查询参数与片段。';
      } else if (info.state === 'no-scheme') {
        strong.textContent = '缺少协议部分';
        text.textContent = '这段文本有主机名，但没有 http:// 或 https:// 这样的协议前缀，浏览器无法确定它是什么。补上协议再试。';
      } else {
        strong.textContent = '这不是一条能解析的 URL';
        text.textContent = '浏览器只接受绝对 URL。要处理单独的参数值或路径段，用上面的「组件」模式编码 / 解码即可。';
      }
      ui.partsEmpty.textContent = '';
      ui.partsEmpty.appendChild(strong);
      ui.partsEmpty.appendChild(text);
      return;
    }

    ui.partsEmpty.hidden = true;
    ui.parts.hidden = false;

    info.rows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'value-row';
      row.setAttribute('data-copy-value', r.value);
      row.setAttribute('title', '点击复制：' + r.value);
      var label = document.createElement('span');
      label.className = 'value-label';
      label.textContent = r.label;
      var value = document.createElement('span');
      value.className = 'value-text';
      value.textContent = r.value;
      row.appendChild(label);
      row.appendChild(value);
      ui.parts.appendChild(row);
    });

    if (!info.params.length) {
      ui.paramsWrap.hidden = true;
      ui.paramsNote.hidden = true;
      return;
    }

    ui.paramsWrap.hidden = false;
    var MAX = 200;
    info.params.slice(0, MAX).forEach(function (p) {
      var tr = document.createElement('tr');

      var tdKey = document.createElement('td');
      tdKey.textContent = p.key;
      if (!p.keyOk) tdKey.className = 'cell-error';

      /* 「原样值」只放值、不带 `键=` —— 参数名已经在第一列了，
         重复一遍只会让人以为两列说的不是同一件事。 */
      var tdRaw = document.createElement('td');
      tdRaw.className = 'mono';

      var tdVal = document.createElement('td');
      if (p.rawValue === null) {
        tdRaw.textContent = '（无值）';
        tdVal.textContent = '（无值）';
      } else {
        tdRaw.textContent = p.rawValue;
        tdVal.textContent = p.value;
        if (!p.valueOk) tdVal.className = 'cell-error';
      }

      tr.appendChild(tdKey);
      tr.appendChild(tdRaw);
      tr.appendChild(tdVal);
      ui.paramsBody.appendChild(tr);
    });

    /* 截断与解不开都要说：静默少给几条，用户会以为参数就这么多 */
    var notes = [];
    if (info.params.length > MAX) {
      notes.push('参数共 ' + info.params.length + ' 条，这里只列出前 ' + MAX + ' 条。');
    }
    if (info.unresolved) {
      notes.push('有 ' + info.unresolved + ' 个参数值不是合法的 UTF-8，已按原样显示（单元格标红）。');
    }
    ui.paramsNote.textContent = notes.join(' ');
    ui.paramsNote.hidden = !notes.length;
  }

  /* --- 10. 常用字符对照表 ----------------------------------------------- */

  /* [字符, 说明]。十六进制与百分号编码都由 utf8Bytes 算出来 ——
     手抄一张表迟早跟实现对不上，而那正是最难发现的一类错。 */
  var REF_ROWS = [
    [' ', '空格', '查询串里常写作 +（表单编码）'],
    ['+', '加号', '查询串里会被当成空格解'],
    ['%', '百分号', '转义本身的引导符'],
    ['#', '井号', '片段标识，不会发给服务器'],
    ['&', '和号', '查询参数的默认分隔符'],
    ['=', '等号', '参数名与参数值的分隔符'],
    ['?', '问号', '查询串的起点'],
    ['/', '斜线', '路径分隔符；路径段里的字面斜线要编码'],
    [':', '冒号', '协议与端口的分隔符'],
    [';', '分号', '保留字（路径参数）'],
    ['@', 'at 号', '用户信息与主机的分隔符'],
    ['$', '美元号', '保留字'],
    [',', '逗号', '保留字'],
    ['!', '感叹号', 'sub-delim；严格模式下要编码'],
    ["'", '单引号', 'sub-delim；严格模式下要编码'],
    ['(', '左括号', 'sub-delim；严格模式下要编码'],
    [')', '右括号', 'sub-delim；严格模式下要编码'],
    ['*', '星号', 'sub-delim；严格模式下要编码'],
    ['[', '左方括号', 'IPv6 地址字面量；严格模式下要编码'],
    [']', '右方括号', 'IPv6 地址字面量；严格模式下要编码'],
    ['"', '双引号', '必须编码'],
    ['<', '小于号', '必须编码'],
    ['>', '大于号', '必须编码'],
    ['\\', '反斜线', '必须编码'],
    ['^', '脱字符', '必须编码'],
    ['`', '反引号', '必须编码'],
    ['{', '左花括号', '必须编码'],
    ['|', '竖线', '必须编码'],
    ['}', '右花括号', '必须编码'],
    ['-', '连字符', '非保留字，不编码'],
    ['.', '句点', '非保留字，不编码'],
    ['_', '下划线', '非保留字，不编码'],
    ['~', '波浪号', '非保留字，不编码'],
    ['中', '汉字 U+4E2D', 'UTF-8 三字节'],
    ['é', 'é U+00E9', 'UTF-8 两字节'],
    ['😀', 'emoji U+1F600', 'UTF-8 四字节（代理对）']
  ];

  function buildRef() {
    REF_ROWS.forEach(function (r) {
      var ch = r[0];
      var bytes = utf8Bytes(ch);
      var hexes = [];
      var pct = '';
      for (var i = 0; i < bytes.length; i++) {
        hexes.push(hex2(bytes[i]));
        pct += '%' + hex2(bytes[i]);
      }
      var tr = document.createElement('tr');

      var tdCh = document.createElement('td');
      tdCh.className = 'ue-ref-ch';
      var code = document.createElement('span');
      code.className = 'mono';
      /* 空格本身不可见，用本站统一的「·」表示（与空白清理的可见化视图一致），
         名字写在说明列，鼠标悬停另有 U+0020 提示 */
      code.textContent = ch === ' ' ? '·' : ch;
      if (ch === ' ') code.setAttribute('title', 'U+0020 空格');
      tdCh.appendChild(code);

      var tdBytes = document.createElement('td');
      tdBytes.className = 'mono';
      tdBytes.textContent = hexes.join(' ');

      var tdPct = document.createElement('td');
      tdPct.className = 'mono';
      tdPct.textContent = pct;

      var tdNote = document.createElement('td');
      tdNote.className = 'ue-ref-note';
      tdNote.textContent = r[1] + ' —— ' + r[2];

      tr.appendChild(tdCh);
      tr.appendChild(tdBytes);
      tr.appendChild(tdPct);
      tr.appendChild(tdNote);
      ui.refBody.appendChild(tr);
    });
  }

  /* --- 11. 渲染 --------------------------------------------------------- */

  function currentMode() {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === state.mode) return MODES[i];
    return MODES[0];
  }

  /** 自动判定：只有当整串**真的解得开**时才认为是「已编码」。 */
  var autoEncoded = false;

  function looksEncoded(s) {
    if (!/%[0-9A-Fa-f]{2}/.test(s)) return false;
    var r = percentDecode(s, state.mode, { plusAsSpace: opt(ui.optPlusSpace) });
    return r.ok;
  }

  /* 判定结果存下来给状态行复用：大输入上没必要为了一句文案再解一遍 */
  function pickDirection(s) {
    if (state.forced) return state.forced;
    if (!opt(ui.optAuto)) return 'encode';
    autoEncoded = looksEncoded(s);
    return autoEncoded ? 'decode' : 'encode';
  }

  function encodeOptions() {
    return { lower: opt(ui.optLower), spaceAsPlus: opt(ui.optSpacePlus) };
  }

  function render() {
    var raw = ui.input.value;
    var mode = currentMode();

    /* 空输入：清空结果与统计，不留任何状态 */
    if (raw === '') {
      state.output = '';
      state.ok = true;
      ui.output.textContent = '';
      setStatusLine('', '', '');
      paintStats('', 'encode');
      renderParts({ state: 'empty' });
      updateButtons();
      return;
    }

    var dir = pickDirection(raw);
    state.dir = dir;

    var result = null;
    var err = null;

    if (dir === 'encode') {
      result = percentEncode(raw, state.mode, encodeOptions());
    } else {
      var dec = percentDecode(raw, state.mode, { plusAsSpace: opt(ui.optPlusSpace) });
      if (dec.ok) result = { text: dec.text };
      else err = dec;
    }

    if (result) {
      state.ok = true;
      state.output = result.text;
      ui.output.textContent = result.text;

      var extra = '';
      var level = 'ok';
      var head = dir === 'encode'
        ? '已编码（' + mode.name + '）'
        : '已解码（' + mode.name + '）';

      if (state.forced) {
        head += ' · 你点的按钮';
      } else if (opt(ui.optAuto)) {
        /* 三种情形分开说：能解开、看着像转义但解不出文本、压根不像转义。
           混成一句「自动判定」会让用户猜不透工具刚才干了什么。 */
        var hasEscape = /%[0-9A-Fa-f]{2}/.test(raw);
        if (autoEncoded) head += ' · 自动判定：输入像已编码的串，按解码处理';
        else if (hasEscape) head += ' · 自动判定：转义解不出文本，按编码处理';
        else head += ' · 自动判定：输入不像已编码的串，按编码处理';
        if (hasEscape && dir === 'encode') {
          extra = '输入里虽然有 % 开头的片段，但它不构成一个能解开的转义串'
            + '（% 后面必须是两位十六进制，且解出的字节要是合法 UTF-8），所以按编码处理。'
            + '要强制解码请点「URL 解码」。';
        }
      }

      var lone = dir === 'encode' ? loneSurrogates(raw) : 0;
      if (lone) {
        level = 'warn';
        extra = '输入里有 ' + lone + ' 个落单的代理项（不成对的 UTF-16 半个字符），它们被编码成 U+FFFD（�）。原文里的这一处信息已经不可还原。';
      }

      setStatusLine(level, head + ' · ' + group(codePoints(result.text)) + ' 个字符', extra);
      paintStats(raw, dir);
      renderParts(parseUrl(raw));
    } else {
      state.ok = false;
      state.output = '';
      ui.output.textContent = '';
      presentError(err, raw);
      paintStats(raw, dir);
      renderParts(parseUrl(raw));
    }

    updateButtons();
  }

  /** 把解码失败翻译成「第几个字符、错在哪、怎么修」 */
  function presentError(err, raw) {
    var message = '';
    var detail = '';

    if (err.code === 'escape') {
      var at = err.index + 1;
      if (err.snippet === '%') {
        message = '第 ' + at + ' 个字符处的 % 后面什么都没有了，转义序列不完整。';
        detail = '单个 % 必须再跟两位十六进制数字才算一个转义，例如 %20。想表示字面的百分号，写法是 %25。';
      } else {
        message = '第 ' + at + ' 个字符处的「' + err.snippet + '」不是合法的转义序列。';
        detail = '% 后面必须紧跟两位十六进制数字（0-9、A-F），这里是「' +
          err.snippet.slice(1) + '」。想表示字面的百分号，写法是 %25。';
      }
    } else {
      var names = {
        lead: '不是合法的 UTF-8 首字节',
        continuation: '不是合法的 UTF-8 续接字节（应当在 0x80–0xBF 之间）',
        truncated: '表示一个多字节字符，但后面的字节不够（序列被截断了）',
        overlong: '是过长的编码（同一个字符有更短的合法写法，RFC 3629 禁止）',
        surrogate: '落在代理项码位区间 U+D800–U+DFFF，UTF-8 里不允许出现',
        range: '超出了 Unicode 的最大码位 U+10FFFF'
      };
      message = '第 ' + (err.index + 1) + ' 个字符起解出的字节不是合法的 UTF-8：0x' +
        hex2(err.byte) + ' ' + (names[err.detail] || '不合法') + '。';
      detail = '这一段解出来的字节是 ' + byteList(err.raw) + '。Base64 与百分号编码都只保证'
        + '「字节被原样搬运」，不保证那串字节是文本 —— 它有可能是图片、压缩包，'
        + '也有可能用的是 GBK 这类非 UTF-8 编码。';
      var guess = gbkGuess(err.raw);
      if (guess) {
        detail += ' 按 GBK 试解是「' + guess + '」（GBK 是老站点编码查询串的常见做法，'
          + '这只是推测，不一定是原意）。';
      }
    }

    setStatusLine('error', message, detail);
  }

  function updateButtons() {
    var canSwap = state.output !== '';
    ui.swapBtn.disabled = !canSwap;
    ui.swapBtn.setAttribute('title', canSwap
      ? '把结果放回输入框，方便继续处理'
      : '结果区还是空的，没有可以搬回输入的內容');

    ui.encodeBtn.setAttribute('aria-pressed', String(state.dir === 'encode'));
    ui.decodeBtn.setAttribute('aria-pressed', String(state.dir === 'decode'));
  }

  /* --- 12. 事件 --------------------------------------------------------- */

  function paintModeChips() {
    var chips = ui.modes ? ui.modes.querySelectorAll('[data-mode]') : [];
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute('aria-pressed', String(chips[i].getAttribute('data-mode') === state.mode));
    }
  }

  var onInput = util.debounce(function () {
    state.forced = null;   /* 一动输入就让「按钮指定」失效，回到自动判定 */
    render();
  }, 90);

  ui.input.addEventListener('input', onInput);

  if (ui.modes) {
    ui.modes.addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('[data-mode]') : null;
      if (!chip) return;
      state.mode = chip.getAttribute('data-mode');
      paintModeChips();
      render();
    });
  }

  ui.encodeBtn.addEventListener('click', function () { state.forced = 'encode'; render(); });
  ui.decodeBtn.addEventListener('click', function () { state.forced = 'decode'; render(); });

  ui.swapBtn.addEventListener('click', function () {
    if (state.output === '') return;
    ui.input.value = state.output;
    state.forced = null;
    render();
    ui.input.focus();
  });

  [ui.optSpacePlus, ui.optPlusSpace, ui.optLower, ui.optAuto].forEach(function (el) {
    if (el) el.addEventListener('change', render);
  });

  /* 拆解面板的行点了即复制（沿用 `.value-row[data-copied]` 的反馈样式） */
  ui.parts.addEventListener('click', function (e) {
    var row = e.target.closest ? e.target.closest('[data-copy-value]') : null;
    if (!row) return;
    util.copy(row.getAttribute('data-copy-value'), null);
    row.setAttribute('data-copied', 'true');
    clearTimeout(row._t);
    row._t = setTimeout(function () { row.removeAttribute('data-copied'); }, 1200);
  });

  if (ui.demoBtn) {
    ui.demoBtn.addEventListener('click', function () {
      ui.input.value = 'https://example.com/search?q=%E4%BD%A0%E5%A5%BD%20%E4%B8%96%E7%95%8C&lang=zh-CN&page=2#%E7%AC%AC%E4%B8%80%E9%A1%B5';
      state.forced = null;
      render();
      ui.input.focus();
    });
  }

  if (ui.clearBtn) {
    ui.clearBtn.addEventListener('click', function () {
      ui.input.value = '';
      state.forced = null;
      render();
      ui.input.focus();
    });
  }

  ui.input.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      state.forced = 'encode';
      render();
    }
  });

  /* --- 13. 首屏 --------------------------------------------------------- */

  buildStats();
  buildRef();
  paintModeChips();
  render();
})();
