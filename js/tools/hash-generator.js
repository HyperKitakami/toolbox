/* ==========================================================================
   hash-generator.js — 哈希摘要生成（MD5 / SHA-1 / SHA-256 / SHA-384 / SHA-512）
   --------------------------------------------------------------------------
   移植自 Praticulus 的 js/tools/hash-generator.js（MIT）。保留下来的：
   文本框 + 文件拖放两种输入、hex / Base64 两种输出、五种算法一次全算并逐行复制、
   以及「粘贴一个期望的摘要看是哪种算法」的比对框。

   改动清单
   --------
   1. 全量中文化；统一到本站设计系统（`.panel` / `.drop-zone` / `.tool-status` /
      `.choice-row`，颜色只用 CSS 变量）。
   2. **非 ASCII 文本的 MD5 算错了（算法错误，可观察）。** 上游把 JS 字符串的
      UTF-16 码元直接当字节塞进 MD5 的 32 位字里，而 SHA 系列走 `TextEncoder`
      的 UTF-8 —— 两套字节，于是：
        · `md5('中文')` 与任何标准工具（`md5sum`、OpenSSL）都对不上，
          而且连「UTF-16LE 的摘要」都不是（码元在 32 位字里互相重叠）；
        · **同一个字符串，粘进文本框与存成文件拖进来，得到的 MD5 不一样**
          （文件路径从 ArrayBuffer 出发，反而是对的）。
      现在所有算法都只吃**字节**，文本统一走 `utf8Bytes()`（UTF-8），
      两条路径给出同一个结果。ASCII 输入的 MD5 上游本来是对的，删掉这个差异。
   3. **`crypto.subtle` 不可用时四个 SHA 全部静默空白。** 上游直接 `crypto.subtle.digest`，
      非安全上下文（`file://`、局域网 IP）下 Promise 链断掉，只剩 MD5 有值 ——
      而界面上没有任何解释。现在走 `js/hash-utils.js`：优先平台实现、回落纯 JS，
      并写明当前走的是哪条路。
   4. **MD5 与 SHA-1 已破，上游照旧不提。** 两者都有公开的碰撞实例，
      MD5 的碰撞是秒级成本。当校验和用没问题，用于签名 / 防篡改则是错的。
      现在这两行带明确标注，并在说明区讲清区别。
   5. **异步结果没有防竞态。** 打字很快时先发出的 `Promise.all` 可能后到，
      把旧文本的摘要盖上去。现在用递增令牌丢弃过期结果。
   6. **复制裸调 `navigator.clipboard`**，没有回退也没有反馈。改走 `T.util.copy`。
   7. **大文件没有上限**，整个读进内存（`crypto.subtle.digest` 没有流式接口，
      但上游没说这件事）。现在给出上限并说明原因与替代方案。
   8. **URL 片段里的输出格式开关去掉了。** 上游把 `#enc=base64` 写进地址栏
      来记住输出格式 —— 安全分类的工具对外承诺「不进 URL」，而这里留着一个
      只为一个布尔值服务的 URL 状态，读代码的人得逐个确认它不含用户数据。
      收益不抵心智负担，去掉（刷新后回到 hex，页面上写明了）。
   9. 补上「当前用的是哪个来源」（文本 / 文件）—— 上游是文件静默压过文本。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T || !T.util || !T.hash) return;

  var util = T.util;
  var H = T.hash;

  var ui = {
    err: document.getElementById('hg-error'),
    input: document.getElementById('hg-input'),
    format: document.getElementById('hg-format'),
    sourceNote: document.getElementById('hg-source-note'),
    clearBtn: document.getElementById('hg-clear'),
    drop: document.getElementById('hg-drop'),
    file: document.getElementById('hg-file'),
    fileInfo: document.getElementById('hg-file-info'),
    fileRemove: document.getElementById('hg-file-remove'),
    rows: document.getElementById('hg-rows'),
    copyAll: document.getElementById('hg-copy-all'),
    compare: document.getElementById('hg-compare'),
    compareOut: document.getElementById('hg-compare-out'),
    status: document.getElementById('hg-status')
  };

  function bail(msg) {
    if (!ui.err) { util.toast(msg); return; }
    ui.err.textContent = msg;
    ui.err.hidden = false;
  }

  if (!ui.input || !ui.rows) {
    bail('页面结构不完整，工具没有启动。');
    return;
  }

  /* --- 1. 常量 ----------------------------------------------------------- */

  /* 顺序就是显示顺序。MD5 与 SHA-1 标注 broken：两者都有公开碰撞实例，
     当校验和用没问题，用于签名 / 防篡改则是错的。 */
  var ALGOS = [
    { name: 'MD5', bits: 128, broken: true },
    { name: 'SHA-1', bits: 160, broken: true },
    { name: 'SHA-256', bits: 256, broken: false },
    { name: 'SHA-384', bits: 384, broken: false },
    { name: 'SHA-512', bits: 512, broken: false }
  ];

  /* 上限是因为 `crypto.subtle.digest` 是「一次性」接口（没有流式更新），
     必须先把整个文件读进内存：读 200 MB 就占 200 MB，还可能把页面卡住。
     纯 JS 那条路同样是整块的。更大的文件请在系统里算。 */
  var MAX_FILE = 128 * 1024 * 1024;

  var FORMATS = [
    { id: 'hex', label: '十六进制' },
    { id: 'base64', label: 'Base64' }
  ];

  var state = {
    source: null,      /* 'text' | 'file' | null */
    bytes: null,       /* 当前要摘要的字节；null = 没有内容 */
    file: null,        /* { name, size } */
    format: 'hex',
    results: {},       /* 算法名 → Uint8Array */
    seq: 0,
    rows: {}
  };

  /* --- 2. 摘要行 --------------------------------------------------------- */

  function buildRows() {
    ALGOS.forEach(function (a) {
      var row = document.createElement('div');
      row.className = 'hash-row';
      row.setAttribute('data-algo', a.name);
      row.setAttribute('data-state', 'empty');

      var head = document.createElement('div');
      head.className = 'hash-head';

      var name = document.createElement('span');
      name.className = 'hash-name';
      name.textContent = a.name;

      var meta = document.createElement('span');
      meta.className = 'hash-meta';

      head.appendChild(name);
      head.appendChild(meta);

      if (a.broken) {
        var warn = document.createElement('span');
        warn.className = 'hash-warn';
        warn.textContent = '已破 · 别用于签名';
        warn.title = a.name + ' 已有公开的碰撞实例：能造出两个内容不同、摘要却一样的输入。' +
          '拿来跟官方公布的校验和比对（防传输损坏）没问题；用来证明「内容没被人改过」则是错的。';
        head.appendChild(warn);
      }

      var copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'btn btn--sm';
      copy.textContent = '复制';
      copy.disabled = true;
      copy.title = '还没有可以复制的摘要';
      head.appendChild(copy);

      var value = document.createElement('code');
      value.className = 'hash-value';

      row.appendChild(head);
      row.appendChild(value);
      ui.rows.appendChild(row);

      state.rows[a.name] = { el: row, value: value, copy: copy, meta: meta, bits: a.bits };
      paintMeta(a.name);
    });
  }

  /**
   * 那行小字跟着输出格式走：Base64 模式下还写着「32 个十六进制字符」会与
   * 下面显示的值对不上。用户在命令行里核对时最常数的就是「位数对不对」，
   * 所以两种格式各给各的数。
   */
  function paintMeta(algoName) {
    var row = state.rows[algoName];
    if (!row) return;
    var bytes = row.bits / 8;
    row.meta.textContent = row.bits + ' 位 · ' + (state.format === 'hex'
      ? (row.bits / 4) + ' 个十六进制字符'
      : (Math.ceil(bytes / 3) * 4) + ' 个 Base64 字符');
  }

  function formatOf(buf) {
    return state.format === 'hex' ? H.hex(buf) : H.toBase64(buf);
  }

  function paintRows() {
    var any = false;
    ALGOS.forEach(function (a) {
      var row = state.rows[a.name];
      var buf = state.results[a.name];
      if (buf === null) {
        row.value.textContent = '当前环境算不了这个算法';
        row.el.setAttribute('data-state', 'unavailable');
        row.copy.disabled = true;
        row.copy.title = '当前环境算不了 ' + a.name;
        return;
      }
      if (!buf) {
        row.value.textContent = '';
        row.el.setAttribute('data-state', 'empty');
        row.copy.disabled = true;
        row.copy.title = '还没有可以复制的摘要';
        return;
      }
      any = true;
      var text = formatOf(buf);
      row.value.textContent = text;
      row.el.setAttribute('data-state', 'ok');
      row.copy.disabled = false;
      row.copy.title = '复制 ' + a.name + ' 摘要（' +
        (state.format === 'hex' ? '十六进制' : 'Base64') + '）';
    });
    if (ui.copyAll) {
      ui.copyAll.disabled = !any;
      ui.copyAll.title = any ? '把所有摘要按「算法: 值」逐行复制' : '还没有可以复制的摘要';
    }
    /* 结果变了就重对一次比对框：用户常常先粘摘要、后填内容 */
    if (ui.compare) checkCompare();
  }

  /* --- 3. 计算 ----------------------------------------------------------- */

  /**
   * 算一种算法。平台认这个算法就用平台实现，否则用纯 JS —— `digestAsync`
   * 对平台不认的算法（MD5 永远如此）返回 null，不会把异常抛进 Promise 链。
   * @returns {Promise<Uint8Array|null>} null 表示当前环境算不了
   */
  function digestOne(name, bytes) {
    var a = H.byName(name);
    if (!a || !H.canUse(name)) return Promise.resolve(null);
    var p = H.digestAsync(name, bytes);
    if (p) return p.then(function (buf) { return buf || a.hash(bytes); });
    return Promise.resolve(a.hash(bytes));
  }

  function compute() {
    var bytes = state.bytes;
    var token = ++state.seq;

    if (!bytes) {
      state.results = {};
      paintRows();
      setFoot();
      return;
    }

    Promise.all(ALGOS.map(function (a) { return digestOne(a.name, bytes); }))
      .then(function (bufs) {
        /* token 不是最新的说明这次算的已经过期（内容在算的过程中被改了），
           丢掉它，别把旧内容的摘要盖上去。 */
        if (token !== state.seq) return;
        state.results = {};
        ALGOS.forEach(function (a, i) { state.results[a.name] = bufs[i]; });
        paintRows();
        setFoot();
      })
      .catch(function () {
        if (token !== state.seq) return;
        state.results = {};
        paintRows();
        util.setStatus(ui.status, 'error', '计算出错 —— 当前环境可能缺少所需的密码学能力。');
      });
  }

  /* --- 4. 来源 ----------------------------------------------------------- */

  function fmtSize(n) {
    if (n < 1024) return n + ' 字节';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function charCount() {
    /* 按码点算，emoji 才不会被算成两个 */
    var s = ui.input.value;
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) i++;
      n++;
    }
    return n;
  }

  /**
   * 画出「当前用的是哪个来源」。两个输入面板都能填，所以**必须有一行说明**
   * 到底在算哪一个 —— 上游是文件静默压过文本，用户看不出结果对应的是谁。
   *
   * 这一行刻意不放在任何一个输入面板里：放哪边都会让人以为只对那一边生效。
   */
  function paintSource() {
    if (state.source === 'file' && state.file) {
      util.setStatus(ui.sourceNote, 'ok',
        '正在算：文件 ' + state.file.name + '（' + fmtSize(state.file.size) + '）');
    } else if (state.source === 'text' && state.bytes) {
      util.setStatus(ui.sourceNote, '',
        '正在算：文本（' + charCount() + ' 个字符，按 UTF-8 编码成字节）');
    } else {
      util.setStatus(ui.sourceNote, '',
        '还没有内容 —— 在下面输入文本，或选一个文件。摘要算的是字节：文本按 UTF-8 编码。');
    }
    if (ui.fileInfo) ui.fileInfo.hidden = !state.file;
    if (ui.fileRemove) ui.fileRemove.hidden = !state.file;
  }

  function setFoot() {
    if (!state.bytes) { util.setStatus(ui.status, '', ''); return; }
    var via = state.source === 'file' ? '文件内容（原始字节）' : '文本（UTF-8）';
    if (!H.hasSubtle()) {
      util.setStatus(ui.status, 'ok',
        '全部在本机计算 · ' + via + ' · 纯 JS 实现（这个环境没有 crypto.subtle）');
      return;
    }
    /* 平台可用时 SHA 系列走原生、MD5 只能走纯 JS（WebCrypto 不实现 MD5）——
       两条路混在一起，值得说明一句；平台不可用时全都是纯 JS，就不必了。 */
    util.setStatus(ui.status, 'ok',
      '全部在本机计算 · ' + via + ' · SHA 系列走浏览器原生 crypto.subtle，' +
      'MD5 没有原生实现、单独走纯 JS');
  }

  function useText() {
    var text = ui.input.value;
    state.source = 'text';
    /* 空文本没有可算的东西；空文件则是有意义的输入（空内容的摘要是固定值），
       所以这里只在文本方向把空串当成「没有内容」。 */
    state.bytes = text === '' ? null : H.utf8Bytes(text);
    state.results = {};
    paintSource();
    compute();
  }

  function useFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE) {
      state.source = null;
      state.bytes = null;
      state.results = {};
      if (ui.fileInfo) ui.fileInfo.hidden = false;
      util.setStatus(ui.fileInfo, 'error',
        '这个文件有 ' + fmtSize(file.size) + '，超过了 ' + fmtSize(MAX_FILE) + ' 的上限。');
      util.setStatus(ui.status, 'warn',
        '原因：浏览器的摘要接口是「一次性」的（crypto.subtle.digest 没有流式更新），' +
        '必须先把整个文件读进内存 —— 大文件会占用同等内存并可能卡住页面。' +
        '这种文件请用系统自带的 sha256sum / certutil 算。');
      paintRows();
      paintSource();
      return;
    }

    var reader = new FileReader();
    reader.onerror = function () {
      util.setStatus(ui.status, 'error', '读不了这个文件 —— 可能已被移动或没有读取权限。');
    };
    reader.onload = function (e) {
      state.file = { name: file.name, size: file.size };
      state.source = 'file';
      state.bytes = new Uint8Array(e.target.result);
      state.results = {};
      if (ui.fileInfo) {
        ui.fileInfo.hidden = false;
        util.setStatus(ui.fileInfo, 'ok',
          file.name + ' · ' + fmtSize(file.size) + ' · 已读取');
      }
      paintSource();
      compute();
    };
    reader.readAsArrayBuffer(file);
  }

  function removeFile() {
    state.file = null;
    if (ui.fileInfo) { ui.fileInfo.hidden = true; ui.fileInfo.textContent = ''; }
    if (ui.file) ui.file.value = '';
    /* 回到文本（可能还是空的）——文件卡消失本身就是「已经移除」的反馈 */
    useText();
  }

  /* --- 5. 输出格式 ------------------------------------------------------- */

  function buildFormats() {
    FORMATS.forEach(function (f) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-chip';
      btn.setAttribute('data-value', f.id);
      btn.setAttribute('aria-pressed', String(f.id === state.format));
      btn.textContent = f.label;
      btn.title = f.id === 'base64'
        ? 'Base64 输出（Subresource Integrity 里用的就是这种写法）'
        : '十六进制输出（小写，跟 sha256sum 的输出一致）';
      ui.format.appendChild(btn);
    });
  }

  function selectFormat(id) {
    state.format = id;
    [].forEach.call(ui.format.querySelectorAll('.choice-chip'), function (c) {
      c.setAttribute('aria-pressed', String(c.getAttribute('data-value') === id));
    });
    ALGOS.forEach(function (a) { paintMeta(a.name); });
    paintRows();
  }

  /* --- 6. 比对 ----------------------------------------------------------- */

  /** 十六进制 / Base64 的字面形态 */
  var RE_HEX = /^[0-9a-fA-F]+$/;
  var RE_B64 = /^[A-Za-z0-9+/]+={0,2}$/;

  /**
   * 把用户粘进来的东西拆成几个候选串，逐个试。
   * 覆盖这几种真实写法：
   *   900150983cd24fb0d6963f7d28e17f72            ← 裸摘要
   *   900150983cd24fb0d6963f7d28e17f72  setup.exe  ← sha256sum 的输出
   *   SHA256 (setup.exe) = 900150…                 ← sha256sum --tag 的输出
   *   90:01:50:98:…                                ← 证书指纹那种冒号分隔
   */
  function candidates(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return [];
    var out = [s];
    var eq = s.lastIndexOf('=');
    if (eq >= 0) out.push(s.slice(eq + 1).trim());
    var parts = s.split(/\s+/);
    if (parts.length > 1) { out.push(parts[0]); out.push(parts[parts.length - 1]); }
    out.push(s.replace(/[\s:]/g, ''));
    return out.filter(function (x, i) {
      return x && out.indexOf(x) === i;
    });
  }

  function matchOne(cand, buf) {
    if (RE_HEX.test(cand)) return H.hex(buf).toLowerCase() === cand.toLowerCase();
    if (RE_B64.test(cand)) return H.toBase64(buf) === cand;
    return false;
  }

  /** 按长度推断这是哪种算法（十六进制 / Base64 都认） */
  function guessByLength(s) {
    var hex = RE_HEX.test(s) ? s.length : null;
    var b64 = !hex && RE_B64.test(s) ? s.length : null;
    for (var i = 0; i < ALGOS.length; i++) {
      var a = ALGOS[i];
      if (hex === a.bits / 4) return a.name;
      /* Base64 的长度：按 4 个字符 3 字节推 */
      if (b64 === Math.ceil(a.bits / 8 / 3) * 4) return a.name;
    }
    return null;
  }

  function checkCompare() {
    var raw = ui.compare.value;
    if (raw.trim() === '') { util.setStatus(ui.compareOut, '', ''); return; }
    if (!state.bytes) {
      util.setStatus(ui.compareOut, '', '先在上面给出内容，才有东西可比。');
      return;
    }

    var cands = candidates(raw);
    for (var i = 0; i < ALGOS.length; i++) {
      var a = ALGOS[i];
      var buf = state.results[a.name];
      if (!buf) continue;
      for (var j = 0; j < cands.length; j++) {
        if (matchOne(cands[j], buf)) {
          util.setStatus(ui.compareOut, 'ok',
            '✓ 与 ' + a.name + ' 的摘要一致' + (a.broken
              ? '。注意 ' + a.name + ' 已不适合用于签名 —— 一致只说明内容相同。' : ''));
          return;
        }
      }
    }

    /* 没命中。**长度能告诉我们用户手里的是哪种算法** —— 说清这一点比
       一句「不匹配」有用得多：算法猜到、值不同，说明内容确实不一样；
       长度都不对，说明可能粘错了东西。 */
    var guess = guessByLength(cands[cands.length - 1]) || guessByLength(cands[0]);
    if (guess) {
      util.setStatus(ui.compareOut, 'error',
        '与这五个摘要都不一致。不过长度像是 ' + guess + ' 的 —— 算法大概没猜错，' +
        '是内容不一样（或者粘贴时漏了字符）。');
    } else {
      util.setStatus(ui.compareOut, 'error',
        '与这五个摘要都不一致，长度也不像任何一种已知摘要（' +
        '十六进制 32/40/64/96/128 位，或对应长度的 Base64）。');
    }
  }

  /* --- 7. 事件 ----------------------------------------------------------- */

  var debouncedText = util.debounce(useText, 140);

  /* 一个监听就够：`useText()` 自己会把来源切回文本 —— 不用另写一个
     「先切来源再算」的监听，那样反而会出现「来源已说文本、结果还是文件」
     这一小段不一致。文件内容留着，随时可以移除。 */
  ui.input.addEventListener('input', debouncedText);

  ui.format.addEventListener('click', function (e) {
    var chip = e.target.closest ? e.target.closest('.choice-chip') : null;
    if (!chip) return;
    selectFormat(chip.getAttribute('data-value'));
  });

  if (ui.clearBtn) {
    ui.clearBtn.addEventListener('click', function () {
      ui.input.value = '';
      state.file = null;
      if (ui.file) ui.file.value = '';
      if (ui.fileInfo) { ui.fileInfo.hidden = true; }
      if (ui.compare) ui.compare.value = '';
      util.setStatus(ui.compareOut, '', '');
      ui.input.classList.remove('input--invalid');
      useText();
      paintSource();
    });
  }

  if (ui.copyAll) {
    ui.copyAll.addEventListener('click', function () {
      var lines = ALGOS.filter(function (a) { return !!state.results[a.name]; })
        .map(function (a) { return a.name + ': ' + formatOf(state.results[a.name]); });
      if (lines.length) util.copy(lines.join('\n'), ui.copyAll);
    });
  }

  /* 每行的复制按钮：用事件委托，别给五行各挂一个监听 */
  ui.rows.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.btn') : null;
    if (!btn) return;
    var row = btn.closest('.hash-row');
    if (!row) return;
    var a = state.results[row.getAttribute('data-algo')];
    if (a) util.copy(formatOf(a), btn);
  });

  if (ui.drop) {
    ui.drop.addEventListener('click', function () { if (ui.file) ui.file.click(); });
    ui.drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (ui.file) ui.file.click(); }
    });
    ui.drop.addEventListener('dragover', function (e) {
      e.preventDefault();
      ui.drop.classList.add('drop-zone--active');
    });
    ui.drop.addEventListener('dragleave', function () {
      if (state.source !== 'file') ui.drop.classList.remove('drop-zone--active');
    });
    ui.drop.addEventListener('drop', function (e) {
      e.preventDefault();
      if (state.source !== 'file') ui.drop.classList.remove('drop-zone--active');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) useFile(f);
    });
  }

  if (ui.file) {
    ui.file.addEventListener('change', function () { if (ui.file.files[0]) useFile(ui.file.files[0]); });
  }
  if (ui.fileRemove) ui.fileRemove.addEventListener('click', removeFile);
  if (ui.compare) {
    ui.compare.addEventListener('input', util.debounce(checkCompare, 120));
  }

  /* --- 8. 首屏 ----------------------------------------------------------- */

  buildRows();
  buildFormats();
  paintSource();
  compute();
})();
