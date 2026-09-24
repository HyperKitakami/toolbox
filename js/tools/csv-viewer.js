/* ==========================================================================
   csv-viewer.js — CSV 查看器
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 csv-viewer（MIT），改动：
     1. 界面文案全量中文化
     2. 改用本站的设计系统与组件类名；表格加了行号列、吸顶表头与键盘排序
     3. 修复缺陷：文件开头的 UTF-8 BOM 未剥离。Excel 导出的 CSV 常带 BOM，
        不去掉会让第一列列名多一个不可见字符，导出的 JSON 键名也对不上。
     4. 修复缺陷：分隔符探测直接 split 计数，把引号内的分隔符也算进去，
        于是「单列且值里含分号」的 CSV 会被误判成多列。改为跳过引号片段。
     5. 新增编码探测：UTF-8 严格解码失败则回退 GBK（中文 Excel 导出的常见编码），
        使用浏览器原生 TextDecoder，不引入任何依赖。
     6. 新增分页，避免几十万行一次性渲染卡死页面。
     7. 导出 JSON 时处理空表头与重名表头；TSV 导出对制表符/换行/引号做包裹。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var esc = T.util.esc;

  /* --- DOM --------------------------------------------------------------- */
  var inputEl  = document.getElementById('csv-input');
  var theadEl  = document.getElementById('csv-thead');
  var tbodyEl  = document.getElementById('csv-tbody');
  var tableEl  = document.getElementById('csv-table');
  var emptyEl  = document.getElementById('csv-empty');
  var statsEl  = document.getElementById('csv-stats');
  var statusEl = document.getElementById('csv-status');
  var badgeEl  = document.getElementById('csv-badge');
  var sizeEl   = document.getElementById('csv-size');
  var rangeEl  = document.getElementById('csv-range');

  var headerEl = document.getElementById('csv-header');
  var delimEl  = document.getElementById('csv-delim');
  var encEl    = document.getElementById('csv-encoding');
  var pageSizeEl = document.getElementById('csv-page-size');
  var prevBtn  = document.getElementById('csv-prev');
  var nextBtn  = document.getElementById('csv-next');

  var dropEl   = document.getElementById('csv-drop');
  var fileEl   = document.getElementById('csv-file');

  var parseBtn  = document.getElementById('csv-parse');
  var copyJsonBtn = document.getElementById('csv-copy-json');
  var downloadBtn = document.getElementById('csv-download');
  var copyTsvBtn  = document.getElementById('csv-copy-tsv');

  var demoBtn  = document.querySelector('[data-demo]');
  var clearBtn = document.querySelector('[data-clear]');

  if (!inputEl || !theadEl || !tbodyEl) return;

  /* --- 常量与状态 -------------------------------------------------------- */
  var DELIMS = [',', ';', '\t', '|'];

  var state = {
    headers: [],
    rows: [],
    delim: ',',
    sort: { col: -1, dir: 1 },
    page: 0,
    pageSize: 500
  };

  /* 首屏时 HTML 里预置的示例，作为「载入示例」的模板 */
  var DEMO = inputEl.value;

  /* ======================================================================
     一、解析
     ====================================================================== */

  /** 统计一行里未被引号包裹的某个字符个数 */
  function countUnquoted(line, delim) {
    var n = 0;
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { i++; continue; }
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && ch === delim) n++;
    }
    return n;
  }

  /**
   * 探测分隔符：只看第一个非空行，且跳过引号内的内容。
   * 上游直接 line.split(d) 计数，会把引号里的分隔符也算进去，
   * 于是「单列但值里含分号」的 CSV 会被误判成多列。
   */
  function detectDelimiter(text) {
    var lines = text.split(/\r?\n/);
    var line = '';
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim()) { line = lines[i]; break; }
    }

    var best = ',';
    var bestCount = -1;
    for (var k = 0; k < DELIMS.length; k++) {
      var n = countUnquoted(line, DELIMS[k]);
      if (n > bestCount) { bestCount = n; best = DELIMS[k]; }
    }
    return best;
  }

  /**
   * RFC 4180 常见子集的解析器：处理引号包裹、"" 转义、字段内的分隔符与换行。
   * 相比上游多了一步 BOM 剥离。
   */
  function parseCSV(text, delim) {
    text = String(text)
      .replace(/^\uFEFF/, '')          /* Excel 导出的 UTF-8 常带 BOM */
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    var out = [], row = [], field = '', i = 0, inQuotes = false;

    while (i < text.length) {
      var ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }

      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ''; i++; continue; }
      if (ch === '\n') { row.push(field); out.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }

    row.push(field);
    out.push(row);

    /* 去掉结尾的空行 */
    var lastRow = out[out.length - 1];
    if (out.length && lastRow.length === 1 && lastRow[0] === '') out.pop();

    return out;
  }

  /* ======================================================================
     二、编码
     ====================================================================== */

  /**
   * 把文件字节解码成文本。
   * auto 模式：先按 UTF-8 严格解码，抛错说明不是 UTF-8，回退 GBK。
   */
  function decodeBuffer(buf) {
    var enc = encEl ? encEl.value : 'auto';

    if (enc === 'utf-8') return new TextDecoder('utf-8').decode(buf);
    if (enc === 'gbk') {
      try { return new TextDecoder('gbk').decode(buf); }
      catch (e) { return new TextDecoder('utf-8').decode(buf); }
    }

    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      try { return new TextDecoder('gbk').decode(buf); }
      catch (e2) { return new TextDecoder('utf-8').decode(buf); }
    }
  }

  /* ======================================================================
     三、渲染
     ====================================================================== */

  function num(n) { return Number(n).toLocaleString('zh-CN'); }

  function delimLabel(d) {
    if (d === ',') return '逗号 ,';
    if (d === ';') return '分号 ;';
    if (d === '\t') return '制表符';
    if (d === '|') return '竖线 |';
    return d;
  }

  function stat(label, value, cls) {
    return '<div class="stat">' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value' + (cls ? ' ' + cls : '') + '">' + value + '</div>' +
      '</div>';
  }

  function renderStats() {
    if (!statsEl) return;
    var rows = state.rows.length;
    var cols = state.headers.length;
    statsEl.innerHTML =
      stat('数据行', num(rows)) +
      stat('列数', num(cols)) +
      stat('单元格', num(rows * cols)) +
      stat('分隔符', esc(delimLabel(state.delim)), 'stat-value--sm') +
      stat('输入字符', num(inputEl.value.length));
  }

  function renderTable() {
    var total = state.rows.length;
    var size = state.pageSize;
    var pages = Math.max(1, Math.ceil(total / size));
    if (state.page >= pages) state.page = pages - 1;

    var start = state.page * size;
    var end = Math.min(start + size, total);

    /* 表头 */
    var head = '<tr><th class="row-num" scope="col">#</th>';
    for (var c = 0; c < state.headers.length; c++) {
      var sorted = state.sort.col === c;
      var cls = 'sortable' +
        (sorted ? (state.sort.dir === 1 ? ' sort-asc' : ' sort-desc') : '');
      var aria = sorted ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none';
      head += '<th class="' + cls + '" data-col="' + c + '" tabindex="0" scope="col"' +
        ' aria-sort="' + aria + '">' + esc(state.headers[c]) + '</th>';
    }
    head += '</tr>';
    theadEl.innerHTML = head;

    /* 表体（只渲染当前页） */
    var body = '';
    for (var r = start; r < end; r++) {
      body += '<tr><td class="row-num">' + (r + 1) + '</td>';
      for (var k = 0; k < state.headers.length; k++) {
        var v = state.rows[r][k];
        var s = v == null ? '' : String(v);
        /* 只在内容较长时才加 title，避免几十万行时 HTML 体积膨胀 */
        var tip = s.length > 32 ? ' title="' + esc(s) + '"' : '';
        body += '<td' + tip + '>' + esc(s) + '</td>';
      }
      body += '</tr>';
    }
    tbodyEl.innerHTML = body;

    renderPager(total, start, end);
  }

  function renderPager(total, start, end) {
    if (rangeEl) {
      rangeEl.textContent = total
        ? '第 ' + num(start + 1) + '–' + num(end) + ' 行，共 ' + num(total) + ' 行'
        : '共 0 行';
    }
    if (prevBtn) prevBtn.disabled = state.page <= 0;
    if (nextBtn) nextBtn.disabled = end >= total;
  }

  function showTable(hasData) {
    if (tableEl) tableEl.hidden = !hasData;
    if (emptyEl) emptyEl.hidden = hasData;
  }

  function setEmpty(message) {
    state.headers = [];
    state.rows = [];
    state.sort = { col: -1, dir: 1 };
    state.page = 0;
    theadEl.innerHTML = '';
    tbodyEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.innerHTML = '<strong>还没有数据</strong>' +
        esc(message || '粘贴 CSV 或拖入文件，然后点「查看表格」。');
    }
    showTable(false);
    if (badgeEl) { badgeEl.textContent = '—'; badgeEl.className = 'badge'; }
    renderStats();
    renderPager(0, 0, 0);
  }

  /* ======================================================================
     四、主流程
     ====================================================================== */

  function build() {
    var text = inputEl.value;
    updateSize();

    if (!text.trim()) {
      setEmpty('粘贴 CSV 或拖入文件，然后点「查看表格」。');
      statusEl.innerHTML = '<span class="faint">还没有输入内容</span>';
      return;
    }

    var delim = delimEl.value === 'auto' ? detectDelimiter(text) : delimEl.value;
    var grid = parseCSV(text, delim);

    if (!grid.length) {
      setEmpty('没能从这段内容里解析出表格。');
      statusEl.innerHTML = '<span class="is-error">解析结果为空</span>';
      return;
    }

    var headers, rows;
    if (headerEl && headerEl.checked) {
      /* 空表头补成「列 N」，避免出现无名列 */
      headers = grid[0].map(function (h, i) {
        var s = String(h == null ? '' : h).trim();
        return s === '' ? '列 ' + (i + 1) : h;
      });
      rows = grid.slice(1);
    } else {
      var cols = grid.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      headers = [];
      for (var c = 0; c < cols; c++) headers.push('列 ' + (c + 1));
      rows = grid;
    }

    state.headers = headers;
    state.rows = rows;
    state.delim = delim;
    state.sort = { col: -1, dir: 1 };
    state.page = 0;

    showTable(true);
    renderTable();
    renderStats();

    if (badgeEl) {
      badgeEl.textContent = num(rows.length) + ' × ' + num(headers.length);
      badgeEl.className = 'badge badge--accent';
    }

    var delimNote = delimEl.value === 'auto'
      ? '，自动探测为 ' + delimLabel(delim)
      : '，分隔符 ' + delimLabel(delim);
    statusEl.innerHTML = '<span class="is-ok">✓ 解析出 ' + num(rows.length) + ' 行 ' +
      num(headers.length) + ' 列</span><span class="faint">' + esc(delimNote) + '</span>';
  }

  function updateSize() {
    if (!sizeEl) return;
    var n = inputEl.value.length;
    sizeEl.textContent = n ? num(n) + ' 字符' : '';
  }

  /* ======================================================================
     五、排序
     ====================================================================== */

  /** 严格判断是不是数字，避免把 "1,234" 当成 1 */
  function toNumber(s) {
    if (!/^\s*[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(s)) return null;
    var n = Number(s);
    return isNaN(n) ? null : n;
  }

  function sortBy(col) {
    if (state.sort.col === col) state.sort.dir *= -1;
    else { state.sort.col = col; state.sort.dir = 1; }

    var dir = state.sort.dir;
    state.rows.sort(function (a, b) {
      var x = a[col] == null ? '' : String(a[col]);
      var y = b[col] == null ? '' : String(b[col]);
      var nx = toNumber(x);
      var ny = toNumber(y);
      if (nx !== null && ny !== null) return (nx - ny) * dir;
      /* numeric: true 让 item2 排在 item10 前面 */
      return x.localeCompare(y, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }) * dir;
    });

    state.page = 0;
    renderTable();
  }

  /* ======================================================================
     六、导出
     ====================================================================== */

  function toJSON() {
    if (!headerEl || !headerEl.checked) {
      return JSON.stringify(state.rows, null, 2);
    }

    var out = state.rows.map(function (r) {
      var o = {};
      state.headers.forEach(function (h, i) {
        /* 重名表头加后缀，避免后面的列覆盖前面的 */
        var key = h;
        var n = 2;
        while (Object.prototype.hasOwnProperty.call(o, key)) {
          key = h + '_' + n;
          n++;
        }
        o[key] = r[i] == null ? '' : r[i];
      });
      return o;
    });

    return JSON.stringify(out, null, 2);
  }

  function tsvCell(v) {
    var s = v == null ? '' : String(v);
    /* 含制表符、换行或引号时用双引号包裹并转义，保证粘进表格软件不错列 */
    if (/[\t\n\r"]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toTSV() {
    var lines = [state.headers.map(tsvCell).join('\t')];
    for (var i = 0; i < state.rows.length; i++) {
      lines.push(state.rows[i].map(tsvCell).join('\t'));
    }
    return lines.join('\n');
  }

  function downloadJSON() {
    if (!state.rows.length) { T.util.toast('还没有可下载的数据'); return; }
    var ok = T.util.download('data.json', toJSON(), 'application/json;charset=utf-8');
    T.util.toast(ok ? '已开始下载' : '当前环境不支持下载');
  }

  /* ======================================================================
     七、文件读取
     ====================================================================== */

  function readFile(file) {
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      T.util.toast('文件超过 20 MB，解析可能会慢');
    }

    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        inputEl.value = decodeBuffer(e.target.result);
      } catch (err) {
        T.util.toast('文件解码失败');
        return;
      }
      build();
      inputEl.focus();
    };
    reader.onerror = function () { T.util.toast('文件读取失败'); };
    /* 读成字节，交给 decodeBuffer 决定编码 */
    reader.readAsArrayBuffer(file);
  }

  /* ======================================================================
     八、事件
     ====================================================================== */

  if (parseBtn) parseBtn.addEventListener('click', build);

  /* 表头排序：鼠标点击 + 键盘 Enter/Space */
  theadEl.addEventListener('click', function (e) {
    var th = e.target.closest('th[data-col]');
    if (th) sortBy(Number(th.getAttribute('data-col')));
  });
  theadEl.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var th = e.target.closest('th[data-col]');
    if (!th) return;
    e.preventDefault();
    sortBy(Number(th.getAttribute('data-col')));
  });

  if (prevBtn) {
    prevBtn.addEventListener('click', function () {
      if (state.page > 0) { state.page--; renderTable(); }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      var pages = Math.ceil(state.rows.length / state.pageSize);
      if (state.page < pages - 1) { state.page++; renderTable(); }
    });
  }
  if (pageSizeEl) {
    pageSizeEl.addEventListener('change', function () {
      state.pageSize = Number(pageSizeEl.value) || 500;
      state.page = 0;
      renderTable();
    });
  }

  if (headerEl) headerEl.addEventListener('change', build);
  if (delimEl) delimEl.addEventListener('change', build);
  if (encEl) encEl.addEventListener('change', function () {
    T.util.toast('编码设置只影响下次读取文件');
  });

  if (copyJsonBtn) {
    copyJsonBtn.addEventListener('click', function () {
      if (!state.rows.length) return;
      T.util.copy(toJSON(), copyJsonBtn);
    });
  }
  if (copyTsvBtn) {
    copyTsvBtn.addEventListener('click', function () {
      if (!state.rows.length) return;
      T.util.copy(toTSV(), copyTsvBtn);
    });
  }
  if (downloadBtn) downloadBtn.addEventListener('click', downloadJSON);

  /* 拖放与点选文件 */
  if (dropEl && fileEl) {
    dropEl.addEventListener('click', function () { fileEl.click(); });
    dropEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileEl.click(); }
    });
    fileEl.addEventListener('change', function () {
      if (fileEl.files && fileEl.files[0]) readFile(fileEl.files[0]);
      fileEl.value = '';
    });

    dropEl.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropEl.classList.add('drop-zone--active');
    });
    dropEl.addEventListener('dragleave', function () {
      dropEl.classList.remove('drop-zone--active');
    });
    dropEl.addEventListener('drop', function (e) {
      e.preventDefault();
      dropEl.classList.remove('drop-zone--active');
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) readFile(dt.files[0]);
    });
  }

  inputEl.addEventListener('input', updateSize);

  if (demoBtn) {
    demoBtn.addEventListener('click', function () {
      inputEl.value = DEMO;
      if (delimEl) delimEl.value = 'auto';
      if (headerEl) headerEl.checked = true;
      build();
      inputEl.focus();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      inputEl.value = '';
      updateSize();
      setEmpty();
      statusEl.innerHTML = '';
      inputEl.focus();
    });
  }

  /* ======================================================================
     九、首屏
     ====================================================================== */

  state.pageSize = pageSizeEl ? (Number(pageSizeEl.value) || 500) : 500;
  updateSize();
  build();
})();
