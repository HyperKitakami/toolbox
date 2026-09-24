/* ==========================================================================
   random-utils.js — 随机取样与字符集（生成器类工具共用）
   --------------------------------------------------------------------------
   挂在 window.TOOLBOX.random 上，必须在 registry.js 之后加载。

   为什么要单独立一个模块：

   1. 「取 [0, n) 上的均匀随机整数」是随机类工具的核心动作，写错一次就是安全隐患。
      最常见的写法 `随机数 % n` 在 n 不能整除 2^32 时有**模偏差** —— 靠前的下标
      概率略高，字符集越小越明显。这里统一用**拒绝采样**，工具里不要再各写一份。
   2. 字符集与「易混字符」的定义也要统一，否则同一个「全部可见字符」在两个工具里
      长度对不上，用户会以为是 bug。
   3. 随机源只认 crypto.getRandomValues。拿不到时**抛错**，不退回 Math.random ——
      Math.random 的序列可预测，用它生成密码等于没生成。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  /* --- 1. 字符集 --------------------------------------------------------- */

  var UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var LOWER = 'abcdefghijklmnopqrstuvwxyz';
  var DIGITS = '0123456789';

  /* 符号取两个上游集合的并集，并排除 `"` `'` `` ` `` `\` 这四个 ——
     生成的密码经常要被粘进命令行、SQL、CSV 或 JSON，这四个字符到哪儿都要转义。 */
  var SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?/|~';

  /* 容易被看错的字符：数字 0 与字母 O / o，数字 1 与字母 I / l */
  var AMBIGUOUS = '0OoIl1';

  var CHARSETS = { upper: UPPER, lower: LOWER, digits: DIGITS, symbols: SYMBOLS };

  /* --- 2. 随机源 --------------------------------------------------------- */

  var UINT32_RANGE = 4294967296;
  var BUF_SIZE = 128;
  var buf = null;
  var cursor = BUF_SIZE;   /* 一开始就置满，第一次取值时才真正调 getRandomValues */

  function available() {
    return typeof crypto !== 'undefined' && !!crypto &&
           typeof crypto.getRandomValues === 'function';
  }

  function nextUint32() {
    if (!buf) buf = new Uint32Array(BUF_SIZE);
    if (cursor >= BUF_SIZE) {
      crypto.getRandomValues(buf);
      cursor = 0;
    }
    return buf[cursor++];
  }

  /**
   * 取 n 个 [0, size) 上的均匀随机整数。
   *
   * 拒绝采样：把 32 位随机数里超出「size 的整数倍」的那一段丢掉重取。
   * 这样每个下标命中的概率完全相同；`v % size` 则会让前 (2^32 mod size) 个
   * 下标多占一份概率。size 越小偏差越明显（size = 3 时偏差约 3.3e-10，
   * 看着小，但随机数不该有可预测的偏差）。
   *
   * @param {number} n    取几个
   * @param {number} size 上界（不含），即字符集长度或数组长度
   * @returns {number[]}
   */
  function indexes(n, size) {
    if (!available()) throw new Error('crypto-unavailable');
    if (!(size >= 1)) throw new Error('bad-size: ' + size);
    if (size > UINT32_RANGE) throw new Error('size-too-large: ' + size);

    var out = new Array(n);
    if (size === 1) {
      for (var k = 0; k < n; k++) out[k] = 0;
      return out;
    }

    var limit = Math.floor(UINT32_RANGE / size) * size;
    for (var i = 0; i < n; i++) {
      var v;
      do { v = nextUint32(); } while (v >= limit);
      out[i] = v % size;
    }
    return out;
  }

  /**
   * 从字符集里等概率取 n 个字符。
   * @param {string} set 字符集
   * @param {number} n
   * @returns {string}
   */
  function chars(set, n) {
    var idx = indexes(n, set.length);
    var out = '';
    for (var i = 0; i < n; i++) out += set.charAt(idx[i]);
    return out;
  }

  /** 从数组里等概率取一个元素 */
  function pick(arr) {
    return arr[indexes(1, arr.length)[0]];
  }

  /** 从数组里等概率取 n 个元素（可重复） */
  function pickMany(arr, n) {
    var idx = indexes(n, arr.length);
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = arr[idx[i]];
    return out;
  }

  /**
   * 取 n 个密码学安全的随机字节。
   * UUID 生成器要用（v4 的 122 位随机、v7 的 rand_b、v1 的节点与时钟序列）。
   * @param {number} n
   * @returns {Uint8Array}
   */
  function bytes(n) {
    if (!available()) throw new Error('crypto-unavailable');
    var out = new Uint8Array(n);
    crypto.getRandomValues(out);
    return out;
  }

  /** Fisher-Yates 洗牌，返回新数组 */
  function shuffle(arr) {
    var out = arr.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = indexes(1, i + 1)[0];
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /** 去掉易混字符 */
  function filterAmbiguous(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      if (AMBIGUOUS.indexOf(s.charAt(i)) === -1) out += s.charAt(i);
    }
    return out;
  }

  /** 去重并去掉空白字符，保持首次出现的顺序 */
  function normalizeCharset(s) {
    var seen = Object.create(null);
    var out = '';
    var raw = String(s == null ? '' : s);
    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (seen[ch] || /\s/.test(ch)) continue;
      seen[ch] = true;
      out += ch;
    }
    return out;
  }

  /** 字符集大小对应的单字符熵（比特） */
  function entropyPerChar(size) {
    return size > 1 ? Math.log2(size) : 0;
  }

  /* --- 3. 导出 ----------------------------------------------------------- */

  T.random = {
    available: available,
    indexes: indexes,
    bytes: bytes,
    chars: chars,
    pick: pick,
    pickMany: pickMany,
    shuffle: shuffle,
    filterAmbiguous: filterAmbiguous,
    normalizeCharset: normalizeCharset,
    entropyPerChar: entropyPerChar,
    CHARSETS: CHARSETS,
    AMBIGUOUS: AMBIGUOUS
  };
})();
