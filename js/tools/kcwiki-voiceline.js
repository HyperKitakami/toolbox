/* ==========================================================================
   kcwiki-voiceline.js — KCWiki 语音台词（自研 · 个人工具迁移）
   --------------------------------------------------------------------------
   原型是本机一个单文件 HTML 工具（.temporary/kcwiki-editor/index.html，
   2026-09-24 之前的版本）。这次按本站的设计系统与约定重写了一遍，
   功能对齐原型，结构、交互与容错都改掉了。改动清单：

   1. **删掉了外部字体。** 原型从 Google Fonts 引入两款字体（@import），
      既是站外的一次请求，也让「数据不出浏览器」这条承诺出现缺口。
      改用系统字体栈。
   2. **不再用 innerHTML 拼用户输入。** 原型是 `card.innerHTML = '…' + scene.jp + '…'`，
      台词里只要出现 `</textarea>`、`<` 或 `&`，轻则显示错乱，重则把后面的输入框
      整个吞掉 —— 而且重渲染一次，用户填的内容就没了。现在全部用 DOM API 建节点、
      用 `textContent` / `value` 赋值，用户输入永远不进 HTML 解析器。
      （测试里有一条回归：往台词里塞 `<b>x</b>`，重新渲染后必须是原样文本。）
   3. **事件一律在 JS 里绑。** 原型满屏内联 onclick / oninput / onchange。
   4. **折叠头是原生 <button>。** 原型的折叠头是带 onclick 的 div，
      键盘 Tab 不到、读屏也读不出「可展开」。现在用原生按钮 + aria-expanded
      （后来为了让省略开关常驻，卡片头拆成了「常驻行 div > 折叠按钮 + 开关」两层，
      折叠按钮本身仍是 <button>，见第 12 条）。
   5. **改一处不再整表重绘。** 原型每次折叠、勾省略、切筛选都重建 52 张卡片
      （104 个 textarea），滚动位置与「刚填完那一格」的状态会跳。现在折叠 / 省略 /
      筛选只改对应节点的 class 与 hidden，只有结构变化（增删自定义场合、载入草稿）
      才重绘。也因此不用再管原型里那套「用 indexOf 找回下标」的写法。
   6. **localStorage 全程 try/catch + 写入防抖。** 原型在每次 input 上裸写
      localStorage：隐私模式下会抛 SecurityError 让整个脚本挂掉，正常模式下
      每敲一个字都做一次同步写。现在失败降级为「不保存草稿」并明确告知，
      写入按 300ms 防抖合并。键名也从 wiki_editor_state 换成 toolbox-kcwiki-voiceline。
   7. **生成前做结构自检。** `|` 是 MediaWiki 模板的参数分隔符，台词里混进一个，
      后面的参数会整体错位 —— 原型会静默生成一份结构坏掉的 wikitext。
      现在在结果区给出「哪几条有问题、该怎么写」的提醒（不替用户改文本）。
   8. **清空改成面板内的两步确认条。** 原型是自绘的 modal（内联样式 + 只能鼠标点、
      不带焦点管理）。现在键盘可达、Esc 可取消，jsdom 里也能测。
   9. **场合表原样保留**：28 个常规 + 24 个整点时报，共 52 条，档名后缀与场合名
      与原型逐字一致 —— 改了会让已有草稿对不上档名。
   10. 状态判定的口径没变（日文+中文=已完成，只填一边=部分缺失，勾省略=已省略），
       但筛选胶囊拆出了独立的「未填写」：原型把「已省略」混进「全部缺失」里，
       于是关掉省略的项目仍然被筛出来，看起来像工具没听他的。
   11. **折叠分两层，且都必须真的收起来。** 分组级（内置的常规台词 / 时报，以及
       用户自建的分组）与条目级各自独立、状态一起进草稿。「展开全部」会连分组一起
       展开，否则收起的分组里的条目「展开了也看不见」；「折叠全部」只收条目、
       保留分组标题当目录。
       **条目折叠不能只切 class** —— CSS 里必须有一条真正隐藏正文的规则，否则现象是
       「箭头转了、正文还在」，而 jsdom 不计算样式表、断言 class 名字又发现不了（已踩）。
       所以正文同时挂 `hidden`，让测试能断到真实行为。
   12. **省略开关挪进常驻行，收起时也看得见。** 原先它跟着正文一起被折叠，
       要标「此场合不存在」得先把那条展开 —— 52 条逐条标的时候等于多点一倍次数，
       收起之后也看不到自己勾了哪些。现在开关住在卡片头那一行（折叠时唯一还在的行），
       标签收短成「整条省略」（完整说法留在 title 与页面说明里，窄屏放不下长句）。
       两个连带的处理：① 卡片头不能再整个做成 <button>（按钮里塞不了复选框），
       拆成「常驻行 div > 折叠按钮 + 开关」；② 点击委托里要先排掉 `.kv-omit`，
       否则点复选框会连带把卡片折起来。「删除场合」留在正文里 —— 破坏性操作
       不该在卡片收着的时候顺手就能点到。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  /* --- 0. 取元素 + 依赖检查 ---------------------------------------------- */
  var charEl      = document.getElementById('kv-charid');
  var groupsEl    = document.getElementById('kv-groups');
  var statsEl     = document.getElementById('kv-stats');
  var statusEl    = document.getElementById('kv-status');
  var footEl      = document.getElementById('kv-foot');
  var emptyEl     = document.getElementById('kv-empty');
  var outputEl    = document.getElementById('kv-output');
  var outPanel    = document.getElementById('kv-output-panel');
  var outFootEl   = document.getElementById('kv-out-foot');
  var hideOmitEl  = document.getElementById('kv-hide-omit');
  var confirmEl   = document.getElementById('kv-confirm');
  var confirmYes  = document.getElementById('kv-confirm-yes');
  var confirmNo   = document.getElementById('kv-confirm-no');
  var genBtn      = document.getElementById('kv-generate');
  var clearBtn    = document.getElementById('kv-clear');
  var copyBtn     = document.getElementById('kv-copy');
  var dlBtn       = document.getElementById('kv-download');
  var expandBtn   = document.getElementById('kv-expand');
  var collapseBtn = document.getElementById('kv-collapse');
  var newSuffixEl = document.getElementById('kv-new-suffix');
  var newLabelEl  = document.getElementById('kv-new-label');
  var newGroupEl  = document.getElementById('kv-new-group');
  var addBtn      = document.getElementById('kv-add');
  if (!charEl || !groupsEl) return;

  /* 依赖缺失要吵，不要静默 return —— 静默退出的表现是「界面一片空白、
     控制台一行错都没有」，用户完全无从下手（详见 skill 5c）。 */
  function bail(detail) {
    var wrap = document.createElement('div');
    wrap.className = 'code-empty';
    var strong = document.createElement('strong');
    strong.textContent = '工具没能初始化';
    wrap.appendChild(strong);
    wrap.appendChild(document.createTextNode(detail));
    groupsEl.parentNode.insertBefore(wrap, groupsEl);
  }

  var util = T.util;
  if (!util ||
      typeof util.esc !== 'function' ||
      typeof util.$$ !== 'function' ||
      typeof util.debounce !== 'function' ||
      typeof util.copy !== 'function' ||
      typeof util.download !== 'function') {
    bail('页面加载到的 js/site.js 是旧版本，缺少这个工具需要的公共方法。请强制刷新（Ctrl+F5）后重试。');
    return;
  }

  var STORAGE_KEY = 'toolbox-kcwiki-voiceline';
  var SAVE_DELAY = 300;

  /* --- 1. 场合表（与原型逐字一致，改了会让已有草稿对不上档名） ----------- */
  var KANJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

  function pad4(n) {
    var s = String(n);
    while (s.length < 4) s = '0' + s;
    return s;
  }

  /** 100 → 〇一〇〇，1600 → 一六〇〇（四位数字逐位映射成汉字） */
  function toKanji(n) {
    var s = pad4(n), out = '';
    for (var i = 0; i < 4; i++) out += KANJI[Number(s.charAt(i))];
    return out;
  }

  var MAIN_SCENES = [
    { suffix: 'Intro',         label: '入手/登入时' },
    { suffix: 'Sec1',          label: '秘书舰1' },
    { suffix: 'Sec2',          label: '秘书舰2' },
    { suffix: 'Sec3',          label: '秘书舰3' },
    { suffix: 'ConstComplete', label: '建造完成' },
    { suffix: 'Return',        label: '归来' },
    { suffix: 'Achievement',   label: '战绩' },
    { suffix: 'Equip1',        label: '装备/改修/改造1' },
    { suffix: 'Equip2',        label: '装备/改修/改造2' },
    { suffix: 'DockLightDmg',  label: '小破入渠' },
    { suffix: 'DockMedDmg',    label: '中破入渠' },
    { suffix: 'FleetOrg',      label: '编成' },
    { suffix: 'Sortie',        label: '出征' },
    { suffix: 'Battle',        label: '战斗开始' },
    { suffix: 'Atk1',          label: '攻击1' },
    { suffix: 'Atk2',          label: '攻击2' },
    { suffix: 'NightBattle',   label: '夜战' },
    { suffix: 'LightDmg1',     label: '小破1' },
    { suffix: 'LightDmg2',     label: '小破2' },
    { suffix: 'MedDmg',        label: '中破' },
    { suffix: 'Sunk',          label: '击沉' },
    { suffix: 'MVP',           label: 'MVP' },
    { suffix: 'Proposal',      label: '结婚' },
    { suffix: 'LibIntro',      label: '图鉴介绍' },
    { suffix: 'Equip3',        label: '装备' },
    { suffix: 'Resupply',      label: '补给' },
    { suffix: 'SecWed',        label: '秘书舰（婚后）' },
    { suffix: 'Idle',          label: '放置' }
  ];

  /* 24 个整点时报：档名 0000 / 0100 … 2300，场合名 〇〇〇〇时报 / 〇一〇〇时报 … */
  var HOUR_SCENES = (function () {
    var out = [];
    for (var h = 0; h < 24; h++) {
      out.push({ suffix: pad4(h * 100), label: toKanji(h * 100) + '时报' });
    }
    return out;
  })();

  var BUILTIN_GROUPS = [
    { id: 'main', name: '常规台词' },
    { id: 'hour', name: '时报' }
  ];

  var STATUS_LABEL = {
    complete: '已完成',
    partial: '部分缺失',
    empty: '未填写',
    omitted: '已省略'
  };

  var FILTERS = ['all', 'complete', 'partial', 'empty'];

  /* --- 2. 状态 ----------------------------------------------------------- */
  var state = {
    charId: '',
    filter: 'all',
    hideOmitted: false,
    scenes: [],            // { suffix, label, group, jp, zh, omit, custom, collapsed }
    groups: [],            // 分组 id 数组，顺序即渲染顺序
    groupCollapsed: {}     // 分组 id -> 是否折叠
  };

  function groupName(id) {
    for (var i = 0; i < BUILTIN_GROUPS.length; i++) {
      if (BUILTIN_GROUPS[i].id === id) return BUILTIN_GROUPS[i].name;
    }
    return id;
  }

  function isBuiltinGroup(id) {
    for (var i = 0; i < BUILTIN_GROUPS.length; i++) {
      if (BUILTIN_GROUPS[i].id === id) return true;
    }
    return false;
  }

  function newScene(suffix, label, group, custom) {
    return {
      suffix: suffix,
      label: label,
      group: group,
      jp: '',
      zh: '',
      omit: false,
      custom: !!custom,
      collapsed: true
    };
  }

  function resetState() {
    state.charId = '';
    state.filter = 'all';
    state.hideOmitted = false;
    state.scenes = [];
    MAIN_SCENES.forEach(function (s) { state.scenes.push(newScene(s.suffix, s.label, 'main', false)); });
    HOUR_SCENES.forEach(function (s) { state.scenes.push(newScene(s.suffix, s.label, 'hour', false)); });
    state.groups = ['main', 'hour'];
    state.groupCollapsed = { main: false, hour: false };
  }

  /* --- 3. 判定与查询 ----------------------------------------------------- */
  function statusOf(s) {
    if (s.omit) return 'omitted';
    var jp = s.jp.trim() !== '';
    var zh = s.zh.trim() !== '';
    if (jp && zh) return 'complete';
    if (jp || zh) return 'partial';
    return 'empty';
  }

  function fileOf(s) {
    return (state.charId || '???') + '-' + s.suffix;
  }

  /** 这个场合在当前筛选下是否应该显示 */
  function isVisible(s) {
    var st = statusOf(s);
    if (state.hideOmitted && st === 'omitted') return false;
    if (state.filter !== 'all' && st !== state.filter) return false;
    return true;
  }

  function addWarning(value) {
    return /[|]|\{\{|\}\}/.test(value);
  }

  /* --- 4. DOM 小工具 ----------------------------------------------------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function mkBtn(label, cls, attrs) {
    var b = el('button', cls, label);
    b.type = 'button';
    Object.keys(attrs || {}).forEach(function (k) { b.setAttribute(k, attrs[k]); });
    return b;
  }

  function caret() {
    var c = el('span', 'kv-caret', '▾');
    c.setAttribute('aria-hidden', 'true');
    return c;
  }

  /* --- 5. 渲染 ----------------------------------------------------------- */
  var cardRefs = [];    // 下标 -> .kv-card（每次 renderAll 重建）
  var groupRefs = {};   // 分组 id -> { sec, body, count, toggle }

  /** 一个输入栏：标签 + textarea。值走属性赋值，不拼 HTML。 */
  function buildField(key, lang, labelText, placeholder, value) {
    var wrap = el('div');
    var lab = el('div', 'field-label');
    lab.appendChild(el('span', 'kv-lang kv-lang--' + key, lang));
    lab.appendChild(document.createTextNode(labelText));
    var ta = el('textarea', 'textarea kv-text');
    ta.rows = 3;
    ta.spellcheck = false;
    ta.setAttribute('data-field', key);
    ta.placeholder = placeholder;
    ta.value = value;
    wrap.appendChild(lab);
    wrap.appendChild(ta);
    return wrap;
  }

  function buildCard(s, i) {
    var card = el('div', 'kv-card');
    card.setAttribute('data-index', String(i));
    card.setAttribute('data-status', statusOf(s));
    if (s.collapsed) card.classList.add('kv-card--collapsed');

    /* 常驻行：折叠时这是唯一还留着的一行。
       省略开关就住在这里 —— 放在 .kv-card-body 里的话，要标一个「此场合不存在」
       得先把那条展开（52 条逐条标的时候等于多点一倍次数），而且光标一收起，
       刚勾的框就看不见了，没法回头核对勾没勾对。
       代价是卡片头不能再整个做成 <button>（按钮里不能塞复选框），
       于是拆成 常驻行 div > 折叠按钮 + 开关 两层。 */
    var head = el('div', 'kv-card-head');

    var toggle = el('button', 'kv-card-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(!s.collapsed));
    toggle.appendChild(el('span', 'kv-dot'));
    toggle.appendChild(el('span', 'kv-code', s.suffix));

    var name = el('span', 'kv-name', s.label);
    if (s.custom) name.appendChild(el('span', 'badge badge--planned', '自定义'));
    toggle.appendChild(name);

    toggle.appendChild(el('span', 'kv-file', fileOf(s)));
    toggle.appendChild(caret());
    head.appendChild(toggle);

    var omitWrap = el('label', 'switch kv-omit');
    omitWrap.title = '此场合不存在，整体省略';
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.setAttribute('data-omit', '');
    box.checked = !!s.omit;
    omitWrap.appendChild(box);
    omitWrap.appendChild(el('span', 'kv-omit-text', '整条省略'));
    head.appendChild(omitWrap);

    var body = el('div', 'kv-card-body');
    body.hidden = !!s.collapsed;   /* 与 .kv-card--collapsed 是同一件事，见 syncCard */
    var fields = el('div', 'kv-fields');
    fields.appendChild(buildField('jp', '日文', ' 日文台词', '粘贴日文原文…', s.jp));
    fields.appendChild(buildField('zh', '中文', ' 中文译文', '粘贴中文译文…', s.zh));
    body.appendChild(fields);

    /* 「删除场合」留在正文里：它是破坏性操作，卡片收着的时候不该顺手就能点到 */
    if (s.custom) {
      var foot = el('div', 'kv-card-foot');
      foot.appendChild(mkBtn('删除场合', 'btn btn--sm kv-danger', { 'data-remove': '' }));
      body.appendChild(foot);
    }

    card.appendChild(head);
    card.appendChild(body);
    return card;
  }

  function buildGroup(id) {
    var collapsed = !!state.groupCollapsed[id];

    var sec = el('div', 'kv-group');
    sec.setAttribute('data-group', id);
    if (collapsed) sec.classList.add('kv-group--collapsed');

    var head = el('div', 'kv-group-head');
    var toggle = el('button', 'kv-group-toggle');
    toggle.type = 'button';
    toggle.setAttribute('data-group-toggle', id);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? '展开这一组' : '收起这一组';
    toggle.appendChild(caret());
    toggle.appendChild(el('span', 'kv-group-name', groupName(id)));
    head.appendChild(toggle);

    var count = el('span', 'kv-group-count');
    head.appendChild(count);

    var actions = el('div', 'kv-group-actions');
    actions.appendChild(mkBtn('全部省略', 'btn btn--sm btn--ghost',
      { 'data-batch-omit': '1', 'data-group': id }));
    actions.appendChild(mkBtn('取消省略', 'btn btn--sm btn--ghost',
      { 'data-batch-omit': '0', 'data-group': id }));
    head.appendChild(actions);

    sec.appendChild(head);

    var body = el('div', 'kv-group-body');
    state.scenes.forEach(function (s, i) {
      if (s.group !== id) return;
      var card = buildCard(s, i);
      cardRefs[i] = card;
      body.appendChild(card);
    });
    sec.appendChild(body);

    groupRefs[id] = { sec: sec, body: body, count: count, toggle: toggle };
    return sec;
  }

  /** 整表重绘：只在结构变化时调用（增删自定义场合、清空、载入草稿） */
  function renderAll() {
    groupsEl.innerHTML = '';
    cardRefs = [];
    groupRefs = {};

    state.groups.forEach(function (id) {
      groupsEl.appendChild(buildGroup(id));
    });

    syncVisibility();
  }

  /** 一个卡片的局部同步：状态色、折叠、省略勾选、档名 */
  function syncCard(i) {
    var card = cardRefs[i];
    if (!card) return;
    var s = state.scenes[i];

    card.setAttribute('data-status', statusOf(s));
    card.classList.toggle('kv-card--collapsed', !!s.collapsed);

    var toggle = card.querySelector('.kv-card-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(!s.collapsed));

    /* 正文的收起靠 `hidden`（jsdom 能量到），CSS 里另有一条
       `.kv-card--collapsed .kv-card-body { display: none }` 兜显示 —— 由这一处驱动，不会打架 */
    var body = card.querySelector('.kv-card-body');
    if (body) body.hidden = !!s.collapsed;

    var box = card.querySelector('[data-omit]');
    if (box) box.checked = !!s.omit;

    var file = card.querySelector('.kv-file');
    if (file) file.textContent = fileOf(s);
  }

  /** 按筛选条件与「隐藏已省略」同步每个卡片的可见性，并刷新计数 */
  function syncVisibility() {
    var shown = 0;

    state.scenes.forEach(function (s, i) {
      var card = cardRefs[i];
      if (!card) return;
      var vis = isVisible(s);
      card.hidden = !vis;
      if (vis) shown++;
    });

    state.groups.forEach(function (id) {
      var ref = groupRefs[id];
      if (!ref) return;
      var any = false;
      for (var k = 0; k < ref.body.children.length; k++) {
        if (!ref.body.children[k].hidden) { any = true; break; }
      }
      ref.sec.hidden = !any;
    });

    emptyEl.hidden = shown > 0;
    syncCounts(shown);
  }

  function syncCounts(shown) {
    var c = { complete: 0, partial: 0, empty: 0, omitted: 0 };
    state.scenes.forEach(function (s) { c[statusOf(s)]++; });

    function stat(label, value, mod) {
      return '<div class="stat"><div class="stat-label">' + util.esc(label) + '</div>' +
        '<div class="stat-value' + (mod ? ' ' + mod : '') + '">' + value + '</div></div>';
    }
    statsEl.innerHTML =
      stat('已完成', c.complete, 'stat-value--ok') +
      stat('部分缺失', c.partial, 'stat-value--warn') +
      stat('未填写', c.empty, '') +
      stat('已省略', c.omitted, '');

    state.groups.forEach(function (id) {
      var ref = groupRefs[id];
      if (!ref) return;
      var total = 0, done = 0, omit = 0;
      state.scenes.forEach(function (s) {
        if (s.group !== id) return;
        total++;
        var st = statusOf(s);
        if (st === 'complete') done++;
        if (st === 'omitted') omit++;
      });
      ref.count.textContent = total + ' 条 · 已完成 ' + done + (omit ? ' · 省略 ' + omit : '');
    });

    var total = state.scenes.length;
    footEl.textContent = '共 ' + total + ' 条场合 · ' +
      (shown === total ? '全部显示中' : '当前筛选下显示 ' + shown + ' 条');
  }

  /* --- 6. 状态提示 ------------------------------------------------------- */
  var statusTimer = null;

  /** @param {'ok'|'warn'|'error'|null} kind */
  function setStatus(msg, kind) {
    clearTimeout(statusTimer);
    if (!msg) { statusEl.textContent = ''; return; }
    statusEl.innerHTML = '<span class="is-' + (kind || 'ok') + '">' + util.esc(msg) + '</span>';
    /* 报错留在页面上，成功类提示几秒后自己消失 */
    if (kind !== 'error' && kind !== 'warn') {
      statusTimer = setTimeout(function () { statusEl.textContent = ''; }, 4000);
    }
  }

  function setOutFoot(msg, kind) {
    outFootEl.innerHTML = kind
      ? '<span class="is-' + kind + '">' + util.esc(msg) + '</span>'
      : util.esc(msg);
  }

  /* --- 7. 草稿 ----------------------------------------------------------- */
  var saveTimer = null;
  var storageOk = true;

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DELAY);
  }

  function saveNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        v: 1,
        charId: state.charId,
        filter: state.filter,
        hideOmitted: state.hideOmitted,
        groups: state.groups,
        groupCollapsed: state.groupCollapsed,
        scenes: state.scenes.map(function (s) {
          return {
            suffix: s.suffix, label: s.label, group: s.group,
            jp: s.jp, zh: s.zh, omit: !!s.omit,
            collapsed: !!s.collapsed, custom: !!s.custom
          };
        })
      }));
      storageOk = true;
    } catch (e) {
      /* localStorage 在隐私模式 / Cookie 被拦时会抛 SecurityError。
         降级为不保存草稿，但要告诉用户 —— 沉默地丢掉一整份翻译更糟。 */
      if (storageOk) {
        storageOk = false;
        setStatus('这个浏览器不让本页保存草稿（隐私模式？），填写的内容不会被记住。', 'warn');
      }
    }
  }

  /** @returns {boolean} 是否真的恢复出了草稿 */
  function loadDraft() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return false; }
    if (!raw) return false;

    var data = null;
    try { data = JSON.parse(raw); } catch (e) { return false; }
    if (!data || typeof data !== 'object') return false;

    if (typeof data.charId === 'string') state.charId = data.charId;
    if (FILTERS.indexOf(data.filter) >= 0) state.filter = data.filter;
    state.hideOmitted = !!data.hideOmitted;

    if (Array.isArray(data.groups)) {
      data.groups.forEach(function (g) {
        if (typeof g === 'string' && g && state.groups.indexOf(g) < 0) state.groups.push(g);
      });
    }
    if (data.groupCollapsed && typeof data.groupCollapsed === 'object') {
      Object.keys(data.groupCollapsed).forEach(function (k) {
        state.groupCollapsed[k] = !!data.groupCollapsed[k];
      });
    }

    var str = function (v) { return typeof v === 'string' ? v : ''; };

    if (Array.isArray(data.scenes)) {
      data.scenes.forEach(function (saved) {
        if (!saved || typeof saved.suffix !== 'string' || !saved.suffix) return;
        var found = null;
        for (var i = 0; i < state.scenes.length; i++) {
          if (state.scenes[i].suffix === saved.suffix) { found = state.scenes[i]; break; }
        }
        if (found) {
          found.jp = str(saved.jp);
          found.zh = str(saved.zh);
          found.omit = !!saved.omit;
          found.collapsed = !!saved.collapsed;
          if (typeof saved.group === 'string' && saved.group) found.group = saved.group;
          return;
        }
        /* 草稿里有、内置场合表里没有的：自定义场合，或者旧版内置场合留下的条目
           —— 当成自定义保留下来，别悄悄丢掉用户填过的东西 */
        var group = typeof saved.group === 'string' && saved.group ? saved.group : 'main';
        var scene = newScene(saved.suffix, str(saved.label) || saved.suffix, group, !!saved.custom);
        scene.jp = str(saved.jp);
        scene.zh = str(saved.zh);
        scene.omit = !!saved.omit;
        scene.collapsed = saved.collapsed !== false;
        state.scenes.push(scene);
      });
    }

    /* 分组顺序：内置两个永远在前，其余按草稿里的顺序去重 */
    state.groups = ['main', 'hour'].concat(state.groups.filter(function (g, i, arr) {
      return g !== 'main' && g !== 'hour' && arr.indexOf(g) === i;
    }));
    state.groups.forEach(function (g) {
      if (typeof state.groupCollapsed[g] === 'undefined') state.groupCollapsed[g] = false;
    });
    return true;
  }

  /* --- 8. 交互：折叠 / 省略 / 筛选 --------------------------------------- */
  function indexOfCard(node) {
    var card = node && node.closest ? node.closest('.kv-card') : null;
    if (!card) return -1;
    return Number(card.getAttribute('data-index'));
  }

  function toggleCollapse(i) {
    if (!state.scenes[i]) return;
    state.scenes[i].collapsed = !state.scenes[i].collapsed;
    syncCard(i);
    saveSoon();
  }

  function setAllCollapsed(val) {
    state.scenes.forEach(function (s, i) {
      s.collapsed = val;
      syncCard(i);
    });
    saveSoon();
  }

  /** 「展开全部」连分组一起展开。
      否则某个分组是收起的，点完「展开全部」它里面仍然一条都看不见 ——
      用户会认为这个按钮没生效。 */
  function expandAll() {
    state.groups.forEach(function (id) {
      if (!state.groupCollapsed[id]) return;
      state.groupCollapsed[id] = false;
      syncGroup(id);
    });
    setAllCollapsed(false);
  }

  /** 「折叠全部」只收条目，分组标题留着 —— 52 条的分组头本身就是一份目录 */
  function collapseAll() {
    setAllCollapsed(true);
  }

  /** 一个分组的折叠同步：类（左箭头方向）、aria、鼠标提示 */
  function syncGroup(id) {
    var ref = groupRefs[id];
    if (!ref) return;
    var collapsed = !!state.groupCollapsed[id];
    ref.sec.classList.toggle('kv-group--collapsed', collapsed);
    ref.toggle.setAttribute('aria-expanded', String(!collapsed));
    ref.toggle.title = collapsed ? '展开这一组' : '收起这一组';
  }

  function toggleGroup(id) {
    state.groupCollapsed[id] = !state.groupCollapsed[id];
    syncGroup(id);
    saveSoon();
  }

  function batchOmit(id, val) {
    state.scenes.forEach(function (s, i) {
      if (s.group !== id) return;
      s.omit = val;
      syncCard(i);
    });
    syncVisibility();
    saveSoon();
    setStatus((val ? '已把「' + groupName(id) + '」整组标记为省略。' : '已取消「' + groupName(id) + '」的省略标记。'));
  }

  function applyFilter(next) {
    state.filter = next;
    chips.forEach(function (c) {
      c.setAttribute('aria-pressed', String(c.getAttribute('data-filter') === next));
    });
    syncVisibility();
    saveSoon();
  }

  var chips = util.$$('[data-filter]').filter(function (c) {
    return FILTERS.indexOf(c.getAttribute('data-filter')) >= 0;
  });

  chips.forEach(function (c) {
    c.addEventListener('click', function () { applyFilter(c.getAttribute('data-filter')); });
  });

  if (hideOmitEl) {
    hideOmitEl.addEventListener('change', function () {
      state.hideOmitted = hideOmitEl.checked;
      syncVisibility();
      saveSoon();
    });
  }

  /* 事件委托：52 张卡片不逐个绑 */
  groupsEl.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    /* 省略开关长在常驻行里、紧挨着折叠按钮，必须先把它挑出来排掉：
       否则点一下复选框就会连带着把卡片折起来（跟「点『全部省略』不该折叠分组」同一个道理） */
    if (t.closest('.kv-omit')) return;

    /* 常驻行整行可点（开关那一块上面已排掉） */
    var head = t.closest('.kv-card-head');
    if (head) { toggleCollapse(indexOfCard(head)); return; }

    /* 这两个是分组标题行里的操作按钮，必须排在「整行可点」之前 */
    var batch = t.closest('[data-batch-omit]');
    if (batch) {
      batchOmit(batch.getAttribute('data-group'), batch.getAttribute('data-batch-omit') === '1');
      return;
    }

    var remove = t.closest('[data-remove]');
    if (remove) { removeCustom(indexOfCard(remove)); return; }

    /* 分组标题整行都能点：标题、条数、行末空白都算折叠这一组 */
    var groupHead = t.closest('.kv-group-head');
    if (groupHead && groupHead.parentNode) {
      toggleGroup(groupHead.parentNode.getAttribute('data-group'));
    }
  });

  groupsEl.addEventListener('input', function (e) {
    var ta = e.target;
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    var key = ta.getAttribute('data-field');
    if (key !== 'jp' && key !== 'zh') return;
    var i = indexOfCard(ta);
    if (i < 0 || !state.scenes[i]) return;

    state.scenes[i][key] = ta.value;
    /* 这里只更新这一张卡片与计数，**不**重新算可见性：
       否则在「部分缺失」筛选下把中文补上，卡片会当场消失，光标一起没了。 */
    syncCard(i);
    syncCounts(visibleCount());
    saveSoon();
  });

  groupsEl.addEventListener('change', function (e) {
    var box = e.target;
    if (!box || !box.hasAttribute || !box.hasAttribute('data-omit')) return;
    var i = indexOfCard(box);
    if (i < 0 || !state.scenes[i]) return;
    state.scenes[i].omit = box.checked;
    syncCard(i);
    syncVisibility();
    saveSoon();
  });

  function visibleCount() {
    var n = 0;
    state.scenes.forEach(function (s, i) {
      if (cardRefs[i] && !cardRefs[i].hidden) n++;
    });
    return n;
  }

  /* --- 9. 角色 ID -------------------------------------------------------- */
  charEl.addEventListener('input', function () {
    state.charId = charEl.value.trim();
    cardRefs.forEach(function (card, i) {
      if (!card) return;
      var file = card.querySelector('.kv-file');
      if (file) file.textContent = fileOf(state.scenes[i]);
    });
    saveSoon();
  });

  /* --- 10. 自定义场合 ---------------------------------------------------- */
  function suffixExists(suffix) {
    for (var i = 0; i < state.scenes.length; i++) {
      if (state.scenes[i].suffix === suffix) return true;
    }
    return false;
  }

  function addCustom() {
    var suffix = newSuffixEl ? newSuffixEl.value.trim() : '';
    var label = newLabelEl ? newLabelEl.value.trim() : '';
    var group = newGroupEl ? newGroupEl.value.trim() : '';
    group = group || label;

    if (!suffix || !label) {
      setStatus('「档名后缀」和「场合名称」都要填。', 'error');
      return;
    }
    if (/[|{}\r\n]/.test(suffix)) {
      setStatus('档名后缀不能包含 | 或花括号 —— 它会出现在 Wikitext 的参数里，破坏模板结构。', 'error');
      return;
    }
    if (suffixExists(suffix)) {
      setStatus('「' + suffix + '」这个档名后缀已经用过了。', 'error');
      return;
    }

    if (state.groups.indexOf(group) < 0) {
      state.groups.push(group);
      state.groupCollapsed[group] = false;
    }
    var scene = newScene(suffix, label, group, true);
    scene.collapsed = false;
    state.scenes.push(scene);

    if (newSuffixEl) newSuffixEl.value = '';
    if (newLabelEl) newLabelEl.value = '';
    if (newGroupEl) newGroupEl.value = '';

    renderAll();
    saveSoon();
    setStatus('已添加「' + label + '」，归到「' + groupName(group) + '」。');
  }

  function removeCustom(index) {
    var s = state.scenes[index];
    if (!s || !s.custom) return;
    var group = s.group;

    state.scenes.splice(index, 1);

    /* 自定义分组空了就一起收掉，别留一个空分组占位置 */
    if (!isBuiltinGroup(group) && !state.scenes.some(function (x) { return x.group === group; })) {
      state.groups = state.groups.filter(function (g) { return g !== group; });
      delete state.groupCollapsed[group];
    }

    renderAll();
    saveSoon();
    setStatus('已删除「' + s.label + '」。');
  }

  /* --- 11. 生成 ---------------------------------------------------------- */
  function generate() {
    var id = state.charId.trim();
    if (!id) {
      setStatus('请先填写角色 ID —— 档名要靠它拼出来。', 'error');
      if (charEl.focus) charEl.focus();
      return false;
    }

    var list = state.scenes.filter(function (s) { return !s.omit; });
    if (!list.length) {
      outputEl.textContent = '';
      setOutFoot('所有场合都被标成了「整体省略」，没有可生成的内容。', 'warn');
      return false;
    }

    var lines = ['{{台词翻译表/页头}}'];
    var risky = 0;

    list.forEach(function (s) {
      lines.push('{{台词翻译表');
      lines.push(' | 档名 = ' + fileOf(s));
      lines.push(' | 场合 = ' + s.label);
      lines.push(' | 日文台词 = ' + s.jp.trim());
      lines.push(' | 中文译文 = ' + s.zh.trim());
      lines.push('}}');
      if (addWarning(s.jp) || addWarning(s.zh)) risky++;
    });
    lines.push('{{页尾}}');

    outputEl.textContent = lines.join('\n');

    var note = '已生成 ' + list.length + ' 条' +
      (state.scenes.length - list.length ? '，跳过 ' + (state.scenes.length - list.length) + ' 条省略' : '');
    if (risky) {
      setOutFoot(note + '；其中 ' + risky + ' 条的台词里含 | 或花括号，会被 MediaWiki 当成参数分隔符，' +
        '需要的话把 | 写成 {{!}}。', 'warn');
    } else {
      setOutFoot(note, 'ok');
    }

    if (outPanel && outPanel.scrollIntoView) {
      outPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return true;
  }

  function downloadName() {
    var base = (state.charId || 'KCWiki语音台词').replace(/[\\/:*?"<>|]/g, '_').trim();
    return (base || 'KCWiki语音台词') + '.txt';
  }

  /* --- 12. 清空（两步确认） ---------------------------------------------- */
  function openConfirm() { confirmEl.setAttribute('data-open', 'true'); }
  function closeConfirm() { confirmEl.setAttribute('data-open', 'false'); }

  function clearAll() {
    state.scenes = state.scenes.filter(function (s) { return !s.custom; });
    state.scenes.forEach(function (s) {
      s.jp = '';
      s.zh = '';
      s.omit = false;
      s.collapsed = true;
    });
    state.groups = state.groups.filter(isBuiltinGroup);
    state.groupCollapsed = { main: false, hour: false };

    outputEl.textContent = '';
    setOutFoot('—', null);
    renderAll();
    saveSoon();
    closeConfirm();
    setStatus('已清空全部台词与自定义场合，角色 ID 保留。');
  }

  /* --- 13. 绑定按钮 ------------------------------------------------------ */
  if (genBtn) genBtn.addEventListener('click', generate);
  if (clearBtn) clearBtn.addEventListener('click', openConfirm);
  if (confirmYes) confirmYes.addEventListener('click', clearAll);
  if (confirmNo) confirmNo.addEventListener('click', closeConfirm);
  if (addBtn) addBtn.addEventListener('click', addCustom);
  if (expandBtn) expandBtn.addEventListener('click', expandAll);
  if (collapseBtn) collapseBtn.addEventListener('click', collapseAll);

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var text = outputEl.textContent || '';
      if (!text) { util.toast('还没有生成内容'); return; }
      util.copy(text, copyBtn);
    });
  }

  if (dlBtn) {
    dlBtn.addEventListener('click', function () {
      var text = outputEl.textContent || '';
      if (!text) { util.toast('还没有生成内容'); return; }
      if (!util.download(downloadName(), text)) util.toast('当前环境不支持下载');
    });
  }

  /* 自定义场合的三个输入框：回车即添加（表单里最常见的习惯） */
  [newSuffixEl, newLabelEl, newGroupEl].forEach(function (input) {
    if (!input) return;
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && confirmEl.getAttribute('data-open') === 'true') closeConfirm();
  });

  /* --- 14. 首屏 ---------------------------------------------------------- */
  resetState();
  var restored = loadDraft();

  /* 把草稿里的筛选项与开关同步回界面 */
  chips.forEach(function (c) {
    c.setAttribute('aria-pressed', String(c.getAttribute('data-filter') === state.filter));
  });
  if (hideOmitEl) hideOmitEl.checked = state.hideOmitted;
  charEl.value = state.charId;

  /* 首屏不走防抖，直接渲染（否则第一次断言会读到空 DOM） */
  renderAll();
  if (restored) setStatus('已恢复上次保存在本机的草稿。');
})();
