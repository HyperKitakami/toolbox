/* ==========================================================================
   number-formatter.js — 数字格式化
   --------------------------------------------------------------------------
   自研工具：参考仓库 jamalofski/praticulus 里没有对应实现。

   设计取舍（自研工具没有上游来源说明，这里是唯一的「为什么这么做」）：

   1. **全程用十进制字符串处理，不经过 Number。** 这不是洁癖，是必须的：
      - `(1.005).toFixed(2)` 得到 `1.00`，因为 1.005 的双精度值其实是
        1.0049999999999998934 —— 用户输入的是十进制 `1.005`，期望 `1.01`。
        同理 `(8.575).toFixed(2)` → `8.57`、`(2.675).toFixed(2)` → `2.67`。
      - `Number('12345678901234567890')` → `12345678901234567000`，
        大整数一进 Number 就没了；`toLocaleString` 更把尾数显示成 `...567,000`。
      - `(1e21).toFixed(2)` → `1e+21`，超过 1e21 时 toFixed 直接放弃，
        小数位设置被无声忽略。
      所以本工具把输入拆成「符号 + 整数数字串 + 小数数字串 + 指数」，
      取整在数字串上按十进制进位做，分组、移位也都在字符串上完成。
      40 位以内的大整数结果**完全精确**，界面上会提示这一点。

   2. **不用 `toLocaleString` 做千分位。** 「千分位」不是一个确定的行为：
      `en-US` 给 `1,234,567.89`，`en-IN` 给 `12,34,567.89`（印度是 3-2-2 分组），
      `de-DE` 给 `1.234.567,89`。分组方式与分隔符都由用户显式选，
      印度式分组作为一个可选项列出来，而不是跟着宿主 locale 漂。

   3. **逗号只当千分位分隔符，位置不合法就报错。** `1,5` 在德语/法语里是 1.5，
      在英语里是 15 —— 猜错方向的代价太大，所以只接受
      `1,234,567` 这种分组位置合法的写法，其余情况明确报错让用户改成 `1.5`。

   4. **取整模式可显式选择**，默认四舍五入（远离零）。另外提供银行家舍入
      （取到偶数，做财务汇总时能避免系统性偏差）与截断。
      注意 `Math.round(-0.5)` 得到的是 `-0`（朝 +∞ 取整），
      而 `(-0.5).toFixed(0)` 是 `-1` —— 两者不一致，本工具统一按「远离零」处理。

   5. **人民币大写金额按《正确填写票据和结算凭证的基本规定》实现**，
      而不是简单地逐位翻译。规范里「元位是 0 而角位不是 0 时写不写『零』」
      是**可写可不写**（规定原文：「可只写一个『零』字，也可不写『零』字」），
      本工具统一**写**这个零（与规定中 ￥107,000.53 的示例一致，也更防涂改），
      并在说明区写明了这是规范允许的两种写法之一。

   6. **货币只做「符号 + 数字」，不做完整的 locale 货币排版。**
      `Intl.NumberFormat` 的货币样式会按 locale 决定符号位置、分组与小数位，
      那会和上面用户选的分组/小数位打架。这里用一张符号表 + 各币种的默认小数位
      （日元、韩元是 0 位），其余跟随用户的设置。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;

  /**
   * 依赖缺失时**不要静默 return** —— 结果区一片空白，光看页面完全看不出哪里坏了。
   */
  function bail(detail) {
    var box = document.getElementById('nf-rows');
    if (!box) return;
    var div = document.createElement('div');
    div.className = 'code-empty';
    var strong = document.createElement('strong');
    strong.textContent = '页面依赖的脚本没有加载成功';
    div.appendChild(strong);
    div.appendChild(document.createTextNode(
      detail + '请强制刷新（Ctrl+F5 / Cmd+Shift+R）后重试。'));
    box.textContent = '';
    box.appendChild(div);
  }

  if (!T || !T.util) {
    bail('js/registry.js 或 js/site.js 没有加载成功。');
    return;
  }
  if (typeof T.util.debounce !== 'function' || typeof T.util.emptyHint !== 'function') {
    bail('加载到的是旧版 js/site.js。');
    return;
  }

  var esc = T.util.esc;

  /* ======================================================================
     一、常量
     ====================================================================== */

  var MAX_DIGITS = 40;          /* 有效数字上限，避免离谱输入把页面撑死 */

  var DECIMAL_CHOICES = [
    { id: 'auto', name: '自动' },
    { id: '0', name: '0' }, { id: '1', name: '1' }, { id: '2', name: '2' },
    { id: '3', name: '3' }, { id: '4', name: '4' }, { id: '6', name: '6' },
    { id: '8', name: '8' }
  ];

  var GROUP_CHOICES = [
    { id: 'none', name: '不分组' },
    { id: 'west', name: '3 位分组' },
    { id: 'in',   name: '印度式 3-2-2' }
  ];

  var SEP_CHOICES = [
    { id: 'dot',   name: '1.23' },
    { id: 'comma', name: '1,23' }
  ];

  var ROUND_CHOICES = [
    { id: 'halfUp',   name: '四舍五入' },
    { id: 'halfEven', name: '银行家舍入' },
    { id: 'trunc',    name: '截断' }
  ];

  /* 货币符号与默认小数位。日元、韩元按惯例是 0 位小数。
     CNY 用 ¥、JPY 用 JP¥ —— 两者符号本来就撞车，加前缀区分。 */
  var CURRENCIES = [
    { code: 'CNY', symbol: '¥',   name: '人民币',   digits: 2 },
    { code: 'USD', symbol: '$',   name: '美元',     digits: 2 },
    { code: 'EUR', symbol: '€',   name: '欧元',     digits: 2 },
    { code: 'GBP', symbol: '£',   name: '英镑',     digits: 2 },
    { code: 'JPY', symbol: 'JP¥', name: '日元',     digits: 0 },
    { code: 'KRW', symbol: '₩',   name: '韩元',     digits: 0 },
    { code: 'HKD', symbol: 'HK$', name: '港元',     digits: 2 },
    { code: 'SGD', symbol: 'S$',  name: '新加坡元', digits: 2 },
    { code: 'INR', symbol: '₹',   name: '印度卢比', digits: 2 },
    { code: 'RUB', symbol: '₽',   name: '卢布',     digits: 2 }
  ];
  var CURRENCY_MAP = {};
  CURRENCIES.forEach(function (c) { CURRENCY_MAP[c.code] = c; });

  /* 人民币大写 */
  var CN_DIGIT = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  var CN_UNIT = ['', '拾', '佰', '仟'];
  var CN_SECTION = ['', '万', '亿', '万亿', '亿亿'];   /* 每 4 位一节 */

  /* ======================================================================
     二、十进制字符串的基本操作
     ====================================================================== */

  function repeat(s, n) {
    return n > 0 ? new Array(n + 1).join(s) : '';
  }

  /** 数字串加一（十进制进位）；"999" → "1000" */
  function incDigits(s) {
    var arr = s.split('');
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i] === '9') { arr[i] = '0'; continue; }
      arr[i] = String(Number(arr[i]) + 1);
      return arr.join('');
    }
    return '1' + arr.join('');
  }

  /** 末位是不是偶数（用于银行家舍入） */
  function lastIsEven(s) {
    var c = s.charAt(s.length - 1);
    return c !== '' && Number(c) % 2 === 0;
  }

  /**
   * 判断要不要进位。
   * @param {string} kept    保留部分的数字串（用来判断奇偶）
   * @param {string} dropped 被丢掉的部分
   * @param {string} mode    halfUp / halfEven / trunc
   */
  function shouldRoundUp(kept, dropped, mode) {
    var first = Number(dropped.charAt(0));
    if (first > 5) return true;
    if (first < 5) return false;
    /* 首位正好是 5：后面还有非零数字就一律进位（这时不是「正好一半」） */
    if (/[1-9]/.test(dropped.slice(1))) return true;
    if (mode === 'trunc') return false;
    if (mode === 'halfEven') return !lastIsEven(kept);
    return true;                              /* halfUp：远离零 */
  }

  /**
   * 按 d 位小数取整。全程在十进制数字串上做。
   * @returns {{int: string, frac: string}}
   */
  function roundDecimal(intPart, fracPart, d, mode) {
    if (d < 0) d = 0;
    if (fracPart.length <= d) {
      return { int: intPart, frac: fracPart + repeat('0', d - fracPart.length) };
    }
    var keep = fracPart.slice(0, d);
    if (!shouldRoundUp(intPart + keep, fracPart.slice(d), mode)) {
      return { int: intPart, frac: keep };
    }
    var bumped = incDigits(intPart + keep);
    /* 进位可能多出一位（999 → 1000），从尾部按 d 位切回来即可 */
    return {
      int: bumped.slice(0, bumped.length - d),
      frac: d ? bumped.slice(bumped.length - d) : ''
    };
  }

  /** 把小数点右移 shift 位（百分比就是 shift = 2） */
  function shiftDecimal(intPart, fracPart, shift) {
    var digits = intPart + fracPart;
    var pos = intPart.length + shift;
    if (pos <= 0) return { int: '0', frac: repeat('0', -pos) + digits };
    if (pos >= digits.length) {
      return { int: digits + repeat('0', pos - digits.length), frac: '' };
    }
    return { int: digits.slice(0, pos), frac: digits.slice(pos) };
  }

  /* ======================================================================
     三、分组
     ====================================================================== */

  function group3(s, sep) {
    var parts = [];
    for (var i = s.length; i > 0; i -= 3) {
      parts.unshift(s.slice(Math.max(0, i - 3), i));
    }
    return parts.join(sep);
  }

  /* 印度式：最后 3 位一组，再往前每 2 位一组。12345678 → 1,23,45,678 */
  function groupIndian(s, sep) {
    if (s.length <= 3) return s;
    var head = s.slice(0, s.length - 3);
    var parts = [];
    for (var i = head.length; i > 0; i -= 2) {
      parts.unshift(head.slice(Math.max(0, i - 2), i));
    }
    return parts.join(sep) + sep + s.slice(s.length - 3);
  }

  function groupDigits(s, style, sep) {
    if (style === 'none') return s;
    if (style === 'in') return groupIndian(s, sep);
    return group3(s, sep);
  }

  /* ======================================================================
     四、科学计数法 / 工程计数法
     ====================================================================== */

  /** 规范化的十进制 → { digits: '123456789', exp: 6 } 表示 d0.d1d2… × 10^exp */
  function sciParts(intPart, fracPart) {
    var combined = intPart + fracPart;
    var stripped = combined.replace(/^0+/, '');
    if (!stripped) return { digits: '0', exp: 0, zero: true };
    var lead = combined.length - stripped.length;
    return { digits: stripped, exp: intPart.length - 1 - lead, zero: false };
  }

  /** 把有效数字串取整到 sig 位；进位到多一位时用 expShift 记下 */
  function roundDigits(digits, sig, mode) {
    if (sig < 1) sig = 1;
    if (digits.length <= sig) return { digits: digits, expShift: 0 };
    var keep = digits.slice(0, sig);
    if (!shouldRoundUp(keep, digits.slice(sig), mode)) {
      return { digits: keep, expShift: 0 };
    }
    var bumped = incDigits(keep);
    if (bumped.length > sig) {
      /* 999 → 1000：指数 +1，末尾那位丢掉 */
      return { digits: bumped.slice(0, sig), expShift: 1 };
    }
    return { digits: bumped, expShift: 0 };
  }

  function expSuffix(exp) {
    return 'e' + (exp >= 0 ? '+' : '') + exp;
  }

  /** decimals 为 null 表示「自动」，显示全部有效数字 */
  function toScientific(sign, sp, decimals, mode) {
    if (sp.zero) return '0';
    var sig = decimals == null ? sp.digits.length : decimals + 1;
    var r = roundDigits(sp.digits, sig, mode);
    var exp = sp.exp + r.expShift;
    var frac = r.digits.slice(1);
    if (decimals != null) frac = (frac + repeat('0', decimals)).slice(0, decimals);
    return (sign < 0 ? '-' : '') + r.digits.charAt(0) +
      (frac ? '.' + frac : '') + expSuffix(exp);
  }

  /** 指数取 3 的倍数，整数部分保持 1–3 位 */
  function toEngineering(sign, sp, decimals, mode) {
    if (sp.zero) return '0';
    var exp = sp.exp;
    var e3 = Math.floor(exp / 3) * 3;
    var mantExp = exp - e3;
    var intLen = mantExp + 1;

    var digits = sp.digits;
    if (decimals != null) {
      var r = roundDigits(digits, intLen + decimals, mode);
      digits = r.digits;
      if (r.expShift) {
        /* 进位后整体大了一个数量级，指数与整数位数都要重算 */
        exp += 1;
        e3 = Math.floor(exp / 3) * 3;
        mantExp = exp - e3;
        intLen = mantExp + 1;
      }
    }

    var mantInt = (digits.slice(0, intLen) + repeat('0', intLen)).slice(0, intLen);
    var mantFrac = digits.slice(intLen);
    if (decimals != null) {
      mantFrac = (mantFrac + repeat('0', decimals)).slice(0, decimals);
    }
    return (sign < 0 ? '-' : '') + mantInt +
      (mantFrac ? '.' + mantFrac : '') + expSuffix(e3);
  }

  /* ======================================================================
     五、人民币大写金额
     ----------------------------------------------------------------------
     依据《正确填写票据和结算凭证的基本规定》。
     数字用壹贰叁…，单位用拾佰仟与万/亿节；连续的零只写一个，
     节末尾的零不写。
     ====================================================================== */

  /** 最多 4 位的数字串 → 中文（壹仟零贰拾） */
  function cnSection(s) {
    var out = '';
    var len = s.length;
    for (var i = 0; i < len; i++) {
      var d = Number(s.charAt(i));
      var pos = len - 1 - i;
      if (d === 0) {
        if (out && !/零$/.test(out)) out += '零';
      } else {
        out += CN_DIGIT[d] + CN_UNIT[pos];
      }
    }
    return out.replace(/零+$/, '');
  }

  /** 整数部分 → 中文大写（不含「元」） */
  function cnInteger(s) {
    if (!/[1-9]/.test(s)) return '';

    var sections = [];
    var str = s;
    while (str.length > 0) {
      var cut = Math.max(0, str.length - 4);
      sections.unshift(str.slice(cut));
      str = str.slice(0, cut);
    }

    var out = '';
    var n = sections.length;
    for (var i = 0; i < n; i++) {
      var sec = sections[i];
      var secNum = Number(sec);
      if (secNum === 0) {
        /* 整节为零：后面还有非零节时才补一个零 */
        var restNonZero = sections.slice(i + 1).some(function (x) { return Number(x) > 0; });
        if (out && restNonZero && !/零$/.test(out)) out += '零';
        continue;
      }
      /* 这一节不满 4 位且首位是 0，说明和上一节之间隔了零 */
      if (out && sec.length === 4 && sec.charAt(0) === '0' && !/零$/.test(out)) out += '零';
      out += cnSection(sec) + (CN_SECTION[n - 1 - i] || '');
    }
    return out.replace(/零+$/, '');
  }

  /** 规范化十进制 → 人民币大写金额 */
  function toChineseAmount(sign, intPart, fracPart, mode) {
    var r = roundDecimal(intPart, fracPart, 2, mode);
    var yuan = r.int;
    var jiao = r.frac.charAt(0) || '0';
    var fen = r.frac.charAt(1) || '0';

    var intCn = cnInteger(yuan);
    var out = sign < 0 ? '负' : '';

    if (intCn) {
      out += intCn + '元';
      /* 元位是 0 而角位不是 0 —— 规范允许写或不写这个「零」，本工具统一写 */
      if (jiao !== '0' && yuan.charAt(yuan.length - 1) === '0') out += '零';
    }
    if (jiao !== '0') out += CN_DIGIT[Number(jiao)] + '角';
    else if (intCn && fen !== '0') out += '零';
    if (fen !== '0') out += CN_DIGIT[Number(fen)] + '分';

    if (!out || out === '负') return '零元整';
    if (fen === '0') out += '整';
    return out;
  }

  /* ======================================================================
     六、解析
     ====================================================================== */

  /* 符号 + 整数位 + 小数位 + 指数。整数位与小数位可以有一边为空，但不能都空。 */
  var INPUT_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
  /* 合法的千分位写法（整数部分按 3 位分组） */
  var GROUPED_RE = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?(?:[eE][+-]?\d+)?$/;

  function parseDecimal(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return { kind: 'empty' };

    /* 下划线、各类空格、撇号是常见的数字分组写法，直接剥掉 */
    s = s.replace(/[_\s\u00a0\u202f\u2009\u2019']/g, '');

    /* 逗号只当千分位分隔符，且必须落在合法的分组位置上。
       「1,5」在德语里是 1.5、在英语里是 15 —— 猜错方向的代价太大，直接报错。 */
    if (s.indexOf(',') >= 0) {
      if (!GROUPED_RE.test(s)) return { kind: 'bad', reason: 'comma' };
      s = s.replace(/,/g, '');
    }

    var m = INPUT_RE.exec(s);
    if (!m || (!m[2] && !m[3])) return { kind: 'bad', reason: 'notNumber' };

    var exp = m[4] ? Number(m[4]) : 0;
    if (!isFinite(exp) || Math.abs(exp) > 100) return { kind: 'bad', reason: 'expRange' };

    /* 把指数折进小数点位置，得到规范形式 */
    var digits = (m[2] || '') + (m[3] || '');
    var pos = (m[2] || '').length + exp;
    var intPart, fracPart;

    if (pos <= 0) {
      intPart = '0';
      fracPart = repeat('0', -pos) + digits;
    } else if (pos >= digits.length) {
      intPart = digits + repeat('0', pos - digits.length);
      fracPart = '';
    } else {
      intPart = digits.slice(0, pos);
      fracPart = digits.slice(pos);
    }

    intPart = intPart.replace(/^0+(?=\d)/, '');
    fracPart = fracPart.replace(/0+$/, '');

    if (intPart.replace(/^0+/, '').length + fracPart.length > MAX_DIGITS) {
      return { kind: 'bad', reason: 'tooLong' };
    }

    return {
      kind: 'ok',
      sign: m[1] === '-' ? -1 : 1,
      int: intPart,
      frac: fracPart,
      exp: exp,
      hadSeparator: /[,_\s\u00a0\u202f\u2009\u2019']/.test(String(raw == null ? '' : raw))
    };
  }

  /* ======================================================================
     七、DOM
     ====================================================================== */

  var inputEl   = document.getElementById('nf-input');
  var decEl     = document.getElementById('nf-decimals');
  var groupEl   = document.getElementById('nf-group');
  var sepEl     = document.getElementById('nf-sep');
  var roundEl   = document.getElementById('nf-round');
  var currEl    = document.getElementById('nf-currency');
  var mainBox   = document.getElementById('nf-main');
  var mainText  = document.getElementById('nf-main-text');
  var rowsEl    = document.getElementById('nf-rows');
  var statsEl   = document.getElementById('nf-stats');
  var statusEl  = document.getElementById('nf-status');
  var copyAllBtn = document.getElementById('nf-copy-all');
  var copyBtn   = document.getElementById('nf-copy');

  if (!inputEl || !rowsEl || !mainText) return;
  if (!decEl || !groupEl || !sepEl || !roundEl || !currEl || !statsEl || !statusEl) {
    bail('页面结构不完整（缺选项控件）。');
    return;
  }

  var state = {
    decimals: 'auto', group: 'west', sep: 'dot', round: 'halfUp', currency: 'CNY'
  };

  /* ======================================================================
     八、渲染
     ====================================================================== */

  function row(id, label, value) {
    return '<button class="value-row" type="button" title="点击复制" ' +
      'data-copy-target="#nf-v-' + id + '">' +
      '<span class="value-label">' + esc(label) + '</span>' +
      '<span class="value-text" id="nf-v-' + id + '">' + esc(value) + '</span>' +
      '</button>';
  }

  function setCopyable(on) {
    [mainBox, copyBtn].forEach(function (b) {
      if (!b) return;
      if (on) b.setAttribute('data-copy-target', '#nf-main-text');
      else b.removeAttribute('data-copy-target');
    });
  }

  function stat(label, value) {
    return '<div class="stat"><div class="stat-label">' + esc(label) + '</div>' +
      '<div class="stat-value stat-value--sm">' + esc(value) + '</div></div>';
  }

  function renderEmpty(message) {
    mainText.textContent = '—';
    setCopyable(false);
    T.util.emptyHint(rowsEl, '还没有输入数字', '在左上角填一个数字，这里会列出它的各种格式化写法。');
    statsEl.innerHTML = '';
    statusEl.innerHTML = message || '输入一个数字';
  }

  function renderError(reason, raw) {
    mainText.textContent = '—';
    setCopyable(false);
    T.util.emptyHint(rowsEl, '解析不了这段输入', REASON_HINT[reason] || REASON_HINT.notNumber);
    statsEl.innerHTML = '';
    statusEl.innerHTML = '<span class="is-error">' + esc(REASON_TEXT[reason] || REASON_TEXT.notNumber) +
      '</span><span class="err-raw">原始输入：' + esc(raw) + '</span>';
  }

  var REASON_TEXT = {
    comma: '逗号只能当千分位分隔符，位置不合法',
    notNumber: '不是一个合法的数字',
    expRange: '指数超出 ±100',
    tooLong: '有效数字超过 ' + MAX_DIGITS + ' 位'
  };
  var REASON_HINT = {
    comma: '只接受 1,234,567 这种三位分组。如果你的 1,5 表示一点五，请写成 1.5。',
    notNumber: '接受整数、小数与科学计数法（如 1.23e-4），可以带千分位逗号或下划线。',
    expRange: '指数超过 ±100 的数字没有实际用途，这里直接拦掉。',
    tooLong: '超过 ' + MAX_DIGITS + ' 位有效数字的输入不再处理。'
  };

  function renderResult(p, opts) {
    var sign = p.sign;
    var d = opts.decimals;                       /* null = 自动 */
    var mode = opts.round;

    /* 主口径：按小数位取整后的值。
       选了固定小数位就**保留**到那一位（1.5 显示成 1.50），
       选「自动」时 p.frac 本来就是去掉尾零的。 */
    var auto = d == null ? p.frac.length : d;
    var rounded = roundDecimal(p.int, p.frac, auto, mode);
    var groupSep = opts.sep === 'dot' ? ',' : '.';
    var decSep = opts.sep === 'dot' ? '.' : ',';

    function signed(text) {
      return (sign < 0 && /[1-9]/.test(text) ? '-' : '') + text;
    }

    function plain(g, sep) {
      var body = g === 'none' ? rounded.int : groupDigits(rounded.int, g, sep);
      return signed(body + (rounded.frac ? decSep + rounded.frac : ''));
    }

    var mainValue = plain(opts.group, groupSep);
    mainText.textContent = mainValue;
    setCopyable(true);

    /* 科学 / 工程：小数位在这里表示尾数的小数位 */
    var sp = sciParts(rounded.int, rounded.frac);
    var sci = toScientific(sign, sp, d, mode);
    var eng = toEngineering(sign, sp, d, mode);

    /* 百分比：小数点右移两位再取整。
       「自动」时的小数位要减掉移走的两位 —— 1234.56 变成 123456，不再需要小数。 */
    var shifted = shiftDecimal(p.int, p.frac, 2);
    var pDec = d == null ? Math.max(0, p.frac.length - 2) : d;
    var pr = roundDecimal(shifted.int, shifted.frac, pDec, mode);
    var pInt = pr.int.replace(/^0+(?=\d)/, '');
    var percent = signed(groupDigits(pInt, opts.group, groupSep) +
      (pr.frac ? decSep + pr.frac : '') + '%');

    /* 货币：小数位「自动」时跟随该币种的惯例（日元 0 位） */
    var cur = CURRENCY_MAP[opts.currency] || CURRENCIES[0];
    var cr = roundDecimal(p.int, p.frac, d == null ? cur.digits : d, mode);
    var money = signed(cur.symbol + groupDigits(cr.int, opts.group, groupSep) +
      (cr.frac ? decSep + cr.frac : ''));

    /* 代码字面量：小数点固定用 . 与 _ 分组，方便直接粘进源码 */
    var literal = signed(group3(rounded.int, '_') +
      (rounded.frac ? '.' + rounded.frac : ''));

    var cn = toChineseAmount(sign, p.int, p.frac, mode);

    rowsEl.innerHTML =
      row('plain', '无分组', plain('none', groupSep)) +
      row('literal', '代码字面量', literal) +
      row('sci', '科学计数法', sci) +
      row('eng', '工程计数法', eng) +
      row('pct', '百分比（×100）', percent) +
      row('money', '货币（' + cur.code + '）', money) +
      row('cn', '人民币大写', cn);

    renderStats(p);
    renderStatus(p, opts);
  }

  /* 2^53 − 1，用来判断整数部分会不会在浮点数里丢精度 */
  var SAFE_INT = '9007199254740991';

  function isSafeIntegerStr(s) {
    var t = s.replace(/^0+/, '') || '0';
    if (t.length !== SAFE_INT.length) return t.length < SAFE_INT.length;
    return t <= SAFE_INT;
  }

  function renderStats(p) {
    var intDigits = p.int.replace(/^0+/, '').length;
    var sp = sciParts(p.int, p.frac);
    statsEl.innerHTML =
      stat('整数位', intDigits ? intDigits + ' 位' : '0') +
      stat('小数位', p.frac.length + ' 位') +
      stat('数量级', sp.zero ? '0' : '10^' + sp.exp) +
      stat('精度', isSafeIntegerStr(p.int) ? '安全' : '超 2^53');
  }

  function renderStatus(p, opts) {
    var parts = ['已解析为 ' + (p.sign < 0 ? '-' : '') + p.int + (p.frac ? '.' + p.frac : '')];

    if (p.hadSeparator) parts.push('已剥掉输入里的分隔符');

    var html = esc(parts.join(' · '));

    if (!isSafeIntegerStr(p.int)) {
      html += '<span class="is-warn"> · 整数位超过 2^53，浮点数存不下；' +
        '本工具按十进制字符串计算，上面的结果仍然精确</span>';
    }
    if (opts.decimals == null) {
      html += '<span class="faint"> · 小数位为「自动」，原样保留</span>';
    }
    statusEl.innerHTML = html;
  }

  /* ======================================================================
     九、主流程
     ====================================================================== */

  /* 选项要在这里就归一化成「null 或数字」再传下去 ——
     'auto' 这个字符串一旦漏进 roundDecimal，`slice(0, 'auto')` 会退化成
     `slice(0, 0)`，结果被静默算错。 */
  function currentOpts() {
    return {
      decimals: state.decimals === 'auto' ? null : Number(state.decimals),
      group: state.group,
      sep: state.sep,
      round: state.round,
      currency: state.currency
    };
  }

  function update() {
    var raw = inputEl.value;
    var p = parseDecimal(raw);
    if (p.kind === 'empty') { renderEmpty(); return; }
    if (p.kind === 'bad') { renderError(p.reason, raw.trim()); return; }
    renderResult(p, currentOpts());
  }

  var debounced = T.util.debounce(update, 90);

  function chipRow(box, choices, current, attr) {
    box.innerHTML = choices.map(function (c) {
      return '<button class="choice-chip" type="button" data-' + attr + '="' + c.id + '" ' +
        'aria-pressed="' + (c.id === current) + '">' + esc(c.name) + '</button>';
    }).join('');
  }

  function syncChips(box, attr, current) {
    T.util.$$('.choice-chip', box).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-' + attr) === current));
    });
  }

  function bindChips(box, attr, key) {
    box.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-' + attr + ']');
      if (!chip) return;
      state[key] = chip.getAttribute('data-' + attr);
      syncChips(box, attr, state[key]);
      update();
    });
  }

  /* ======================================================================
     十、事件
     ====================================================================== */

  inputEl.addEventListener('input', debounced);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); update(); }
  });

  bindChips(decEl, 'dec', 'decimals');
  bindChips(groupEl, 'group', 'group');
  bindChips(sepEl, 'sep', 'sep');
  bindChips(roundEl, 'round', 'round');

  currEl.addEventListener('change', function () {
    state.currency = currEl.value;
    update();
  });

  if (copyAllBtn) {
    copyAllBtn.addEventListener('click', function () {
      var p = parseDecimal(inputEl.value);
      if (p.kind !== 'ok') { T.util.toast('还没有可复制的内容'); return; }
      var lines = ['普通数字\t' + mainText.textContent];
      T.util.$$('.value-row', rowsEl).forEach(function (r) {
        lines.push(r.querySelector('.value-label').textContent + '\t' +
          r.querySelector('.value-text').textContent);
      });
      T.util.copy(lines.join('\n'), copyAllBtn);    });
  }

  /* ======================================================================
     十一、首屏
     ====================================================================== */

  chipRow(decEl, DECIMAL_CHOICES, state.decimals, 'dec');
  chipRow(groupEl, GROUP_CHOICES, state.group, 'group');
  chipRow(sepEl, SEP_CHOICES, state.sep, 'sep');
  chipRow(roundEl, ROUND_CHOICES, state.round, 'round');

  currEl.innerHTML = CURRENCIES.map(function (c) {
    return '<option value="' + c.code + '"' + (c.code === state.currency ? ' selected' : '') + '>' +
      esc(c.name + ' ' + c.code + '（' + c.symbol + '）') + '</option>';
  }).join('');

  update();                     /* 首屏同步渲染，不走防抖 */
})();
