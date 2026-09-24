/* ==========================================================================
   mock-data.js — 测试数据生成
   --------------------------------------------------------------------------
   自研工具：参考仓库 jamalofski/praticulus 里没有对应实现
   （它的文件树里没有任何 mock / fake data 工具）。

   设计取舍写在文件头，因为这是自研工具唯一的「来源说明」：

   1. **生成的每一类数据都要先回答「会不会落到真人身上」。** 测试数据工具最容易
      被忽略的风险就是这个：随手一个随机手机号，可能真的是某人的号。这里的处理：
        - 邮箱只用 RFC 2606 / RFC 6761 的保留域名（example.com 等）—— 永远发不出去；
        - IP 只用 RFC 5737 的三段文档地址 —— 永远不指向真实主机；
        - 身份证号的地址码只用**省级**代码（真实号码用区县级代码），
          格式与校验位正确但不会与真实公民号重合；
        - **不做银行卡号** —— 有 Luhn 校验位，按规则生成就可能是真卡号；
        - **手机号没法两全**：假号段格式就不对，真号段就可能撞真人。选了后者
          （测试数据要的就是格式真实），并在界面上明确警告。
   2. **区县用「通用区名」而不是完整行政区划表。** 城关区 / 新城区 / 朝阳区 / 人民路
      这些名字在全国很多城市都真实存在，配到哪个市都不违和。维护一份几千条的
      完整区划表既臃肿又容易过时，还会生成「浙江省兰州市」这种不存在的组合。
   3. **一行里的字段是自洽的**：身份证号里的生日与「生日」列相同，
      顺序码第 17 位的奇偶与「性别」列相同。造数据时字段之间对不上很常见，
      但对不上的数据拿去测校验逻辑就会误判。
   4. **CSV 带 UTF-8 BOM、行尾用 CRLF。** 没有 BOM 的话 Excel 会按 Latin-1
      打开，中文全乱码 —— 这是导出 CSV 最常见的坑。
   5. 随机源走 js/random-utils.js（crypto），不退回 Math.random。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;

  /** 依赖缺失时不要静默退出，见 random-string.js 里的同名函数说明 */
  function bail(detail) {
    var box = document.getElementById('md-scroll');
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
  var C = T.mockCorpus;
  if (!C) {
    bail('js/mock-data-corpus.js 没有加载成功。');
    return;
  }

  /* --- 1. 字段 ----------------------------------------------------------- */

  var FIELDS = [
    { id: 'name',     label: '姓名' },
    { id: 'gender',   label: '性别' },
    { id: 'mobile',   label: '手机号' },
    { id: 'email',    label: '邮箱' },
    { id: 'address',  label: '地址' },
    { id: 'idcard',   label: '身份证号' },
    { id: 'birthday', label: '生日' },
    { id: 'company',  label: '公司' },
    { id: 'job',      label: '职位' },
    { id: 'ip',       label: 'IP 地址' }
  ];
  var FIELD_MAP = {};
  FIELDS.forEach(function (f) { FIELD_MAP[f.id] = f; });

  var MIN_COUNT = 1, MAX_COUNT = 500;

  /* 港澳台不接通用区名 —— 那里没有「朝阳区」「城关区」这种叫法 */
  var NO_DISTRICT = { '台湾省': 1, '香港特别行政区': 1, '澳门特别行政区': 1 };

  var EMAIL_WORDS = [
    'user', 'test', 'demo', 'sample', 'dev', 'qa', 'admin', 'info',
    'contact', 'hello', 'mail', 'team', 'support', 'service', 'office',
    'studio', 'lab', 'works', 'cloud', 'data'
  ];

  /* --- 2. 取元素 --------------------------------------------------------- */

  var fieldBox    = document.getElementById('md-fields');
  var countInput  = document.getElementById('md-count');
  var scrollEl    = document.getElementById('md-scroll');
  var statsEl     = document.getElementById('md-stats');
  var statusEl    = document.getElementById('md-status');
  var regenBtn    = document.getElementById('md-regenerate');
  var copyCsvBtn  = document.getElementById('md-copy-csv');
  var dlCsvBtn    = document.getElementById('md-download-csv');
  var dlJsonBtn   = document.getElementById('md-download-json');
  if (!fieldBox || !scrollEl || !countInput) return;

  var state = {
    picked: FIELDS.map(function (f) { return f.id; }),   /* 默认全选 */
    rows: []
  };

  /* --- 3. 小工具 --------------------------------------------------------- */

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function digits(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += R.indexes(1, 10)[0];
    return s;
  }

  function daysInMonth(y, m) {
    /* 下个月的第 0 天 = 这个月的最后一天 */
    return new Date(y, m, 0).getDate();
  }

  /* --- 4. 各类字段 ------------------------------------------------------- */

  function genName(gender) {
    var surname = R.pick(C.surnames);
    var pool = gender === '男' ? C.givenM : C.givenF;
    if (R.indexes(1, 2)[0] === 0) return surname + R.pick(pool);   /* 单字名 */

    /* 双字名：取两个不同的字，避免「王伟伟」 */
    var a = R.indexes(1, pool.length)[0];
    var b = R.indexes(1, pool.length - 1)[0];
    if (b >= a) b++;
    return surname + pool[a] + pool[b];
  }

  function genMobile() {
    return R.pick(C.mobilePrefix) + digits(8);
  }

  function genEmail() {
    return R.pick(EMAIL_WORDS) + digits(4) + '@' + R.pick(C.emailDomains);
  }

  function genAddress() {
    var place = R.pick(C.places);
    var city = R.pick(place.cs);
    /* 直辖市与特别行政区的省市同名，别拼成「北京市北京市」 */
    var head = place.p === city ? place.p : place.p + city;
    if (!NO_DISTRICT[place.p]) head += R.pick(C.districts);

    return head + R.pick(C.roads) +
      (1 + R.indexes(1, 999)[0]) + '号' +
      (1 + R.indexes(1, 30)[0]) + '号楼' +
      (1 + R.indexes(1, 2000)[0]) + '室';
  }

  function genBirthday() {
    var year = new Date().getFullYear() - (18 + R.indexes(1, 48)[0]);   /* 18–65 岁 */
    var month = 1 + R.indexes(1, 12)[0];
    var day = 1 + R.indexes(1, daysInMonth(year, month))[0];
    return year + '-' + pad2(month) + '-' + pad2(day);
  }

  /** ISO 7064:1983 MOD 11-2 的校验位 */
  function idChecksum(first17) {
    var W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    var CODE = '10X98765432';
    var sum = 0;
    for (var i = 0; i < 17; i++) sum += Number(first17.charAt(i)) * W[i];
    return CODE.charAt(sum % 11);
  }

  function genIdCard(gender, birthday) {
    /* 地址码只用省级（如 330000）—— 真实身份证号用的是区县级代码，
       所以这样生成的号码不会撞上真实公民号 */
    var head = R.pick(C.provinceCodes) + birthday.replace(/-/g, '');
    /* 顺序码 3 位：第 17 位（也就是顺序码的最后一位）奇数为男、偶数为女 */
    var seq = pad2(R.indexes(1, 100)[0]) +
      (gender === '男'
        ? String(1 + 2 * R.indexes(1, 5)[0])   /* 1 3 5 7 9 */
        : String(2 * R.indexes(1, 5)[0]));     /* 0 2 4 6 8 */
    var first17 = head + seq;
    return first17 + idChecksum(first17);
  }

  function genCompany() {
    return R.pick(C.companyPrefix) + R.pick(C.companyField) + R.pick(C.companySuffix);
  }

  function genIp() {
    return R.pick(C.ipBlocks) + '.' + (1 + R.indexes(1, 254)[0]);
  }

  /** 一行里各字段是自洽的：生日与性别先定，身份证号跟着走 */
  function makeRow() {
    var gender = R.indexes(1, 2)[0] === 0 ? '男' : '女';
    var birthday = genBirthday();
    return {
      name: genName(gender),
      gender: gender,
      mobile: genMobile(),
      email: genEmail(),
      address: genAddress(),
      idcard: genIdCard(gender, birthday),
      birthday: birthday,
      company: genCompany(),
      job: R.pick(C.jobs),
      ip: genIp()
    };
  }

  /* --- 5. 导出 ----------------------------------------------------------- */

  function pickedFields() {
    return FIELDS.filter(function (f) { return state.picked.indexOf(f.id) !== -1; });
  }

  /** RFC 4180：含逗号、引号或换行时用双引号包裹，内部的引号翻倍 */
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV() {
    var fields = pickedFields();
    var lines = [fields.map(function (f) { return csvCell(f.label); }).join(',')];
    state.rows.forEach(function (r) {
      lines.push(fields.map(function (f) { return csvCell(r[f.id]); }).join(','));
    });
    /* BOM 给 Excel 认 UTF-8，CRLF 是 RFC 4180 规定的行尾 */
    return '\uFEFF' + lines.join('\r\n');
  }

  function toJSON() {
    var fields = pickedFields();
    var out = state.rows.map(function (r) {
      var o = {};
      fields.forEach(function (f) { o[f.label] = r[f.id]; });
      return o;
    });
    return JSON.stringify(out, null, 2);
  }

  function byteLength(s) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s).length;
    try { return new Blob([s]).size; } catch (e) { return s.length; }
  }

  /* --- 6. 渲染 ----------------------------------------------------------- */

  function renderFields() {
    fieldBox.innerHTML = FIELDS.map(function (f) {
      return '<button class="choice-chip" type="button" data-field="' + f.id + '" ' +
        'aria-pressed="' + (state.picked.indexOf(f.id) !== -1) + '">' +
        T.util.esc(f.label) + '</button>';
    }).join('');
  }

  function syncFields() {
    T.util.$$('.choice-chip', fieldBox).forEach(function (b) {
      b.setAttribute('aria-pressed',
        String(state.picked.indexOf(b.getAttribute('data-field')) !== -1));
    });
  }

  /**
   * 把表格整个写进滚动容器。
   * **每次都重建 `<table>`，不缓存它的引用** —— 空状态提示会整体替换容器的内容，
   * 缓存下来的 table 引用在那之后就脱离文档了，后面再往里写等于写进一个不在页面上的
   * 节点（踩过一次：一个字段都不选之后，再怎么勾回来表格都是空的）。
   */
  function renderTable(fields) {
    var html = '<table class="data-table" id="md-table"><thead><tr><th class="row-num">#</th>';
    fields.forEach(function (f) { html += '<th>' + T.util.esc(f.label) + '</th>'; });
    html += '</tr></thead><tbody>';
    state.rows.forEach(function (r, i) {
      html += '<tr><td class="row-num">' + (i + 1) + '</td>';
      fields.forEach(function (f) {
        var v = T.util.esc(r[f.id]);
        html += '<td title="' + v + '">' + v + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    scrollEl.innerHTML = html;
  }

  function stat(label, value) {
    return '<div class="stat">' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + value + '</div>' +
      '</div>';
  }

  function fail(msg) {
    state.rows = [];
    statsEl.innerHTML = '';
    T.util.emptyHint(scrollEl, '一个字段都没选',
      '至少要留一列。点上面的字段胶囊可以重新选上。');
    statusEl.innerHTML = '<span class="is-error">' + T.util.esc(msg) + '</span>';
  }

  var now = (window.performance && window.performance.now)
    ? function () { return window.performance.now(); }
    : function () { return Date.now(); };

  function update() {
    syncFields();
    var count = T.util.readInt(countInput, MIN_COUNT, MAX_COUNT);
    var fields = pickedFields();

    if (!fields.length) {
      fail('无法生成：一个字段都没选');
      return;
    }

    var t0 = now();
    var rows = [];
    for (var i = 0; i < count; i++) rows.push(makeRow());
    state.rows = rows;
    var ms = now() - t0;

    renderTable(fields);

    var csv = toCSV();
    var bytes = byteLength(csv);
    statsEl.innerHTML =
      stat('字段数', fields.length + ' 列') +
      stat('记录数', count + ' 条') +
      stat('CSV 大小', bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB') +
      stat('生成耗时', ms < 10 ? ms.toFixed(1) + ' ms' : Math.round(ms) + ' ms');

    statusEl.textContent = '已生成 ' + count + ' 条 × ' + fields.length + ' 列，' +
      '共 ' + (count * fields.length) + ' 个值。' +
      (fields.some(function (f) { return f.id === 'mobile'; })
        ? '手机号是真实号段，别拿去发短信。' : '');
  }

  var render = T.util.debounce(update, 90);

  /* --- 7. 事件 ----------------------------------------------------------- */

  fieldBox.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-field]');
    if (!chip) return;
    var id = chip.getAttribute('data-field');
    var at = state.picked.indexOf(id);
    if (at === -1) state.picked.push(id); else state.picked.splice(at, 1);
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

  if (regenBtn) regenBtn.addEventListener('click', update);

  if (copyCsvBtn) {
    copyCsvBtn.addEventListener('click', function () {
      if (!state.rows.length) { T.util.toast('还没有可复制的内容'); return; }
      T.util.copy(toCSV(), copyCsvBtn);
    });
  }

  if (dlCsvBtn) {
    dlCsvBtn.addEventListener('click', function () {
      if (!state.rows.length) { T.util.toast('还没有可下载的内容'); return; }
      var ok = T.util.download('mock-data.csv', toCSV(), 'text/csv;charset=utf-8');
      T.util.toast(ok ? '已开始下载' : '当前环境不支持下载');
    });
  }

  if (dlJsonBtn) {
    dlJsonBtn.addEventListener('click', function () {
      if (!state.rows.length) { T.util.toast('还没有可下载的内容'); return; }
      var ok = T.util.download('mock-data.json', toJSON(), 'application/json;charset=utf-8');
      T.util.toast(ok ? '已开始下载' : '当前环境不支持下载');
    });
  }

  /* --- 8. 首屏 ----------------------------------------------------------- */

  renderFields();
  update();   /* 首屏同步渲染，不走防抖 */
})();
