/* ==========================================================================
   hash-utils.js — 摘要 / HMAC / Base32（共用模块）
   --------------------------------------------------------------------------
   为什么自己写一遍 SHA：
   `crypto.subtle` 只在**安全上下文**里存在。本站承诺「本地运行」，而
   `python -m http.server` 用 `http://192.168.x.x:8080` 打开、或者直接双击
   HTML 用 `file://` 打开时，`crypto.subtle` 可能是 undefined —— 这时如果
   只有一条平台实现的路，哈希 / HMAC / TOTP 会整块不可用，而且报出来的
   原因是「密钥无效」之类与真实原因无关的话。测试环境（jsdom）同理：
   实测 jsdom 30 有 `crypto.getRandomValues`，**没有** `crypto.subtle`。
   所以这里**优先用平台实现，拿不到就回落到纯 JS**，并如实告诉用户走的是哪条路。

   纯 JS 那部分不是「大致能算」：`scripts/tests/hash-utils.mjs` 把 MD5 / SHA-1 /
   SHA-256 / SHA-384 / SHA-512 / HMAC 逐个与 **Node 的 `crypto`（OpenSSL）** 交叉比对，
   覆盖空串、分组边界（MD5/SHA 系列的 55/56/63/64/65、119～129 字节）、
   多字节 UTF-8、代理对、全 0x00 / 全 0xff、以及密钥长于分组（HMAC 要先摘要一次）
   这些分支。**多字节 UTF-8 那几条是特意留的**：上游的 hash-generator 就是在这里出错的
   （它的 MD5 吃的是 JS 字符串的 UTF-16 码元、而 SHA 走 TextEncoder 的 UTF-8，
   于是同一个字符串「当文本算」与「当文件算」给出两个不同的 MD5）。

   API（window.TOOLBOX.hash）：
     utf8Bytes(str) / hex(bytes) / fromHex(str) / toBase64(bytes) / fromBase64(str)
     equal(a, b)                 定长比较，不提前返回（比时间不泄漏前缀匹配长度）
     base32Encode(bytes) / base32Decode(str)
     md5(bytes) / sha1(bytes) / sha256(bytes) / sha384(bytes) / sha512(bytes)   纯 JS，同步
     hmac(name, keyBytes, msgBytes)                      纯 JS，同步
     ALGOS                        { MD5/SHA1/SHA256/SHA384/SHA512:
                                    { name, block, bytes, native, bigint } }
     hasSubtle() / impl()        'native' | 'pure'
     nativeImpl(name)            平台认不认这个算法（MD5 永远 false）
     digestAsync(name, bytes) -> Promise|null
     hmacAsync(name, keyBytes, msgBytes) -> Promise|null
     canUse(name)                当前环境能不能算这个算法

   设计取舍：
   1. **只认 `window.crypto.subtle`，不认裸 `crypto`。** 模块可能被注入到一个
      假的 window 里（测试就是这么加载它的），这时应当老老实实走纯 JS 路径，
      而不是摸到宿主环境的实现 —— 否则「降级路径」永远测不到。
   2. **`ALGOS` 的键不带连字符**（`SHA1`/`SHA256`/`SHA384`/`SHA512`），
      与 otpauth URI 里的写法一致；带连字符的名字用 `byName()` 认。
       MD5 的键就是 `MD5`。
   3. **MD5 的 `native` 是 false**：WebCrypto 有意不实现 MD5，所以它永远走纯 JS。
      `digestAsync` / `hmacAsync` 遇到平台不认的算法**返回 null 而不是让
      NotSupportedError 顺着 Promise 链穿出去** —— 那种失败看起来与输入无关，
      极难定位。
   4. **SHA-384 与 SHA-512 共用 `sha512Core`**：只差初始向量与截断长度。
      按「只差一个常量表」抄第二遍，迟早会在轮数或移位量上分叉。
   5. **`base32Decode` 严格校验**，不接受「残留位非零」和非法分组长度。
      宽松实现会把打错的密钥解成一个**看起来正常**的密钥，
      于是口令永远对不上、还没有任何提示。宁可当场拒绝。
   6. **SHA-384/512 用 BigInt** 实现 64 位字，常量**惰性初始化**：
      把 `BigInt('0x…')` 写在模块顶层的话，缺少 BigInt 的引擎会在加载期抛错，
      把 MD5/SHA-1/SHA-256 一起带下水。缺 BigInt 时返回 null 而不是算错 ——
      调用方用 `canUse()` 提前问。
   ========================================================================== */
