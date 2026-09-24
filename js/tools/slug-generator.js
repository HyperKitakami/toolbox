/* ==========================================================================
   slug-generator.js — Slug 生成（自研）
   --------------------------------------------------------------------------
   设计取舍（自研工具，这一段是它唯一的「来源说明」）：

   1. 拼音表是自托管的第三方数据（js/vendor/pinyin-common.js，来自 Unicode
      Unihan 的 kMandarin 字段，GB2312 范围内的 6763 个汉字）。**不引入拼音库** ——
      现成的库要么带完整词典（几 MB），要么连声调、多音字标注一起给，
      而这个工具只需要「一个字一个无声调音节」。自建表 23 KB，
      解析一次不到 5 ms，而且解析逻辑就下面十来行，没有黑盒。
   2. 先切词再拼接：字母数字连成一段算一个词，其余字符都是分隔符。
      这样连续标点、首尾标点都不会在结果里留下多余的分隔符，
      也不必事后用正则去清理「--」「-_」这类混排。
   3. 拼音不带声调。带调符号（nǐ）在 URL 里会被百分号编码成 %C7%90，
      对 slug 毫无意义；ü 按 slug 惯例写成 v（绿 → lv），避免与「路 lu」混淆。
   4. 重音符号用 Unicode 分解 + 去组合标记（café → cafe），不维护映射表；
      只有 NFD 拆不开的独立字母（ø ł đ ß æ œ …）才走一张 12 项的小表。
   5. 多音字取 Unihan 的第一个读音，工具不做语境判断 —— 做不到，也不假装能做到。
      界面上写明这一点，并告诉用户可以直接把那个字写成拼音。
   6. 「最大长度」在最后一个分隔符处回退截断，而不是硬切半个词；
      「无分隔符」模式下没有词边界，只能硬截断，这一点在说明区讲清楚。
   7. 不用 lookbehind / replaceAll / Array.at 这类较新语法：在老引擎里它们是
      **解析期**错误，整个脚本加载失败、工具白屏，控制台连一行有用的报错都没有。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  /* --- 0. 取元素 + 依赖检查 ---------------------------------------------- */
  var input    = document.getElementById('sg-input');
  var outputEl = document.getElementById('sg-output');
  var statsEl  = document.getElementById('sg-stats');
  var statusEl = document.getElementById('sg-status');
  var outFoot  = document.getElementById('sg-out-foot');
  var footEl   = document.getElementById('sg-foot');
  var dlBtn    = document.getElementById('sg-download');
  var resetBtn = document.getElementById('sg-reset');
  var maxLenEl = document.getElementById('sg-maxlen');
  var clearBtn = document.querySelector('[data-clear]');
  var demoBtn  = document.querySelector('[data-demo]');
  if (!input || !outputEl) return;

  /* 依赖缺失要吵，不要静默 return —— 静默退出的表现是「结果区一片空白、
     控制台一行错都没有」，用户完全无从下手。 */
  function bail(detail) {
    var box = document.getElementById('sg-output');
    if (!box) return;
    box.textContent = '';
    var wrap = document.createElement('div');
    wrap.className = 'code-empty';
    wrap.innerHTML = '<strong>工具没能初始化</strong>' + detail;
    box.parentNode.appendChild(wrap);
  }

  var util = T.util;
  if (!util || typeof util.readInt !== 'function' || typeof util.download !== 'function') {
    bail('页面加载到的 js/site.js 是旧版本，缺少这个工具需要的公共方法。请强制刷新（Ctrl+F5）后重试。');
    return;
  }

  /* --- 1. 拼音表 ---------------------------------------------------------- */

  /* 懒加载：首次用到才把 23 KB 的字符串切成映射表（约 6763 次赋值，< 5 ms） */
  var PINYIN = null;

  function loadPinyin() {
    if (PINYIN) return PINYIN;
    var src = window.TOOLBOX_PINYIN;
    if (!src || typeof src.data !== 'string') return null;

    var map = Object.create(null);
    var lines = src.data.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var sp = line.indexOf(' ');
      if (sp < 0) continue;
      var py = line.slice(0, sp);
      var chars = line.slice(sp + 1);
      for (var k = 0; k < chars.length; k++) map[chars.charAt(k)] = py;
    }
    PINYIN = map;
    return map;
  }

  /* 需要转拼音的码位范围：CJK 统一表意文字 + 扩展 A + 兼容表意文字 + 扩展 B~F。
     刻意不含日文假名与韩文谚文 —— 它们不是汉字，Unihan 也不给它们拼音。
     U+3007（〇）是表意数字零，Unicode 把它放在「CJK 符号和标点」区块里、
     Unihan 也没有给它拼音，但它是汉字：单独纳进来，让它至少在统计与
     「不在表里」的提示里可见，而不是悄悄消失。 */
  function isHan(cp) {
    return cp === 0x3007 ||
           (cp >= 0x3400 && cp <= 0x4DBF) ||
           (cp >= 0x4E00 && cp <= 0x9FFF) ||
           (cp >= 0xF900 && cp <= 0xFAFF) ||
           (cp >= 0x20000 && cp <= 0x2FA1F);
  }

  /* --- 2. 字符处理 -------------------------------------------------------- */

  /* NFD 拆不开的独立字母：它们不是「带变音符号的拉丁字母」，而是独立码位，
     所以去组合标记那一步对它们无效，得单独给一个替代写法。 */
  var SPECIAL_LATIN = {
    '\u00DF': 'ss',   /* ß */
    '\u00E6': 'ae',   /* æ */
    '\u0153': 'oe',   /* œ */
    '\u00F8': 'o',    /* ø */
    '\u0111': 'd',    /* đ */
    '\u00F0': 'd',    /* ð */
    '\u00FE': 'th',   /* þ */
    '\u0142': 'l',    /* ł */
    '\u0127': 'h',    /* ħ */
    '\u0131': 'i',    /* ı */
    '\u014B': 'n',    /* ŋ */
    '\u0138': 'k'     /* ĸ */
  };

  /** 去掉重音符号：café → cafe、München → munchen */
  function deaccent(ch) {
    var mapped = SPECIAL_LATIN[ch.toLowerCase()];
    if (mapped) return mapped;
    var nfd = ch;
    /* String.prototype.normalize 是 ES6 才有的，老引擎上要能优雅降级 */
    if (typeof String.prototype.normalize === 'function') nfd = ch.normalize('NFD');
    return nfd.replace(/[\u0300-\u036f]/g, '');
  }

  function applyCase(s, o) {
    if (o.letterCase === 'lower') return s.toLowerCase();
    if (o.letterCase === 'upper') return s.toUpperCase();
    return s;
  }

  /* --- 3. 核心：切词与拼接 ------------------------------------------------ */

  /**
   * 把一行切成「词」的数组。字母数字连成一段算一个词，其余都是分隔符。
   * 转拼音模式下每个汉字是一个词（全拼）或并入连续中文那一串（首字母）。
   */
  function toParts(line, o, stats) {
    var parts = [];
    var buf = '';    /* 累积中的拉丁词 */
    var cjk = '';    /* 累积中的中文串（首字母模式的拼音首字母 / 保留模式的原字） */

    function push(s) { if (s) parts.push(s); }
    function flush() { push(buf); buf = ''; push(cjk); cjk = ''; }

    var chars = Array.from(line);
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];

      if (isHan(ch.codePointAt(0))) {
        stats.han++;
        if (o.chinese === 'drop') { flush(); continue; }
        if (o.chinese === 'keep') { push(buf); buf = ''; cjk += ch; continue; }

        var py = PINYIN[ch];
        if (!py) { stats.missed++; flush(); continue; }
        stats.converted++;
        if (o.pinyinStyle === 'initial') {
          push(buf); buf = '';
          cjk += py.charAt(0);
        } else {
          flush();
          parts.push(py);
        }
        continue;
      }

      push(cjk); cjk = '';
      var base = deaccent(ch);
      /* 大小写要在判定之后再套：先 applyCase 再判断的话，
         「大写」模式下 'H' 不匹配 [a-z0-9]，整个词会被当分隔符丢掉 */
      if (/^[a-z0-9]+$/i.test(base)) {
        buf += applyCase(base, o);
      } else {
        push(buf);
        buf = '';
      }
    }

    flush();
    return parts;
  }

  /** 拼接成 slug；超过最大长度时回退到最后一个分隔符处截断 */
  function joinParts(parts, o) {
    var slug = parts.join(o.sep);
    if (!o.maxLen || slug.length <= o.maxLen) return slug;

    var cut = slug.slice(0, o.maxLen);
    if (o.sep) {
      var at = cut.lastIndexOf(o.sep);
      if (at > 0) cut = cut.slice(0, at);
    }
    /* 截断后可能留下分隔符尾巴，一并去掉 */
    return cut.replace(/[-_]+$/, '');
  }

  function convert(text, o) {
    var lines = text.split(/\r\n|\r|\n/);
    var slugs = [];
    var stats = { han: 0, converted: 0, missed: 0, blank: 0, empty: 0, lines: lines.length };

    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) { stats.blank++; continue; }
      var slug = joinParts(toParts(lines[i], o, stats), o);
      if (!slug) { stats.empty++; continue; }
      slugs.push(slug);
    }
    return { slugs: slugs, stats: stats };
  }

  /* --- 4. 选项 ------------------------------------------------------------ */

  var DEFAULTS = {
    chinese: 'pinyin',     /* pinyin | drop | keep */
    pinyinStyle: 'full',   /* full | initial */
    sep: '-',              /* - | _ | '' */
    letterCase: 'lower',   /* lower | keep | upper */
    maxLen: 0              /* 0 = 不限 */
  };

  var state = {};
  Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });

  var DEMO = [
    '如何用 Python 写一个爬虫',
    'Café 与 咖啡：哪个更好喝？',
    '2026 年前端开发趋势（上）'
  ].join('\n');

  /* --- 5. 渲染 ------------------------------------------------------------ */

  function num(n) { return n.toLocaleString('zh-CN'); }

  function stat(label, value, cls) {
    return '<div class="stat">' +
      '<div class="stat-label">' + util.esc(label) + '</div>' +
      '<div class="stat-value' + (cls ? ' ' + cls : '') + '">' + util.esc(value) + '</div>' +
      '</div>';
  }

  function update() {
    var text = input.value;
    var map = loadPinyin();
    if (!map && state.chinese === 'pinyin') {
      util.emptyHint(outputEl, '拼音表没有加载',
        '页面引用的 js/vendor/pinyin-common.js 没找到，中文暂时无法转拼音。', 'code-empty');
      return;
    }

    state.maxLen = util.readInt(maxLenEl, 0, 500);

    var result = convert(text, state);
    var slugs = result.slugs;
    var st = result.stats;

    outputEl.textContent = slugs.join('\n');

    var outChars = slugs.join('\n').length;
    statsEl.innerHTML =
      stat('输入字符', num(Array.from(text).length)) +
      stat('输出字符', num(outChars)) +
      stat('输出行数', num(slugs.length)) +
      stat('汉字', num(st.han));

    if (statusEl) {
      statusEl.textContent = text
        ? num(st.lines) + ' 行 · ' + num(Array.from(text).length) + ' 字符'
        : '';
    }

    if (outFoot) {
      var skipped = [];
      if (st.blank) skipped.push(num(st.blank) + ' 个空行');
      if (st.empty) skipped.push(num(st.empty) + ' 行转换后为空');
      outFoot.textContent = skipped.length
        ? '已跳过 ' + skipped.join('、')
        : '空行会被跳过，只输出有内容的行';
    }

    if (footEl) {
      var base = '拼音表覆盖 6763 个常用汉字（GB2312 全部汉字）';
      footEl.textContent = st.missed
        ? base + ' · 有 ' + num(st.missed) + ' 个字不在表里，已按分隔符处理'
        : base;
    }
  }

  /* 首屏同步渲染一次，不要走防抖 —— 否则首屏有 70ms 空白，测试也会读到空 DOM */
  var render = util.debounce(update, 70);

  /* --- 6. 事件 ------------------------------------------------------------ */

  input.addEventListener('input', render);

  /* 胶囊组都是单选：同一个 data-opt 下只有一个 aria-pressed="true" */
  var optGroups = Object.create(null);
  util.$$('[data-opt]').forEach(function (chip) {
    var key = chip.getAttribute('data-opt');
    if (!optGroups[key]) optGroups[key] = [];
    optGroups[key].push(chip);

    chip.addEventListener('click', function () {
      state[key] = chip.getAttribute('data-value');
      optGroups[key].forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === chip));
      });
      update();
    });
  });

  function syncUI() {
    Object.keys(optGroups).forEach(function (key) {
      optGroups[key].forEach(function (chip) {
        chip.setAttribute('aria-pressed',
          String(chip.getAttribute('data-value') === state[key]));
      });
    });
    maxLenEl.value = String(state.maxLen);
  }

  if (maxLenEl) {
    maxLenEl.addEventListener('input', function () {
      render();
    });
    maxLenEl.addEventListener('blur', function () {
      maxLenEl.value = String(util.readInt(maxLenEl, 0, 500));
      maxLenEl.classList.remove('input--invalid');
      update();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });
      syncUI();
      update();
      util.toast('已恢复默认选项');
    });
  }

  if (dlBtn) {
    dlBtn.addEventListener('click', function () {
      var text = outputEl.textContent;
      if (!text) { util.toast('没有可下载的内容'); return; }
      if (!util.download('slugs.txt', text)) util.toast('当前环境不支持下载');
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      input.value = '';
      update();
      input.focus();
    });
  }

  if (demoBtn) {
    demoBtn.addEventListener('click', function () {
      input.value = DEMO;
      update();
      input.focus();
    });
  }

  /* --- 7. 首屏 ------------------------------------------------------------ */
  syncUI();
  update();
})();
