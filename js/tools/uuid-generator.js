/* ==========================================================================
   uuid-generator.js — UUID 生成（v1 / v4 / v7）
   --------------------------------------------------------------------------
   移植自 Praticulus 的 uuid-generator（MIT，作者 Jamal Tantaoui / Iris Digital）。
   做了中文化、设计系统统一，并修掉以下缺陷 —— 逐条对照见 THIRD-PARTY.md：

   1. **v1 的节点标识没有设单播/多播位（违反 MUST）。** RFC 9562 §6.10 原文：
      「After generating the 48-bit fully randomized node value, implementations
      MUST set the least significant bit of the first octet of the Node ID to 1.」
      上游直接用随机 6 字节当节点，首字节最低位有一半概率是 0 ——
      那就有可能和真实网卡的 MAC 地址撞上，而这条规范存在的唯一目的就是防这个。
   2. **v7 在同一毫秒内没有顺序（丢掉了 v7 的主要价值）。** RFC 9562 §6.2 专门点名了
      批量场景：「if one thousand UUIDs are generated for the same timestamp, there
      should be sufficient logic for organizing the creation order of those one
      thousand UUIDs」，并给出三种做法。上游一种都没用，所以一次批量生成的 1000 条
      v7 在同一毫秒内**排序是随机的** —— 而「可按时间排序」正是 v7 相对于 v4 的全部意义。
      本工具改用 Method 1（固定位长专用计数器）。
   3. **校验器接受错位的横线。** 上游的正则把 `-?` 逐段可选，于是
      `123456781234-1234-1234-123456789012` 这种**不是合法 UUID 表示**的串也会被判为
      合法。现在只接受「五组标准位置」或「32 位连写」两种形式。
   4. **批量数量不校验。** 上游 `Math.min(parseInt(v) || 10, 1000)`：清空静默变 10、
      填 5000 静默变 1000，界面上没有任何提示。改用 T.util.readInt（标红 + 失焦回退）。
   5. **复制没有降级。** 上游裸调 `navigator.clipboard.writeText`，非安全上下文下
      会直接抛 TypeError。改用 site.js 的全局代理。
   6. **不写 BigInt 字面量。** 上游把 v1 单独拆成一个文件，理由是「用了 10000n 这样的
      字面量，老引擎解析这个文件会失败，会连累 uuid-generator.js」。其实只要改用
      `BigInt(10000)` 调用形式就没有这个问题 —— 文件在任何引擎上都能解析，
      缺 BigInt 时只是运行时不可用，可以优雅降级。本工具因此收成一个文件。
   7. 顺手把 `substr`（Annex B 的遗留 API）换成 `slice`。
   8. 新增：版本/变体的中文名、nil / max UUID 的识别、`urn:uuid:` 前缀与花括号的
      归一化、v7 单调性说明。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;

  /** 依赖缺失时不要静默退出，见 random-string.js 里的同名函数说明 */
  function bail(detail) {
    var box = document.getElementById('uu-list');
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
    var v = document.getElementById('uu-value-text');
    if (v) v.textContent = '';
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
  if (!R || typeof R.bytes !== 'function') {
    bail('js/random-utils.js 没有加载成功。');
    return;
  }

  /* --- 1. 常量 ----------------------------------------------------------- */

  var HEX = '0123456789abcdef';

  var VERSIONS = [
    { id: '4', name: 'v4 随机', randomBits: 122,
      note: '122 位全是随机数。最通用，绝大多数场景直接用这个。' },
    { id: '7', name: 'v7 时间有序', randomBits: 62,
      note: '前 48 位是毫秒时间戳，12 位做单调计数器，62 位随机。排序即插入顺序，适合做主键。' },
    { id: '1', name: 'v1 时间戳', randomBits: 62,
      note: '老系统要的格式。60 位时间戳 + 时钟序列 + 随机节点，同一台机器生成的会被关联起来。' }
  ];
  var VERSION_MAP = {};
  VERSIONS.forEach(function (v) { VERSION_MAP[v.id] = v; });

  var VERSION_NAMES = {
    1: 'v1 时间戳', 2: 'v2 DCE 安全', 3: 'v3 名字（MD5）', 4: 'v4 随机',
    5: 'v5 名字（SHA-1）', 6: 'v6 时间戳（重排）', 7: 'v7 时间有序', 8: 'v8 自定义'
  };

  var MIN_COUNT = 1, MAX_COUNT = 1000;

  /* --- 2. 取元素 --------------------------------------------------------- */

  var versionBox   = document.getElementById('uu-versions');
  var versionNote  = document.getElementById('uu-version-note');
  var upperEl      = document.getElementById('uu-uppercase');
  var noDashEl     = document.getElementById('uu-no-dashes');
  var bracesEl     = document.getElementById('uu-braces');
  var valueText    = document.getElementById('uu-value-text');
  var statsEl      = document.getElementById('uu-stats');
  var statusEl     = document.getElementById('uu-status');
  var countInput   = document.getElementById('uu-count');
  var listEl       = document.getElementById('uu-list');
  var regenBtn     = document.getElementById('uu-regenerate');
  var copyAllBtn   = document.getElementById('uu-copy-all');
  var downloadBtn  = document.getElementById('uu-download');
  var validateIn   = document.getElementById('uu-validate');
  var validateOut  = document.getElementById('uu-validate-result');
  if (!versionBox || !valueText || !listEl || !countInput) return;

  var state = { version: '4', items: [] };

  /* --- 3. 字节与十六进制 ------------------------------------------------- */

  function toHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) {
      s += HEX.charAt(bytes[i] >> 4) + HEX.charAt(bytes[i] & 0x0F);
    }
    return s;
  }

  function pad(n, len) {
    return n.toString(16).padStart(len, '0');
  }

  /** 把 32 位十六进制串写成 8-4-4-4-12 的形式 */
  function hyphenate(h) {
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) +
           '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /* --- 4. 三个版本 ------------------------------------------------------- */

  function uuidv4() {
    var b = R.bytes(16);
    b[6] = (b[6] & 0x0F) | 0x40;   /* 版本 4 */
    b[8] = (b[8] & 0x3F) | 0x80;   /* 变体：RFC 9562 */
    return hyphenate(toHex(b));
  }

  /* v7：48 位毫秒时间戳 + 12 位单调计数器（rand_a）+ 62 位随机（rand_b）。
     RFC 9562 §6.2 的 Method 1：计数器**必须**紧跟在时间戳之后。 */
  var v7State = { lastMs: 0, counter: 0 };

  function uuidv7() {
    var ms = Date.now();

    if (ms > v7State.lastMs) {
      v7State.lastMs = ms;
      /* 随机起点：计数器可预测不影响不可猜测性（rand_b 有 62 位随机），
         但没必要把「这是本毫秒第几条」直接写在脸上 */
      v7State.counter = R.indexes(1, 4096)[0];
    } else {
      v7State.counter++;
      if (v7State.counter > 0x0FFF) {
        /* 计数器回绕：RFC 9562 §6.2 允许把时间戳往前推，以保住单调性 */
        v7State.lastMs++;
        v7State.counter = 0;
      }
    }

    var t = v7State.lastMs;
    var b = R.bytes(16);
    b[0] = Math.floor(t / 1099511627776) & 0xFF;
    b[1] = Math.floor(t / 4294967296) & 0xFF;
    b[2] = Math.floor(t / 16777216) & 0xFF;
    b[3] = Math.floor(t / 65536) & 0xFF;
    b[4] = Math.floor(t / 256) & 0xFF;
    b[5] = t & 0xFF;
    b[6] = ((v7State.counter >> 8) & 0x0F) | 0x70;   /* 版本 7 + 计数器高 4 位 */
    b[7] = v7State.counter & 0xFF;                   /* 计数器低 8 位 */
    b[8] = (b[8] & 0x3F) | 0x80;                     /* 变体：RFC 9562 */
    return hyphenate(toHex(b));
  }

  /* v1：60 位时间戳（1582-10-15 起的 100 纳秒数）+ 时钟序列 + 节点标识。
     节点与时钟序列是**「这台机器」的状态**，所以每次会话只生成一次；
     同一毫秒内靠 sub 计数器补足 100 纳秒精度，否则同一毫秒内会生成完全相同的 UUID。 */
  var v1State = null;

  function ensureV1() {
    if (v1State) return v1State;

    var node = R.bytes(6);
    /* RFC 9562 §6.10：用随机值当节点标识时，**必须**把第一个字节的最低位设成 1
       （单播/多播位），这样永远不会和真实网卡的 MAC 地址冲突 */
    node[0] = node[0] | 0x01;

    var cs = R.bytes(2);
    v1State = {
      node: node,
      clockSeq: (((cs[0] << 8) | cs[1]) & 0x3FFF) | 0x8000,
      lastMs: 0,
      sub: 0,
      /* 不写字面量 10000n —— 那会让老引擎在解析阶段就失败（见文件头第 6 条） */
      k10k: BigInt(10000),
      offset: BigInt(122192928000000000),
      m32: BigInt(0xFFFFFFFF),
      m16: BigInt(0xFFFF),
      m12: BigInt(0x0FFF),
      s32: BigInt(32),
      s48: BigInt(48)
    };
    return v1State;
  }

  function uuidv1() {
    var s = ensureV1();
    var ms = Date.now();

    if (ms > s.lastMs) {
      s.lastMs = ms;
      s.sub = 0;
    } else {
      s.sub++;
      /* 1 毫秒 = 10000 个 100 纳秒刻度；用满就把时间戳往前推一毫秒 */
      if (s.sub > 9999) { s.lastMs++; s.sub = 0; }
    }

    var ts = BigInt(s.lastMs) * s.k10k + BigInt(s.sub) + s.offset;
    var timeLow = Number(ts & s.m32);
    var timeMid = Number((ts >> s.s32) & s.m16);
    var timeHi  = Number((ts >> s.s48) & s.m12) | 0x1000;

    return hyphenate(
      pad(timeLow, 8) + pad(timeMid, 4) + pad(timeHi, 4) +
      pad(s.clockSeq, 4) + toHex(s.node)
    );
  }

  function generate() {
    if (state.version === '7') return uuidv7();
    if (state.version === '1') return uuidv1();
    return uuidv4();
  }

  /* --- 5. 格式化 --------------------------------------------------------- */

  function applyFormat(uuid) {
    if (noDashEl && noDashEl.checked) uuid = uuid.replace(/-/g, '');
    if (upperEl && upperEl.checked) uuid = uuid.toUpperCase();
    if (bracesEl && bracesEl.checked) uuid = '{' + uuid + '}';
    return uuid;
  }

  /* --- 6. 校验器 --------------------------------------------------------- */

  var RE_HYPHEN = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/;
  var RE_PLAIN = /^[0-9a-f]{32}$/;

  /** 去掉 urn:uuid: 前缀与花括号，转小写 */
  function normalizeUuid(s) {
    s = String(s == null ? '' : s).trim().toLowerCase();
    if (s.slice(0, 9) === 'urn:uuid:') s = s.slice(9);
    if (s.charAt(0) === '{' && s.charAt(s.length - 1) === '}') s = s.slice(1, -1);
    return s;
  }

  /**
   * 解析并检查一个 UUID。
   * **只接受两种写法**：五组标准位置，或 32 位连写。
   * 上游把 `-?` 逐段可选，于是错位的横线（`123456781234-1234-…`）也会被放行。
   * @returns {{ok:boolean, reason?:string, ...}}
   */
  function parseUuid(input) {
    var s = normalizeUuid(input);
    if (!s) return { ok: false, reason: 'empty' };

    if (RE_PLAIN.test(s)) {
      s = hyphenate(s);
    } else if (!RE_HYPHEN.test(s)) {
      return { ok: false, reason: 'format' };
    }

    var m = RE_HYPHEN.exec(s);
    var version = parseInt(m[3].charAt(0), 16);
    var variantNibble = parseInt(m[4].charAt(0), 16);

    var variant;
    if ((variantNibble & 0x8) === 0) variant = 'NCS（保留，已废弃）';
    else if ((variantNibble & 0xC) === 0x8) variant = 'RFC 9562（标准）';
    else if ((variantNibble & 0xE) === 0xC) variant = 'Microsoft（保留）';
    else variant = '保留（未来定义）';

    var allZero = s === '00000000-0000-0000-0000-000000000000';
    var allF = s === 'ffffffff-ffff-ffff-ffff-ffffffffffff';

    return {
      ok: true,
      hex: s,
      version: version,
      versionName: allZero ? 'nil（全零）' : (allF ? 'max（全一）' : (VERSION_NAMES[version] || ('版本 ' + version))),
      variant: variant,
      rfcVariant: (variantNibble & 0xC) === 0x8
    };
  }

  function renderValidate() {
    if (!validateIn || !validateOut) return;
    var raw = validateIn.value;
    if (!raw.trim()) { validateOut.innerHTML = ''; return; }

    var r = parseUuid(raw);
    if (!r.ok) {
      validateOut.innerHTML = '<span class="is-error">不是合法的 UUID</span>' +
        ' 格式应当是 8-4-4-4-12 的十六进制，共 32 位；带不带横线、花括号、' +
        'urn:uuid: 前缀都可以，但横线不能错位。';
      return;
    }

    var warn = r.rfcVariant ? '' :
      '<span class="is-warn"> · 变体不是 RFC 9562 标准值，规范里这类 UUID 属于保留</span>';

    validateOut.innerHTML = '<span class="is-ok">合法的 UUID</span> · ' +
      T.util.esc(r.versionName) + ' · 变体 ' + T.util.esc(r.variant) + warn +
      '<span class="err-raw">' + T.util.esc(r.hex) + '</span>';
  }

  /* --- 7. 渲染 ----------------------------------------------------------- */

  function stat(label, value) {
    return '<div class="stat">' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + value + '</div>' +
      '</div>';
  }

  function renderVersions() {
    versionBox.innerHTML = VERSIONS.map(function (v) {
      return '<button class="choice-chip" type="button" data-version="' + v.id + '" ' +
        'aria-pressed="' + (v.id === state.version) + '">' + T.util.esc(v.name) + '</button>';
    }).join('');
  }

  function syncVersions() {
    T.util.$$('.choice-chip', versionBox).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-version') === state.version));
    });
  }

  function renderList(items) {
    listEl.innerHTML = items.map(function (s, i) {
      var id = 'uu-item-' + i;
      return '<button class="value-row" type="button" title="点击复制这一条" ' +
        'data-copy-target="#' + id + '">' +
        '<span class="value-label">#' + (i + 1) + '</span>' +
        '<span class="value-text" id="' + id + '">' + T.util.esc(s) + '</span>' +
        '</button>';
    }).join('');
  }

  function update() {
    syncVersions();
    if (versionNote) versionNote.textContent = VERSION_MAP[state.version].note;

    var count = T.util.readInt(countInput, MIN_COUNT, MAX_COUNT);
    var meta = VERSION_MAP[state.version];

    var items = [];
    for (var i = 0; i < count; i++) items.push(applyFormat(generate()));
    state.items = items;

    valueText.textContent = items[0];
    renderList(items);

    statsEl.innerHTML =
      stat('版本', meta.name) +
      stat('长度', items[0].length + ' 个字符') +
      stat('随机位', meta.randomBits + ' 位') +
      stat('本次批量', count + ' 条');

    statusEl.textContent = '已生成 ' + count + ' 条 ' + meta.name + '，' +
      '单条约 ' + meta.randomBits + ' 位随机。' +
      (state.version === '7' ? '同一毫秒内按生成顺序递增，排序即插入顺序。' : '');
  }

  var render = T.util.debounce(update, 90);

  /* --- 8. 事件 ----------------------------------------------------------- */

  versionBox.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-version]');
    if (!chip) return;
    state.version = chip.getAttribute('data-version');
    render();
  });

  [upperEl, noDashEl, bracesEl].forEach(function (el) {
    if (el) el.addEventListener('change', render);
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

  if (regenBtn) regenBtn.addEventListener('click', update);

  if (copyAllBtn) {
    copyAllBtn.addEventListener('click', function () {
      if (!state.items.length) { T.util.toast('还没有可复制的内容'); return; }
      T.util.copy(state.items.join('\n'), copyAllBtn);
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', function () {
      if (!state.items.length) { T.util.toast('还没有可下载的内容'); return; }
      var ok = T.util.download('uuids.txt', state.items.join('\n'));
      T.util.toast(ok ? '已开始下载' : '当前环境不支持下载');
    });
  }

  if (validateIn) validateIn.addEventListener('input', renderValidate);

  /* --- 9. 首屏 ----------------------------------------------------------- */

  renderVersions();
  update();   /* 首屏同步渲染，不走防抖 */
})();
