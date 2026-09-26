/* ==========================================================================
   totp-generator.js — TOTP 动态口令（RFC 6238 / RFC 4226）
   --------------------------------------------------------------------------
   移植自 Praticulus 的 js/tools/totp-generator.js（MIT）。保留下来的：
   Base32 密钥 + 口令 + 倒计时 + 位数 / 周期 / 算法三个选项 + otpauth 二维码
   与链接 + 「填入示例」这个信息架构。

   改动清单
   --------
   1. 全量中文化；统一到本站设计系统（canvas 二维码 → SVG，颜色只用 CSS 变量）。
   2. **非安全上下文下 `crypto.subtle` 不存在，整个工具不可用。** 上游把异常吞进
      `.catch` 里显示一个「Error」，跟真实原因毫无关系。现在走 `js/hash-utils.js`：
      优先平台实现、回落纯 JS（已对 OpenSSL 逐个校验），并把走的是哪条路写在页面上。
   3. **Base32 解码过于宽松。** 上游接受「残留位非零」与「非法分组长度」的输入 ——
      实测 `AB`、`ABC`、`MZXW6YTBO` 都会被解成一个**看起来正常**的密钥，
      于是口令永远对不上、却没有任何提示。现在严格校验并逐条说清原因
      （第几个字符、长度、填充位置与个数、残留位）。
   4. **不检查密钥长度。** RFC 4226 §4 R6 要求共享密钥「MUST be at least 128 bits」，
      上游对一个 40 位的密钥照样算。现在短于 64 位会明确警告。
   5. **异步算口令没有防竞态。** 上游在 `then` 里直接写结果：改动密钥 / 周期时，
      先发出的 Promise 可能后到，把**过期的口令**盖在新的上面
      （表现为「改完选项口令还是旧的」）。现在用递增令牌丢弃过期结果。
   6. **otpauth URI 的编码不合规。** 上游把账号与发行方里的「:」直接**删掉**
      （静默改动用户输入），又把整个 label 一起 `encodeURIComponent`
      （连分隔用的冒号也编成 `%3A`）。现在按 Key URI Format 拆成
      `encodeURIComponent(发行方) + ':' + encodeURIComponent(账号)`。
   7. **二维码与 otpauth 链接本身就是明文密钥。** 上游的密钥输入框不遮罩，
      所以没有这个问题；本实现默认遮罩，因此「显示」必须同时管住
      输入框、二维码与链接三处 —— 只改输入框的 `type` 那个开关是假的。
   8. 二维码改用 SVG（canvas 拿不到 2d 上下文时上游整块消失，且缩放会糊），
      并把「密钥抄错」这类问题挡在算口令之前。
   9. 无障碍：上游把口令与链接做成可点的 `<div>`，只给链接补了键盘处理。
      现在口令是按钮（键盘可达），链接是 `<button>`，隐藏时 `disabled` 并写明原因。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T || !T.util || !T.hash || !T.qr) return;

  var util = T.util;
  var H = T.hash;
  var Q = T.qr;

  var ui = {
    err: document.getElementById('totp-error'),
    secret: document.getElementById('totp-secret'),
    secretStatus: document.getElementById('totp-secret-status'),
    opts: document.getElementById('totp-opts'),
    code: document.getElementById('totp-code'),
    codeLive: document.getElementById('totp-code-live'),
    bar: document.getElementById('totp-bar'),
    remaining: document.getElementById('totp-remaining'),
    copyBtn: document.getElementById('totp-copy'),
    status: document.getElementById('totp-status'),
    account: document.getElementById('totp-account'),
    issuer: document.getElementById('totp-issuer'),
    qr: document.getElementById('totp-qr'),
    uri: document.getElementById('totp-uri'),
    uriText: document.getElementById('totp-uri-text'),
    parts: document.getElementById('totp-parts'),
    revealBtn: document.getElementById('totp-reveal'),
    demoBtn: document.getElementById('totp-demo'),
    clearBtn: document.getElementById('totp-clear')
  };

  /* 依赖缺失时必须给可见提示，否则整页看着是「静默失效」的 */
  function bail(msg) {
    if (!ui.err) { util.toast(msg); return; }
    ui.err.textContent = msg;
    ui.err.hidden = false;
  }

  if (!ui.secret || !ui.code || !ui.opts) {
    bail('页面结构不完整，工具没有启动。');
    return;
  }

  /* --- 1. 常量 ----------------------------------------------------------- */

  /* Google Authenticator 文档里那个经典示例密钥（对应 ASCII "Hello!" + 4 字节），
     是公开的测试值，不是任何人的真实凭据。 */
  var SAMPLE = 'JBSWY3DPEHPK3PXP';

  /* Key URI Format 只定义了 6 与 8 位；RFC 4226 §5.3 要求「至少能出 6 位，
     可能还有 7 与 8 位」，但只要不是 6/8，各家验证器就未必认。 */
  var OPT_DEFS = [
    { id: 'digits', label: '位数', values: ['6', '8'] },
    { id: 'period', label: '周期（秒）', values: ['30', '60'] },
    { id: 'algo', label: '算法', values: ['SHA-1', 'SHA-256', 'SHA-512'] }
  ];

  /* RFC 4226 §4 R6：共享密钥「MUST be at least 128 bits」。
     服务商实际普遍只发 80 位（16 个 Base32 字符），所以 128 位这一档
     只写进说明区；这里只在明显太短（< 64 位）时报警告。 */
  var WARN_BITS = 64;

  var state = {
    revealed: false,
    bytes: null,        /* 解出来的密钥字节 */
    error: null,        /* base32Decode 给的错误对象 */
    opts: { digits: 6, period: 30, algo: 'SHA-1' },
    raw: '',            /* 当前口令（不含分组空格），供复制用 */
    counter: null,
    key: '',
    seq: 0,
    painted: null       /* 'empty' | 'secret'：避免每 200ms 重建一遍 DOM */
  };

  /* --- 2. 选项胶囊 ------------------------------------------------------- */

  var groups = {};

  function renderOpts() {
    OPT_DEFS.forEach(function (d) {
      var box = document.createElement('div');
      box.className = 'opt-row';

      var lab = document.createElement('span');
      lab.className = 'opt-label';
      lab.id = 'totp-' + d.id + '-label';
      lab.textContent = d.label;

      var row = document.createElement('div');
      row.className = 'choice-row';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-labelledby', lab.id);
      row.id = 'totp-' + d.id;

      d.values.forEach(function (v) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-chip';
        btn.setAttribute('data-value', v);
        btn.setAttribute('aria-pressed', String(String(state.opts[d.id]) === v));
        btn.textContent = v;
        row.appendChild(btn);
      });

      groups[d.id] = row;
      box.appendChild(lab);
      box.appendChild(row);
      ui.opts.appendChild(box);
    });

    /* 没有 BigInt 又没有平台实现时，SHA-512 算不出来。
       直接禁用并说清原因 —— 灰着不解释，用户只会反复点它。 */
    if (!H.canUse('SHA-512')) {
      var chip = groups.algo.querySelector('[data-value="SHA-512"]');
      if (chip) {
        chip.disabled = true;
        chip.title = '当前环境算不了 SHA-512：浏览器没提供 crypto.subtle（非安全上下文），' +
          '而纯 JS 实现需要 BigInt。SHA-1 与 SHA-256 不受影响。';
      }
      if (state.opts.algo === 'SHA-512') selectOpt('algo', 'SHA-1');
    }
  }

  function activeOpt(id) {
    var on = groups[id].querySelector('[aria-pressed="true"]');
    return on ? on.getAttribute('data-value') : null;
  }

  function selectOpt(id, value) {
    [].forEach.call(groups[id].querySelectorAll('.choice-chip'), function (c) {
      c.setAttribute('aria-pressed', String(c.getAttribute('data-value') === value));
    });
  }

  function readOpts() {
    state.opts.digits = Number(activeOpt('digits')) || 6;
    state.opts.period = Number(activeOpt('period')) || 30;
    state.opts.algo = activeOpt('algo') || 'SHA-1';
  }

  /* --- 3. 密钥校验 ------------------------------------------------------- */

  /**
   * 写状态行。语义色（`is-ok` / `is-error` / `is-warn`）按本站约定加在**子 span**
   * 上 —— `css/tool.css` 里写的是 `.tool-status .is-error` 这个后代选择器，
   * 加在同一个元素上不生效（样子是灰的，颜色与加粗都吃不到）。
   * 用建节点而不是 innerHTML：文案里会带用户输入的片段（「第 16 个字符」）。
   */
  function paintStatus(el, level, text) {
    if (!el) return;
    el.textContent = '';
    if (!text) return;
    if (!level) { el.textContent = text; return; }
    var span = document.createElement('span');
    span.className = 'is-' + level;
    span.textContent = text;
    el.appendChild(span);
  }

  function setSecretStatus(level, text) {
    paintStatus(ui.secretStatus, level, text);
  }

  /**
   * 读输入框、解 Base32、更新校验提示。
   * @returns {boolean} 密钥是否可用
   */
  function readSecret() {
    var raw = ui.secret.value;

    if (raw.trim() === '') {
      state.bytes = null;
      state.error = null;
      ui.secret.classList.remove('input--invalid');
      setSecretStatus('', '还没填密钥。');
      return false;
    }

    var res = H.base32Decode(raw);
    if (res.error) {
      state.bytes = null;
      state.error = res.error;
      ui.secret.classList.add('input--invalid');
      setSecretStatus('error', res.error.message);
      return false;
    }

    state.bytes = res.bytes;
    state.error = null;
    ui.secret.classList.remove('input--invalid');

    var bits = res.bytes.length * 8;
    if (bits < WARN_BITS) {
      setSecretStatus('warn',
        '密钥只有 ' + bits + ' 位（' + res.bytes.length + ' 字节）—— 短得能被离线暴力猜出来。');
    } else {
      setSecretStatus('ok',
        '密钥有效 · ' + res.bytes.length + ' 字节（' + bits + ' 位）。');
    }
    return true;
  }

  /* --- 4. 口令计算 ------------------------------------------------------- */

  /** 计数器 → 8 字节大端（RFC 4226 §5.1：C 是 8 字节的整数） */
  function counterBytes(counter) {
    var buf = new Uint8Array(8);
    var c = counter;
    for (var i = 7; i >= 0; i--) {
      buf[i] = c % 256;
      c = Math.floor(c / 256);
    }
    return buf;
  }

  /**
   * RFC 4226 §5.3 的动态截断。
   * 「Return the Last 31 bits of P」—— 屏蔽最高位是为了避开有符号 / 无符号取模的
   * 歧义（RFC 原文这么写的），少了这个 `& 0x7f`，约一半的口令会算错。
   */
  function truncate(mac, digits) {
    var offset = mac[mac.length - 1] & 0x0f;
    var bin = ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16) |
      ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff);
    var code = String(bin % Math.pow(10, digits));
    while (code.length < digits) code = '0' + code;
    return code;
  }

  /**
   * 算某个计数器对应的口令。有平台实现就走平台实现，否则走纯 JS ——
   * 两条路的结果由 hash-utils 的套件保证一致，页面这里只负责把「哪条路」报出来。
   * @returns {Promise<string|null>} 过期结果返回 null
   */
  function codeFor(counter, token) {
    var algo = state.opts.algo;
    var key = state.bytes;
    var msg = counterBytes(counter);

    var p = H.hmacAsync(algo, key, msg);
    if (p) {
      return p.then(function (mac) {
        if (!mac) mac = H.hmac(algo, key, msg);
        return mac && token === state.seq ? truncate(mac, state.opts.digits) : null;
      });
    }
    var mac = H.hmac(algo, key, msg);
    return Promise.resolve(mac && token === state.seq ? truncate(mac, state.opts.digits) : null);
  }

  /** 6 位 → 「123 456」，8 位 → 「1234 5678」。只影响显示，复制的是原串。 */
  function group(code) {
    var mid = Math.ceil(code.length / 2);
    return code.slice(0, mid) + ' ' + code.slice(mid);
  }

  function paintCode(code) {
    state.raw = code;
    ui.code.textContent = code ? group(code) : '—';
    ui.code.setAttribute('data-state', code ? 'ok' : 'empty');
    ui.code.title = code ? '点击复制 ' + code + '（不含空格）' : '还没有可复制的口令';
    ui.copyBtn.disabled = !code;
    ui.copyBtn.title = code
      ? '复制 ' + code + '（不含空格）'
      : '还没有可复制的口令 —— 先填入一个合法的 Base32 密钥';
  }

  /* --- 5. 每秒一跳 ------------------------------------------------------- */

  function now() { return Date.now(); }

  function tick() {
    var period = state.opts.period;
    var ms = now();
    var epoch = Math.floor(ms / 1000);
    var counter = Math.floor(epoch / period);
    var leftMs = period * 1000 - (ms % (period * 1000));
    var left = Math.ceil(leftMs / 1000);

    if (!state.bytes) { showEmpty(); return; }

    ui.bar.style.width = (leftMs / (period * 1000) * 100).toFixed(2) + '%';
    ui.bar.setAttribute('data-state', left <= 5 ? 'crit' : left <= 10 ? 'low' : 'ok');
    ui.remaining.textContent = '还剩 ' + left + ' 秒 · 每 ' + period + ' 秒换一次口令';

    /* 计数器没变、选项也没变，就只更新倒计时，不重算也不重绘 ——
       每秒重算一次没意义，还会让 aria-live 反复播报同一个口令。 */
    var key = H.hex(state.bytes) + '|' + state.opts.digits + '|' +
      state.opts.period + '|' + state.opts.algo;

    if (state.painted === 'secret' && counter === state.counter && key === state.key) return;
    state.painted = 'secret';
    state.counter = counter;
    state.key = key;

    paintParts(epoch, counter);

    var token = ++state.seq;
    codeFor(counter, token).then(function (code) {
      /* token 不是最新的说明这次算的已经过期（密钥 / 选项在算的过程中被改了），
         丢掉它，别把关公的刀盖到秦琼的结果上。 */
      if (code === null) return;
      paintCode(code);
    }).catch(function () {
      if (token !== state.seq) return;
      paintCode('');
      setSecretStatus('error', '算不出口令：' + state.opts.algo + ' 在当前环境不可用。');
    });
  }

  /** 没有可用密钥时的呈现。只在状态切换时重绘一次，别每个 tick 都重建 DOM。 */
  function showEmpty() {
    if (state.painted === 'empty') return;
    state.painted = 'empty';
    state.counter = null;
    state.key = '';
    state.seq++;                    /* 让在途的结果作废 */
    ui.bar.style.width = '0%';
    ui.bar.setAttribute('data-state', 'ok');
    ui.remaining.textContent = '填入密钥后开始计时';
    paintCode('');
    ui.parts.textContent = '';
    util.emptyHint(ui.parts, '还没有可以拆解的东西',
      '填一个合法的 Base32 密钥，这里会列出这次口令的全部输入。', 'totp-empty');
  }

  /* --- 6. 本次口令的输入（排查用） --------------------------------------- */

  function row(label, value) {
    return { label: label, value: value };
  }

  function paintParts(epoch, counter) {
    var bytes = state.bytes;
    var rows = [
      row('当前时刻', String(epoch) + ' 秒（Unix 时间）'),
      row('步长 X', String(state.opts.period) + ' 秒'),
      row('计数器 T', String(counter) + '（⌊' + epoch + ' ÷ ' + state.opts.period + '⌋）'),
      row('HMAC 输入', H.hex(counterBytes(counter)) + '（计数器，8 字节大端）'),
      row('算法 / 密钥', state.opts.algo + ' · ' + bytes.length + ' 字节（' + bytes.length * 8 + ' 位）'),
      row('计算方式', H.hasSubtle() ? '浏览器原生 crypto.subtle' : '纯 JS 实现（没有 crypto.subtle）')
    ];

    ui.parts.textContent = '';
    rows.forEach(function (r) {
      var div = document.createElement('div');
      div.className = 'value-row';
      var l = document.createElement('span');
      l.className = 'value-label';
      l.textContent = r.label;
      var v = document.createElement('span');
      v.className = 'value-text';
      v.textContent = r.value;
      div.appendChild(l);
      div.appendChild(v);
      ui.parts.appendChild(div);
    });
  }

  /* --- 7. otpauth 链接与二维码 ------------------------------------------- */

  /**
   * 按 Key URI Format 拼链接。
   *
   * label 由「发行方:账号」两部分组成，**冒号是分隔符本身**，所以要把两部分
   * 分别编码、再把冒号原样放回去；整体一起编码会把冒号变成 %3A。
   * 上游更省事：直接把账号与发行方里的冒号删掉 —— 那是静默改用户的输入。
   */
  function buildUri() {
    if (!state.bytes) return '';
    var algo = state.opts.algo.replace(/-/g, '');
    var account = ui.account.value.trim();
    var issuer = ui.issuer.value.trim();
    var label = (issuer ? encodeURIComponent(issuer) + ':' : '') +
      encodeURIComponent(account || '工具箱');

    var params = ['secret=' + H.base32Encode(state.bytes)];
    if (issuer) params.push('issuer=' + encodeURIComponent(issuer));
    params.push('algorithm=' + algo);
    params.push('digits=' + state.opts.digits);
    params.push('period=' + state.opts.period);

    return 'otpauth://totp/' + label + '?' + params.join('&');
  }

  function qrPlaceholder(strong, desc) {
    ui.qr.textContent = '';
    util.emptyHint(ui.qr, strong, desc, 'totp-qr-empty');
  }

  function renderQr() {
    if (!state.bytes) {
      qrPlaceholder('还没有二维码', '填入一个合法的 Base32 密钥后，这里会出现可以扫进验证器的二维码。');
      return;
    }
    /* 密钥遮着的时候不能画二维码 —— 二维码就是明文密钥的另一种写法，
       画出来「隐藏」就成了假开关。 */
    if (!state.revealed) {
      qrPlaceholder('二维码已隐藏', '它和密钥是同一份信息。点右上角「显示」后再生成。');
      return;
    }
    if (typeof qrcode === 'undefined') {
      qrPlaceholder('二维码引擎没加载上', '口径计算不受影响；otpauth 链接照样可以手动导入。');
      return;
    }

    /* qrcode-generator 默认按 Latin-1 处理字符串，这里全是 ASCII，
       不过统一换成 UTF-8 更保险（发行方 / 账号里可能有中文）。 */
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

    var uri = buildUri();
    var qr;
    try {
      qr = qrcode(0, 'M');
      qr.addData(uri);
      qr.make();
    } catch (e) {
      qrPlaceholder('内容太长，装不进二维码', '缩短发行方或账号，或者直接把下面的链接贴进验证器。');
      return;
    }

    /* 二维码固定深模块 + 白底，**不跟随主题**：反色（浅模块 + 深底）
       有相当一部分扫描器读不出来，这是历史实现问题，代价却很高。
       这里插的是 T.qr 用布尔矩阵拼出来的 SVG，字符串里没有任何用户输入
       （颜色是常量、aria-label 是常量），所以走 innerHTML 是安全的。 */
    ui.qr.innerHTML = Q.toSvg(qr, {
      dim: '100%',
      fg: '#111111',
      bg: '#ffffff',
      style: 'square',
      label: 'otpauth 二维码'
    });
  }

  function renderUri() {
    var uri = buildUri();
    if (!ui.uriText) return;
    if (!state.bytes) {
      ui.uri.disabled = true;
      ui.uri.title = '还没有密钥 —— 先填入一个合法的 Base32 密钥';
      ui.uriText.textContent = '填入密钥后这里会给出 otpauth:// 链接';
      return;
    }
    if (!state.revealed) {
      /* 链接里 `secret=` 后面就是密钥原文，所以它必须跟着「显示」一起走 */
      ui.uri.disabled = true;
      ui.uri.title = '密钥正遮着，链接里带着明文密钥 —— 点「显示」后再看';
      ui.uriText.textContent = '已隐藏 —— 这个链接里就是你的密钥原文';
      return;
    }
    ui.uri.disabled = false;
    ui.uri.title = '点击复制这个链接';
    ui.uriText.textContent = uri;
  }

  /* --- 8. 显示 / 隐藏 ---------------------------------------------------- */

  /**
   * 这个开关管三处：输入框、二维码、otpauth 链接。
   * 三处里漏掉任何一处，「隐藏」都只是装饰 —— 因为二维码和链接本身就是
   * 明文密钥的另外两种写法。
   */
  function setRevealed(on) {
    state.revealed = on;
    ui.secret.setAttribute('type', on ? 'text' : 'password');
    if (ui.revealBtn) {
      /* 文案换的是「动作」而不是「状态名」，所以不用 aria-pressed
         （那会让屏幕阅读器把它读成「已按下的开关」）。 */
      ui.revealBtn.textContent = on ? '隐藏' : '显示';
      ui.revealBtn.title = on
        ? '重新遮住密钥，同时收起二维码与 otpauth 链接'
        : '显示密钥原文，并生成二维码与 otpauth 链接';
    }
    renderQr();
    renderUri();
  }

  /* --- 9. 整体重绘 ------------------------------------------------------- */

  function refresh() {
    readOpts();
    if (!readSecret()) {
      showEmpty();
      renderQr();
      renderUri();
      setFoot();
      return;
    }
    state.key = '';        /* 清掉缓存键，强制下一跳重算 */
    state.painted = null;
    renderQr();
    renderUri();
    tick();
    setFoot();
  }

  function setFoot() {
    paintStatus(ui.status, state.bytes ? 'ok' : '',
      state.bytes ? '全部计算都在本机完成 · 没有网络请求 · 不会保存' : '');
  }

  /* --- 10. 事件 ---------------------------------------------------------- */

  function onChipClick(e) {
    var chip = e.target.closest ? e.target.closest('.choice-chip') : null;
    if (!chip || chip.disabled) return;
    var id = chip.parentNode.id.replace('totp-', '');
    selectOpt(id, chip.getAttribute('data-value'));
    refresh();
  }

  /* 密钥防抖：每敲一个字符都解一次 Base32 不值得，但延迟太长会「看起来卡住」 */
  var debouncedRefresh = util.debounce(refresh, 140);

  ui.secret.addEventListener('input', debouncedRefresh);
  ui.secret.addEventListener('blur', function () {
    if (ui.secret.value.trim() !== '' && state.error) {
      /* 失焦时再报一次，并保留标红 —— 用户刚离开这个框，这会儿最想看到原因 */
      setSecretStatus('error', state.error.message);
    }
  });

  ui.opts.addEventListener('click', onChipClick);

  ui.account.addEventListener('input', util.debounce(function () {
    renderQr();
    renderUri();
  }, 140));
  ui.issuer.addEventListener('input', util.debounce(function () {
    renderQr();
    renderUri();
  }, 140));

  if (ui.revealBtn) {
    ui.revealBtn.addEventListener('click', function () { setRevealed(!state.revealed); });
  }

  if (ui.copyBtn) {
    ui.copyBtn.addEventListener('click', function () {
      if (state.raw) util.copy(state.raw, ui.copyBtn);
    });
  }

  /* 点口令本身也能复制（鼠标便利），键盘可达的路是旁边那个按钮 */
  ui.code.addEventListener('click', function () {
    if (state.raw) util.copy(state.raw, ui.copyBtn);
  });

  ui.uri.addEventListener('click', function () {
    if (ui.uri.disabled) return;
    util.copy(buildUri(), ui.uri);
  });

  if (ui.demoBtn) {
    ui.demoBtn.addEventListener('click', function () {
      ui.secret.value = SAMPLE;
      /* 示例不改动「显示 / 隐藏」的状态：那是用户自己的选择，
         而且这个工具在讲「密钥是凭据」这件事，不该顺手把它亮出来。 */
      refresh();
    });
  }

  if (ui.clearBtn) {
    ui.clearBtn.addEventListener('click', function () {
      ui.secret.value = '';
      ui.account.value = '';
      ui.issuer.value = '';
      ui.secret.classList.remove('input--invalid');
      refresh();
    });
  }

  /* --- 11. 首屏 ---------------------------------------------------------- */

  renderOpts();
  setRevealed(false);
  refresh();
  setInterval(tick, 200);

  /* 标签页切回来时立刻对齐一次：后台标签页的定时器会被浏览器降频，
     倒计时可能停在半路上。 */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) tick();
  });
})();
