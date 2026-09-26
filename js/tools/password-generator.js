/* ==========================================================================
   password-generator.js — 密码 / 口令短语生成
   --------------------------------------------------------------------------
   移植自 Praticulus 的 password-generator（MIT，作者 Jamal Tantaoui / Iris Digital）。
   做了中文化、设计系统统一，并修掉以下缺陷 —— 逐条对照见 THIRD-PARTY.md：

   1. **模偏差**：上游用 `cs[v % cs.length]` 取字符。字符集长度不整除 2^32 时，
      靠前的字符出现概率会略高。改为走 js/random-utils.js 的拒绝采样。
   2. **字符集为空时静默降级**：上游 getCharset() 在四类都没勾时返回小写字母，
      用户看到的是「我明明只勾了符号，怎么出来一串小写字母」。现在直接报错。
   3. **复制没有降级**：上游裸调 navigator.clipboard.writeText —— 非安全上下文下
      它是 undefined，会抛 TypeError；Promise 失败也没有任何处理。
      改用 T.util.copy（带 execCommand 降级），行内复制交给 site.js 的全局代理。
   4. **清空自定义分隔符无法恢复**：上游只在输入非空时赋值，清空输入框后仍旧沿用
      上一个值。现在改成「填了就用自定义，清空即回到胶囊选中的那个」。
   5. **长度 / 词数不做校验**：上游直接 parseInt，输入框清空会得到 NaN，
      `new Uint32Array(NaN)` 静默产出一个空密码。现在非法输入标红 + 失焦回退。
   6. **批量条数被静默截断**：上游 `Math.min(..., 100)`，界面上没有任何提示，
      填 500 只给 100。现在输入框直接限定 1–100，超界标红回退。
   7. **爆破时间会溢出**：上游 `Math.pow(2, entropy)` 在熵值很大时变成 Infinity，
      于是所有分档都落进最后一档。现在全程在对数空间计算
      （换算表与强度分档后来抽到 js/password-utils.js，与密码强度检测共用一份）。
   8. **词表只覆盖 A–F**：上游自带的 529 个词排到 faculty 就断了，换成 EFF 官方
      7776 词长词表（js/vendor/eff-large-wordlist.js）。
   9. 新增「每类至少出现一次」—— 上游没有，但很多站点强制要求大小写 + 数字。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;

  /**
   * 依赖缺失时**不要静默 return** —— 结果区一片空白，光看页面完全看不出哪里坏了。
   * 这种情形几乎都是「浏览器拿到了旧资源」（缓存里是旧版 site.js，或缺 random-utils.js），
   * 所以提示里直接给出强制刷新的办法。资源引用带的 ?v= 版本号能避免再次发生。
   */
  function bail(detail) {
    var box = document.getElementById('pg-list');
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

    var v = document.getElementById('pg-value-text');
    if (v) v.textContent = '';
    var st = document.getElementById('pg-stats');
    if (st) st.textContent = '';
  }

  if (!T || !T.util) {
    bail('js/registry.js 或 js/site.js 没有加载成功。');
    return;
  }
  if (typeof T.util.readInt !== 'function') {
    bail('加载到的是旧版 js/site.js。');
    return;
  }

  var R = T.random;
  if (!R) {
    bail('js/random-utils.js 没有加载成功。');
    return;
  }

  /* 爆破时间与强度分档在 js/password-utils.js 里 —— 密码强度检测那个工具要用
     同一套阈值与同一张换算表，两份实现迟早在「生成器说一般、检测说弱」这种
     地方分叉，而分叉后两边看着都正常。 */
  var P = T.password;
  if (!P) {
    bail('js/password-utils.js 没有加载成功。');
    return;
  }

  var C = R.CHARSETS;
  var WL = (T.wordlists && T.wordlists.effLarge) || [];

  /* --- 1. 常量 ----------------------------------------------------------- */

  var CLASS_IDS = ['upper', 'lower', 'digits', 'symbols'];
  var CLASS_LABEL = {
    upper:   '大写字母 A-Z',
    lower:   '小写字母 a-z',
    digits:  '数字 0-9',
    symbols: '符号 !@#'
  };

  var MODES = [
    { id: 'password', name: '随机密码',
      hint: '按字符类别与长度取随机串，适合放进密码管理器。' },
    { id: 'passphrase', name: '口令短语',
      hint: '用英文单词拼成，好记但更长 —— 每多一个词就多 12.9 比特熵。' }
  ];
  var MODE_MAP = {};
  MODES.forEach(function (m) { MODE_MAP[m.id] = m; });

  var SEPS = [
    { id: 'dash',  ch: '-', name: '短横线' },
    { id: 'space', ch: ' ', name: '空格' },
    { id: 'dot',   ch: '.', name: '点' },
    { id: 'under', ch: '_', name: '下划线' },
    { id: 'none',  ch: '',  name: '不加' }
  ];
  var SEP_MAP = {};
  SEPS.forEach(function (s) { SEP_MAP[s.id] = s; });

  var MIN_LEN = 4,   MAX_LEN = 128;
  var MIN_WORDS = 3, MAX_WORDS = 10;
  var MIN_COUNT = 1, MAX_COUNT = 100;

  /* 爆破时间与强度分档见 js/password-utils.js（`T.password`）。
     离线爆破的假设（每秒 1000 亿次，对应 MD5 / SHA 这类快速哈希）也在那边，
     取平均命中位置，所以时间 = 2^熵值 / (2 × 每秒次数)。 */
  function levelOf(bits) { return P.levelOf(bits); }
  function crackTime(bits) { return P.crackTimeFromBits(bits, P.DEFAULT_GUESSES_PER_SEC); }

  /* --- 2. 取元素 --------------------------------------------------------- */

  var modeBox        = document.getElementById('pg-modes');
  var modeHint       = document.getElementById('pg-mode-hint');
  var passwordPanel  = document.getElementById('pg-panel-password');
  var passPanel      = document.getElementById('pg-panel-passphrase');
  var classBox       = document.getElementById('pg-classes');
  var lengthInput    = document.getElementById('pg-length');
  var lengthValueEl  = document.getElementById('pg-length-value');
  var excludeAmbEl   = document.getElementById('pg-exclude-ambiguous');
  var guaranteeEl    = document.getElementById('pg-guarantee');
  var charsetPreview = document.getElementById('pg-charset-preview');
  var charsetSizeEl  = document.getElementById('pg-charset-size');
  var wordsInput     = document.getElementById('pg-words');
  var wordsValueEl   = document.getElementById('pg-words-value');
  var sepBox         = document.getElementById('pg-seps');
  var sepInput       = document.getElementById('pg-custom-sep');
  var capEl          = document.getElementById('pg-capitalize');
  var wordlistInfo   = document.getElementById('pg-wordlist-info');
  var valueBtn       = document.getElementById('pg-value');
  var valueText      = document.getElementById('pg-value-text');
  var strengthEl     = document.getElementById('pg-strength');
  var strengthLabel  = document.getElementById('pg-strength-label');
  var statsEl        = document.getElementById('pg-stats');
  var statusEl       = document.getElementById('pg-status');
  var regenBtn       = document.getElementById('pg-regenerate');
  var countInput     = document.getElementById('pg-count');
  var listEl         = document.getElementById('pg-list');
  var copyAllBtn     = document.getElementById('pg-copy-all');
  if (!modeBox || !valueText || !listEl) return;

  var state = {
    mode: 'password',
    classes: { upper: true, lower: true, digits: true, symbols: true },
    sep: 'dash',
    items: []
  };

  /* --- 3. 取值 ----------------------------------------------------------- */

  function currentSep() {
    var custom = sepInput ? sepInput.value : '';
    if (custom) return custom;
    return SEP_MAP[state.sep] ? SEP_MAP[state.sep].ch : '-';
  }

  /** 拼出实际使用的字符集：选中的类别 -> 去重 -> 排除易混 */
  function buildCharset() {
    var set = '';
    CLASS_IDS.forEach(function (id) {
      if (state.classes[id]) set += C[id];
    });
    set = R.normalizeCharset(set);
    if (excludeAmbEl && excludeAmbEl.checked) set = R.filterAmbiguous(set);
    return set;
  }

  /**
   * 每个选中类别在**过滤后的字符集**里还剩哪些字符。
   * 被「排除易混字符」清空的类别会被丢掉 —— 否则「每类至少一次」会永远无解。
   */
  function effectiveGroups(set) {
    var groups = [];
    CLASS_IDS.forEach(function (id) {
      if (!state.classes[id]) return;
      var keep = '';
      for (var i = 0; i < C[id].length; i++) {
        if (set.indexOf(C[id].charAt(i)) !== -1) keep += C[id].charAt(i);
      }
      if (keep) groups.push(keep);
    });
    return groups;
  }

  /** 生成一条密码 */
  function genPassword(len, set, groups, guarantee) {
    var chars = R.chars(set, len).split('');

    /* groups.length > len 走不到（长度下限 4、类别最多 4 个），留一道防线而已 */
    if (!guarantee || !groups.length || groups.length > len) return chars.join('');

    var slots = [];
    for (var i = 0; i < len; i++) slots.push(i);
    slots = R.shuffle(slots).slice(0, groups.length);

    for (var k = 0; k < groups.length; k++) chars[slots[k]] = R.chars(groups[k], 1);
    return chars.join('');
  }

  /** 生成一条口令短语 */
  function genPassphrase(words, sep, capitalize) {
    var picked = R.pickMany(WL, words);
    if (capitalize) {
      picked = picked.map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); });
    }
    return picked.join(sep);
  }

  /* --- 4. 渲染 ----------------------------------------------------------- */

  function stat(label, value, cls) {
    return '<div class="stat">' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value ' + (cls || '') + '">' + value + '</div>' +
      '</div>';
  }

  function renderModes() {
    modeBox.innerHTML = MODES.map(function (m) {
      return '<button class="choice-chip" type="button" data-mode="' + m.id + '" ' +
        'aria-pressed="' + (m.id === state.mode) + '">' + T.util.esc(m.name) + '</button>';
    }).join('');
  }

  function renderClasses() {
    classBox.innerHTML = CLASS_IDS.map(function (id) {
      return '<button class="choice-chip" type="button" data-class="' + id + '" ' +
        'aria-pressed="' + !!state.classes[id] + '">' + T.util.esc(CLASS_LABEL[id]) + '</button>';
    }).join('');
  }

  function renderSeps() {
    sepBox.innerHTML = SEPS.map(function (s) {
      return '<button class="choice-chip" type="button" data-sep="' + s.id + '" ' +
        'aria-pressed="' + (s.id === state.sep) + '">' + T.util.esc(s.name) + '</button>';
    }).join('');
  }

  function syncChips(box, attr, current) {
    T.util.$$('.choice-chip', box).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute(attr) === current));
    });
  }

  function renderList(items) {
    listEl.innerHTML = items.map(function (s, i) {
      var id = 'pg-item-' + i;
      return '<button class="value-row" type="button" title="点击复制这一条" ' +
        'data-copy-target="#' + id + '">' +
        '<span class="value-label">#' + (i + 1) + '</span>' +
        '<span class="value-text" id="' + id + '">' + T.util.esc(s) + '</span>' +
        '</button>';
    }).join('');
  }

  function fail(title, desc, msg) {
    state.items = [];
    valueText.textContent = '';
    strengthEl.setAttribute('data-level', '0');
    strengthLabel.textContent = '';
    statsEl.innerHTML = '';
    T.util.emptyHint(listEl, title, desc);
    statusEl.innerHTML = '<span class="is-error">' + T.util.esc(msg) + '</span>';
  }

  /* --- 5. 主循环 --------------------------------------------------------- */

  function update() {
    var isPass = state.mode === 'passphrase';

    if (modeHint) modeHint.textContent = MODE_MAP[state.mode].hint;
    syncChips(modeBox, 'data-mode', state.mode);
    syncChips(sepBox, 'data-sep', state.sep);
    /* 字符类别是多选，逐个同步 */
    T.util.$$('.choice-chip', classBox).forEach(function (b) {
      b.setAttribute('aria-pressed', String(!!state.classes[b.getAttribute('data-class')]));
    });
    if (passwordPanel) passwordPanel.hidden = isPass;
    if (passPanel) passPanel.hidden = !isPass;

    var length = T.util.readInt(lengthInput, MIN_LEN, MAX_LEN);
    var words  = T.util.readInt(wordsInput, MIN_WORDS, MAX_WORDS);
    var count  = T.util.readInt(countInput, MIN_COUNT, MAX_COUNT);
    if (lengthValueEl) lengthValueEl.textContent = String(length);
    if (wordsValueEl) wordsValueEl.textContent = String(words);

    if (!R.available()) {
      fail('这个环境没有可用的密码学安全随机源',
        '浏览器没有提供 crypto.getRandomValues。本工具不会退回 Math.random —— ' +
        '可预测的随机数拿来生成密码等于没生成。',
        '无法生成：缺少 crypto.getRandomValues');
      return;
    }

    var bits, subject, detail, warn = '';
    var set = '', groups = [], size = 0;
    var guarantee = !!(guaranteeEl && guaranteeEl.checked);

    if (isPass) {
      if (!WL.length) {
        fail('词表没有加载',
          'js/vendor/eff-large-wordlist.js 没有加载成功，口令短语模式无法工作。',
          '无法生成：词表为空');
        return;
      }
      bits = words * R.entropyPerChar(WL.length);
      subject = words + ' 个词';
      detail = '词表 ' + WL.length + ' 个';
    } else {
      set = buildCharset();
      groups = effectiveGroups(set);
      size = set.length;

      charsetPreview.textContent = set;
      charsetSizeEl.textContent = size ? '共 ' + size + ' 个字符' : '（空）';

      if (!size) {
        var nothingPicked = CLASS_IDS.every(function (id) { return !state.classes[id]; });
        fail('字符集是空的',
          nothingPicked
            ? '一个字符类别都没选。至少要勾选一类才能生成密码。'
            : '选中的类别在排除易混字符之后不剩任何字符了，换个类别或者关掉「排除易混字符」。',
          '无法生成：字符集为空');
        return;
      }

      bits = length * R.entropyPerChar(size);
      subject = length + ' 个字符';
      detail = '字符集 ' + size + ' 个';

      /* 强制每类至少一次会让分布不再均匀，显示的是上界 */
      if (guarantee && groups.length > 1) {
        warn = '已强制每类至少出现一次，实际熵略低于此值';
      }
    }

    var items = [];
    var i;
    if (isPass) {
      var sep = currentSep();
      var cap = !!(capEl && capEl.checked);
      for (i = 0; i < count; i++) items.push(genPassphrase(words, sep, cap));
    } else {
      for (i = 0; i < count; i++) items.push(genPassword(length, set, groups, guarantee));
    }
    state.items = items;

    var lv = levelOf(bits);
    valueText.textContent = items[0];
    strengthEl.setAttribute('data-level', String(lv.level));
    strengthLabel.textContent = lv.label;

    var bitsCls = 'stat-value--' + (lv.level === 1 ? 'danger' : (lv.level === 2 ? 'warn' : 'ok'));

    statsEl.innerHTML = isPass
      ? stat('熵值', bits.toFixed(1) + ' 比特', bitsCls) +
        stat('词表大小', WL.length + ' 个') +
        stat('词数', words + ' 个') +
        stat('离线爆破', crackTime(bits), 'stat-value--sm')
      : stat('熵值', bits.toFixed(1) + ' 比特', bitsCls) +
        stat('字符集大小', size + ' 个') +
        stat('密码长度', length + ' 个') +
        stat('离线爆破', crackTime(bits), 'stat-value--sm');

    statusEl.innerHTML = T.util.esc(
      subject + '，' + detail + '，约 ' + bits.toFixed(1) + ' 比特熵。' + lv.note + '。'
    ) + (warn ? '<span class="is-warn"> · ' + T.util.esc(warn) + '</span>' : '');

    renderList(items);
  }

  var render = T.util.debounce(update, 90);

  /* --- 6. 事件 ----------------------------------------------------------- */

  modeBox.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-mode]');
    if (!chip) return;
    state.mode = chip.getAttribute('data-mode');
    render();
  });

  classBox.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-class]');
    if (!chip) return;
    var id = chip.getAttribute('data-class');
    state.classes[id] = !state.classes[id];
    render();
  });

  sepBox.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-sep]');
    if (!chip) return;
    state.sep = chip.getAttribute('data-sep');
    if (sepInput) sepInput.value = '';   /* 选胶囊就清掉自定义，两者不打架 */
    render();
  });

  [lengthInput, wordsInput].forEach(function (el) {
    if (!el) return;
    el.addEventListener('input', render);
  });

  [excludeAmbEl, guaranteeEl, capEl].forEach(function (el) {
    if (el) el.addEventListener('change', render);
  });

  if (sepInput) sepInput.addEventListener('input', render);

  countInput.addEventListener('input', render);
  countInput.addEventListener('blur', function () {
    if (!countInput.classList.contains('input--invalid')) return;
    countInput.value = String(T.util.readInt(countInput, MIN_COUNT, MAX_COUNT));
    countInput.classList.remove('input--invalid');
    update();
  });
  countInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); update(); }
  });

  if (regenBtn) regenBtn.addEventListener('click', update);

  if (copyAllBtn) {
    copyAllBtn.addEventListener('click', function () {
      if (!state.items.length) { T.util.toast('还没有可复制的内容'); return; }
      T.util.copy(state.items.join('\n'), copyAllBtn);
    });
  }

  /* --- 7. 首屏 ----------------------------------------------------------- */

  renderModes();
  renderClasses();
  renderSeps();
  if (wordlistInfo) {
    wordlistInfo.textContent = WL.length
      ? 'EFF 长词表 · ' + WL.length + ' 个词 · 每词 ' + R.entropyPerChar(WL.length).toFixed(2) + ' 比特'
      : '（未加载）';
  }
  update();   /* 首屏同步渲染，不走防抖 */
})();
