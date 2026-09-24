/* ==========================================================================
   unit-converter.js — 单位换算
   --------------------------------------------------------------------------
   自研工具：参考仓库 jamalofski/praticulus 里没有对应实现。

   设计取舍（自研工具没有上游来源说明，这里是唯一的「为什么这么做」）：

   1. **温度不走系数表。** 摄氏、华氏、兰氏都有零点偏移，用「基准值 × 系数」
      根本算不出来。所以单位表里每一项要么给系数 `k`，要么给 `toBase` /
      `fromBase` 一对函数 —— 两种形态共用同一条换算流程，不为温度单开分支。
      这也是「只考虑一种情况」的典型坑：把温度塞进系数表的实现，
      换 °C → °F 会得到「1 °C = 33.8 °F」这种错一个数量级的结果。
   2. **数据存储把两套前缀并排列出。** 1000 进制的 kB / MB / GB（SI 前缀）与
      1024 进制的 KiB / MiB / GiB（IEC 60027-2）都列，且单位名里写清进制 ——
      「买来 1 TB 的硬盘在系统里只显示 931 GiB」就是这两套混用的结果。
      只给一套的话，用户根本无从发现自己在混用。
   3. **精确定义与测量值分开标注。** 英寸 = 2.54 cm、磅 = 0.45359237 kg、
      美制加仑 = 231 in³、海里 = 1852 m 这些都是国际协定的**定义值**（精确），
      不是量出来的近似值。凡属此类打「精确定义」标记，其余（如市亩）老实说明。
   4. **不给马赫数。** 马赫是相对量，声速随温度与介质变化（海平面 15 °C 约
      340.3 m/s，一万米高空只有约 295 m/s），不存在一个固定系数。
      给一个数比不给更糟 —— 用户会拿它当真。
   5. **精度用 `toPrecision` 收敛浮点噪声**，不自己乘除 10 的幂：
      `Math.round(v * 10 ** n) / 10 ** n` 会把 0.3 算成 0.30000000000000004，
      而 `Number(v.toPrecision(n))` 会回到最接近 0.3 的那个双精度值。
   6. **低于绝对零度只警告不拦截。** 用户可能就是在算温差（-300 °C 到 -200 °C
      的差），直接拦住反而没法用。
   7. **不做「单位别名模糊匹配 / 前缀自动展开」。** 单位表是封闭的，
      下拉里选不出来的就是不支持 —— 猜用户想输入 "meter" 还是 "metre"、
      "kb" 是 kB 还是 KiB，猜错的代价比让用户多选一次大得多。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;

  /**
   * 依赖缺失时**不要静默 return** —— 结果区一片空白，光看页面完全看不出哪里坏了。
   * 这种情形几乎都是「浏览器拿到了旧资源」，所以提示里直接给出强制刷新的办法。
   */
  function bail(detail) {
    var box = document.getElementById('uc-list');
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
     一、单位表
     ----------------------------------------------------------------------
     基准单位：长度 / 面积 / 体积 / 质量 / 速度 / 数据存储 / 时间 / 角度
       用「到基准单位的系数 k」表示；角度用弧度做基准，`k` 里含 π。
     温度
       基准是开尔文，各项给 toBase / fromBase（见文件头第 1 条）。

     字段：
       k      到基准单位的系数（与 toBase 二选一）
       exact  该系数是国际协定的定义值，而不是测量值
       note   显示在单位下方的一句话说明
     ====================================================================== */

  var DEG = Math.PI / 180;

  var CATS = [
    {
      id: 'length', name: '长度', base: '米', from: 'm', to: 'ft',
      units: [
        { id: 'nm',  name: '纳米',   sym: 'nm',  k: 1e-9 },
        { id: 'um',  name: '微米',   sym: 'µm',  k: 1e-6 },
        { id: 'mm',  name: '毫米',   sym: 'mm',  k: 1e-3 },
        { id: 'cm',  name: '厘米',   sym: 'cm',  k: 1e-2 },
        { id: 'm',   name: '米',     sym: 'm',   k: 1, exact: true,
          note: '国际单位制基本单位' },
        { id: 'km',  name: '千米',   sym: 'km',  k: 1e3, exact: true,
          note: '1 km = 1000 m' },
        { id: 'in',  name: '英寸',   sym: 'in',  k: 0.0254, exact: true,
          note: '1959 年国际码磅协定定为 2.54 cm' },
        { id: 'ft',  name: '英尺',   sym: 'ft',  k: 0.3048, exact: true,
          note: '1 ft = 12 in' },
        { id: 'yd',  name: '码',     sym: 'yd',  k: 0.9144, exact: true,
          note: '1 yd = 3 ft' },
        { id: 'mi',  name: '英里',   sym: 'mi',  k: 1609.344, exact: true,
          note: '1 mi = 5280 ft' },
        { id: 'nmi', name: '海里',   sym: 'nmi', k: 1852, exact: true,
          note: '1954 年国际水文会议定为 1852 m' }
      ]
    },
    {
      id: 'area', name: '面积', base: '平方米', from: 'm2', to: 'ft2',
      units: [
        { id: 'mm2', name: '平方毫米', sym: 'mm²', k: 1e-6 },
        { id: 'cm2', name: '平方厘米', sym: 'cm²', k: 1e-4 },
        { id: 'm2',  name: '平方米',   sym: 'm²',  k: 1 },
        { id: 'ha',  name: '公顷',     sym: 'ha',  k: 1e4, exact: true,
          note: '1 ha = 10000 m²' },
        { id: 'km2', name: '平方千米', sym: 'km²', k: 1e6, exact: true,
          note: '1 km² = 100 ha' },
        { id: 'mu',  name: '市亩',     sym: '亩',  k: 2000 / 3,
          note: '1 公顷 = 15 亩，即 1 亩 = 2000/3 m²（约 666.67 m²）' },
        { id: 'in2', name: '平方英寸', sym: 'in²', k: 0.00064516, exact: true,
          note: '0.0254² 精确' },
        { id: 'ft2', name: '平方英尺', sym: 'ft²', k: 0.09290304, exact: true,
          note: '0.3048² 精确' },
        { id: 'yd2', name: '平方码',   sym: 'yd²', k: 0.83612736, exact: true,
          note: '0.9144² 精确' },
        { id: 'ac',  name: '英亩',     sym: 'ac',  k: 4046.8564224, exact: true,
          note: '1 ac = 4840 yd²' },
        { id: 'mi2', name: '平方英里', sym: 'mi²', k: 2589988.110336, exact: true,
          note: '1 mi² = 640 ac' }
      ]
    },
    {
      id: 'volume', name: '体积', base: '立方米', from: 'l', to: 'galus',
      units: [
        { id: 'ml',  name: '毫升',       sym: 'mL',       k: 1e-6, exact: true,
          note: '1 mL = 1 cm³' },
        { id: 'cm3', name: '立方厘米',   sym: 'cm³',      k: 1e-6, exact: true },
        { id: 'l',   name: '升',         sym: 'L',        k: 1e-3, exact: true,
          note: '1 L = 1 dm³ = 1000 mL' },
        { id: 'm3',  name: '立方米',     sym: 'm³',       k: 1 },
        { id: 'in3', name: '立方英寸',   sym: 'in³',      k: 1.6387064e-5, exact: true,
          note: '0.0254³ 精确' },
        { id: 'ft3', name: '立方英尺',   sym: 'ft³',      k: 0.028316846592, exact: true,
          note: '0.3048³ 精确' },
        { id: 'galus', name: '美制加仑', sym: 'gal (US)', k: 0.003785411784, exact: true,
          note: '231 in³ 精确' },
        { id: 'galuk', name: '英制加仑', sym: 'gal (UK)', k: 0.00454609, exact: true,
          note: '1 gal = 4.54609 L' },
        { id: 'flozus', name: '美制液量盎司', sym: 'fl oz (US)', k: 2.95735295625e-5, exact: true,
          note: '1/128 美制加仑' },
        { id: 'flozuk', name: '英制液量盎司', sym: 'fl oz (UK)', k: 2.84130625e-5, exact: true,
          note: '1/160 英制加仑' }
      ]
    },
    {
      id: 'mass', name: '质量', base: '千克', from: 'kg', to: 'lb',
      units: [
        { id: 'ug', name: '微克', sym: 'µg', k: 1e-9 },
        { id: 'mg', name: '毫克', sym: 'mg', k: 1e-6 },
        { id: 'g',  name: '克',   sym: 'g',  k: 1e-3 },
        { id: 'kg', name: '千克', sym: 'kg', k: 1, exact: true,
          note: '国际单位制基本单位' },
        { id: 't',  name: '吨',   sym: 't',  k: 1e3, exact: true,
          note: '1 t = 1000 kg' },
        { id: 'jin', name: '市斤', sym: '斤', k: 0.5, exact: true,
          note: '1 市斤 = 500 g' },
        { id: 'oz', name: '盎司', sym: 'oz', k: 0.028349523125, exact: true,
          note: '常衡盎司，1 lb = 16 oz' },
        { id: 'lb', name: '磅',   sym: 'lb', k: 0.45359237, exact: true,
          note: '常衡磅，1959 年国际码磅协定定为 0.45359237 kg' },
        { id: 'st', name: '英石', sym: 'st', k: 6.35029318, exact: true,
          note: '1 st = 14 lb' }
      ]
    },
    {
      id: 'temperature', name: '温度', base: '开尔文', from: 'c', to: 'f',
      units: [
        { id: 'c', name: '摄氏度', sym: '°C', exact: true,
          note: '0 °C = 273.15 K（水的冰点），1 °C 的间隔 = 1 K',
          toBase: function (v) { return v + 273.15; },
          fromBase: function (v) { return v - 273.15; } },
        { id: 'f', name: '华氏度', sym: '°F', exact: true,
          note: '32 °F = 0 °C，212 °F = 100 °C，1 °F 的间隔 = 5/9 K',
          toBase: function (v) { return (v + 459.67) * 5 / 9; },
          fromBase: function (v) { return v * 9 / 5 - 459.67; } },
        { id: 'k', name: '开尔文', sym: 'K', exact: true,
          note: '国际单位制基本单位，0 K 是绝对零度',
          toBase: function (v) { return v; },
          fromBase: function (v) { return v; } },
        { id: 'r', name: '兰氏度', sym: '°R', exact: true,
          note: '0 °R = 绝对零度，1 °R 的间隔 = 5/9 K',
          toBase: function (v) { return v * 5 / 9; },
          fromBase: function (v) { return v * 9 / 5; } }
      ]
    },
    {
      id: 'speed', name: '速度', base: '米/秒', from: 'kmh', to: 'mph',
      units: [
        { id: 'mps', name: '米/秒',     sym: 'm/s',  k: 1 },
        { id: 'kmh', name: '千米/小时', sym: 'km/h', k: 1 / 3.6, exact: true,
          note: '1000 m ÷ 3600 s' },
        { id: 'fps', name: '英尺/秒',   sym: 'ft/s', k: 0.3048, exact: true },
        { id: 'mph', name: '英里/小时', sym: 'mph',  k: 0.44704, exact: true,
          note: '1 mi/h，精确' },
        { id: 'kn',  name: '节',        sym: 'kn',   k: 1852 / 3600, exact: true,
          note: '1 海里/小时，精确' }
      ]
    },
    {
      id: 'data', name: '数据存储', base: '字节', from: 'mb', to: 'mib',
      units: [
        { id: 'bit', name: '比特',     sym: 'bit', k: 0.125, exact: true,
          note: '1 B = 8 bit' },
        { id: 'b',   name: '字节',     sym: 'B',   k: 1, exact: true },
        { id: 'kb',  name: '千字节',   sym: 'kB',  k: 1e3, exact: true,
          note: 'SI 前缀 10³' },
        { id: 'mb',  name: '兆字节',   sym: 'MB',  k: 1e6, exact: true,
          note: 'SI 前缀 10⁶' },
        { id: 'gb',  name: '吉字节',   sym: 'GB',  k: 1e9, exact: true,
          note: 'SI 前缀 10⁹' },
        { id: 'tb',  name: '太字节',   sym: 'TB',  k: 1e12, exact: true,
          note: 'SI 前缀 10¹²' },
        { id: 'pb',  name: '拍字节',   sym: 'PB',  k: 1e15, exact: true,
          note: 'SI 前缀 10¹⁵' },
        { id: 'kib', name: '千比字节', sym: 'KiB', k: 1024, exact: true,
          note: 'IEC 二进制前缀 2¹⁰' },
        { id: 'mib', name: '兆比字节', sym: 'MiB', k: 1048576, exact: true,
          note: 'IEC 二进制前缀 2²⁰' },
        { id: 'gib', name: '吉比字节', sym: 'GiB', k: 1073741824, exact: true,
          note: 'IEC 二进制前缀 2³⁰' },
        { id: 'tib', name: '太比字节', sym: 'TiB', k: 1099511627776, exact: true,
          note: 'IEC 二进制前缀 2⁴⁰' }
      ]
    },
    {
      id: 'time', name: '时间', base: '秒', from: 'min', to: 'h',
      units: [
        { id: 'ms',  name: '毫秒',   sym: 'ms',  k: 1e-3, exact: true },
        { id: 's',   name: '秒',     sym: 's',   k: 1, exact: true,
          note: '国际单位制基本单位' },
        { id: 'min', name: '分钟',   sym: 'min', k: 60, exact: true },
        { id: 'h',   name: '小时',   sym: 'h',   k: 3600, exact: true },
        { id: 'd',   name: '天',     sym: 'd',   k: 86400, exact: true },
        { id: 'wk',  name: '周',     sym: 'wk',  k: 604800, exact: true },
        { id: 'yr',  name: '儒略年', sym: 'a',   k: 31557600, exact: true,
          note: '365.25 天，精确；公历年的长度不固定（365 或 366 天）' }
      ]
    },
    {
      id: 'angle', name: '角度', base: '弧度', from: 'deg', to: 'rad',
      units: [
        { id: 'rad', name: '弧度', sym: 'rad',  k: 1, exact: true },
        { id: 'deg', name: '度',   sym: '°',    k: DEG, exact: true,
          note: '180° = π rad；计算按 π 的双精度浮点值进行' },
        { id: 'grad', name: '梯度', sym: 'gon', k: Math.PI / 200, exact: true,
          note: '400 gon = 360°，1 gon = 0.9°' },
        { id: 'turn', name: '转',   sym: 'turn', k: Math.PI * 2, exact: true,
          note: '1 turn = 360°' },
        { id: 'arcmin', name: '角分', sym: '′', k: Math.PI / 10800, exact: true,
          note: '1° = 60′' },
        { id: 'arcsec', name: '角秒', sym: '″', k: Math.PI / 648000, exact: true,
          note: '1′ = 60″' }
      ]
    }
  ];

  var CAT_MAP = {};
  CATS.forEach(function (c) {
    CAT_MAP[c.id] = c;
    c.unitMap = {};
    c.units.forEach(function (u) { c.unitMap[u.id] = u; });
  });

  /* 精度档位：有效数字位数。6 位是工程上常用的默认值。 */
  var SIG_CHOICES = [4, 6, 8, 10, 12];
  var SIG_DEFAULT = 6;

  /* ======================================================================
     二、换算与格式化
     ====================================================================== */

  /** 该单位到基准单位的值 */
  function toBase(u, v) {
    return u.toBase ? u.toBase(v) : v * u.k;
  }

  /** 基准单位到该单位的值 */
  function fromBase(u, v) {
    return u.fromBase ? u.fromBase(v) : v / u.k;
  }

  /**
   * 按有效数字格式化。
   *
   * 关键点：用 `toPrecision` 而不是自己乘除 10 的幂 —— 后者会把 0.3 变成
   * 0.30000000000000004（浮点噪声），而 `Number(v.toPrecision(n))` 会把
   * 十进制字符串解析回最接近的双精度值，噪声自然消失。
   *
   * 太大或太小的值改用指数写法：1 bit 换成 PB 是 1.25e-16，
   * 写成小数要 16 个 0，没人会去数。
   */
  function fmt(v, sig) {
    if (!isFinite(v)) return '—';
    if (v === 0) return '0';                 /* 含 -0 */
    var a = Math.abs(v);

    if (a >= 1e15 || a < 1e-6) {
      var parts = v.toExponential(sig - 1).split('e');
      var mant = parts[0];
      if (mant.indexOf('.') >= 0) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
      return mant + 'e' + parts[1];
    }
    return String(Number(v.toPrecision(sig)));
  }

  /* 接受：整数、小数、.5 这种省略整数位的写法、科学计数法、正负号。
     不接受：千分位逗号、十六进制、Infinity / NaN —— 猜错了比报错更难查。 */
  var NUM_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

  function parseNumber(raw) {
    if (!NUM_RE.test(raw)) return null;
    var n = Number(raw);
    return isFinite(n) ? n : null;
  }

  /* ======================================================================
     三、DOM
     ====================================================================== */

  var catsEl    = document.getElementById('uc-cats');
  var sigSel    = document.getElementById('uc-sig');
  var valueEl   = document.getElementById('uc-value');
  var fromSel   = document.getElementById('uc-from');
  var fromInfo  = document.getElementById('uc-from-info');
  var toSel     = document.getElementById('uc-to');
  var toInfo    = document.getElementById('uc-to-info');
  var swapBtn   = document.getElementById('uc-swap');
  var resultBox = document.getElementById('uc-result');        /* 整块可点的结果 */
  var copyBtn   = document.getElementById('uc-copy');          /* 面板头的「复制」 */
  var resultText = document.getElementById('uc-result-text');
  var statusEl  = document.getElementById('uc-status');
  var listEl    = document.getElementById('uc-list');
  var copyAllBtn = document.getElementById('uc-copy-all');

  if (!catsEl || !valueEl || !fromSel || !toSel || !resultText || !listEl) return;

  var state = { cat: 'length', from: 'm', to: 'ft', value: 1, sig: SIG_DEFAULT };

  /* ======================================================================
     四、渲染
     ====================================================================== */

  /** 单位下方的一句话说明：定义关系 + 备注；精确定义的加标记 */
  function unitInfoHtml(u, cat) {
    var html = '';
    if (u.exact) html += '<span class="uc-exact">精确定义</span>';

    var parts = [];
    /* 基准单位自己不用写「1 米 = 1 米」 */
    if (typeof u.k === 'number' && u.k !== 1) {
      parts.push('1 ' + u.name + ' = ' + fmt(u.k, 12) + ' ' + cat.base);
    }
    if (u.note) parts.push(u.note);
    if (!parts.length) parts.push('本分类的基准单位');

    return html + esc(parts.join(' · '));
  }

  function syncCats() {
    T.util.$$('.choice-chip', catsEl).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-cat') === state.cat));
    });
  }

  function renderCats() {
    catsEl.innerHTML = CATS.map(function (c) {
      return '<button class="choice-chip" type="button" data-cat="' + c.id + '" ' +
        'aria-pressed="' + (c.id === state.cat) + '">' + esc(c.name) + '</button>';
    }).join('');
  }

  function renderSigs() {
    sigSel.innerHTML = SIG_CHOICES.map(function (n) {
      return '<option value="' + n + '"' + (n === state.sig ? ' selected' : '') + '>' + n + '</option>';
    }).join('');
  }

  function renderUnits() {
    var cat = CAT_MAP[state.cat];
    var opts = cat.units.map(function (u) {
      return '<option value="' + u.id + '">' + esc(u.name + '（' + u.sym + '）') + '</option>';
    }).join('');
    fromSel.innerHTML = opts;
    toSel.innerHTML = opts;
    fromSel.value = state.from;
    toSel.value = state.to;
  }

  /** 结果区没有内容时，把两个复制入口的 data-copy-target 都摘掉 ——
      否则点一下会把占位的那个「—」复制走 */
  function setCopyable(on) {
    [resultBox, copyBtn].forEach(function (b) {
      if (!b) return;
      if (on) b.setAttribute('data-copy-target', '#uc-result-text');
      else b.removeAttribute('data-copy-target');
    });
  }

  /** 输入框为空：结果与列表都进入空状态 */
  function renderEmpty() {
    var cat = CAT_MAP[state.cat];
    resultText.textContent = '—';
    setCopyable(false);
    T.util.emptyHint(listEl, '还没有输入数值', '在左上角填一个数字，这里会列出它换算成全部单位的结果。');
    statusEl.textContent = '输入一个数值开始换算';
    fromInfo.innerHTML = unitInfoHtml(cat.unitMap[state.from], cat);
    toInfo.innerHTML = unitInfoHtml(cat.unitMap[state.to], cat);
  }

  function render() {
    var cat = CAT_MAP[state.cat];
    var fromU = cat.unitMap[state.from];
    var toU = cat.unitMap[state.to];
    var sig = state.sig;

    fromInfo.innerHTML = unitInfoHtml(fromU, cat);
    toInfo.innerHTML = unitInfoHtml(toU, cat);

    var raw = valueEl.value.trim();
    if (raw === '') {
      valueEl.classList.remove('input--invalid');
      renderEmpty();
      return;
    }

    var parsed = parseNumber(raw);
    var invalid = parsed === null;
    valueEl.classList.toggle('input--invalid', invalid);
    if (!invalid) state.value = parsed;

    /* 输入非法时沿用上一次的合法值继续渲染 —— 直接清空的话，
       用户删掉一个字符的瞬间整页就空了，很难看清自己改了什么。 */
    var v = state.value;
    var base = toBase(fromU, v);
    var out = fromBase(toU, base);

    resultText.textContent = isFinite(out) ? fmt(out, sig) + ' ' + toU.sym : '—';
    setCopyable(isFinite(out));

    /* 全部单位：以「1 个源单位」为口径列一遍 */
    var rows = cat.units.map(function (u) {
      var val = fromBase(u, base);
      var text = isFinite(val) ? fmt(val, sig) + ' ' + u.sym : '—';
      return '<button class="value-row" type="button" title="点击复制" ' +
        'data-copy-target="#uc-u-' + u.id + '">' +
        '<span class="value-label">' + esc(u.name) + '</span>' +
        '<span class="value-text" id="uc-u-' + u.id + '">' + esc(text) + '</span>' +
        '</button>';
    }).join('');
    listEl.innerHTML = rows;

    /* 状态行：正反两个方向的「1 : 1」关系，外加温度的下限检查 */
    if (invalid) {
      statusEl.innerHTML = '<span class="is-error">不是合法的数字</span>' +
        '<span class="err-raw">只接受十进制数字与科学计数法（如 1e3），不支持千分位逗号</span>';
      return;
    }

    var one = '1 ' + fromU.name + ' = ' + fmt(fromBase(toU, toBase(fromU, 1)), sig) + ' ' + toU.name;
    var back = '1 ' + toU.name + ' = ' + fmt(fromBase(fromU, toBase(toU, 1)), sig) + ' ' + fromU.name;
    var html = esc(one + ' · ' + back);

    if (cat.id === 'temperature') {
      /* 绝对零度在基准单位下的值是 0，换算回源单位就是该单位刻度上的下限 */
      var zero = fromBase(fromU, 0);
      if (v < zero) {
        html += '<span class="is-warn"> · 低于绝对零度（' + fmt(zero, sig) + ' ' + fromU.sym +
          '），物理上不可达</span>';
      }
    }
    statusEl.innerHTML = html;
  }

  var debounced = T.util.debounce(render, 90);

  /* ======================================================================
     五、事件
     ====================================================================== */

  catsEl.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-cat]');
    if (!chip) return;
    var id = chip.getAttribute('data-cat');
    if (id === state.cat) return;

    state.cat = id;
    var cat = CAT_MAP[id];
    state.from = cat.from;
    state.to = cat.to;
    syncCats();
    renderUnits();
    render();                 /* 切换分类是离散操作，不走防抖 */
  });

  sigSel.addEventListener('change', function () {
    var n = Number(sigSel.value);
    state.sig = SIG_CHOICES.indexOf(n) >= 0 ? n : SIG_DEFAULT;
    render();
  });

  valueEl.addEventListener('input', debounced);

  /* 失焦时把非法输入回退成上一次的合法值（输入过程中不覆盖用户原文） */
  valueEl.addEventListener('blur', function () {
    if (!valueEl.classList.contains('input--invalid')) return;
    valueEl.value = String(state.value);
    valueEl.classList.remove('input--invalid');
    render();
  });

  fromSel.addEventListener('change', function () {
    state.from = fromSel.value;
    render();
  });

  toSel.addEventListener('change', function () {
    state.to = toSel.value;
    render();
  });

  swapBtn.addEventListener('click', function () {
    var f = state.from;
    state.from = state.to;
    state.to = f;
    fromSel.value = state.from;
    toSel.value = state.to;
    render();
  });

  if (copyAllBtn) {
    copyAllBtn.addEventListener('click', function () {
      /* 输入框里没有合法数值时不复制 —— 否则会复制出一份用旧值算的结果 */
      var v = parseNumber(valueEl.value.trim());
      if (v === null) { T.util.toast('还没有可换算的数值'); return; }

      var cat = CAT_MAP[state.cat];
      var fromU = cat.unitMap[state.from];
      var base = toBase(fromU, v);
      var lines = [fmt(v, state.sig) + ' ' + fromU.name + '（' + fromU.sym + '）='];

      cat.units.forEach(function (u) {
        var val = fromBase(u, base);
        /* 制表符分隔：粘进表格软件就是两列 */
        lines.push((isFinite(val) ? fmt(val, state.sig) : '—') + ' ' + u.sym + '\t' + u.name);
      });

      T.util.copy(lines.join('\n'), copyAllBtn);
    });
  }

  /* ======================================================================
     六、首屏
     ====================================================================== */

  renderCats();
  renderSigs();
  renderUnits();
  render();                   /* 首屏同步渲染，不走防抖 */
})();
