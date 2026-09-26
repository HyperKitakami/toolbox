/* ==========================================================================
   password-utils.js — 密码强度相关共用模块
   --------------------------------------------------------------------------
   挂在 window.TOOLBOX.password 上（须在 registry.js 之后加载）。

   两个消费者，所以抽上来：
     - js/tools/password-generator.js —— 生成之后算熵值分档与爆破时间
     - js/tools/password-strength.js  —— 分析用户自己输入的密码
   这些阈值（40 / 60 / 80 比特）与取整口径如果各留一份，迟早在
   「生成器说一般、检测说弱」这种地方分叉，而分叉后两边看着都正常。

   【自研】没有上游实现可移植（praticulus 有 password-generator，没有
   password-strength）。设计取舍都写在下面各段。

   一、爆破时间：全程在对数空间算
   --------------------------------------------------------------------------
   上游的生成器用 `Math.pow(2, entropy)`，熵值一大就变成 Infinity，
   于是所有分档都落进最后一档。这里全程只碰 log10，超过 10^16 年改成
   「约 10^n 年」，永远不会溢出。

   二、强度分档
   --------------------------------------------------------------------------
   按比特分四档（40 / 60 / 80）。这是**生成器与检测共用**的口径：
   用户拿 55 比特的密码在两个工具里看到同一句话，才谈得上一致性。

   三、强度估算（模式化，不是「字符集 × 长度」）
   --------------------------------------------------------------------------
   朴素做法（字符集大小 × 长度）会把 `P@ssw0rd` 算成 8 × log₂(95) ≈ 53 比特，
   报「强」—— 它其实在字典攻击的第一秒里就被命中了。所以这里做两件事：

     1. **朴素上界**：`长度 × log₂(字符集)`。它回答「如果每个字符都独立随机，
        能有多少种可能」，是一个**上界**，不是真实强度。
     2. **模式化估计**：把密码拆成一段段「可被猜出来的模式」，每段给一个
        「猜中它要试多少次」，用动态规划求**总猜测次数最少的那种拆法**
        （攻击者就是这么拆的）。单字符段按 `log₂(字符集)` 计价，所以
        「每个字符各拆一段」这个平凡拆法恰好等于朴素上界 —— 于是
        **模式化估计永远 ≤ 朴素上界**，两个数摆在一起就是「你以为 vs 实际」。

   每段的代价（单位：log₂ 猜测次数）：
     - 单字符       log₂(字符集大小)
     - 查表命中     按下面三份表的**尝试顺序**计价 + 大小写变体 + l33t 替换
     - 键盘/序列    log₂(表数 × 起点数 × 方向) + log₂(长度)
     - 重复         log₂(基串的代价) + log₂(重复次数)
     - 日期         log₂(年数 × 12 × 31 × 排列数)，只认 1900–2099

   三份表，一份都不够用：
     ① 最常见密码表（111 条，**手写**，顺序就是常见程度）：`123456`、`qwerty`、
        `iloveyou`…… 第一个只要 1 次猜测。EFF 那份里没有这些，因为它是「英文
        单词表」而不是「被用过的口令表」。
     ② 常用词表（约 190 条，**手写**）：EFF 表实测**缺很多极常见的词**
        （hello / house / horse / summer / world / welcome 都不在），而人写密码
        时最常用的恰恰是这些，所以单独配一份。
     ③ EFF 长词表（7776 个英文词，来自 js/vendor/，CC BY 3.0 US）：字母序、
        没有频率含义，所以只能按表长计价（log₂(7776) ≈ 12.9 比特）。

   已知的偏差方向（都写成「偏保守」）：
     - 忽略了「攻击者枚举分段方式」带来的组合数 —— 少算 → 低估强度；
     - l33t 只展开单点歧义（`1`→`i` 还是 `l`），不做全组合 —— 少算 → 低估强度；
     - 非 ASCII 一律按 2000 计（汉字量级），拉丁扩展字母实际远小于此 → 低估强度。
   宁可低估也不能高估：高估会让人把弱密码当成强密码用。

   **已知偏乐观的三处**（都会让分数偏高，页面说明区逐条写明）：
     - **多词口令**（`correcthorsebatterystaple`）按「每个词都是从列表里随机抽的」
       计价，而人选的词不是随机的；
     - **词表够不到的东西**：拼写变体（`Tr0ub4dor` —— 连 `troubadour` 这个词都不在
       表里）、专有名词、其它语言、拼音姓名，一律按逐字符暴力算，会明显偏高；
     - **中文 / 日文没有词表、也不分词**，几个汉字组成的词组会被当成随机汉字串。

   结论上的口径：这个分数回答的是「攻击者按上面这套模型猜，最省的一条路要多少
   次猜测」。它**不**回答「这个密码安不安全」—— 撞库、钓鱼、同一密码多处复用，
   哪一样都比算力便宜。页面底部写了这句。
   ========================================================================== */
