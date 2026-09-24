/* ==========================================================================
   regex-tester.js — 正则表达式测试
   --------------------------------------------------------------------------
   移植自 jamalofski/praticulus 的 regex-tester（MIT），改动：
     1. 全量中文化（界面文案 + 模式解释器的全部标签）
     2. 改用本站的设计系统与组件类名，去掉原有内联样式
     3. 修复空匹配死循环：全局正则遇到零长匹配时 exec 不推进 lastIndex
     4. 修复分享链接丢参数：base64 末尾的 = 填充会让 split('=') 解析失败
     5. 新增标志快捷开关、统计面板，输入改为防抖执行
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var esc = T.util.esc;

  /* --- DOM --------------------------------------------------------------- */
  var patternEl   = document.getElementById('rt-pattern');
  var flagsEl     = document.getElementById('rt-flags');
  var textEl      = document.getElementById('rt-text');
  var statusEl    = document.getElementById('rt-status');
  var highlightEl = document.getElementById('rt-highlight');
  var statsEl     = document.getElementById('rt-stats');
  var matchesEl   = document.getElementById('rt-matches');
  var explainerEl = document.getElementById('rt-explainer');
  var chipsEl     = document.getElementById('rt-flag-chips');
  var shareBtn    = document.getElementById('rt-share');

  var replaceToggle  = document.getElementById('rt-replace-toggle');
  var replaceSection = document.getElementById('rt-replace-section');
  var replacementEl  = document.getElementById('rt-replacement');
  var replaceOutEl   = document.getElementById('rt-replace-output');

  var demoBtn  = document.querySelector('[data-demo]');
  var clearBtn = document.querySelector('[data-clear]');

  if (!patternEl || !textEl || !highlightEl) return;

  /* --- 常量 -------------------------------------------------------------- */
  var MAX_MATCHES = 5000;

  var DEMO_PATTERN = '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+';
  var DEMO_FLAGS = 'g';
  var DEMO_TEXT = [
    '联系邮箱：zhang@example.com',
    '备用邮箱：li.si@company.org.cn',
    '无效输入：not-an-email',
    '订单号：A2026-0924-001'
  ].join('\n');

  var FLAGS = [
    { f: 'g', tip: '全局匹配：找出所有匹配，而不是只找第一个' },
    { f: 'i', tip: '忽略大小写' },
    { f: 'm', tip: '多行模式：^ 和 $ 匹配每一行的开头与结尾' },
    { f: 's', tip: '点号也匹配换行符' },
    { f: 'u', tip: 'Unicode 模式' },
    { f: 'y', tip: '粘性匹配：只从 lastIndex 处开始尝试' }
  ];

  /* ======================================================================
     一、模式解释器
     把正则表达式逐记号拆开，给出每一段的含义。
     ====================================================================== */

  function explainRegex(pattern) {
    var tokens = [];
    var i = 0;
    var depth = 0;
    var n = pattern.length;

    function push(src, label, unrec) {
      tokens.push({ src: src, label: label, depth: depth, unrec: !!unrec });
    }

    function tryQuantifier() {
      if (i >= n) return;
      var c = pattern[i];

      if (c === '*' || c === '+' || c === '?') {
        i++;
        var lazy = false;
        if (i < n && pattern[i] === '?') { lazy = true; i++; }
        var names = { '*': '重复 0 次或多次', '+': '重复 1 次或多次', '?': '重复 0 次或 1 次' };
        push(c + (lazy ? '?' : ''),
          '量词：前一项' + names[c] + (lazy ? '（懒惰）' : '（贪婪）'));
        return;
      }

      if (c === '{') {
        var rest = pattern.substring(i);
        var m = rest.match(/^\{(\d+)(,(\d*))?\}/);
        if (!m) return;
        i += m[0].length;
        var lazy2 = false;
        if (i < n && pattern[i] === '?') { lazy2 = true; i++; }

        var times;
        if (m[2] === undefined) times = '恰好重复 ' + m[1] + ' 次';
        else if (m[3] === '' || m[3] === undefined) times = '至少重复 ' + m[1] + ' 次';
        else times = '重复 ' + m[1] + ' 到 ' + m[3] + ' 次';

        push(m[0] + (lazy2 ? '?' : ''),
          '量词：前一项' + times + (lazy2 ? '（懒惰）' : '（贪婪）'));
      }
    }

    function readEscape() {
      if (i >= n) { push('\\', '无法识别的记号', true); return; }

      var c = pattern[i];
      i++;

      if (c === 'd') return push('\\d', '任意数字（0-9）');
      if (c === 'D') return push('\\D', '任意非数字');
      if (c === 'w') return push('\\w', '任意单词字符（字母、数字、下划线）');
      if (c === 'W') return push('\\W', '任意非单词字符');
      if (c === 's') return push('\\s', '任意空白字符');
      if (c === 'S') return push('\\S', '任意非空白字符');
      if (c === 'b') return push('\\b', '单词边界');
      if (c === 'B') return push('\\B', '非单词边界');
      if (c === 'n') return push('\\n', '换行符（LF）');
      if (c === 't') return push('\\t', '制表符');
      if (c === 'r') return push('\\r', '回车符');
      if (c === 'f') return push('\\f', '换页符');
      if (c === 'v') return push('\\v', '垂直制表符');
      if (c === '0') return push('\\0', '空字符');

      if (c >= '1' && c <= '9') {
        var num = c;
        while (i < n && pattern[i] >= '0' && pattern[i] <= '9') { num += pattern[i]; i++; }
        return push('\\' + num, '反向引用：第 ' + num + ' 个捕获分组的内容');
      }

      if (c === 'k' && pattern[i] === '<') {
        var j = i + 1;
        while (j < n && pattern[j] !== '>') j++;
        if (j < n && pattern[j] === '>') {
          var name = pattern.substring(i + 1, j);
          i = j + 1;
          return push('\\k<' + name + '>', '命名反向引用：引用名为 "' + name + '" 的分组');
        }
      }

      if (c === 'x') {
        if (i + 1 < n && /[0-9a-fA-F]/.test(pattern[i]) && /[0-9a-fA-F]/.test(pattern[i + 1])) {
          var hx = pattern[i] + pattern[i + 1];
          i += 2;
          return push('\\x' + hx, '十六进制转义：字符 0x' + hx);
        }
      }

      if (c === 'u') {
        if (pattern[i] === '{') {
          var jj = i + 1;
          while (jj < n && pattern[jj] !== '}') jj++;
          if (jj < n && pattern[jj] === '}') {
            var cp = pattern.substring(i + 1, jj);
            i = jj + 1;
            return push('\\u{' + cp + '}', 'Unicode 码点：U+' + cp);
          }
        } else if (/^[0-9a-fA-F]{4}$/.test(pattern.substring(i, i + 4))) {
          var hu = pattern.substring(i, i + 4);
          i += 4;
          return push('\\u' + hu, 'Unicode 转义：U+' + hu);
        }
      }

      if (c === 'c') {
        if (i < n && /[A-Za-z]/.test(pattern[i])) {
          var cc = pattern[i];
          i++;
          return push('\\c' + cc, '控制字符：Ctrl+' + cc.toUpperCase());
        }
      }

      if (/[.^$*+?()[\]{}|\\\/\-]/.test(c)) return push('\\' + c, '字面字符 "' + c + '"');
      return push('\\' + c, '转义字符 "' + c + '"');
    }

    function readCharClass() {
      var s = '[';
      i++;
      var negated = false;
      if (pattern[i] === '^') { negated = true; s += '^'; i++; }

      while (i < n && pattern[i] !== ']') {
        if (pattern[i] === '\\' && i + 1 < n) {
          s += pattern[i] + pattern[i + 1];
          i += 2;
        } else {
          s += pattern[i];
          i++;
        }
      }
      if (i < n && pattern[i] === ']') { s += ']'; i++; }

      var inner = s.slice(negated ? 2 : 1, -1);
      push(s, '字符类：匹配' + (negated ? '不在 ' : ' ') +
              (inner.length ? inner : '（空集合）') + ' 中的任意一个字符');
    }

    while (i < n) {
      var c = pattern[i];

      if (c === '\\') {
        i++;
        readEscape();
        tryQuantifier();
      } else if (c === '[') {
        readCharClass();
        tryQuantifier();
      } else if (c === '(') {
        i++;
        if (pattern[i] === '?') {
          var next = pattern[i + 1];
          if (next === ':') { i += 2; push('(?:', '非捕获分组：只分组，不单独记录'); depth++; }
          else if (next === '=') { i += 2; push('(?=', '正向先行断言：后面必须是'); depth++; }
          else if (next === '!') { i += 2; push('(?!', '负向先行断言：后面不能是'); depth++; }
          else if (next === '<' && pattern[i + 2] === '=') { i += 3; push('(?<=', '正向后行断言：前面必须是'); depth++; }
          else if (next === '<' && pattern[i + 2] === '!') { i += 3; push('(?<!', '负向后行断言：前面不能是'); depth++; }
          else if (next === '<') {
            var j2 = i + 2;
            while (j2 < n && pattern[j2] !== '>') j2++;
            if (j2 < n && pattern[j2] === '>') {
              var gname = pattern.substring(i + 2, j2);
              i = j2 + 1;
              push('(?<' + gname + '>', '命名捕获分组："' + gname + '"');
              depth++;
            } else {
              push('(', '无法识别的记号', true);
            }
          } else {
            push('(?', '无法识别的记号', true);
            i++;
          }
        } else {
          push('(', '捕获分组');
          depth++;
        }
      } else if (c === ')') {
        i++;
        depth = Math.max(0, depth - 1);
        push(')', '分组结束');
        tryQuantifier();
      } else if (c === '|') {
        i++;
        push('|', '或：左右两侧任选其一');
      } else if (c === '^') {
        i++;
        push('^', '字符串开头（带 m 标志时为行首）');
      } else if (c === '$') {
        i++;
        push('$', '字符串结尾（带 m 标志时为行尾）');
      } else if (c === '.') {
        i++;
        push('.', '任意字符（默认不含换行，带 s 标志时包含）');
        tryQuantifier();
      } else if (c === '*' || c === '+' || c === '?' || c === '{') {
        push(c, '无法识别的记号', true);
        i++;
      } else {
        i++;
        push(c, '字面字符 "' + c + '"');
        tryQuantifier();
      }
    }

    return tokens;
  }

  function renderExplainer(tokens) {
    if (!tokens.length) {
      return '<div class="regex-explainer-empty">在上面输入正则表达式，这里会逐字拆解它的含义。</div>';
    }
    var html = '';
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var d = Math.min(t.depth, 6);
      html += '<div class="regex-explainer-row depth-' + d + (t.unrec ? ' unrecognized' : '') + '">' +
        '<code class="regex-explainer-code">' + esc(t.src) + '</code>' +
        '<span class="regex-explainer-label">' + esc(t.label) + '</span>' +
        '</div>';
    }
    return html;
  }

  /* ======================================================================
     二、匹配
     ====================================================================== */

  function snapshot(m) {
    return {
      match: m[0],
      index: m.index,
      groups: Array.prototype.slice.call(m, 1),
      named: m.groups || null
    };
  }

  /**
   * 收集全部匹配。
   * 关键：全局正则遇到零长匹配时 exec 不会推进 lastIndex，
   * 必须手动前进一位，否则会无限循环（原实现只靠计数上限兜底，
   * 结果是产出上千条重复的空匹配）。
   */
  function collect(regex, text) {
    var out = [];

    if (!regex.global && !regex.sticky) {
      var one = regex.exec(text);
      if (one) out.push(snapshot(one));
      return out;
    }

    var m;
    while ((m = regex.exec(text)) !== null) {
      out.push(snapshot(m));
      if (m[0] === '') regex.lastIndex++;
      if (out.length >= MAX_MATCHES) break;
    }
    return out;
  }

  function renderHighlight(text, all) {
    if (!all.length) { highlightEl.textContent = text; return; }

    var html = '';
    var last = 0;
    for (var i = 0; i < all.length; i++) {
      var m = all[i];
      if (m.index < last) continue;                 /* 重叠或零长相邻时的保险 */
      html += esc(text.substring(last, m.index));
      html += '<mark>' + esc(m.match) + '</mark>';
      last = m.index + m.match.length;
    }
    html += esc(text.substring(last));
    highlightEl.innerHTML = html;
  }

  function stat(label, value, cls) {
    return '<div class="stat">' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value' + (cls ? ' ' + cls : '') + '">' + value + '</div>' +
      '</div>';
  }

  function renderStats(all) {
    if (!statsEl) return;
    var n = all.length;
    var groupCount = 0, namedCount = 0;
    if (n) {
      groupCount = all[0].groups.length;
      namedCount = all[0].named ? Object.keys(all[0].named).length : 0;
    }
    statsEl.innerHTML =
      stat('匹配数', n.toLocaleString('zh-CN'), n ? 'stat-value--ok' : '') +
      stat('捕获分组', String(groupCount)) +
      stat('命名分组', String(namedCount)) +
      stat('模式长度', String(patternEl.value.length)) +
      stat('标志', esc(flagsEl.value || '—'), 'stat-value--sm');
  }

  function renderMatches(all) {
    if (!matchesEl) return;
    if (!all.length) {
      matchesEl.innerHTML = '<div class="match-empty">没有匹配结果</div>';
      return;
    }

    matchesEl.innerHTML = all.map(function (m, i) {
      var groups = m.groups.map(function (g, j) {
        return '<span class="match-group">$' + (j + 1) + ' = ' + esc(g) + '</span>';
      }).join('');

      if (m.named) {
        Object.keys(m.named).forEach(function (k) {
          groups += '<span class="match-group">' + esc(k) + ' = ' + esc(m.named[k]) + '</span>';
        });
      }

      return '<div class="match-item">' +
        '<span class="match-num">#' + (i + 1) + '</span>' +
        '<code class="match-text">' + esc(m.match) + '</code>' +
        '<span class="match-pos">位置 ' + m.index + ' – ' + (m.index + m.match.length) + '</span>' +
        (groups ? '<div class="match-groups">' + groups + '</div>' : '') +
        '</div>';
    }).join('');
  }

  /* ======================================================================
     三、替换
     ====================================================================== */

  function updateReplace() {
    if (!replaceToggle || !replaceToggle.checked || !replaceOutEl) return;
    var pattern = patternEl.value;
    if (!pattern) { replaceOutEl.textContent = textEl.value; return; }
    try {
      replaceOutEl.textContent = textEl.value.replace(new RegExp(pattern, flagsEl.value), replacementEl.value);
    } catch (e) {
      replaceOutEl.textContent = '';
    }
  }

  /* ======================================================================
     四、标志快捷开关
     ====================================================================== */

  function syncFlagChips() {
    if (!chipsEl) return;
    var cur = flagsEl.value;
    Array.prototype.forEach.call(chipsEl.children, function (chip) {
      var f = chip.getAttribute('data-flag');
      chip.setAttribute('aria-pressed', String(cur.indexOf(f) >= 0));
    });
  }

  function buildFlagChips() {
    if (!chipsEl) return;
    chipsEl.innerHTML = FLAGS.map(function (item) {
      return '<button class="flag-chip" type="button" data-flag="' + item.f + '" ' +
        'aria-pressed="false" title="' + esc(item.tip) + '">' + item.f + '</button>';
    }).join('');

    chipsEl.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-flag]');
      if (!chip) return;
      var f = chip.getAttribute('data-flag');
      flagsEl.value = flagsEl.value.indexOf(f) >= 0
        ? flagsEl.value.split(f).join('')
        : flagsEl.value + f;
      run();
      patternEl.focus();
    });
  }

  /* ======================================================================
     五、主流程
     ====================================================================== */

  function run() {
    var pattern = patternEl.value;
    var flags = flagsEl.value;
    var text = textEl.value;

    syncFlagChips();

    /* 没有表达式：原样显示文本 */
    if (!pattern) {
      highlightEl.textContent = text;
      statusEl.innerHTML = '<span class="faint">还没有输入正则表达式</span>';
      renderStats([]);
      renderMatches([]);
      updateReplace();
      return;
    }

    var regex;
    try {
      regex = new RegExp(pattern, flags);
    } catch (e) {
      statusEl.innerHTML = '<span class="is-error">表达式有误：' + esc(e.message) + '</span>';
      highlightEl.textContent = text;
      renderStats([]);
      renderMatches([]);
      updateReplace();
      return;
    }

    var all = collect(regex, text);

    renderHighlight(text, all);
    renderStats(all);
    renderMatches(all);

    if (all.length) {
      var tail = all.length >= MAX_MATCHES ? '（已达 ' + MAX_MATCHES + ' 条上限）' : '';
      statusEl.innerHTML = '<span class="is-ok">匹配到 ' + all.length + ' 处</span>' + tail;
    } else {
      statusEl.innerHTML = '<span class="faint">没有匹配</span>';
    }

    updateReplace();
  }

  function updateExplainer() {
    try {
      explainerEl.innerHTML = renderExplainer(explainRegex(patternEl.value));
    } catch (e) {
      explainerEl.innerHTML = '<div class="regex-explainer-empty">这个表达式无法解析。</div>';
    }
  }

  var runDebounced = T.util.debounce(run, 100);
  var explainDebounced = T.util.debounce(updateExplainer, 140);

  /* ======================================================================
     六、分享链接
     ====================================================================== */

  function b64encode(s) {
    try { return btoa(encodeURIComponent(s)); } catch (e) { return ''; }
  }
  function b64decode(s) {
    try { return decodeURIComponent(atob(s)); } catch (e) { return ''; }
  }

  /**
   * 解析 #k=v&k=v。
   * 注意不能用 split('=')：base64 末尾的 = 填充会让键值对解析失败，
   * 原实现因此会静默丢掉带填充的参数。
   */
  function parseHash(hash) {
    var out = {};
    String(hash).replace(/^#/, '').split('&').forEach(function (pair) {
      var idx = pair.indexOf('=');
      if (idx < 0) return;
      out[pair.slice(0, idx)] = pair.slice(idx + 1);
    });
    return out;
  }

  function buildHash() {
    var hash = '#p=' + b64encode(patternEl.value) +
               '&f=' + b64encode(flagsEl.value) +
               '&t=' + b64encode(textEl.value);
    if (replaceToggle && replaceToggle.checked && replacementEl.value) {
      hash += '&r=' + b64encode(replacementEl.value);
    }
    return hash;
  }

  function loadFromHash() {
    var params = parseHash(location.hash);
    if (!Object.keys(params).length) return false;

    var loaded = false;
    if (params.p !== undefined) { patternEl.value = b64decode(params.p); loaded = true; }
    if (params.f !== undefined) { flagsEl.value = b64decode(params.f); loaded = true; }
    if (params.t !== undefined) { textEl.value = b64decode(params.t); loaded = true; }
    if (params.r !== undefined && replaceToggle) {
      replacementEl.value = b64decode(params.r);
      replaceToggle.checked = true;
      replaceSection.hidden = false;
      loaded = true;
    }
    return loaded;
  }

  /* ======================================================================
     七、事件
     ====================================================================== */

  patternEl.addEventListener('input', function () { runDebounced(); explainDebounced(); });
  flagsEl.addEventListener('input', function () { runDebounced(); });
  textEl.addEventListener('input', function () { runDebounced(); });

  if (replacementEl) {
    replacementEl.addEventListener('input', T.util.debounce(updateReplace, 100));
  }

  if (replaceToggle) {
    replaceToggle.addEventListener('change', function () {
      replaceSection.hidden = !replaceToggle.checked;
      if (replaceToggle.checked) updateReplace();
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', function () {
      var url = location.origin + location.pathname + buildHash();
      T.util.copy(url, null);
      T.util.toast('分享链接已复制');
    });
  }

  if (demoBtn) {
    demoBtn.addEventListener('click', function () {
      patternEl.value = DEMO_PATTERN;
      flagsEl.value = DEMO_FLAGS;
      textEl.value = DEMO_TEXT;
      run();
      updateExplainer();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      textEl.value = '';
      run();
      textEl.focus();
    });
  }

  /* ======================================================================
     八、首屏
     ====================================================================== */

  buildFlagChips();

  var fromHash = loadFromHash();

  /* 同步渲染一次，不要等防抖，否则首屏有 100ms 空白 */
  run();
  updateExplainer();

  if (fromHash) T.util.toast('已载入分享链接中的内容');
})();
