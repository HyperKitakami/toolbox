/* ==========================================================================
   jwt-decoder.js — JWT 解码（自研）
   --------------------------------------------------------------------------
   设计取舍（自研工具，这一段是它唯一的「来源说明」）：

   1. 只解码，不校验签名 —— 这条写在页面最显眼处，也写在「时效」那一栏的措辞里。
      解码成功 ≠ 令牌有效：任何人都能照着原样拼一个载荷一样、签名随便填的 Token。
      本站不做验证，所以从不用「有效」「合法」这类词，只说「在本机时钟下算有效期内」。

   2. base64url 解码与 UTF-8 解码都自己实现，只借 atob 拿字节。
      atob 给的是一串「Latin-1 字符串」，转 UTF-8 那一步若用 TextDecoder 会多出一条
      环境分支（构造参数在各引擎上的容错不同），所以干脆自己写三十行 UTF-8 解码器：
      行为确定，还能把 overlong、孤立续字节、代理区这些非法序列数出来告诉用户。
      注意 atob 只认**标准** base64，所以送进去之前得把 - 与 _ 换回 + 与 / ——
      不换的话，载荷里只要出现一个 _ 就整段解不开（真实 Token 里非常常见）。
      另外末尾的 = 填充要在「挑非法字符」之前先摘掉，否则报出来的原因是假的。

   3. 段的处置按 RFC 的三种形态分开：3 段是 JWS；第三段为空字符串是未签名令牌
      （alg=none）；5 段是 JWE（加密令牌），此时只有第一段（受保护的头部）解得开，
      载荷是密文 —— 如实说明，不假装解出来了。只写 2 段的写法不合规
      （RFC 7519 的 JWT 一定是三段），照样解出来但明确标出问题。
      5 段未必是 JWE（也可能是几个 Token 粘在一起），判据用 RFC 7516 §4.1：
      受保护头部里必须同时有 alg 与 enc。

   4. 时间声明按 RFC 7519 §2 的 NumericDate 处理：从 1970-01-01T00:00:00Z 起的
      **秒数**，允许小数。所以值是字符串数字时照样换算（但标出类型不合规），
      而 13 位（毫秒）会单独警告 —— 规范要求的是秒，按秒解释会得到公元五万年以后。
      时间一律换算成本机时区，并把「本机时间」印在底栏，让时效判定可复核。

   5. 安全提示只做「对着规范条文就能判定」的事：alg=none、缺 alg、crit、jku / x5u、
      jwk / x5c，以及时间声明互相矛盾、iat 在未来。不去猜「这个 Token 是不是被盗了」——
      那需要上下文，猜出来的结论比不说更糟。

   6. 声明表、概览、时效判定共用同一次解析结果与同一张声明字典，避免出现
      「表里说过期了、概览还写着有效期内」这种自相矛盾。

   7. 演示 Token 在运行时拼出来，不在源码里写一长串 base64：免得源码里躺着一串
      看着像真凭据的东西，也让 exp / iat 能跟着当前时间走 —— 示例才真的能展示
      「还剩 2 小时」这类结论。它的签名是合成的 32 字节，按钮 title 里写明了这一点。

   8. 复制不走 data-copy-target 的通用机制：复制目标随 Tab 变（载荷 / 头部 / 签名段），
      由 JS 复制 state.copyText（与空白清理同一个理由）。签名栏里那三行各自是
      .value-row，仍然走通用机制。

   9. 不用 lookbehind、String.replaceAll、Array.at、Object.fromEntries 这类较新的语法：
      它们是解析期错误，整个脚本加载失败、工具白屏，控制台连一行有用的报错都没有。

   10. 告警只有一种形状：{ level, title, text }。曾经有几条是裸字符串，渲染时
       title / text 都取不到，于是整块提示渲染成一个「看得见边框、看不见字」的空壳 ——
       比不显示还难查。渲染端对裸字符串做了兜底，但新增告警仍请按这个形状写。

   11. Tab 状态分两个字段：state.tab 是「当前显示哪一栏」，state.userTab 是
       「用户手动点过哪一栏」（null = 没点过）。JWE 只有头部这一栏，会把 tab 强推
       到 header；如果拿 tab 当用户意图，之后换成普通 Token 就再也回不到「载荷」了。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  /* --- 0. 取元素 + 依赖检查 ---------------------------------------------- */
  var inputEl = document.getElementById('jwt-input');
  var statusEl = document.getElementById('jwt-status');
  var warnsEl = document.getElementById('jwt-warns');
  var partsEl = document.getElementById('jwt-parts');
  var statsEl = document.getElementById('jwt-stats');
  var footEl = document.getElementById('jwt-foot');
  var claimsEl = document.getElementById('jwt-claims');
  var claimCountEl = document.getElementById('jwt-claim-count');
  var tabsEl = document.getElementById('jwt-tabs');
  var codeEl = document.getElementById('jwt-code');
  var sigEl = document.getElementById('jwt-sig');
  var tabFootEl = document.getElementById('jwt-tab-foot');
  var copyBtn = document.getElementById('jwt-copy');
  var demoBtn = document.querySelector('[data-demo]');
  var clearBtn = document.querySelector('[data-clear]');
  if (!inputEl || !partsEl) return;

  /* 依赖缺失要吵，不要静默 return —— 静默退出的表现是「结果区一片空白、
     控制台一行错都没有」，用户完全无从下手（踩过一次，两个工具同时无输出）。
     这里刻意不依赖 T.util（它可能正是缺的那一半）。 */
  function bail(detail) {
    var box = document.getElementById('jwt-code');
    if (!box) return;
    box.innerHTML = '<div class="code-empty"><strong>工具没能初始化</strong></div>';
    var p = document.createElement('p');
    p.textContent = detail;
    box.firstChild.appendChild(p);
  }

  var util = T.util;
  if (!util || typeof util.renderCode !== 'function' || typeof util.emptyHint !== 'function' ||
      typeof util.highlightJson !== 'function') {
    bail('页面加载到的 js/site.js 是旧版本，缺少这个工具需要的公共方法。请强制刷新（Ctrl+F5）后重试。');
    return;
  }

  var esc = util.esc;
  var EMPTY_HINT = '把 Token 粘贴到左侧，这里会实时给出解码结果。';

  /* ======================================================================
     一、base64url 与 UTF-8
     ====================================================================== */

  var B64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  /**
   * base64url → 字节数组。不抛异常，失败时返回 { err }，错误文案里已经带上原因。
   * 容忍两种不合规但常见的写法（末尾带 = 填充、用了标准 base64 的 + /），
   * 都会记进 warns —— 用户需要知道自己那边写得不对。
   */
  function b64urlToBytes(seg) {
    var warns = [];
    var s = seg;

    if (s.indexOf('+') >= 0 || s.indexOf('/') >= 0) {
      warns.push({
        level: 'warn',
        title: '这一段用了标准 base64 的 + 或 /',
        text: 'JWS 用的是 base64url，这两个字符应当是 - 与 _。按 base64url 解释仍解得开，' +
          '但这一段严格来说不合规范。'
      });
      s = s.replace(/\+/g, '-').replace(/\//g, '_');
    }

    /* 先摘填充再挑非法字符 —— 顺序反了的话，= 会被当成「base64url 之外的字符」
       报出去，用户看到的原因就不是真原因。 */
    var padded = false;
    if (/=+$/.test(s)) {
      padded = true;
      s = s.replace(/=+$/, '');
    }

    var bad = /[^A-Za-z0-9_-]/.exec(s);
    if (bad) return { err: '含有 base64url 之外的字符「' + bad[0] + '」' };

    /* 长度除以 4 余 1 是任何 base64 编码都到不了的状态，先挡掉：
       交给 atob 会抛一句英文的 InvalidCharacterError，说不到点上。 */
    var rest = s.length % 4;
    if (rest === 1) return { err: '长度不合法（去掉填充后除以 4 余 1，任何 base64 编码都不会是这样）' };
    if (rest === 2) s += '==';
    else if (rest === 3) s += '=';

    /* atob 只认标准 base64，不认 base64url 的 - 与 _。
       两个字符换回去，否则带 - 或 _ 的段会整段解不开（真实 Token 里很常见）。 */
    s = s.replace(/-/g, '+').replace(/_/g, '/');

    var bin;
    try {
      bin = window.atob(s);
    } catch (e) {
      return { err: 'base64 解码失败：' + (e && e.message ? e.message : '未知错误') };
    }

    var bytes = [];
    for (var i = 0; i < bin.length; i++) bytes.push(bin.charCodeAt(i));
    if (padded) {
      warns.push({
        level: 'warn',
        title: '末尾带了 = 填充',
        text: 'JWS 的 base64url 要求把填充全部省略。这里已经自动去掉，内容能正常解出。'
      });
    }
    return { bytes: bytes, warns: warns };
  }

  /** 字节数组 → base64url（演示 Token 用；输出不带填充） */
  function bytesToB64url(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = bytes[i + 1];
      var b2 = bytes[i + 2];
      out += B64URL_CHARS.charAt(b0 >> 2);
      out += B64URL_CHARS.charAt(((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4));
      if (b1 === undefined) break;
      out += B64URL_CHARS.charAt(((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6));
      if (b2 === undefined) break;
      out += B64URL_CHARS.charAt(b2 & 63);
    }
    return out;
  }

  /**
   * UTF-8 → 字符串。非法字节（孤立续字节、overlong、代理区、截断）替换成 U+FFFD
   * 并计数，计数 > 0 时由调用方给出提示 —— 静默替换会让「解出来一串乱码」
   * 看起来像工具坏了。
   */
  function utf8Decode(bytes) {
    var out = '';
    var bad = 0;
    var i = 0;
    var n = bytes.length;

    while (i < n) {
      var b = bytes[i];
      var cp;
      var need;

      if (b < 0x80) { cp = b; need = 0; i++; }
      else if ((b & 0xE0) === 0xC0) { cp = b & 0x1F; need = 1; i++; }
      else if ((b & 0xF0) === 0xE0) { cp = b & 0x0F; need = 2; i++; }
      else if ((b & 0xF8) === 0xF0) { cp = b & 0x07; need = 3; i++; }
      else { out += '\uFFFD'; bad++; i++; continue; }

      var complete = true;
      for (var k = 0; k < need; k++) {
        var c = bytes[i];
        if (c === undefined || (c & 0xC0) !== 0x80) { complete = false; break; }
        cp = (cp << 6) | (c & 0x3F);
        i++;
      }
      if (!complete) { out += '\uFFFD'; bad++; continue; }

      /* 最短编码检查（overlong）、代理区、上界 */
      if ((need === 1 && cp < 0x80) || (need === 2 && cp < 0x800) ||
          (need === 3 && cp < 0x10000) || cp > 0x10FFFF ||
          (cp >= 0xD800 && cp <= 0xDFFF)) {
        out += '\uFFFD';
        bad++;
        continue;
      }

      if (cp > 0xFFFF) {
        cp -= 0x10000;
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      } else {
        out += String.fromCharCode(cp);
      }
    }
    return { text: out, invalid: bad };
  }

  /** 字符串 → UTF-8 字节（演示 Token 用）。落单的代理码位替换成 U+FFFD，不产出非法序列 */
  function utf8Encode(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var cp = str.charCodeAt(i);
      if (cp >= 0xD800 && cp <= 0xDBFF) {
        var lo = str.charCodeAt(i + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
          cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          i++;
        } else {
          cp = 0xFFFD;
        }
      } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
        cp = 0xFFFD;
      }

      if (cp < 0x80) bytes.push(cp);
      else if (cp < 0x800) bytes.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) bytes.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return bytes;
  }

  function toHex(bytes) {
    var out = [];
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16).toUpperCase();
      out.push(h.length < 2 ? '0' + h : h);
    }
    return out.join(' ');
  }

  /* ======================================================================
     二、时间、数字与小工具
     ====================================================================== */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 本机时区偏移，形如 UTC+08:00 */
  function tzText(d) {
    var off = -d.getTimezoneOffset();
    var sign = off < 0 ? '-' : '+';
    var a = Math.abs(off);
    return 'UTC' + sign + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
  }

  /** 秒（NumericDate）→ 本机时区的可读时间 */
  function fmtTime(sec) {
    var d = new Date(sec * 1000);
    if (isNaN(d.getTime())) return '超出可表示的日期范围';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + ' ' + tzText(d);
  }

  /** 把秒数说成人话（取绝对值）。先算整段再四舍五入余数，免得出现「3 分 60 秒」 */
  function humanDuration(sec) {
    sec = Math.round(Math.abs(sec));
    if (sec < 1) return '不到 1 秒';
    if (sec < 60) return sec + ' 秒';

    if (sec < 3600) {
      var m = Math.floor(sec / 60);
      var rs = sec - m * 60;
      return m + ' 分' + (rs ? ' ' + rs + ' 秒' : '');
    }
    if (sec < 86400) {
      var h = Math.floor(sec / 3600);
      var rm = Math.round((sec - h * 3600) / 60);
      if (rm === 60) { h++; rm = 0; }
      return h + ' 小时' + (rm ? ' ' + rm + ' 分' : '');
    }
    var d = Math.floor(sec / 86400);
    var rh = Math.round((sec - d * 86400) / 3600);
    if (rh === 24) { d++; rh = 0; }
    return d + ' 天' + (rh ? ' ' + rh + ' 小时' : '');
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function describeType(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return '数组';
    if (typeof v === 'number') return '数字';
    if (typeof v === 'string') return '字符串';
    if (v === undefined) return '空值';
    return typeof v;
  }

  function compactJson(v) {
    if (v === undefined) return '—';
    try {
      var s = JSON.stringify(v);
      return s === undefined ? '—' : s;
    } catch (e) {
      return String(v);
    }
  }

  /* 展示单个值用：字符串去掉 JSON 的引号（`alg = "HS256"` 读起来比 `alg = HS256` 累），
     其余类型仍按紧凑 JSON 写。声明表里保留引号 —— 那里要看的是「原始 JSON 值」。 */
  function plainValue(v) {
    if (typeof v === 'string') return v;
    return compactJson(v);
  }

  /**
   * 从 JSON.parse 的报错里抽出位置翻成中文。
   * 返回的 why 只讲「哪里不对」，不含「不是合法的 JSON」这种结论 ——
   * 结论由调用方的标题负责，否则拼起来会重复一遍。
   * raw 保留原始英文（便于用户拿去搜）。
   */
  function jsonErrorText(err, text) {
    var msg = String(err && err.message ? err.message : err);
    var why = '解出来不是 JSON';

    var at = /\(line (\d+) column (\d+)\)/.exec(msg);
    if (at) {
      why = '第 ' + at[1] + ' 行第 ' + at[2] + ' 列附近不合法';
    } else {
      var pos = /position (\d+)/.exec(msg);
      if (pos) {
        var i = Number(pos[1]);
        var before = text.slice(0, i);
        var line = before.split('\n').length;
        var col = i - before.lastIndexOf('\n');
        why = '第 ' + line + ' 行第 ' + col + ' 列附近不合法';
      }
    }
    return { why: why, raw: msg.replace(/\s*\(line \d+ column \d+\)/i, '') };
  }

  /* 超过这个量级（1000 亿秒 ≈ 公元 5138 年）就怀疑是毫秒时间戳。
     13 位的毫秒值（1.7e12）落在这一侧，10 位的秒值（1.7e9）不会。 */
  var MS_SUSPECT = 1e11;

  /* ======================================================================
     三、声明字典
     ----------------------------------------------------------------------
     kind：reg = RFC 7519 §4.1 的注册声明；common = 生态里常见的；其余按自定义处理。
     time：值是 NumericDate（秒），要换成本机时间显示。
     ====================================================================== */

  var CLAIMS = [
    { k: 'iss', name: '签发者', note: '谁签发的这个 Token', kind: 'reg' },
    { k: 'sub', name: '主体', note: 'Token 描述的对象，通常是用户 ID', kind: 'reg' },
    { k: 'aud', name: '受众', note: '接收方，可以是字符串，也可以是字符串数组', kind: 'reg' },
    { k: 'exp', name: '过期时间', note: '到或超过它，就必须拒绝这个 Token', kind: 'reg', time: true },
    { k: 'nbf', name: '生效时间', note: '早于它，就必须拒绝这个 Token', kind: 'reg', time: true },
    { k: 'iat', name: '签发时间', note: 'Token 是何时签发的', kind: 'reg', time: true },
    { k: 'jti', name: '令牌编号', note: '唯一标识，用于防重放（如一次性刷新令牌）', kind: 'reg' },
    { k: 'scope', name: '作用域', note: 'OAuth 2.0：空格分隔的权限清单', kind: 'common' },
    { k: 'scp', name: '作用域', note: 'OAuth 2.0：作用域的另一种写法', kind: 'common' },
    { k: 'azp', name: '授权方', note: 'OpenID Connect：Token 是发给哪个客户端的', kind: 'common' },
    { k: 'client_id', name: '客户端', note: 'OpenID Connect：客户端标识', kind: 'common' },
    { k: 'auth_time', name: '认证时间', note: 'OpenID Connect：用户实际完成登录的时间', kind: 'common', time: true },
    { k: 'nonce', name: '随机串', note: 'OpenID Connect：一次性的重放防护值', kind: 'common' },
    { k: 'sid', name: '会话编号', note: 'OpenID Connect：会话标识', kind: 'common' },
    { k: 'acr', name: '认证上下文', note: '用了哪一档强度的认证', kind: 'common' },
    { k: 'amr', name: '认证方式', note: '密码 / 短信 / 生物识别等，按数组给出', kind: 'common' },
    { k: 'at_hash', name: '访问令牌哈希', note: 'OpenID Connect：绑定同一流程里的访问令牌', kind: 'common' },
    { k: 'c_hash', name: '授权码哈希', note: 'OpenID Connect：绑定同一流程里的授权码', kind: 'common' },
    { k: 'email', name: '邮箱', note: 'OpenID Connect：用户邮箱', kind: 'common' },
    { k: 'email_verified', name: '邮箱已验证', note: '邮箱是否经过验证', kind: 'common' },
    { k: 'preferred_username', name: '用户名', note: 'OpenID Connect：偏好显示的用户名', kind: 'common' },
    { k: 'name', name: '姓名', note: 'OpenID Connect：用户全名', kind: 'common' },
    { k: 'roles', name: '角色', note: '授权方自定的角色清单（非标准声明）', kind: 'common' },
    { k: 'groups', name: '分组', note: '授权方自定的分组清单（非标准声明）', kind: 'common' },
    { k: 'permissions', name: '权限', note: '授权方自定的权限清单（非标准声明）', kind: 'common' }
  ];

  var CLAIM_MAP = {};
  var CLAIM_ORDER = {};
  CLAIMS.forEach(function (c, i) {
    CLAIM_MAP[c.k] = c;
    CLAIM_ORDER[c.k] = i;
  });

  var KIND_LABEL = { reg: '注册声明', common: '常用声明', custom: '自定义声明' };

  /* 头部参数：给「解码内容 · 头部」那一栏的底注写人话 */
  var HEADER_PARAMS = {
    alg: '签名算法',
    typ: '令牌类型',
    kid: '密钥编号',
    cty: '内容类型',
    crit: '关键扩展',
    jku: '密钥地址（JWK Set 的 URL）',
    jwk: '内嵌的公钥',
    x5u: '证书链地址',
    x5c: '内嵌的证书链',
    x5t: '证书指纹',
    'x5t#S256': '证书指纹（SHA-256）',
    enc: '内容加密算法',
    zip: '加密前的压缩方式'
  };

  /* ======================================================================
     四、解析
     ====================================================================== */

  /** 从 Authorization 头 / .env / 引号里粘过来都要能用 */
  function cleanInput(raw) {
    var s = String(raw == null ? '' : raw).replace(/^\s+|\s+$/g, '');
    s = s.replace(/^authorization\s*:\s*/i, '');
    s = s.replace(/^bearer\s+/i, '');

    if (s.length > 1) {
      var a = s.charAt(0);
      var z = s.charAt(s.length - 1);
      if ((a === '"' && z === '"') || (a === "'" && z === "'") || (a === '`' && z === '`')) {
        s = s.slice(1, -1);
      }
    }

    /* 折行粘进来的 Token 中间会夹空白，去掉；多粘了几行会在段数校验时报出来 */
    return s.replace(/\s+/g, '');
  }

  /** 解一段：base64url → 字节 → UTF-8 → JSON。失败也不抛异常，把问题记在返回值里 */
  function decodeSegment(seg, label) {
    var r = b64urlToBytes(seg);
    if (r.err) return { err: label + r.err };

    var u = utf8Decode(r.bytes);
    var out = { text: u.text, bytes: r.bytes, warns: r.warns.slice() };
    if (u.invalid) {
      out.warns.push({
        level: 'warn',
        title: label + '不是合法的 UTF-8',
        text: '有 ' + u.invalid + ' 个字节解不出来，已经用 \uFFFD 顶替。上面看到的问号就是它们。'
      });
    }

    var trimmed = u.text.replace(/^\s+|\s+$/g, '');
    if (trimmed === '') {
      out.jsonErr = { why: '解出来是空的', raw: '' };
      return out;
    }

    try {
      out.json = JSON.parse(trimmed);
    } catch (e) {
      out.jsonErr = jsonErrorText(e, trimmed);
    }
    return out;
  }

  /** 主解析：raw → 模型。模型里没有 DOM，逻辑与渲染分开。 */
  function parse(raw, nowSec) {
    var s = cleanInput(raw);
    if (!s) return { empty: true };

    var parts = s.split('.');
    var warns = [];
    var kind;

    if (parts.length === 1) {
      return {
        error: {
          title: '这不是一个 JWT',
          detail: '整串里一个点号都没有。JWT 是「头部.载荷.签名」三段 base64url 用点号连起来的。'
        }
      };
    }
    if (parts.length === 2) {
      kind = 'unsigned';
      warns.push({
        level: 'info',
        title: '只有 2 段',
        text: 'JWT 一定是 3 段 —— 未签名令牌的第三段是空字符串（结尾保留一个点号）。' +
          '只写两段不合规范，多半是签发方把末尾的空签名段截掉了。'
      });
    } else if (parts.length === 3) {
      kind = 'jws';
    } else if (parts.length === 5) {
      kind = 'jwe';
    } else {
      return {
        error: {
          title: '段数不对（' + parts.length + ' 段）',
          detail: 'JWS 是 3 段，JWE 是 5 段。如果刚才是粘了多个 Token，请一次只粘一个。'
        }
      };
    }

    var header = decodeSegment(parts[0], '头部');
    if (header.err) return { error: { title: '头部解不开', detail: header.err } };

    /* 5 段未必是 JWE —— 也可能两三个 Token 粘在了一起。
       判据用 RFC 7516 §4.1：JWE 的受保护头部里一定同时有 alg 与 enc。 */
    if (kind === 'jwe' && !(isPlainObject(header.json) && header.json.enc !== undefined)) {
      return {
        error: {
          title: '段数不对（5 段）',
          detail: '第一段解出来的头部里没有 JWE 必须的 enc 字段，所以这大概不是加密令牌，' +
            '而是几个 Token 粘在了一起。请一次只粘一个。'
        }
      };
    }

    var model = {
      kind: kind,
      partCount: parts.length,
      token: s,
      nowSec: nowSec,
      header: header,
      payload: null,
      signature: null,
      jweSegments: null,
      warns: warns.concat(header.warns)
    };

    if (kind === 'jwe') {
      /* 加密令牌：只有第一段解得开，其余四段只报字节数 */
      var jwe = [];
      for (var j = 1; j < parts.length; j++) {
        var rb = b64urlToBytes(parts[j]);
        jwe.push({ bytes: rb.err ? null : rb.bytes.length });
      }
      model.jweSegments = jwe;
      return model;
    }

    var payload = decodeSegment(parts[1] || '', '载荷');
    if (payload.err) return { error: { title: '载荷解不开', detail: payload.err } };
    model.payload = payload;
    model.warns = model.warns.concat(payload.warns);

    /* 2 段的令牌里第三段压根不存在，跟「第三段为空字符串」（真正的未签名令牌）
       是两码事，分开标记，免得显示时把「缺一段」和「未签名」混掉。 */
    if (parts.length === 2) {
      model.signature = { seg: '', bytes: [], absent: true };
      return finish(model, header, payload, kind, nowSec);
    }

    var sigSeg = parts[2];
    var sig = b64urlToBytes(sigSeg);
    if (sig.err) {
      model.warns.push({
        level: 'warn',
        title: '签名段解不开',
        text: '第三段' + sig.err + '。签名栏里只能按原文展示。'
      });
      model.signature = { bad: true, seg: sigSeg };
    } else {
      model.signature = { seg: sigSeg, bytes: sig.bytes };
      model.warns = model.warns.concat(sig.warns);
    }

    return finish(model, header, payload, kind, nowSec);
  }

  /** 头部 / 载荷的通用收尾：告警、声明分析。两段与三段都走这里 */
  function finish(model, header, payload, kind, nowSec) {

    if (header.json !== undefined && !isPlainObject(header.json)) {
      model.warns.push({
        level: 'warn',
        title: '头部不是 JSON 对象',
        text: 'RFC 7515 要求受保护的头部是一个 JSON 对象，这里解出来的是 ' + describeType(header.json) +
          '；下面按 JSON 原文显示，但不当作头部参数解释。'
      });
    }
    if (payload.jsonErr) {
      model.warns.push({
        level: 'warn',
        title: '载荷不是合法的 JSON',
        text: '载荷这一段' + payload.jsonErr.why + '，所以没有声明可以列，下面按原文显示。' +
          (payload.jsonErr.raw ? '（' + payload.jsonErr.raw + '）' : '')
      });
    } else if (!isPlainObject(payload.json)) {
      model.warns.push({
        level: 'warn',
        title: '载荷不是 JSON 对象',
        text: 'JWT 的载荷应当是一组声明（JSON 对象），这里解出来的是 ' + describeType(payload.json) +
          '。RFC 7519 允许 JWS 装任意载荷，但那就不是 JWT 了。'
      });
    }

    model.warns = model.warns.concat(headerWarnings(header.json, kind));

    if (isPlainObject(payload.json)) {
      model.claims = analyseClaims(payload.json, nowSec);
      model.warns = model.warns.concat(model.claims.warns);
    }
    return model;
  }

  /** 头部里那些「对着规范条文就能判定」的问题 */
  function headerWarnings(h, kind) {
    var out = [];
    if (!isPlainObject(h)) return out;

    var alg = h.alg;
    if (typeof alg === 'string' && alg.toLowerCase() === 'none') {
      out.push({
        level: 'warn',
        title: '未签名的令牌（alg = "none"）',
        text: '第三段没有签名。任何人都能改完载荷再原样发出去，所以线上一律不应当接受它 —— ' +
          'RFC 7519 只允许在「明确知道这个令牌未受保护」的场合使用这个算法。'
      });
    } else if (alg === undefined) {
      out.push({
        level: 'warn',
        title: '头部没有 alg',
        text: 'RFC 7515 要求受保护的头部必须带 alg（签名算法）。缺了它，验证方无从判断该用哪种算法，' +
          '也就无从校验。'
      });
    } else if (typeof alg !== 'string') {
      out.push({
        level: 'warn',
        title: 'alg 不是字符串',
        text: 'RFC 7515 要求 alg 是字符串，这里是 ' + describeType(alg) + '（' + compactJson(alg) + '）。'
      });
    }

    if (h.crit !== undefined) {
      out.push({
        level: 'warn',
        title: '头部声明了 crit（关键扩展）',
        text: 'RFC 7515 §4.1.11：crit 里列出的扩展，只要验证方有一个不认识，就一定得拒绝这个令牌。' +
          '本站不验签，看不出这些扩展对不对，但见到 crit 就先确认验证方支持哪些扩展。'
      });
    }

    if (h.jku !== undefined || h.x5u !== undefined) {
      var names = [];
      if (h.jku !== undefined) names.push('jku');
      if (h.x5u !== undefined) names.push('x5u');
      out.push({
        level: 'warn',
        title: '密钥地址由令牌自己指定（' + names.join(' / ') + '）',
        text: '验证方会去这个地址下载密钥，而地址来自令牌本身 —— 这是「让验证方取到攻击者的密钥」' +
          '与 SSRF 两类问题的常见入口。验证方至少要把域名限制在签发方的白名单里。'
      });
    }

    if (h.jwk !== undefined) {
      out.push({
        level: 'info',
        title: '公钥内嵌在头部（jwk）',
        text: '规范允许，但密钥不经过任何信任链：验证方得自己判断该不该信任这把内嵌的公钥。'
      });
    }
    if (h.x5c !== undefined) {
      out.push({
        level: 'info',
        title: '证书链内嵌在头部（x5c）',
        text: '验证方需要自己校验证书链是否可信、有没有在上游被吊销。'
      });
    }
    if (kind !== 'jwe' && (h.enc !== undefined || h.zip !== undefined)) {
      out.push({
        level: 'info',
        title: '头部出现了 JWE 的参数（enc / zip）',
        text: '这两个参数属于 RFC 7516 的加密令牌。出现在三段的 JWS 里，说明签发方写错了参数，' +
          '或者这个头部本来就不是给 JWS 用的。'
      });
    }
    return out;
  }

  /** 逐条看时间声明：能不能当数字用、是不是毫秒、彼此矛不矛盾 */
  function analyseClaims(payload, nowSec) {
    var out = { list: [], warns: [], exp: null, nbf: null, iat: null, status: 'none' };
    var keys = Object.keys(payload);

    keys.forEach(function (k, idx) {
      var def = CLAIM_MAP[k];
      var row = { key: k, value: payload[k], def: def, kind: def ? def.kind : 'custom', idx: idx };
      if (def && def.time) {
        row.time = readNumericDate(k, payload[k]);
        if (row.time.warn) out.warns.push(row.time.warn);
        if (k === 'exp') out.exp = row.time;
        if (k === 'nbf') out.nbf = row.time;
        if (k === 'iat') out.iat = row.time;
      }
      out.list.push(row);
    });

    /* 排序：字典里有的按字典顺序在前，其余保持载荷里的原始顺序（用 idx 兜底，
       不指望 sort 稳定） */
    out.list.sort(function (a, b) {
      var oa = CLAIM_ORDER[a.key] === undefined ? 9999 : CLAIM_ORDER[a.key];
      var ob = CLAIM_ORDER[b.key] === undefined ? 9999 : CLAIM_ORDER[b.key];
      if (oa !== ob) return oa - ob;
      return a.idx - b.idx;
    });

    var exp = out.exp && out.exp.sec !== null ? out.exp.sec : null;
    var nbf = out.nbf && out.nbf.sec !== null ? out.nbf.sec : null;
    var iat = out.iat && out.iat.sec !== null ? out.iat.sec : null;

    if (exp !== null && nbf !== null && exp <= nbf) {
      out.warns.push({
        level: 'warn',
        title: 'exp 不晚于 nbf',
        text: '过期时间（' + fmtTime(exp) + '）没有晚于生效时间（' + fmtTime(nbf) + '），两个声明互相矛盾 —— ' +
          '按规范，这个令牌要么还没生效，要么一开始就是无效的。'
      });
    }
    if (iat !== null && exp !== null && iat > exp) {
      out.warns.push({
        level: 'warn',
        title: 'iat 晚于 exp',
        text: '签发时间（' + fmtTime(iat) + '）在过期时间（' + fmtTime(exp) + '）之后，声明之间对不上。'
      });
    }
    if (iat !== null && iat > nowSec + 60) {
      out.warns.push({
        level: 'warn',
        title: '签发时间在本机时间之后',
        text: 'iat 比本机时钟晚了 ' + humanDuration(iat - nowSec) +
          '。可能签发方的时钟不准，也可能令牌是伪造的 —— 本机时钟不准也会长这样。'
      });
    }

    if (exp !== null && nowSec >= exp) out.status = 'expired';
    else if (nbf !== null && nowSec < nbf) out.status = 'notyet';
    else if (exp === null && nbf === null) out.status = 'none';
    else out.status = 'valid';

    return out;
  }

  /** 把 exp / nbf / iat / auth_time 的值读成秒数（只读取，判定在上面的 analyseClaims 里） */
  function readNumericDate(key, v) {
    var rec = { key: key, raw: v, sec: null, fix: null, ms: false };

    if (typeof v === 'number' && isFinite(v)) {
      rec.sec = v;
    } else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) {
      /* 有些签发方把秒数写成字符串：能用，但类型不合规 */
      rec.sec = Number(v);
      rec.fix = '这个值是字符串，RFC 7519 要求 NumericDate 是 JSON 数字';
    } else if (v === null) {
      rec.fix = '值是 null，无法当作时间';
    } else if (typeof v === 'object') {
      rec.fix = '值是' + describeType(v) + '，无法当作时间（RFC 7519 要求 NumericDate 是数字）';
    } else {
      rec.fix = '不是数字，无法换算成时间';
    }

    if (rec.sec !== null && Math.abs(rec.sec) >= MS_SUSPECT) rec.ms = true;

    if (rec.fix || rec.ms) {
      var bits = [];
      if (rec.fix) bits.push(rec.fix);
      if (rec.ms) {
        bits.push('这个值有 ' + String(Math.floor(Math.abs(rec.sec))).length + ' 位，看起来是毫秒时间戳，' +
          '但规范要求的是秒 —— 按秒解释会得到 ' + fmtTime(rec.sec) + ' 这个日期');
      }
      rec.warn = {
        level: 'warn',
        title: '时间声明 ' + key + ' 的值不规范',
        text: bits.join('；') + '。'
      };
    }
    return rec;
  }

  /* ======================================================================
     五、渲染
     ====================================================================== */

  function renderParts(model) {
    var valid = model && !model.empty && !model.error;
    if (!valid) { partsEl.innerHTML = ''; return; }

    var cells = [];

    if (model.kind === 'jwe') {
      var labels = ['头部', '加密密钥', '初始向量', '密文', '认证标签'];
      var shades = ['h', 'p', 's', 'p', 's'];
      var lens = [model.header.bytes.length + ' 字节'];
      for (var j = 0; j < model.jweSegments.length; j++) {
        lens.push(model.jweSegments[j].bytes === null ? '解不开' : model.jweSegments[j].bytes + ' 字节');
      }
      for (var i = 0; i < 5; i++) {
        cells.push({ label: labels[i], len: lens[i], tab: i === 0 ? 'header' : null, cls: shades[i] });
      }
    } else {
      var sig = model.signature;
      cells.push({ label: '头部', len: model.header.bytes.length + ' 字节', tab: 'header', cls: 'h' });
      cells.push({ label: '载荷', len: model.payload.bytes.length + ' 字节', tab: 'payload', cls: 'p' });
      cells.push({
        label: '签名',
        len: !sig ? '无'
          : (sig.absent ? '无'
            : (sig.bad ? '解不开' : (sig.bytes.length ? sig.bytes.length + ' 字节' : '空'))),
        tab: 'signature',
        cls: 's'
      });
    }

    partsEl.innerHTML = cells.map(function (c) {
      var inner = '<span class="jwt-part-swatch jwt-part-swatch--' + c.cls + '" aria-hidden="true"></span>' +
        '<span class="jwt-part-name">' + esc(c.label) + '</span>' +
        '<span class="jwt-part-len">' + esc(c.len) + '</span>';
      if (!c.tab) return '<div class="jwt-part jwt-part--static">' + inner + '</div>';
      return '<button class="jwt-part" type="button" data-part="' + c.tab + '" ' +
        'title="切到这一段的解码内容" aria-pressed="' + String(model.tab === c.tab) + '">' + inner + '</button>';
    }).join('');
  }

  function stat(label, value, cls) {
    return '<div class="stat">' +
      '<div class="stat-label">' + esc(label) + '</div>' +
      '<div class="stat-value' + (cls ? ' ' + cls : '') + '">' + esc(value) + '</div>' +
      '</div>';
  }

  var STATUS_TEXT = { valid: '有效期内', expired: '已过期', notyet: '尚未生效', none: '无时效声明' };
  var STATUS_CLS = {
    valid: 'stat-value--ok',
    expired: 'stat-value--danger',
    notyet: 'stat-value--warn',
    none: ''
  };

  function renderStats(model) {
    var valid = model && !model.empty && !model.error;
    if (!valid) {
      statsEl.innerHTML = stat('时效', '—', '') + stat('剩余 / 超期', '—', 'stat-value--sm') +
        stat('签名算法', '—', 'stat-value--sm') + stat('令牌类型', '—', 'stat-value--sm') +
        stat('载荷', '—', '') + stat('签名', '—', '');
      return;
    }

    if (model.kind === 'jwe') {
      var hj = isPlainObject(model.header.json) ? model.header.json : {};
      var cipher = model.jweSegments[2] ? model.jweSegments[2].bytes : null;
      statsEl.innerHTML =
        stat('时效', '需解密', 'stat-value--sm') +
        stat('密钥算法', hj.alg === undefined ? '—' : plainValue(hj.alg), 'stat-value--sm') +
        stat('内容加密', hj.enc === undefined ? '—' : plainValue(hj.enc), 'stat-value--sm') +
        stat('段数', '5 段（JWE）', 'stat-value--sm') +
        stat('头部', model.header.bytes.length + ' 字节', '') +
        stat('密文', cipher === null ? '—' : cipher + ' 字节', '');
      return;
    }

    var ch = isPlainObject(model.header.json) ? model.header.json : {};
    var claims = model.claims;
    var status = claims ? claims.status : 'none';
    var second = '—';
    var secondCls = 'stat-value--sm';

    if (claims && status === 'expired') {
      second = '已过期 ' + humanDuration(model.nowSec - claims.exp.sec);
      secondCls = 'stat-value--danger stat-value--sm';
    } else if (claims && status === 'notyet') {
      second = '还有 ' + humanDuration(claims.nbf.sec - model.nowSec);
      secondCls = 'stat-value--warn stat-value--sm';
    } else if (claims && claims.exp && claims.exp.sec !== null) {
      second = '还剩 ' + humanDuration(claims.exp.sec - model.nowSec);
      secondCls = 'stat-value--ok stat-value--sm';
    }

    var sig = model.signature;
    var sigText = '无';
    var sigCls = 'stat-value--warn';
    if (sig && sig.absent) {
      sigText = '缺少第三段';
      sigCls = 'stat-value--warn stat-value--sm';
    } else if (sig && !sig.bad && sig.bytes.length) {
      sigText = sig.bytes.length + ' 字节';
      sigCls = '';
    } else if (sig && !sig.bad) {
      sigText = '空（未签名）';
      sigCls = 'stat-value--warn stat-value--sm';
    } else if (sig && sig.bad) {
      sigText = '解不开';
      sigCls = 'stat-value--warn stat-value--sm';
    }

    statsEl.innerHTML =
      stat('时效', STATUS_TEXT[status], STATUS_CLS[status]) +
      stat('剩余 / 超期', second, secondCls) +
      stat('签名算法', ch.alg === undefined ? '—' : plainValue(ch.alg), 'stat-value--sm') +
      stat('令牌类型', ch.typ === undefined ? '—' : plainValue(ch.typ), 'stat-value--sm') +
      stat('载荷', model.payload.bytes.length + ' 字节', '') +
      stat('签名', sigText, sigCls);
  }

  function renderWarns(model) {
    var list = (model && model.warns) ? model.warns : [];
    if (!list.length) {
      warnsEl.hidden = true;
      warnsEl.innerHTML = '';
      return;
    }
    warnsEl.hidden = false;
    warnsEl.innerHTML = list.map(function (w) {
      /* 告警的形状统一是 { level, title, text }。
         裸字符串也认（当成 text），否则形状一写错，整块提示会渲染成
         一个「空壳」—— 看得见边框、看不见字，排查起来很费劲。 */
      if (typeof w === 'string') w = { level: 'warn', title: '', text: w };
      var isWarn = w.level === 'warn';
      var icon = isWarn
        ? '<path d="M12 3.2 19 6v6.1c0 4.4-2.9 7.4-7 8.7-4.1-1.3-7-4.3-7-8.7V6l7-2.8Z"/><path d="M12 9v4M12 16h.01"/>'
        : '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>';
      return '<div class="notice' + (isWarn ? ' notice--warn' : '') + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icon + '</svg>' +
        '<p><strong>' + esc(w.title) + '</strong>' + esc(w.text || '') + '</p>' +
        '</div>';
    }).join('');
  }

  /** 时间类声明的说明文字：本机时间 + 相对现在的说法 */
  function timeNoteHtml(row, nowSec) {
    var t = row.time;
    if (!t || t.sec === null) return '';

    var html = ' · <span class="jwt-time" title="' + esc('本机时区 ' + tzText(new Date())) + '">' +
      esc(fmtTime(t.sec)) + '</span>';

    if (t.key === 'exp') {
      var left = t.sec - nowSec;
      if (left <= 0) {
        return html + ' · <span class="jwt-time jwt-time--bad">已过期 ' + esc(humanDuration(-left)) + '</span>';
      }
      return html + ' · <span class="jwt-time jwt-time--ok">还剩 ' + esc(humanDuration(left)) + '</span>';
    }
    if (t.key === 'nbf') {
      var d = t.sec - nowSec;
      if (d > 0) {
        return html + ' · <span class="jwt-time jwt-time--warn">还有 ' + esc(humanDuration(d)) + ' 才生效</span>';
      }
      return html + ' · <span class="jwt-time jwt-time--ok">已生效 ' + esc(humanDuration(-d)) + '</span>';
    }
    if (t.key === 'iat') {
      var diff = nowSec - t.sec;
      if (diff < 0) {
        return html + ' · <span class="jwt-time jwt-time--warn">比本机时间晚 ' +
          esc(humanDuration(-diff)) + '</span>';
      }
      return html + ' · <span class="jwt-time">' + esc(humanDuration(diff)) + '前</span>';
    }
    return html;
  }

  function renderClaims(model) {
    if (!model || model.empty || model.error || !model.claims) {
      claimCountEl.textContent = '';
      if (model && model.error) {
        util.emptyHint(claimsEl, '没有可展示的声明', model.error.detail, 'table-empty');
      } else if (model && model.kind === 'jwe') {
        util.emptyHint(claimsEl, '载荷是密文，解不开',
          '这是 JWE（加密令牌）。本站只能解出第一段的受保护头部；载荷要拿私钥解密才能看到。', 'table-empty');
      } else if (model && model.payload && model.payload.jsonErr) {
        util.emptyHint(claimsEl, '载荷不是 JSON',
          '解出来的内容不是合规的 JSON，所以没有声明可以列。切到「载荷」能看到原文。', 'table-empty');
      } else {
        util.emptyHint(claimsEl, '还没有内容', EMPTY_HINT, 'table-empty');
      }
      return;
    }

    if (!model.claims.list.length) {
      claimCountEl.textContent = '0 个声明';
      util.emptyHint(claimsEl, '载荷是空的 JSON 对象',
        '{} 里一个声明都没有 —— 这样的 Token 不带任何身份信息。', 'table-empty');
      return;
    }

    var regCount = 0;
    var rows = model.claims.list.map(function (row) {
      if (row.kind === 'reg') regCount++;

      var valueText = compactJson(row.value);
      var noteHtml = '<span class="jwt-claim-kind">' + KIND_LABEL[row.kind] + '</span>';

      if (row.def) {
        noteHtml += '<span class="jwt-claim-name">' + esc(row.def.name) + '</span>';
        if (row.time && row.time.fix) {
          noteHtml += '<span class="jwt-claim-fix">' + esc(row.time.fix) + '</span>';
        } else if (row.time && row.time.ms) {
          noteHtml += '<span class="jwt-claim-fix">看起来是毫秒时间戳，规范要求的是秒</span>';
        } else if (!row.def.time) {
          noteHtml += '<span class="jwt-claim-note-text">' + esc(row.def.note) + '</span>';
        }
      } else {
        noteHtml += '<span class="jwt-claim-fix">规范里没有这个名字，含义要看签发方的文档</span>';
      }
      noteHtml += timeNoteHtml(row, model.nowSec);

      return '<tr>' +
        '<td class="jwt-claim-key">' + esc(row.key) + '</td>' +
        '<td class="jwt-claim-value" title="' + esc(valueText) + '">' + esc(valueText) + '</td>' +
        '<td class="jwt-claim-note">' + noteHtml + '</td>' +
        '</tr>';
    }).join('');

    claimCountEl.textContent = model.claims.list.length + ' 个声明 · 其中 ' + regCount + ' 个注册声明';
    claimsEl.innerHTML = '<table class="data-table">' +
      '<thead><tr><th>声明</th><th>值</th><th>说明</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  /** 头部那一栏的底注：认识的参数写成人话，不认识的列出来 */
  function headerFootText(header) {
    if (!isPlainObject(header)) return '头部不是 JSON 对象，按原文显示';
    var keys = Object.keys(header);
    if (!keys.length) return '头部是空对象';

    var parts = [];
    var other = [];
    keys.forEach(function (k) {
      var label = HEADER_PARAMS[k];
      if (label) parts.push(k + ' = ' + plainValue(header[k]) + '（' + label + '）');
      else other.push(k);
    });
    var text = parts.join(' · ');
    if (other.length) text += (text ? ' · ' : '') + '不认识的头参数：' + other.join('、');
    return text;
  }

  /** 签名栏：三段信息各自一行，点哪行复制哪行（走通用复制机制） */
  function renderSignature(model) {
    if (!model || model.kind === 'jwe') {
      sigEl.innerHTML = '';
      return;
    }

    var sig = model.signature;
    var absent = !!(sig && sig.absent);
    var b64 = sig ? sig.seg : '';
    var bytes = (sig && !sig.bad) ? sig.bytes : [];

    var emptyHintText = absent ? '（没有第三段）' : '（空）';
    var lenNote = bytes.length
      ? '签名原文的长度（HS256 是 32 字节，RS256 是 256 字节）'
      : (absent ? '这个 Token 只有 2 段，第三段整个缺失 —— 多半是签发方把末尾的空签名段截掉了'
        : '第三段是空的，说明这个 Token 没有签名');

    var rows = [
      rowHtml('段原文', 'jwt-sig-b64', b64 === '' ? emptyHintText : b64,
        absent ? 'Token 只有 2 段，没有第三段可展示'
          : (sig && sig.bad ? '这一段不是合法的 base64url，只能按原文展示'
            : 'base64url，与 Token 第三段逐字符相同')),
      rowHtml('字节数', 'jwt-sig-len', String(bytes.length), lenNote),
      rowHtml('十六进制', 'jwt-sig-hex', bytes.length ? toHex(bytes) : emptyHintText,
        '把 base64url 解回来的原始字节，可与本地算出来的签名逐字节比对')
    ];

    sigEl.innerHTML = rows.join('') +
      '<p class="jwt-sig-note">本站不校验签名。要确认这个 Token 的真伪，请拿签发方的密钥自己验签 —— ' +
      '页面底部「怎么自己校验签名」一节给了 openssl 命令。</p>';

    if (absent) tabFootEl.textContent = '签名 · 缺少第三段';
    else if (bytes.length) tabFootEl.textContent = '签名 · ' + bytes.length + ' 字节 · 未校验';
    else tabFootEl.textContent = '签名 · 空（这个 Token 没有签名）';
    state.copyText = b64;
  }

  function rowHtml(label, id, text, note) {
    return '<div class="jwt-sig-item">' +
      '<button class="value-row" type="button" data-copy-target="#' + id + '" title="点击复制' + label + '">' +
      '<span class="value-label">' + esc(label) + '</span>' +
      '<span class="value-text" id="' + id + '">' + esc(text) + '</span>' +
      '</button>' +
      '<p class="jwt-sig-sub">' + esc(note) + '</p>' +
      '</div>';
  }

  function renderTab(model) {
    var valid = model && !model.empty && !model.error && model.tabs.length > 0;
    var showSig = valid && model.tab === 'signature';

    sigEl.hidden = !showSig;
    codeEl.hidden = showSig;

    if (showSig) {
      renderSignature(model);
      return;
    }
    renderSignature(null);

    if (!valid) {
      codeEl.className = 'code-view';
      if (model && model.error) util.emptyHint(codeEl, model.error.title, model.error.detail);
      else util.emptyHint(codeEl, '还没有内容', EMPTY_HINT);
      tabFootEl.textContent = '—';
      state.copyText = '';
      return;
    }

    var seg = model.tab === 'header' ? model.header : model.payload;
    codeEl.className = 'code-view';

    if (seg.json !== undefined) {
      var pretty = JSON.stringify(seg.json, null, 2);
      util.renderCode(codeEl, pretty, util.highlightJson);
      state.copyText = pretty;
    } else {
      util.renderCode(codeEl, seg.text, null);
      state.copyText = seg.text;
    }

    if (model.tab === 'header') {
      tabFootEl.textContent = '头部 · ' + seg.bytes.length + ' 字节 · ' + headerFootText(seg.json);
    } else {
      var desc = '载荷 · ' + seg.bytes.length + ' 字节';
      if (seg.jsonErr) desc += ' · 不是合法的 JSON，按原文显示';
      else if (model.claims) desc += ' · ' + model.claims.list.length + ' 个声明';
      else desc += ' · 不是 JSON 对象';
      tabFootEl.textContent = desc;
    }
  }

  /* ======================================================================
     六、主循环
     ====================================================================== */

  /* tab：当前显示的那一栏；userTab：用户手动点过的那一栏（null 表示没点过）。
     两者分开是必要的 —— JWE 会把 tab 强推到「头部」，如果拿 tab 当用户意图，
     换成普通 Token 之后就永远回不到「载荷」了。 */
  var state = { tab: 'payload', userTab: null, copyText: '' };

  /** 可用的 Tab：JWE 只有头部；未签名令牌仍然能看「签名」那一栏（会显示空） */
  function availableTabs(model) {
    if (!model || model.empty || model.error) return [];
    if (model.kind === 'jwe') return ['header'];
    return ['payload', 'header', 'signature'];
  }

  function syncTabs(model) {
    var tabs = availableTabs(model);
    model.tabs = tabs;

    /* 用户点过的那一栏在这一版里还在，就听用户的；否则回到默认（有载荷看载荷） */
    var want = state.userTab !== null && tabs.indexOf(state.userTab) >= 0
      ? state.userTab
      : (tabs.indexOf('payload') >= 0 ? 'payload' : tabs[0]);
    state.tab = want;
    model.tab = want;

    util.$$('[data-tab]', tabsEl).forEach(function (btn) {
      var key = btn.getAttribute('data-tab');
      var on = tabs.indexOf(key) >= 0;
      btn.hidden = !on;
      btn.setAttribute('aria-pressed', String(on && key === want));
    });
  }

  /** 底栏那行「本机时间」：时效判定全靠它，写出来才可复核 */
  function nowText(nowSec) { return '本机时间 ' + fmtTime(nowSec); }

  function update() {
    var raw = inputEl.value;
    var nowSec = Date.now() / 1000;
    var model = parse(raw, nowSec);

    if (!model.empty && !model.error) syncTabs(model);
    else {
      model.tabs = [];
      model.tab = null;
    }

    renderParts(model);
    renderStats(model);
    renderWarns(model);
    renderClaims(model);
    renderTab(model);

    if (model.empty) {
      statusEl.className = 'jwt-status';
      statusEl.textContent = '';
      footEl.textContent = EMPTY_HINT;
      return;
    }
    if (model.error) {
      statusEl.className = 'jwt-status is-error';
      statusEl.textContent = model.error.title;
      footEl.textContent = nowText(nowSec) + ' · 时效按它判断';
      return;
    }

    statusEl.className = 'jwt-status';
    var segText;
    if (model.kind === 'jwe') segText = '5 段（JWE）';
    else if (model.partCount === 2) segText = '2 段 · 缺少签名段';
    else if (model.signature && !model.signature.bad && model.signature.bytes.length === 0) {
      segText = '3 段 · 第三段为空（未签名）';
    } else segText = '3 段';
    statusEl.textContent = segText + ' · 共 ' + model.token.length + ' 个字符';

    if (model.kind === 'jwe') {
      var cipher = model.jweSegments[2] ? model.jweSegments[2].bytes : null;
      footEl.textContent = '头部 ' + model.header.bytes.length + ' 字节 · 密文 ' +
        (cipher === null ? '—' : cipher + ' 字节') + ' · ' + nowText(nowSec);
      return;
    }
    var sigBytes = model.signature && !model.signature.bad ? model.signature.bytes.length : null;
    footEl.textContent = '头部 ' + model.header.bytes.length + ' 字节 · 载荷 ' +
      model.payload.bytes.length + ' 字节 · 签名 ' +
      (sigBytes === null ? '解不开' : (sigBytes ? sigBytes + ' 字节' : '空')) +
      ' · ' + nowText(nowSec);
  }

  var render = util.debounce(update, 80);

  /* ======================================================================
     七、演示 Token
     ----------------------------------------------------------------------
     运行时拼出来：exp / iat 跟着当前时间走，示例才能真的展示「还剩 2 小时」；
     源码里也不用躺着一长串看着像真凭据的 base64。
     签名是合成出来的 32 字节（头部写的是 HS256），验签必然失败 —— 按钮 title 写明了。
     ====================================================================== */
  function demoToken() {
    var now = Math.floor(Date.now() / 1000);
    var header = { alg: 'HS256', typ: 'JWT', kid: 'demo-2026-09' };
    var payload = {
      iss: 'https://demo.example.com',
      sub: 'user-1024',
      aud: ['api.example.com', 'web.example.com'],
      iat: now - 300,
      nbf: now - 60,
      exp: now + 7200,
      jti: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      scope: 'read:profile write:profile',
      roles: ['editor', 'reviewer'],
      email: 'demo@example.com',
      email_verified: true
    };
    var sig = [];
    for (var i = 0; i < 32; i++) sig.push((i * 37 + 11) & 0xFF);

    return bytesToB64url(utf8Encode(JSON.stringify(header))) + '.' +
      bytesToB64url(utf8Encode(JSON.stringify(payload))) + '.' +
      bytesToB64url(sig);
  }

  /* ======================================================================
     八、事件
     ====================================================================== */

  inputEl.addEventListener('input', render);

  /* Tab 与「三段格子」是同一个状态的两种入口，都只切视图，不重新解析 */
  var pickTab = function (key) {
    state.tab = key;
    state.userTab = key;   /* 记下来：换 Token 时也听用户的 */
    update();
  };

  tabsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tab]');
    if (!btn || btn.hidden) return;
    pickTab(btn.getAttribute('data-tab'));
  });

  partsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-part]');
    if (!btn) return;
    pickTab(btn.getAttribute('data-part'));
  });

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      if (!state.copyText) { util.toast('没有可复制的内容'); return; }
      util.copy(state.copyText, copyBtn);
    });
  }

  if (demoBtn) {
    demoBtn.setAttribute('title',
      '填入一个示例 Token：exp 是两小时后，签名是合成出来的，验签必然失败');
    demoBtn.addEventListener('click', function () {
      inputEl.value = demoToken();
      update();
      inputEl.focus();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      inputEl.value = '';
      state.tab = 'payload';
      state.userTab = null;   /* 清空等于从头开始，用户的选择也一并忘掉 */
      update();
      inputEl.focus();
    });
  }

  /* --- 首屏 --------------------------------------------------------------- */
  /* 首屏同步渲染一次，不走防抖 —— 否则首屏有 80ms 空白，测试也会读到空 DOM */
  update();
})();