(function () {
  'use strict';

  var T = (window.TOOLBOX = window.TOOLBOX || {});

  /* ======================================================================
     一、爆破时间
     ====================================================================== */

  /* 离线 · 快哈希（MD5 / SHA 系）单张 GPU 的**量级**假设。
     生成器与本工具共用这一个数，改就一起改。 */
  var DEFAULT_GUESSES_PER_SEC = 1e11;

  var LOG10_YEAR = Math.log10(31536000);

  /** 10 以下留一位小数，10 以上取整 —— 避免「2.9999999 秒」这种读数 */
  function fmtNum(v) {
    return v >= 10 ? String(Math.round(v)) : String(Number(v.toFixed(1)));
  }

  /**
   * log10(猜测次数) → 「平均要试多久」。
   *
   * 取平均命中位置（攻击者试到一半就中），所以分母是 `2 × 每秒次数`。
   * 全程只在 log10 空间里加减，不出现 2^熵 这种会溢出的中间值。
   *
   * @param {number} log10Guesses log10(猜测次数)
   * @param {number} [perSec]     攻击者每秒能试多少次
   * @returns {string}
   */
  function crackTimeFromLog10(log10Guesses, perSec) {
    var l = log10Guesses - Math.log10(2 * (perSec || DEFAULT_GUESSES_PER_SEC));

    if (l < 0) return '瞬间';
    if (l < Math.log10(60))    return fmtNum(Math.pow(10, l)) + ' 秒';
    if (l < Math.log10(3600))  return fmtNum(Math.pow(10, l) / 60) + ' 分钟';
    if (l < Math.log10(86400)) return fmtNum(Math.pow(10, l) / 3600) + ' 小时';
    if (l < LOG10_YEAR)        return fmtNum(Math.pow(10, l) / 86400) + ' 天';

    var y = l - LOG10_YEAR;   /* log10(年) */
    if (y < 4)  return fmtNum(Math.pow(10, y)) + ' 年';
    if (y < 8)  return fmtNum(Math.pow(10, y - 4)) + ' 万年';
    if (y < 12) return fmtNum(Math.pow(10, y - 8)) + ' 亿年';
    if (y < 16) return fmtNum(Math.pow(10, y - 12)) + ' 万亿年';
    return '约 10^' + Math.round(y) + ' 年';
  }

  /** 比特 → 「平均要试多久」 */
  function crackTimeFromBits(bits, perSec) {
    return crackTimeFromLog10(bits * Math.log10(2), perSec);
  }

  /* ======================================================================
     二、强度分档
     ====================================================================== */

  var LEVELS = [
    { max: 40,       level: 1, label: '弱',   note: '能被枚举，别用在真实账号上' },
    { max: 60,       level: 2, label: '一般', note: '能挡住随手的尝试，重要账号还不够' },
    { max: 80,       level: 3, label: '强',   note: '适合绝大多数账号' },
    { max: Infinity, level: 4, label: '很强', note: '适合主邮箱、网银与密钥' }
  ];

  function levelOf(bits) {
    for (var i = 0; i < LEVELS.length; i++) {
      if (bits < LEVELS[i].max) return LEVELS[i];
    }
    return LEVELS[LEVELS.length - 1];
  }

  /* ======================================================================
     三、强度估算
     ====================================================================== */

  /* 字符集档位。非 ASCII 一律按 2000（常用汉字量级）——
     拉丁扩展字母其实远小于这个数，所以这一类会被**低估**，方向是安全的。 */
  var CLASS_INFO = [
    { id: 'digit',  label: '数字',     size: 10 },
    { id: 'lower',  label: '小写字母', size: 26 },
    { id: 'upper',  label: '大写字母', size: 26 },
    { id: 'symbol', label: '符号',     size: 33 },
    { id: 'cjk',    label: '中日韩文字', size: 2000 },
    { id: 'other',  label: '其它非 ASCII', size: 100 }
  ];
  var CLASS_MAP = {};
  CLASS_INFO.forEach(function (c) { CLASS_MAP[c.id] = c; });

  var RE_DIGIT = /[0-9]/;
  var RE_LOWER = /[a-z]/;
  var RE_UPPER = /[A-Z]/;
  /* 中日韩统一表意文字 + 扩展A + 兼容表意 + 假名 + 谚文 + 半角片假名（与 site.js 同一组区间） */
  var RE_CJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF66-\uFF9F\uAC00-\uD7AF]/;

  function classOf(ch) {
    if (RE_DIGIT.test(ch)) return 'digit';
    if (RE_LOWER.test(ch)) return 'lower';
    if (RE_UPPER.test(ch)) return 'upper';
    if (ch.charCodeAt(0) < 128) return 'symbol';   /* 剩下的 ASCII 就是符号与空格 */
    if (RE_CJK.test(ch)) return 'cjk';
    return 'other';
  }

  /* --- 键盘与序列 ------------------------------------------------------- */

  /* 行内相邻的一组键，正着反着都算。大写由大小写变体处理，所以只列小写。 */
  var SEQUENCES = [
    'abcdefghijklmnopqrstuvwxyz',
    '0123456789',
    'qwertyuiop',
    'asdfghjkl',
    'zxcvbnm',
    '!@#$%^&*()'
  ];
  var MAX_SEQ_START = 26;   /* 起点数的量级：最长那张表 26 个字符 */

  /**
   * 这段是不是某张表里连续的一段（含反向）。
   * @returns {number|null} log₂ 猜测次数
   */
  function sequenceBits(span) {
    var s = span.toLowerCase();
    if (s.length < 3) return null;

    var found = false;
    for (var i = 0; i < SEQUENCES.length; i++) {
      var t = SEQUENCES[i];
      if (t.indexOf(s) >= 0) { found = true; break; }
      /* 反向：把表倒过来再看一次，比自己反转字符串省事 */
      if (s.length > 1 && t.split('').reverse().join('').indexOf(s) >= 0) { found = true; break; }
    }
    if (!found) return null;

    /* 猜是哪种表 × 从哪个键开始 × 哪个方向，再乘上「取多长」 */
    return Math.log2(SEQUENCES.length * MAX_SEQ_START * 2) + Math.log2(s.length);
  }

  /* --- 日期 ------------------------------------------------------------- */

  var YEAR_MIN = 1900, YEAR_MAX = 2099;

  function plausible(y, m, d) {
    return (y === null || (y >= YEAR_MIN && y <= YEAR_MAX)) &&
           m >= 1 && m <= 12 && d >= 1 && d <= 31;
  }

  /**
   * 这段像不像一个日期 / 年份。
   * 认 4 位纯数字（当year）、8 位纯数字（YMD / DMY / MDY 三种排列）、
   * 6 位纯数字（两位年的 YMD / DMY / MDY），以及中间带一个 `-` `.` `/` 的同形态。
   * @returns {number|null} log₂ 猜测次数
   */
  function dateBits(span) {
    var digits = span.replace(/[-./]/g, '');

    /* 只允许「纯数字」或「两组/三组用同一个分隔符连起来」 */
    if (!/^\d+$/.test(digits)) return null;
    if (span !== digits && !/^\d{2,4}[-./]\d{1,2}[-./]\d{1,4}$/.test(span)) return null;

    var n = digits.length;

    /* 4 位：当成年份（1900–2099） */
    if (n === 4) {
      var y4 = Number(digits);
      if (y4 >= YEAR_MIN && y4 <= YEAR_MAX) {
        return Math.log2(YEAR_MAX - YEAR_MIN + 1);
      }
      return null;
    }

    var orders = n === 8
      ? [[0, 4, 6], [4, 0, 2], [0, 2, 4]]      /* YMD / MDY / DMY，年都是 4 位 */
      : n === 6
        ? [[0, 2, 4], [4, 0, 2], [0, 4, 2]]    /* 两位年：YMD / MDY / DMY */
        : [];                                   /* 其余长度（含 2 位）不当日期 */

    for (var k = 0; k < orders.length; k++) {
      var o = orders[k];
      var y = Number(digits.substr(o[0], n === 8 ? 4 : 2));
      if (n === 6) y += y < 50 ? 2000 : 1900;   /* 两位年：00–49 归 2000 年代 */
      var m = Number(digits.substr(o[1], 2));
      var d = Number(digits.substr(o[2], 2));
      if (plausible(y, m, d)) {
        var years = n === 8 ? (YEAR_MAX - YEAR_MIN + 1) : 100;
        return Math.log2(years * 12 * 31 * orders.length);
      }
    }
    return null;
  }

  /* --- 重复 ------------------------------------------------------------- */

  /**
   * 这段是不是某个更短的串重复出来的。
   * @returns {{base: string, times: number}|null}
   */
  function repeatOf(span) {
    var n = span.length;
    if (n < 2) return null;
    for (var b = 1; b <= n / 2; b++) {
      if (n % b !== 0) continue;
      var times = n / b;
      if (times < 2) continue;
      var ok = true;
      for (var i = b; i < n; i++) {
        if (span.charAt(i) !== span.charAt(i - b)) { ok = false; break; }
      }
      if (ok) return { base: span.slice(0, b), times: times };
    }
    return null;
  }

  /* --- 词表 ------------------------------------------------------------- */

  /* 手写的「最常见密码」小表，**顺序就是排名**。
     来源：公开的「最常见密码」共识（每年的泄露口令榜前几名高度稳定），
     不是某份授权数据集的原样复制，所以刻意只收最典型的一批。
     EFF 长词表里没有 qwerty / admin / welcome / letmein / iloveyou 这些
     —— 那 7776 个是「英文单词」，不是「被用过的口令」，两件事必须都查。 */
  var TOP_PASSWORDS = [
    '123456', 'password', '12345678', 'qwerty', '123456789', '12345', '1234',
    '111111', '1234567', 'dragon', '123123', 'baseball', 'abc123', 'football',
    'monkey', 'letmein', '696969', 'shadow', 'master', '666666', 'qwertyuiop',
    '123321', 'mustang', '1234567890', 'michael', '654321', 'pussy', 'superman',
    '1qaz2wsx', '7777777', 'fuckyou', '121212', '000000', 'qazwsx', '123qwe',
    'killer', 'trustno1', 'jordan', 'jennifer', 'zxcvbnm', 'asdfgh', 'hunter',
    'buster', 'soccer', 'harley', 'batman', 'andrew', 'tigger', 'sunshine',
    'iloveyou', 'fuckme', '2000', 'charlie', 'robert', 'thomas', 'hockey',
    'ranger', 'daniel', 'starwars', 'klaster', '112233', 'george', 'asshole',
    'computer', 'michelle', 'jessica', 'pepper', '1111', 'zxcvbn', '555555',
    '11111111', '131313', 'freedom', '777777', 'pass', 'fuck', 'maggie',
    '159753', 'aaaaaa', 'ginger', 'princess', 'joshua', 'cheese', 'amanda',
    'summer', 'love', 'ashley', 'nicole', 'chelsea', 'biteme', 'matthew',
    'access', 'yankees', '987654321', 'dallas', 'austin', 'thunder', 'taylor',
    'matrix', 'admin', 'welcome', 'secret', 'hello', 'changeme', 'letmein1',
    'root', 'toor', 'administrator', 'passw0rd', 'p@ssword', 'p@ssw0rd'
  ];
  var TOP_INDEX = {};
  TOP_PASSWORDS.forEach(function (w, i) { TOP_INDEX[w] = i; });

  /* 第二份：常在密码里出现的英文常用词。
     为什么不用 EFF 那份就够了 —— 实测 EFF 长词表**缺很多极常见的词**
     （hello / house / horse / summer / world / welcome 都不在，
     而 safehouse、handball 这种反而在）。它是为「口令短语」挑的词，
     不是「人在密码里会用的词」，两件事不一样。
     顺序是按常见程度**估**的（不是实测词频表），前几名是最常出现在
     密码里的那些。这份是手写的，不是授权数据集的原样复制。 */
  var COMMON_WORDS = [
    'love', 'hello', 'world', 'house', 'horse', 'summer', 'winter', 'money',
    'friend', 'family', 'angel', 'baby', 'forever', 'heart', 'sweet', 'honey',
    'dream', 'kiss', 'star', 'moon', 'sun', 'sky', 'fire', 'water', 'earth',
    'wind', 'rain', 'snow', 'storm', 'flower', 'garden', 'tree', 'rose',
    'tiger', 'lion', 'bear', 'wolf', 'eagle', 'rabbit', 'snake', 'mouse',
    'dog', 'cat', 'bird', 'fish', 'panda', 'elephant', 'dolphin', 'butterfly',
    'spring', 'autumn', 'january', 'february', 'march', 'april', 'may',
    'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'monday', 'friday', 'sunday', 'red', 'blue', 'green', 'black', 'white',
    'orange', 'purple', 'pink', 'silver', 'golden', 'yellow', 'brown',
    'music', 'guitar', 'piano', 'movie', 'game', 'player', 'winner',
    'champion', 'soccer', 'basketball', 'tennis', 'hockey', 'golf',
    'computer', 'phone', 'coffee', 'pizza', 'candy', 'cookie', 'apple',
    'banana', 'cherry', 'lemon', 'melon', 'pepper', 'cheese', 'chocolate',
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'hundred', 'thousand', 'million',
    'diamond', 'crystal', 'magic', 'power', 'super', 'ninja', 'pirate',
    'wizard', 'knight', 'prince', 'queen', 'king', 'royal', 'ocean', 'river',
    'mountain', 'forest', 'island', 'desert', 'valley', 'bridge', 'window',
    'door', 'table', 'chair', 'garden', 'school', 'college', 'student',
    'teacher', 'doctor', 'police', 'soldier', 'officer', 'manager', 'office',
    'service', 'support', 'system', 'network', 'server', 'internet', 'email',
    'login', 'user', 'guest', 'test', 'demo', 'sample', 'google', 'facebook',
    'twitter', 'yahoo', 'hotmail', 'gmail', 'windows', 'linux', 'android',
    'pumpkin', 'sunflower', 'rainbow', 'thunder', 'lightning', 'hurricane',
    'treasure', 'journey', 'adventure', 'freedom', 'victory', 'paradise',
    'harmony', 'destiny', 'mystery', 'fantasy', 'galaxy', 'universe',
    'planet', 'rocket', 'comet', 'meteor', 'sphere', 'angle', 'circle',
    'square', 'triangle', 'pyramid', 'temple', 'castle', 'tower', 'palace'
  ];
  var COMMON_INDEX = {};
  COMMON_WORDS.forEach(function (w, i) { COMMON_INDEX[w] = i; });

  /* 攻击者的尝试顺序：先最常见密码（按常见程度），再常用词，最后才轮到
     7776 词的通用词表。所以代价 = log2(排到自己为止试了多少个 + 1)。 */
  var COMMON_BASE = TOP_PASSWORDS.length;

  function listRank(word) {
    if (TOP_INDEX[word] !== undefined) return TOP_INDEX[word];
    if (COMMON_INDEX[word] !== undefined) return COMMON_BASE + COMMON_INDEX[word];
    return null;
  }

  /* EFF 长词表（7776 个英文单词）。页面没引入时降级：不查词典，
     但其余模式照常工作 —— 探测到这种情况会在结果里挂一条提示。 */
  var WORDS = null;
  var WORD_SET = null;
  var WORD_SOURCE = '';

  function useWordlist(list) {
    if (!list || !list.length) return false;
    WORDS = list;
    WORD_SET = {};
    for (var i = 0; i < list.length; i++) WORD_SET[list[i]] = true;
    WORD_SOURCE = 'EFF 长词表 · ' + list.length + ' 个词';
    return true;
  }

  function readWordlist() {
    var raw = T.wordlists && T.wordlists.effLarge;
    if (!raw) return false;
    /* vendor 文件末尾已经 `.split('\n')` 过了，拿到的是数组；
       字符串分支留着，免得哪天换成原文时这里静默失效。 */
    var list = typeof raw === 'string' ? raw.split('\n') : raw;
    var clean = [];
    for (var i = 0; i < list.length; i++) {
      var w = String(list[i]).trim();
      if (w) clean.push(w);
    }
    return useWordlist(clean);
  }

  /* --- l33t 替换 -------------------------------------------------------- */

  /* 字符 → 它可能代表的字母（一个字符可能对应多个，例如 `1` 是 i 也可能是 l） */
  var L33T = {
    '4': 'a', '@': 'a', '8': 'b', '3': 'e', '6': 'g', '9': 'g',
    '1': 'il', '!': 'i', '|': 'l', '0': 'o', '$': 's', '5': 's', '7': 't', '2': 'z'
  };

  /**
   * 把 l33t 写法还原成可能的字母串。
   * 只展开「单点歧义」：全部按第一候选还原一次，再加上每次只改一个位置的变体。
   * 全组合会指数爆炸（`1` 与 `|` 多起来就是 2^n 个候选），而且实战里
   * 攻击者也是先按最常见的映射试，所以这里是有意收窄的近似。
   *
   * @returns {Array<{text: string, bits: number, subs: number}>|null}
   */
  function l33tCandidates(span) {
    var lower = span.toLowerCase();
    var at = [];
    var sumBits = 0;

    for (var i = 0; i < lower.length; i++) {
      var alts = L33T[lower.charAt(i)];
      if (!alts) continue;
      at.push({ i: i, alts: alts });
      /* 每种替换至少算 1 比特（「这里用了替换」本身也要猜），多候选再加 */
      sumBits += Math.log2(alts.length > 1 ? alts.length : 2);
    }
    if (!at.length) return null;

    function build(overrideIndex, overrideAlt) {
      var s = lower;
      for (var k = 0; k < at.length; k++) {
        var alt = (k === overrideIndex && overrideAlt < at[k].alts.length)
          ? at[k].alts.charAt(overrideAlt)
          : at[k].alts.charAt(0);
        s = s.slice(0, at[k].i) + alt + s.slice(at[k].i + 1);
      }
      return s;
    }

    var out = [{ text: build(-1, 0), bits: sumBits }];
    for (var g = 0; g < at.length && out.length < 8; g++) {
      for (var a = 1; a < at[g].alts.length && out.length < 8; a++) {
        out.push({ text: build(g, a), bits: sumBits });
      }
    }
    return out;
  }

  /* --- 大小写变体 ------------------------------------------------------- */

  /** 还原成小写之后，还要猜「原来是怎么大写的」 */
  function caseBits(span) {
    if (span === span.toLowerCase()) return 0;                 /* 全小写 */
    if (span === span.toUpperCase()) return 1;                 /* 全大写 */
    var first = span.charAt(0) + span.slice(1).toLowerCase();
    if (span === first) return 1;                              /* 首字母大写 */
    return span.length;                                        /* 混合大小写：每个位置 1 比特 */
  }

  /* --- 词表匹配 --------------------------------------------------------- */

  /**
   * 这段能否被「查表」命中，代价是多少。
   *
   * 三种表按攻击者的尝试顺序叠在一起：最常见密码表 → 常用词表 → 通用词表。
   * 前两份的顺序**就是排名**（第一个词试 1 次），第三份是字母序、没有频率
   * 含义，所以只能按表长计价（log₂(7776) ≈ 12.9 比特）。
   *
   * @returns {{bits:number, note:string, meta:object}|null}
   */
  function dictBits(span) {
    /* 两字符的「词」查表代价（12.9 比特）比逐字符暴力还贵，DP 永远不会选，
       所以直接从 3 字符起查，省掉大量无用查表。 */
    if (span.length < 3) return null;

    var lower = span.toLowerCase();
    /* 反转要 4 个字符以上才认：3 字符的词倒过来往往还是另一个 3 字符的词
       （`bad` / `dab`），在长密码里会冒出「倒着写的词」这种误导性提示。 */
    var reversed = span.length >= 4 ? lower.split('').reverse().join('') : null;
    var l33t = l33tCandidates(span);
    var best = null;

    function costOf(word) {
      var r = listRank(word);
      if (r !== null) {
        return { bits: Math.log2(r + 1), from: r < COMMON_BASE ? 'toppw' : 'common', rank: r + 1 };
      }
      if (WORD_SET && WORD_SET[word]) {
        return { bits: Math.log2(WORDS.length), from: 'dict', rank: null };
      }
      return null;
    }

    function tryWord(word, isReversed, l33tInfo) {
      var hit = costOf(word);
      if (!hit) return;

      var bits = hit.bits + caseBits(span);
      if (l33tInfo) bits += l33tInfo.bits;
      if (isReversed) bits += 1;         /* 反转只是多一比特，挡不住 */

      var note = (hit.from === 'toppw' ? '最常见密码表第 ' + hit.rank + ' 个'
        : hit.from === 'common' ? '常用词表第 ' + hit.rank + ' 个'
        : '通用英文词表（7776 词）')
        + (l33tInfo ? '，' + l33tInfo.subs + ' 处 l33t 替换' : '')
        + (isReversed ? '，倒着写' : '');

      if (!best || bits < best.bits) {
        best = {
          bits: bits,
          note: note,
          meta: { from: hit.from, rank: hit.rank, subs: l33tInfo ? l33tInfo.subs : 0, reversed: !!isReversed }
        };
      }
    }

    tryWord(lower, false, null);
    if (reversed) tryWord(reversed, true, null);

    if (l33t) {
      for (var i = 0; i < l33t.length; i++) {
        var info = { bits: l33t[i].bits, subs: countSubs(span) };
        tryWord(l33t[i].text, false, info);
        if (reversed) tryWord(l33t[i].text.split('').reverse().join(''), true, info);
      }
    }

    return best;
  }

  function countSubs(span) {
    var lower = span.toLowerCase();
    var n = 0;
    for (var i = 0; i < lower.length; i++) if (L33T[lower.charAt(i)]) n++;
    return n;
  }

  /* --- 动态规划 --------------------------------------------------------- */

  /* 单段最长 40 个码点：再长的话没有任何一个匹配器覆盖得到，
     每加一个码点只是白白多跑一轮。 */
  var MAX_SPAN = 40;
  /* 重复段要递归求「基串」的代价，深度设个上限防止病态输入 */
  var MAX_DEPTH = 3;
  var memo = {};

  function codePoints(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var d = str.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { out.push(str.substr(i, 2)); i++; continue; }
      }
      out.push(str.charAt(i));
    }
    return out;
  }

  /**
   * 求一个串「最省的拆解」。
   * @param {Array<string>} chars 码点数组
   * @param {number} perChar      log₂(字符集大小)
   * @param {number} depth
   * @returns {{bits: number, segs: Array}}
   */
  function decompose(chars, perChar, depth) {
    var n = chars.length;
    var key = (depth || 0) + '|' + perChar.toFixed(4) + '|' + chars.join('');
    if (memo[key]) return memo[key];

    var best = new Array(n + 1);
    var from = new Array(n + 1);
    for (var i = 0; i <= n; i++) best[i] = Infinity;
    best[0] = 0;

    for (var i = 0; i < n; i++) {
      if (best[i] === Infinity) continue;
      var max = Math.min(MAX_SPAN, n - i);

      for (var L = 1; L <= max; L++) {
        var span = chars.slice(i, i + L).join('');
        var cands = [];

        /* 单字符：按整个密码的字符集计价。
           这样「每个字符各拆一段」的总价恰好等于朴素上界，
           于是模式化估计永远 ≤ 朴素上界 —— 两个数才有可比性。 */
        if (L === 1) {
          cands.push({ kind: 'brute', bits: perChar, note: CLASS_MAP[classOf(span)].label });
        } else {
          var d = dictBits(span);
          if (d) cands.push({ kind: 'dict', bits: d.bits, note: d.note, meta: d.meta });

          var s = sequenceBits(span);
          if (s !== null) cands.push({ kind: 'sequence', bits: s, note: '键盘或字母表的连续一段' });

          var dt = dateBits(span);
          if (dt !== null) cands.push({ kind: 'date', bits: dt, note: '像日期或年份' });

          var rp = repeatOf(span);
          if (rp && depth < MAX_DEPTH) {
            var inner = decompose(codePoints(rp.base), perChar, (depth || 0) + 1);
            cands.push({
              kind: 'repeat',
              bits: inner.bits + Math.log2(rp.times),
              note: q(rp.base) + '重复 ' + rp.times + ' 次'
            });
          }
        }

        for (var c = 0; c < cands.length; c++) {
          var total = best[i] + cands[c].bits;
          if (total < best[i + L]) {
            best[i + L] = total;
            from[i + L] = { at: i, len: L, seg: cands[c] };
          }
        }
      }
    }

    /* 回溯出拆解 */
    var segs = [];
    var p = n;
    while (p > 0) {
      var f = from[p];
      if (!f) break;
      segs.unshift({
        text: chars.slice(f.at, f.at + f.len).join(''),
        kind: f.seg.kind,
        bits: f.seg.bits,
        note: f.seg.note,
        meta: f.seg.meta || null
      });
      p = f.at;
    }

    var res = { bits: best[n] === Infinity ? 0 : best[n], segs: segs };
    memo[key] = res;
    return res;
  }

  /* --- 对外入口 --------------------------------------------------------- */

  var KIND_LABEL = {
    brute: '逐字符暴力',
    dict: '词表 / 常见密码',
    sequence: '序列 / 键盘',
    date: '日期',
    repeat: '重复'
  };

  /* 模式化估计是 O(长度 × 单段上限) 的动态规划：128 位约 25ms，1000 位约 220ms。
     密码不会这么长，但粘贴一大段文本进来就会卡一下 —— 超过这个长度只给
     朴素估计（那个是 O(长度)），并如实说明少算了什么。 */
  var MAX_ANALYZE = 512;

  /**
   * 分析一个密码。
   *
   * @param {string} pw
   * @returns {{
   *   length: number, codeUnits: number, charset: number,
   *   classes: Array<{id,label,size,count}>, kindCount: number,
   *   naiveBits: number, bits: number, guessesLog10: number,
   *   segments: Array<{text,kind,kindLabel,bits,note}>,
   *   level: object, empty: boolean, wordlistReady: boolean,
   *   warnings: Array<{level,title,text}>
   * }}
   */
  function estimate(pw) {
    var str = String(pw == null ? '' : pw);
    var chars = codePoints(str);
    var n = chars.length;

    /* 各类字符各有多少 */
    var counts = {};
    CLASS_INFO.forEach(function (c) { counts[c.id] = 0; });
    chars.forEach(function (ch) { counts[classOf(ch)]++; });

    var classes = CLASS_INFO
      .filter(function (c) { return counts[c.id] > 0; })
      .map(function (c) {
        return { id: c.id, label: c.label, size: c.size, count: counts[c.id] };
      });
    var charset = classes.reduce(function (a, c) { return a + c.size; }, 0);

    var perChar = charset > 1 ? Math.log2(charset) : 0;
    var naiveBits = n * perChar;

    if (!n) {
      return {
        length: 0, codeUnits: 0, charset: 0, classes: [], kindCount: 0,
        naiveBits: 0, bits: 0, guessesLog10: 0, segments: [],
        level: levelOf(0), empty: true,
        wordlistReady: !!WORD_SET, wordlistSource: WORD_SOURCE,
        warnings: []
      };
    }

    /* 超长输入：只给朴素估计，别让粘贴一大段文本把页面卡住 */
    if (n > MAX_ANALYZE) {
      return {
        length: n, codeUnits: str.length, charset: charset, classes: classes,
        kindCount: classes.length, naiveBits: naiveBits, bits: naiveBits,
        guessesLog10: naiveBits * Math.log10(2), segments: [],
        level: levelOf(naiveBits), empty: false, tooLong: true,
        wordlistReady: !!WORD_SET, wordlistSource: WORD_SOURCE,
        warnings: [{
          level: 'info',
          title: '超过 ' + MAX_ANALYZE + ' 位，只给了朴素估计',
          text: '这么长的输入不做模式化拆解（那一步是平方级耗时）。上面这个数字是' +
            '「每个字符都独立随机」的上界，没有扣掉词表、重复、日期这些折扣 —— ' +
            '真实强度只会更低。'
        }]
      };
    }

    memo = {};
    var res = decompose(chars, perChar, 0);

    var segments = res.segs.map(function (s) {
      return {
        text: s.text, kind: s.kind, kindLabel: KIND_LABEL[s.kind],
        bits: s.bits, note: s.note, meta: s.meta
      };
    });

    return {
      length: n,
      codeUnits: str.length,
      charset: charset,
      classes: classes,
      kindCount: classes.length,
      naiveBits: naiveBits,
      bits: res.bits,
      guessesLog10: res.bits * Math.log10(2),
      segments: segments,
      level: levelOf(res.bits),
      empty: false,
      wordlistReady: !!WORD_SET,
      wordlistSource: WORD_SOURCE,
      warnings: warningsFor(segments, res.bits, n, classes, charset)
    };
  }

  /* --- 发现与建议 ------------------------------------------------------- */

  /* 引用密码片段统一走这里：外面套反引号，页面遮罩的时候只把反引号里的内容
     换成圆点 —— 「隐藏」关掉的是密码本身，解释文字照旧可读。 */
  function q(frag) { return '「`' + frag + '`」'; }

  function warningsFor(segments, bits, n, classes, charset) {
    var out = [];
    var kinds = {};
    segments.forEach(function (s) { kinds[s.kind] = (kinds[s.kind] || 0) + 1; });

    function first(pred) {
      for (var i = 0; i < segments.length; i++) if (pred(segments[i])) return segments[i];
      return null;
    }
    var isFrom = function (v) { return function (s) { return s.meta && s.meta.from === v; }; };

    /* ① 字典类：三段表里「最严重的那一段」只出一条，免得刷屏。
       命中片段短于 4 个字符就不单独提示 —— 一个三字母词对结论影响很小，
       在一串随机字符里偶然撞到时，提示反而会把人带偏（DP 仍会计入它的代价）。 */
    var hit = first(isFrom('toppw')) || first(isFrom('common')) || first(isFrom('dict')) ||
      first(function (s) { return s.meta && s.meta.subs > 0; });
    if (hit && hit.text.length < 4) hit = null;
    if (hit) {
      var from = hit.meta.from;
      var rank = hit.meta.rank;

      if (from === 'toppw' && rank <= 20) {
        out.push({
          level: 'danger',
          title: '这是最常见密码表里的前 20 名',
          text: q(hit.text) + '在常见密码表里排第 ' + rank + '。' +
            '攻击者第一步就是拿这份表从上往下试，排在前面的几秒内必中 —— ' +
            '这不是「有点弱」，是等于没设密码。'
        });
      } else if (from === 'toppw') {
        out.push({
          level: 'danger',
          title: '命中了常见密码表',
          text: q(hit.text) + '在常见密码表里排第 ' + rank + '，' +
            '整份表只有几百条，一次遍历就试完了。优先换掉这一段。'
        });
      } else if (from === 'common') {
        out.push({
          level: 'warn',
          title: '含常用词',
          text: q(hit.text) + '是很常出现在密码里的词（词表里排第 ' + rank + '）。' +
            '这类词会被词表攻击优先命中，而**在词尾加数字只多几比特** ——' +
            '`hello1` 不比 `hello` 强多少。'
        });
      } else if (from === 'dict') {
        out.push({
          level: 'warn',
          title: '含通用词表里的单词',
          text: q(hit.text) + '在 7776 词的英文词表里。整份表一次遍历只要十几比特，' +
            '所以「用一个词 + 改几个字母」是本工具最容易识破的写法。'
        });
      }

      if (hit.meta.subs > 0) {
        out.push({
          level: 'warn',
          title: 'l33t 替换挡不住字典攻击',
          text: q(hit.text) + '里有 ' + hit.meta.subs + ' 处字母被换成了相近符号' +
            '（`a`→`@`/`4`、`o`→`0`、`e`→`3`、`i`→`1`、`s`→`$`/`5`）。' +
            '这类替换是字典攻击的标配，会被**一并试**，等于没换。'
        });
      }
      if (hit.meta.reversed) {
        out.push({
          level: 'warn',
          title: '倒着写的词',
          text: q(hit.text) + '是把词倒过来写的。反转只是多一次尝试，' +
            '在攻击者的枚举表里属于同一档次。'
        });
      }
    }

    /* ② 序列 / 键盘 */
    if (kinds.sequence) {
      var seqSeg = first(function (s) { return s.kind === 'sequence'; });
      out.push({
        level: 'warn',
        title: '键盘相邻键或字母表顺序',
        text: q(seqSeg.text) + '是键盘或字母表里挨着的一段。' +
          '`qwerty`、`asdfgh`、`abcd`、`1234` 这类全都在攻击者的枚举表里。'
      });
    }

    /* ③ 重复 */
    if (kinds.repeat) {
      var rep = first(function (s) { return s.kind === 'repeat'; });
      out.push({
        level: 'warn',
        title: '重复的片段',
        text: q(rep.text) + '是同一个片段重复出来的（' + rep.note + '）。' +
          '多加几遍并不增加多少可能 —— 攻击者试一次基串就够了。'
      });
    }

    /* ④ 日期 / 年份 */
    if (kinds.date) {
      var dt = first(function (s) { return s.kind === 'date'; });
      out.push({
        level: 'warn',
        title: '像日期或年份',
        text: q(dt.text) + '落在 1900–2099 这个范围里。生日、纪念日、常用年份是' +
          '攻击者最先试的一批（一年 365 天 × 100 年，全部试完也只要 22 比特）。' +
          '换成一个跟你不相干的数字，或者干脆不要数字段。'
      });
    }

    /* ⑤ 长度 */
    if (n < 12) {
      out.push({
        level: n < 8 ? 'danger' : 'info',
        title: '长度只有 ' + n + ' 位',
        text: '加长是最省事也最有效的改法：每多一位，猜测次数就乘一整个字符集。' +
          (bits < 40 ? '加到 12 位以上能立刻跳出「弱」这一档。' : '')
      });
    }

    /* ⑥ 字符种类 */
    if (classes.length <= 1) {
      out.push({
        level: 'info',
        title: '只用了' + (classes[0] ? classes[0].label : '一类') + '一类字符',
        text: '字符集大小只有 ' + charset + '，每种字符的可能数少，猜起来便宜。' +
          '但**别为了凑种类去加 `!` 或 `1`** —— 那两种是最常见的凑数写法，' +
          '攻击者的枚举表里就排在最前面。'
      });
    } else if (classes.length === 2 && charset <= 36) {
      out.push({
        level: 'info',
        title: '字符种类偏少',
        text: '只用到 ' + classes.map(function (c) { return c.label; }).join(' 和 ') +
          '，字符集共 ' + charset + ' 种。'
      });
    }

    /* ⑦ 中日韩文字没有词表可查 —— 这条会影响结论，必须说 */
    if (classes.length === 1 && classes[0].id === 'cjk') {
      out.push({
        level: 'info',
        title: '纯中日韩文字：没有词表可查，这一项会高估',
        text: '本站没有中文 / 日文词表，也不会分词，所以「几个汉字组成的词或短语」' +
          '在这里被当成「每个字都从 2000 个常用字里随机挑的」来算，数字会偏高。' +
          '拼音、姓名、生日同理 —— 判定结论请按「这段文字是不是有意义的组合」自己再想一遍。'
      });
    }

    /* ⑧ 全是逐字符暴力 —— 没命中任何模式，这是好信号 */
    if (segments.length && segments.every(function (s) { return s.kind === 'brute'; })) {
      out.push({
        level: 'ok',
        title: '没有命中任何已知模式',
        text: '逐字符暴力是最贵的路。' + (n >= 12
          ? '保持这个长度、别换成有意义的词，就已经不错了。'
          : '再长一点会更好。')
      });
    }

    /* ⑨ 词表没加载上时说明一句，免得用户以为词表检测「没发现问题」 */
    if (!WORD_SET) {
      out.push({
        level: 'info',
        title: '词表没加载上，这几项没查',
        text: '常用词表的脚本没引入或加载失败，本轮只做了键盘序列、重复、日期与暴力这些检测。'
      });
    }

    return out;
  }

  /* ======================================================================
     四、破解场景
     ====================================================================== */

  /* 都是**量级**假设，不是实测值。真正决定要多久的是目标站点用的是哪种哈希，
     所以页面上要把这句话讲出来，别让用户以为这是个精确预测。

     **按攻击能力从弱到强排**（每秒次数单调递增），这样页面上的时间会单调递减，
     上下一比就能看出「换一种攻击方式差几个数量级」。
     注意「每小时 100 次」比「不限速」弱得多：0.028 次/秒 vs 10 次/秒。 */
  var ATTACKS = [
    { id: 'online-locked', name: '在线 · 每小时 100 次', perSec: 100 / 3600, note: '有锁定或验证码 —— 最弱的攻击者' },
    { id: 'online-open',   name: '在线 · 不限速',      perSec: 10,        note: '登录接口不限制尝试次数' },
    { id: 'offline-slow',  name: '离线 · 慢哈希',      perSec: 1e5,       note: 'bcrypt / Argon2 量级，单张 GPU' },
    { id: 'offline-fast',  name: '离线 · 快哈希',      perSec: 1e11,      note: 'MD5 / SHA 系，单张 GPU' },
    { id: 'offline-cluster', name: '离线 · 快哈希 · 集群', perSec: 1e13,   note: '同一套算法，100 张 GPU —— 最强的攻击者' }
  ];

  /* ======================================================================
     五、导出
     ====================================================================== */

  T.password = {
    DEFAULT_GUESSES_PER_SEC: DEFAULT_GUESSES_PER_SEC,
    fmtNum: fmtNum,
    crackTimeFromLog10: crackTimeFromLog10,
    crackTimeFromBits: crackTimeFromBits,
    LEVELS: LEVELS,
    levelOf: levelOf,
    estimate: estimate,
    readWordlist: readWordlist,
    useWordlist: useWordlist,
    ATTACKS: ATTACKS,
    CLASS_INFO: CLASS_INFO,
    TOP_PASSWORDS: TOP_PASSWORDS,
    COMMON_WORDS: COMMON_WORDS
  };
})();