(function () {
  'use strict';

  var T = (window.TOOLBOX = window.TOOLBOX || {});

  /* --- 1. 字节与文本 ----------------------------------------------------- */

  function utf8Bytes(str) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(str);
    /* 老引擎兜底。和 base64 工具里同样的取舍：孤立代理项会抛 URIError，
       交给调用方处理，不信誓旦旦地替换成 U+FFFD。 */
    var bin = unescape(encodeURIComponent(str));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  }

  var HEX = '0123456789abcdef';

  function hex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
    }
    return out;
  }

  function fromHex(str) {
    var s = String(str == null ? '' : str).replace(/[\s:-]/g, '');
    if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s)) return null;
    var out = new Uint8Array(s.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }

  /* btoa / atob 只认「每字符 = 一字节」的字符串，直接喂多字节会抛
     InvalidCharacterError，所以先摊成字节串再编码。分块是为了避免
     参数过多爆栈（几 MB 的输入会踩到）。 */
  function toBase64(bytes) {
    var CHUNK = 0x8000;
    var parts = '';
    for (var i = 0; i < bytes.length; i += CHUNK) {
      parts += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(parts);
  }

  function fromBase64(str) {
    try {
      var bin = atob(String(str == null ? '' : str).replace(/\s+/g, '')
        .replace(/-/g, '+').replace(/_/g, '/'));
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
      return out;
    } catch (e) {
      return null;
    }
  }

  function concat(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  /**
   * 定长比较。不提前 return —— 提前返回会让耗时随「前多少个字节相同」变化，
   * 校验口令 / 签名时这就是个可利用的信道。长度不同直接判否（长度本身不保密）。
   */
  function equal(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  /* --- 2. Base32（RFC 4648 §6，TOTP 密钥用） ----------------------------- */

  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  /* 合法「未填充」长度对 8 取模只能是这几个：分别对应 0/1/2/3/4 个完整字节。
     3 和 6 剩不下完整字节的倍数关系（15 位 → 1 字节 + 7 位残留），
     1 更是一个字节都凑不出来 —— 都是打错字才会出现的形态。 */
  var OK_LEN_MOD8 = { 0: 1, 2: 1, 4: 1, 5: 1, 7: 1 };

  function base32Encode(bytes) {
    var out = '';
    var bits = 0;
    var val = 0;
    for (var i = 0; i < bytes.length; i++) {
      val = ((val << 8) | bytes[i]) & 0xfffff;   /* 只留低位，见文件头的说明 */
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        out += B32[(val >>> bits) & 31];
      }
    }
    if (bits > 0) out += B32[(val << (5 - bits)) & 31];
    while (out.length % 8 !== 0) out += '=';
    return out;
  }

  /**
   * 解 Base32 密钥。**严格**：拒绝非法字符、非法分组长度、残留位非零、填充位置错。
   *
   * @param {string} str 允许含空白与大小写混写（用户常从文档 / 二维码里粘）。
   * @returns {{bytes: Uint8Array|null, error: {code, message, index?, char?}|null,
   *            bits: number}}
   */
  function base32Decode(str) {
    var raw = String(str == null ? '' : str);
    var chars = [];
    var at = [];      /* 每个有效字符在原始串里的下标，报错时指得出位置 */

    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (/\s/.test(ch)) continue;
      chars.push(ch.toUpperCase());
      at.push(i);
    }

    function bad(code, message, k) {
      return {
        bytes: null, bits: 0,
        error: { code: code, message: message, index: k == null ? null : at[k] + 1,
          char: k == null ? null : raw.charAt(at[k]) }
      };
    }

    if (chars.length === 0) {
      return bad('empty', '密钥是空的。');
    }

    /* 填充：只允许连续出现在末尾 */
    var firstEq = chars.indexOf('=');
    var bodyEnd = firstEq === -1 ? chars.length : firstEq;
    if (firstEq !== -1) {
      for (var k = firstEq; k < chars.length; k++) {
        if (chars[k] !== '=') {
          return bad('padding',
            '填充符 = 只能连续出现在末尾，第 ' + (k + 1) + ' 个有效字符却是「' +
            chars[k] + '」。', k);
        }
      }
    }

    /* 字符集 */
    for (k = 0; k < bodyEnd; k++) {
      if (B32.indexOf(chars[k]) === -1) {
        return bad('char',
          '第 ' + (k + 1) + ' 个有效字符「' + chars[k] +
          '」不在 Base32 的字符集里（只允许 A–Z 与 2–7）。', k);
      }
    }

    var rest = chars.length - bodyEnd;      /* 填充个数 */
    var mod = bodyEnd % 8;

    if (!OK_LEN_MOD8[mod]) {
      return bad('length',
        '长度不对：去掉填充后有 ' + bodyEnd + ' 个字符，这个长度凑不出完整字节' +
        '（合法长度对 8 取模只能是 0 / 2 / 4 / 5 / 7）。多半是抄漏或抄多了一个字符。');
    }

    /* 有填充就必须填够 —— 少填等于把一个不完整的编码当完整的读 */
    var wantPad = (8 - mod) % 8;
    if (rest > 0 && rest !== wantPad) {
      return bad('padding',
        '填充符个数不对：' + bodyEnd + ' 个字符应当配 ' + wantPad + ' 个 =，' +
        '这里却有 ' + rest + ' 个。');
    }

    var bytes = [];
    var bits = 0;
    var val = 0;

    for (k = 0; k < bodyEnd; k++) {
      val = ((val << 5) | B32.indexOf(chars[k])) & 0xffff;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((val >>> bits) & 0xff);
      }
    }

    /* 残留位必须是 0（RFC 4648 §3.5 的规范编码要求）。
       不查这一条的话，抄错一个字符会得到一个「长度正常、也能算出口令」的
       密钥 —— 用户只会看到口令一直对不上，永远查不到是自己抄错了。 */
    if (bits > 0 && (val & ((1 << bits) - 1)) !== 0) {
      return bad('dangling',
        '末尾几位多出来的比特不是 0，说明这段 Base32 不是规范编码 —— ' +
        '通常是最后一个字符写错了。');
    }

    if (bytes.length === 0) {
      return bad('short', '解出来是 0 字节，太短了。');
    }

    return { bytes: new Uint8Array(bytes), error: null, bits: bytes.length * 8 };
  }

  /* --- 3. MD5 / SHA-1 / SHA-256 / SHA-384 / SHA-512（纯 JS） ------------- */

  function readU32(b, i) {
    return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  }

  function writeU32(b, i, v) {
    b[i] = (v >>> 24) & 0xff;
    b[i + 1] = (v >>> 16) & 0xff;
    b[i + 2] = (v >>> 8) & 0xff;
    b[i + 3] = v & 0xff;
  }

  /* MD5 是**小端**的：读字、写字、以及末尾的位长度都与 SHA 系列相反。
     两套各留一份，别想着合并成一个带字节序参数的函数 —— 那个参数
     在调用点上永远看不出来是哪个。 */
  function readU32LE(b, i) {
    return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  }

  function writeU32LE(b, i, v) {
    b[i] = v & 0xff;
    b[i + 1] = (v >>> 8) & 0xff;
    b[i + 2] = (v >>> 16) & 0xff;
    b[i + 3] = (v >>> 24) & 0xff;
  }

  function rotr(v, n) { return ((v >>> n) | (v << (32 - n))) >>> 0; }
  function rotl(v, n) { return ((v << n) | (v >>> (32 - n))) >>> 0; }

  /**
   * 填充：补 0x80、补 0 到分组边界前 lenBytes 字节、末尾放**位长度**（大端）。
   * 位长度用 64 位表示（lenBytes = 8）或 128 位（lenBytes = 16，高 8 字节恒为 0 ——
   * JS 里拿不到 2^64 位长的输入，不必假装能表示）。
   */
  function padded(bytes, block, lenBytes) {
    var len = bytes.length;
    var rem = (len + 1 + lenBytes) % block;
    var k = rem === 0 ? 0 : block - rem;
    var out = new Uint8Array(len + 1 + k + lenBytes);
    out.set(bytes, 0);
    out[len] = 0x80;

    var bits = len * 8;
    var hi = Math.floor(bits / 4294967296) >>> 0;
    var lo = bits >>> 0;
    var p = out.length - lenBytes + (lenBytes === 16 ? 8 : 0);
    writeU32(out, p, hi);
    writeU32(out, p + 4, lo);
    return out;
  }

  var K1 = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];

  function sha1(bytes) {
    var H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    var d = padded(bytes, 64, 8);
    var w = new Uint32Array(80);
    var i, t;

    for (i = 0; i < d.length; i += 64) {
      for (t = 0; t < 16; t++) w[t] = readU32(d, i + t * 4);
      for (t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);

      var a = H[0], b = H[1], c = H[2], e = H[3], f = H[4];
      for (t = 0; t < 80; t++) {
        var fn, kk;
        if (t < 20) { fn = (b & c) | (~b & e); kk = K1[0]; }
        else if (t < 40) { fn = b ^ c ^ e; kk = K1[1]; }
        else if (t < 60) { fn = (b & c) | (b & e) | (c & e); kk = K1[2]; }
        else { fn = b ^ c ^ e; kk = K1[3]; }

        var tmp = (rotl(a, 5) + (fn >>> 0) + f + kk + w[t]) >>> 0;
        f = e; e = c; c = rotl(b, 30); b = a; a = tmp;
      }
      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + e) >>> 0;
      H[4] = (H[4] + f) >>> 0;
    }

    var out = new Uint8Array(20);
    for (i = 0; i < 5; i++) writeU32(out, i * 4, H[i]);
    return out;
  }

  var K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var d = padded(bytes, 64, 8);
    var w = new Uint32Array(64);
    var i, t;

    for (i = 0; i < d.length; i += 64) {
      for (t = 0; t < 16; t++) w[t] = readU32(d, i + t * 4);
      for (t = 16; t < 64; t++) {
        var x = w[t - 15], y = w[t - 2];
        var s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
        var s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }

      var a = H[0], b = H[1], c = H[2], e = H[3];
      var f = H[4], g = H[5], h = H[6], k8 = H[7];

      for (t = 0; t < 64; t++) {
        var S1 = rotr(f, 6) ^ rotr(f, 11) ^ rotr(f, 25);
        var ch = (f & g) ^ (~f & h);
        var t1 = (k8 + S1 + (ch >>> 0) + K256[t] + w[t]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + (maj >>> 0)) >>> 0;

        k8 = h; h = g; g = f;
        f = (e + t1) >>> 0;
        e = c; c = b; b = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + e) >>> 0;
      H[4] = (H[4] + f) >>> 0;
      H[5] = (H[5] + g) >>> 0;
      H[6] = (H[6] + h) >>> 0;
      H[7] = (H[7] + k8) >>> 0;
    }

    var out = new Uint8Array(32);
    for (i = 0; i < 8; i++) writeU32(out, i * 4, H[i]);
    return out;
  }

  /* --- MD5：128 位，小端（RFC 1321） ------------------------------------- */

  /**
   * 填充：补 0x80、补 0 到分组边界前 lenBytes 字节、末尾放**小端**位长度。
   * 与 SHA 的 `padded()` 只差字节序 —— 但也正因为只差这一点，
   * 复用同一个函数时极易漏掉，所以这里各写一份、各自点名。
   */
  function paddedLE(bytes, block, lenBytes) {
    var len = bytes.length;
    var rem = (len + 1 + lenBytes) % block;
    var k = rem === 0 ? 0 : block - rem;
    var out = new Uint8Array(len + 1 + k + lenBytes);
    out.set(bytes, 0);
    out[len] = 0x80;

    var bits = len * 8;
    var p = out.length - lenBytes;
    writeU32LE(out, p, bits >>> 0);                                  /* 低位在前 */
    if (lenBytes >= 8) writeU32LE(out, p + 4, Math.floor(bits / 4294967296) >>> 0);
    return out;
  }

  /* 常量 = floor(2^32 × |sin(i + 1)|)，i = 0…63 —— 这就是 RFC 1321 §3.4 给的
     定义式，所以直接按公式算，而不是手抄 64 个魔数（手抄 64 个 8 位十六进制
     数，错一个都要靠交叉校验才发现）。惰性构造，且结果由测试对 OpenSSL 校验。 */
  var MD5_K = null;

  var MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];

  function md5Constants() {
    if (MD5_K) return MD5_K;
    var k = new Uint32Array(64);
    for (var i = 0; i < 64; i++) {
      k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    }
    MD5_K = k;
    return k;
  }

  function md5(bytes) {
    var K = md5Constants();
    var H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    var d = paddedLE(bytes, 64, 8);
    var M = new Uint32Array(16);
    var i, t;

    for (i = 0; i < d.length; i += 64) {
      for (t = 0; t < 16; t++) M[t] = readU32LE(d, i + t * 4);

      var a = H[0], b = H[1], c = H[2], dd = H[3];
      for (t = 0; t < 64; t++) {
        var F, g;
        if (t < 16) { F = (b & c) | (~b & dd); g = t; }
        else if (t < 32) { F = (dd & b) | (~dd & c); g = (5 * t + 1) % 16; }
        else if (t < 48) { F = b ^ c ^ dd; g = (3 * t + 5) % 16; }
        else { F = c ^ (b | ~dd); g = (7 * t) % 16; }

        F = ((F >>> 0) + a + K[t] + M[g]) >>> 0;
        a = dd; dd = c; c = b;
        b = (b + rotl(F, MD5_S[t])) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + dd) >>> 0;
    }

    var out = new Uint8Array(16);
    for (i = 0; i < 4; i++) writeU32LE(out, i * 4, H[i]);
    return out;
  }

  /* --- SHA-512：64 位字，用 BigInt --------------------------------------- */

  var HAS_BIGINT = typeof BigInt === 'function';

  /* 常量与初始向量惰性构造：缺少 BigInt 的引擎上这里会抛 SyntaxError /
     ReferenceError，不能让它连累 SHA-1 与 SHA-256 的加载。 */
  var K512 = null;
  var H512_INIT = null;
  var H384_INIT = null;

  function init512() {
    if (K512) return true;
    if (!HAS_BIGINT) return false;

    var ks = ['428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc',
      '3956c25bf348b538', '59f111f1b605d019', '923f82a4af194f9b', 'ab1c5ed5da6d8118',
      'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2',
      '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694',
      'e49b69c19ef14ad2', 'efbe4786384f25e3', '0fc19dc68b8cd5b5', '240ca1cc77ac9c65',
      '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5',
      '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4',
      'c6e00bf33da88fc2', 'd5a79147930aa725', '06ca6351e003826f', '142929670a0e6e70',
      '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df',
      '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b',
      'a2bfe8a14cf10364', 'a81a664bbc423001', 'c24b8b70d0f89791', 'c76c51a30654be30',
      'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8',
      '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8',
      '391c0cb3c5c95a63', '4ed8aa4ae3418acb', '5b9cca4f7763e373', '682e6ff3d6b2b8a3',
      '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec',
      '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b',
      'ca273eceea26619c', 'd186b8c721c0c207', 'eada7dd6cde0eb1e', 'f57d4f7fee6ed178',
      '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b',
      '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c',
      '4cc5d4becb3e42b6', '597f299cfc657e2a', '5fcb6fab3ad6faec', '6c44198c4a475817'];

    var hs = ['6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1',
      '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179'];

    /* SHA-384 与 SHA-512 是同一个核心：只是初始向量取**第 9～16 个素数**
       平方根的小数部分，并把输出截到前 48 字节（FIPS 180-4 §5.3.4）。 */
    var h384 = ['cbbb9d5dc1059ed8', '629a292a367cd507', '9159015a3070dd17', '152fecd8f70e5939',
      '67332667ffc00b31', '8eb44a8768581511', 'db0c2e0d64f98fa7', '47b5481dbefa4fa4'];

    K512 = ks.map(function (s) { return BigInt('0x' + s); });
    H512_INIT = hs.map(function (s) { return BigInt('0x' + s); });
    H384_INIT = h384.map(function (s) { return BigInt('0x' + s); });
    return true;
  }

  var MASK64 = null;

  function rotr64(x, n) {
    var b = BigInt(n);
    return ((x >> b) | (x << (BigInt(64) - b))) & MASK64;
  }

  function readU64(b, i) {
    var v = BigInt(0);
    for (var k = 0; k < 8; k++) v = (v << BigInt(8)) | BigInt(b[i + k]);
    return v;
  }

  function writeU64(b, i, v) {
    for (var k = 7; k >= 0; k--) {
      b[i + k] = Number(v & BigInt(255));
      v >>= BigInt(8);
    }
  }

  /**
   * SHA-512 的核心：64 位字、80 轮、分组 128 字节。SHA-384 只是换一组初始向量
   * 再把结果截短，所以两者共用这一份 —— 按「只差一个常量表」抄第二遍，
   * 迟早会在轮数或移位量上分叉。
   *
   * 传的是**变体名**而不是初始向量本身：那两张表是在 `init512()` 里才填充的，
   * 而函数参数在调用前就求值 —— 传 `H384_INIT` 进来会拿到 `null`（首次调用时）。
   *
   * @param {'SHA-384'|'SHA-512'} variant
   * @returns {Uint8Array|null} 完整的 64 字节状态；BigInt 不可用时 null
   */
  function sha512Core(bytes, variant) {
    if (!init512()) return null;
    if (MASK64 === null) MASK64 = BigInt('0xffffffffffffffff');

    var H = (variant === 'SHA-384' ? H384_INIT : H512_INIT).slice();
    var d = padded(bytes, 128, 16);
    var w = new Array(80);
    var i, t;

    for (i = 0; i < d.length; i += 128) {
      for (t = 0; t < 16; t++) w[t] = readU64(d, i + t * 8);
      for (t = 16; t < 80; t++) {
        var x = w[t - 15], y = w[t - 2];
        /* SHA-512 的 σ0 是 ROTR^1 ⊕ ROTR^8 ⊕ **SHR^7**、σ1 是
           ROTR^19 ⊕ ROTR^61 ⊕ SHR^6。与 SHA-256 的 σ0/σ1
           （ROTR^7 ⊕ ROTR^18 ⊕ SHR^3 / ROTR^17 ⊕ ROTR^19 ⊕ SHR^10）
           一个都不一样 —— 从 SHA-256 抄过来时最容易漏改的就是这两个移位量。 */
        var s0 = rotr64(x, 1) ^ rotr64(x, 8) ^ (x >> BigInt(7));
        var s1 = rotr64(y, 19) ^ rotr64(y, 61) ^ (y >> BigInt(6));
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) & MASK64;
      }

      var a = H[0], b = H[1], c = H[2], e = H[3];
      var f = H[4], g = H[5], h = H[6], k8 = H[7];

      for (t = 0; t < 80; t++) {
        var S1 = rotr64(f, 14) ^ rotr64(f, 18) ^ rotr64(f, 41);
        var ch = (f & g) ^ ((~f & MASK64) & h);
        var t1 = (k8 + S1 + ch + K512[t] + w[t]) & MASK64;
        var S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) & MASK64;

        k8 = h; h = g; g = f;
        f = (e + t1) & MASK64;
        e = c; c = b; b = a;
        a = (t1 + t2) & MASK64;
      }
      H[0] = (H[0] + a) & MASK64;
      H[1] = (H[1] + b) & MASK64;
      H[2] = (H[2] + c) & MASK64;
      H[3] = (H[3] + e) & MASK64;
      H[4] = (H[4] + f) & MASK64;
      H[5] = (H[5] + g) & MASK64;
      H[6] = (H[6] + h) & MASK64;
      H[7] = (H[7] + k8) & MASK64;
    }

    var out = new Uint8Array(64);
    for (i = 0; i < 8; i++) writeU64(out, i * 8, H[i]);
    return out;
  }

  /** @returns {Uint8Array|null} BigInt 不可用时返回 null */
  function sha512(bytes) { return sha512Core(bytes, 'SHA-512'); }

  /** SHA-384：同一核心 + 第 9～16 个素数的那组初始向量 + 截到 48 字节 */
  function sha384(bytes) {
    var full = sha512Core(bytes, 'SHA-384');
    return full ? full.subarray(0, 48) : null;
  }

  /* --- 4. HMAC（RFC 2104） ----------------------------------------------- */

  /**
   * `native` 表示「`crypto.subtle` 认得这个算法」。**MD5 是 false** ——
   * WebCrypto 有意不实现它（这不是遗漏，是标准层面的决定），所以 MD5
   * 在任何浏览器里都得走纯 JS。有了这个标志，`digestAsync` 才会老老实实
   * 返回 null 让调用方回落，而不是把一个 NotSupportedError 抛进 Promise 链。
   *
   * `bigint` 表示纯 JS 实现依赖 BigInt（SHA-384/512 的 64 位字）。
   */
  var ALGOS = {
    MD5:    { name: 'MD5',     block: 64,  bytes: 16, hash: md5,    native: false, bigint: false },
    SHA1:   { name: 'SHA-1',   block: 64,  bytes: 20, hash: sha1,   native: true,  bigint: false },
    SHA256: { name: 'SHA-256', block: 64,  bytes: 32, hash: sha256, native: true,  bigint: false },
    SHA384: { name: 'SHA-384', block: 128, bytes: 48, hash: sha384, native: true,  bigint: true },
    SHA512: { name: 'SHA-512', block: 128, bytes: 64, hash: sha512, native: true,  bigint: true }
  };

  /** 认 'SHA-1' / 'sha1' / 'SHA1' 都行（otpauth URI 里是不带连字符的写法） */
  function byName(name) {
    var k = String(name == null ? '' : name).toUpperCase().replace(/-/g, '');
    return ALGOS[k] || null;
  }

  /**
   * @param {string} name 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'
   * @returns {Uint8Array|null} 算法不存在或环境不支持（SHA-384/512 缺 BigInt）时 null
   */
  function hmac(name, keyBytes, msgBytes) {
    var a = byName(name);
    if (!a) return null;

    var key = keyBytes;
    /* 密钥长于分组时先摘要一次（RFC 2104 第 2 步）—— 不这么做的话，
       超长密钥会被截断成前 block 字节，算出来的 MAC 与所有标准实现都不一样。 */
    if (key.length > a.block) {
      key = a.hash(key);
      if (!key) return null;
    }

    var k = new Uint8Array(a.block);
    k.set(key);

    var ipad = new Uint8Array(a.block);
    var opad = new Uint8Array(a.block);
    for (var i = 0; i < a.block; i++) {
      ipad[i] = k[i] ^ 0x36;
      opad[i] = k[i] ^ 0x5c;
    }

    var inner = a.hash(concat(ipad, msgBytes));
    if (!inner) return null;
    return a.hash(concat(opad, inner));
  }

  /* --- 5. 平台实现（安全上下文里才有） ----------------------------------- */

  /**
   * 只认 `window.crypto.subtle`。刻意不去摸裸 `crypto`：
   * 模块可能被装进一个假的 window（测试就这么干），那时应当走纯 JS 路径。
   */
  function hasSubtle() {
    return !!(window.crypto && window.crypto.subtle &&
      typeof window.crypto.subtle.importKey === 'function');
  }

  function impl() { return hasSubtle() ? 'native' : 'pure'; }

  /** 平台（`crypto.subtle`）能不能算这个算法 —— MD5 永远不能 */
  function nativeImpl(name) {
    var a = byName(name);
    return !!(a && a.native && hasSubtle());
  }

  /**
   * 当前环境能不能算这个算法。三条路取或：
   * 平台有实现 / 纯 JS 实现存在（且不缺 BigInt）。
   */
  function canUse(name) {
    var a = byName(name);
    if (!a) return false;
    if (nativeImpl(name)) return true;
    return !a.bigint || HAS_BIGINT;
  }

  /**
   * 平台实现。**平台没有这个算法时返回 null**（MD5 就是这种情况），
   * 调用方据此回落 `digestAsync` 的同步版本 —— 不要让 subtle 的
   * NotSupportedError 顺着 Promise 链穿出去，那种失败看起来与输入无关。
   */
  function digestAsync(name, bytes) {
    if (!nativeImpl(name)) return null;
    return window.crypto.subtle.digest(byName(name).name, bytes)
      .then(function (buf) { return new Uint8Array(buf); });
  }

  function hmacAsync(name, keyBytes, msgBytes) {
    if (!nativeImpl(name)) return null;
    var s = window.crypto.subtle;
    return s.importKey('raw', keyBytes, { name: 'HMAC', hash: { name: byName(name).name } },
      false, ['sign'])
      .then(function (k) { return s.sign('HMAC', k, msgBytes); })
      .then(function (buf) { return new Uint8Array(buf); });
  }

  T.hash = {
    utf8Bytes: utf8Bytes,
    hex: hex,
    fromHex: fromHex,
    toBase64: toBase64,
    fromBase64: fromBase64,
    concat: concat,
    equal: equal,

    base32Encode: base32Encode,
    base32Decode: base32Decode,

    md5: md5,
    sha1: sha1,
    sha256: sha256,
    sha384: sha384,
    sha512: sha512,
    hmac: hmac,

    ALGOS: ALGOS,
    byName: byName,
    hasBigInt: HAS_BIGINT,
    hasSubtle: hasSubtle,
    impl: impl,
    nativeImpl: nativeImpl,
    canUse: canUse,
    digestAsync: digestAsync,
    hmacAsync: hmacAsync
  };
})();
