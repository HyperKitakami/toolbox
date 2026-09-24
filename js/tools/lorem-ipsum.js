/* ==========================================================================
   lorem-ipsum.js — 占位文本生成
   --------------------------------------------------------------------------
   移植自 Praticulus 的 lorem-ipsum（MIT，作者 Jamal Tantaoui / Iris Digital）。
   做了中文化、设计系统统一，并修掉以下缺陷 —— 逐条对照见 THIRD-PARTY.md：

   1. **后行断言会让整个脚本加载失败（可观察）。** 上游用 `p.split(/(?<=[.?!])\s+/)` 切句。
      正则里的后行断言在 Safari 16.4 之前是**语法错误**（不是运行时异常），
      整个文件解析不过去，工具直接白屏。改成不依赖 lookbehind 的扫描式切分。
   2. **「包一层 HTML 标签」在「单词」单位下静默失效（可观察）。** 上游那个分支
      根本没读这个开关，勾了等于没勾。现在四种单位都会包。
   3. **数量超过语料长度时整块重复（可观察）。** 上游 `pool[i % pool.length]`
      让第 2 轮与第 1 轮**完全相同** —— 要 20 个段落、语料只有 8 段时，
      后 12 段就是前 8 段的逐字复制。现在每一轮重新打乱。
   4. **数量输入不校验（可观察）。** 上游 `Math.min(parseInt(v) || 3, 100)`：
      清空输入框静默变回 3、填 500 静默变 100，界面上没有任何提示。
      改用 T.util.readInt（标红 + 失焦回退）。
   5. **复制没有降级（可观察）。** 上游裸调 `navigator.clipboard.writeText`，
      非安全上下文（http、部分内嵌浏览器）下 `navigator.clipboard` 是 undefined，
      直接抛 TypeError。改用 site.js 的全局复制代理。
   6. **数据标注与实际不符（可观察）。** 上游把 8 段语料一起标成
      Cicero《De Finibus Bonorum et Malorum》1.10.32–1.10.33 原文，
      但后 2 段不是 —— 它们是网络模板里流传的另一套拉丁填充句
      （pellentesque / accumsan / scelerisque 这些词来自别处），第 7、8 段里
      连一个 lorem 都没有。本次把标注改准，数据原样保留（见 THIRD-PARTY.md）。
   7. **词池会推进空串（隐患，当前语料没触发）。** 上游写的是
      `if (w) ALL_WORDS.push(w.toLowerCase().replace(/[^a-z]/g, ''))` ——
      判断的是清洗**前**的 token，所以纯标点的 token 会以空串形式进池子，
      产出的文本里会出现多余空格。实测当前语料清洗后没有空串，
      所以现在看不出问题；一旦换语料就会冒出来。改成判断清洗**后**的结果。
   8. **「以经典开头」会漏掉池子的第 0 项（隐患，分布上看不出来）。**
      上游 `for (i = startClassic ? 1 : 0; …)` 配 `pool[i % pool.length]`，
      于是 pool[0] 在 count 较小时永远取不到。因为池子每次生成都会重新打乱，
      各段落长期看仍然是均匀的，所以**这不是用户能观察到的缺陷**，
      只是意图明显是「取满池子」而代码没做到。顺手改直。
   9. **字符数用 `result.length`（口径问题）。** 那是 UTF-16 码元数，
      扩展区汉字与 emoji 会被算成两个。当前两套语料都在基本平面内，
      所以数字碰巧是对的，但口径本身是错的。改用码点数。
   10. 新增中文语料与中文界面 —— 上游只有拉丁文。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;

  /** 依赖缺失时不要静默退出，见 random-string.js 里的同名函数说明 */
  function bail(detail) {
    var box = document.getElementById('li-output');
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
  if (typeof T.util.readInt !== 'function') {
    bail('加载到的是旧版 js/site.js。');
    return;
  }

  var R = T.random;
  if (!R) {
    bail('js/random-utils.js 没有加载成功。');
    return;
  }
  var CORPUS = T.corpus;
  if (!CORPUS) {
    bail('js/lorem-corpus.js 没有加载成功。');
    return;
  }

  /* --- 1. 常量 ----------------------------------------------------------- */

  var LANGS = [
    { id: 'la', name: '拉丁文 Lorem ipsum',
      note: '前 6 段是 Cicero《论至善与至恶》1.10.32–1.10.33 原文（公有领域），后 2 段出处不可考。' },
    { id: 'zh', name: '中文',
      note: '本项目自撰的中性语料，随本仓库以 MIT 发布，可自由使用。' }
  ];
  var LANG_MAP = {};
  LANGS.forEach(function (l) { LANG_MAP[l.id] = l; });

  /* zh: false 表示这一档在中文下不提供 —— 中文没有天然的词边界 */
  var UNITS = [
    { id: 'paragraphs', name: '段落',  zh: true },
    { id: 'sentences',  name: '句子',  zh: true },
    { id: 'words',      name: '单词',  zh: false },
    { id: 'list',       name: '列表项', zh: true }
  ];
  var UNIT_MAP = {};
  UNITS.forEach(function (u) { UNIT_MAP[u.id] = u; });

  var UNIT_HINT = {
    paragraphs: '整段取用，段落之间空一行 —— 用来撑满一块正文区域，看行距与整体灰度。',
    sentences:  '把句子拼成一段连续文字，用来测一行放多少个字比较舒服。',
    words:      '只出词，用来测字体的字面宽度与字距。',
    list:       '从句子里截出短标签，用来填导航、卡片标题、下拉菜单这类位置。'
  };

  var MIN_COUNT = 1, MAX_COUNT = 100;

  /* 句子结束标点（拉丁用半角，中文用全角） */
  var PUNCT = { la: '.?!', zh: '。！？…' };

  /* --- 2. 取元素 --------------------------------------------------------- */

  var langBox      = document.getElementById('li-langs');
  var corpusInfo   = document.getElementById('li-corpus-info');
  var corpusNote   = document.getElementById('li-corpus-note');
  var unitBox      = document.getElementById('li-units');
  var countInput   = document.getElementById('li-count');
  var classicEl    = document.getElementById('li-classic');
  var classicHint  = document.getElementById('li-classic-hint');
  var htmlEl       = document.getElementById('li-html');
  var unitHint     = document.getElementById('li-unit-hint');
  var outputEl     = document.getElementById('li-output');
  var statsEl      = document.getElementById('li-stats');
  var statusEl     = document.getElementById('li-status');
  var regenBtn     = document.getElementById('li-regenerate');
  var downloadBtn  = document.getElementById('li-download');
  if (!langBox || !outputEl || !countInput) return;

  var state = { lang: 'la', unit: 'paragraphs' };

  /* --- 3. 语料切分 ------------------------------------------------------- */

  /**
   * 按「一串结束标点 + 其后的空白」切分，标点保留在句子末尾。
   * 不用后行断言 —— `(?<=…)` 在 Safari 16.4 之前是语法错误，会让整个脚本加载失败。
   */
  function splitBy(text, punctClass) {
    var out = [];
    var re = new RegExp('[' + punctClass + ']+\\s*', 'g');
    var start = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      var end = m.index + m[0].length;
      var s = text.slice(start, end).trim();
      if (s) out.push(s);
      start = end;
    }
    var tail = text.slice(start).trim();
    if (tail) out.push(tail);
    return out;
  }

  var DATA = {};    /* 原顺序：经典开头要用 */
  var POOLS = {};   /* 打乱后的池子 */

  function buildData() {
    Object.keys(CORPUS).forEach(function (lang) {
      var d = { paragraphs: [], sentences: [], words: [] };
      CORPUS[lang].forEach(function (p) {
        d.paragraphs.push(p);
        splitBy(p, PUNCT[lang]).forEach(function (s) { d.sentences.push(s); });

        if (lang === 'la') {
          p.split(/\s+/).forEach(function (w) {
            var clean = w.toLowerCase().replace(/[^a-z]/g, '');
            if (clean) d.words.push(clean);   /* 判断清洗后的结果，避免推入空串 */
          });
        }
      });
      DATA[lang] = d;
    });
  }

  function reshuffle() {
    Object.keys(DATA).forEach(function (lang) {
      POOLS[lang] = {
        paragraphs: R.shuffle(DATA[lang].paragraphs),
        sentences: R.shuffle(DATA[lang].sentences),
        words: R.shuffle(DATA[lang].words)
      };
    });
  }

  /* --- 4. 生成 ----------------------------------------------------------- */

  /**
   * 从池子里取 count 项，尽量不重复；取完一轮还没凑够就重新打乱再来一轮。
   * classicItem 不为空时把它固定放在第一位，并从池子里剔除，避免重复出现。
   */
  function fill(pool, count, classicItem) {
    var out = [];
    if (classicItem != null) out.push(classicItem);

    var rest = pool.filter(function (x) { return x !== classicItem; });
    if (!rest.length) rest = pool.slice();
    if (!rest.length) return out;

    while (out.length < count) {
      var round = R.shuffle(rest);
      for (var i = 0; i < round.length && out.length < count; i++) out.push(round[i]);
    }
    return out;
  }

  /** 从句子里截出一个短标签 */
  function listItem(sentence, lang) {
    if (lang === 'zh') {
      var first = sentence.split(/[，、；：]/)[0] || sentence;
      return first.replace(/[。！？…，、；：]+$/, '');
    }
    var take = 4 + R.indexes(1, 5)[0];        /* 4–8 个词 */
    var words = sentence.split(/\s+/).slice(0, take);
    var t = words.join(' ').replace(/[.?!,]+$/, '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 拼出纯文本（统计与复制都以它为准） */
  function joinPlain(unit, items) {
    if (unit === 'paragraphs') return items.join('\n\n');
    if (unit === 'list') return items.join('\n');
    return items.join(' ');
  }

  /** 按选项包一层 HTML 标签 */
  function wrapHtml(unit, items, plain) {
    if (unit === 'list') {
      return '<ul>\n' + items.map(function (x) {
        return '  <li>' + escHtml(x) + '</li>';
      }).join('\n') + '\n</ul>';
    }
    if (unit === 'paragraphs') {
      return items.map(function (x) { return '<p>' + escHtml(x) + '</p>'; }).join('\n');
    }
    return '<p>' + escHtml(plain) + '</p>';
  }

  /* --- 5. 统计 ----------------------------------------------------------- */

  function byteLength(s) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s).length;
    try { return new Blob([s]).size; } catch (e) { return s.length; }
  }

  function stat(label, value) {
    return '<div class="stat">' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + value + '</div>' +
      '</div>';
  }

  function renderStats(plain, lang) {
    var chars = Array.from(plain).length;
    var bytes = byteLength(plain);
    var tokens = lang === 'zh'
      ? (plain.match(/[\u4E00-\u9FFF]/g) || []).length            /* 汉字数 */
      : plain.split(/\s+/).filter(Boolean).length;                /* 单词数 */
    var blocks = plain.split('\n').filter(function (l) { return l.trim(); }).length;

    statsEl.innerHTML =
      stat('字符数', chars.toLocaleString('zh-CN')) +
      stat(lang === 'zh' ? '汉字数' : '单词数', tokens.toLocaleString('zh-CN')) +
      stat('条目数', blocks.toLocaleString('zh-CN')) +
      stat('字节数', bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB');
  }

  /* --- 6. 渲染 ----------------------------------------------------------- */

  function renderLangs() {
    langBox.innerHTML = LANGS.map(function (l) {
      return '<button class="choice-chip" type="button" data-lang="' + l.id + '" ' +
        'aria-pressed="' + (l.id === state.lang) + '">' + T.util.esc(l.name) + '</button>';
    }).join('');
  }

  /** 单位胶囊按当前语言渲染 —— 中文下没有「单词」这一档 */
  function renderUnits() {
    var list = UNITS.filter(function (u) {
      return state.lang === 'zh' ? u.zh : true;
    });
    unitBox.innerHTML = list.map(function (u) {
      return '<button class="choice-chip" type="button" data-unit="' + u.id + '" ' +
        'aria-pressed="' + (u.id === state.unit) + '">' + T.util.esc(u.name) + '</button>';
    }).join('');
  }

  function syncLangs() {
    T.util.$$('.choice-chip', langBox).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === state.lang));
    });
  }

  function syncUnits() {
    T.util.$$('.choice-chip', unitBox).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-unit') === state.unit));
    });
  }

  function renderCorpusInfo() {
    var d = DATA[state.lang];
    var counts = d.paragraphs.length + ' 段 · ' + d.sentences.length + ' 句';
    if (state.lang === 'la') counts += ' · ' + d.words.length + ' 个单词';

    var sample = d.paragraphs[0] || '';
    if (sample.length > 56) sample = sample.slice(0, 56) + '…';

    corpusInfo.textContent = counts + '\n' + sample;
    corpusNote.textContent = LANG_MAP[state.lang].note;
  }

  function update() {
    /* 切到中文时「单词」不再可用，退回段落 */
    if (state.lang === 'zh' && !UNIT_MAP[state.unit].zh) state.unit = 'paragraphs';

    syncLangs();
    renderUnits();
    renderCorpusInfo();
    if (unitHint) unitHint.textContent = UNIT_HINT[state.unit];

    var classicAllowed = state.lang === 'la';
    /* 中文下只是把开关禁用，不清掉勾选状态 —— 切回拉丁文时用户的选择还在 */
    if (classicEl) classicEl.disabled = !classicAllowed;
    if (classicHint) {
      classicHint.textContent = classicAllowed
        ? 'Lorem ipsum dolor sit amet…'
        : '中文语料没有「经典开头」这一说';
    }

    var count = T.util.readInt(countInput, MIN_COUNT, MAX_COUNT);
    var lang = state.lang;
    var unit = state.unit;
    var d = DATA[lang];
    /* 「列表项」是从句子里截出来的，所以用句子池 */
    var poolKey = unit === 'list' ? 'sentences' : unit;
    var pool = POOLS[lang][poolKey] || [];
    var classic = classicAllowed && !!(classicEl && classicEl.checked);
    var items;

    if (unit === 'words') {
      /* 经典开头就是语料最前面的那些词，和上游一致 */
      items = classic ? d.words.slice(0, Math.min(count, d.words.length)) : [];
      var rest = R.shuffle(pool);
      var k = 0;
      while (items.length < count && rest.length) {
        items.push(rest[k % rest.length]);
        k++;
      }
    } else if (unit === 'list') {
      var sentences = fill(pool, count, classic ? d.sentences[0] : null);
      items = sentences.map(function (s) { return listItem(s, lang); });
    } else {
      var key = unit === 'sentences' ? 'sentences' : 'paragraphs';
      items = fill(pool, count, classic ? d[key][0] : null);
    }

    var plain = joinPlain(unit, items);
    var out = (htmlEl && htmlEl.checked) ? wrapHtml(unit, items, plain) : plain;

    outputEl.textContent = out;
    renderStats(plain, lang);

    var unitName = UNIT_MAP[unit].name;
    statusEl.textContent = '已生成 ' + count + ' 个' + unitName +
      '，纯文本共 ' + Array.from(plain).length.toLocaleString('zh-CN') + ' 个字符。';
  }

  var render = T.util.debounce(update, 90);

  /* --- 7. 事件 ----------------------------------------------------------- */

  langBox.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-lang]');
    if (!chip) return;
    state.lang = chip.getAttribute('data-lang');
    render();
  });

  unitBox.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-unit]');
    if (!chip) return;
    state.unit = chip.getAttribute('data-unit');
    render();
  });

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

  [classicEl, htmlEl].forEach(function (el) {
    if (el) el.addEventListener('change', render);
  });

  if (regenBtn) {
    regenBtn.addEventListener('click', function () {
      reshuffle();
      update();
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', function () {
      var text = outputEl.textContent;
      if (!text) { T.util.toast('还没有可下载的内容'); return; }
      var ok = T.util.download('placeholder-text.txt', text);
      T.util.toast(ok ? '已开始下载' : '当前环境不支持下载');
    });
  }

  /* --- 8. 首屏 ----------------------------------------------------------- */

  buildData();
  reshuffle();
  renderLangs();
  renderUnits();
  update();   /* 首屏同步渲染，不走防抖 */
})();
