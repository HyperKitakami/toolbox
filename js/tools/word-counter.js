/* ==========================================================================
   word-counter.js — 字数统计
   纯前端统计，输入不离开浏览器。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  var input   = document.getElementById('wc-input');
  var statsEl = document.getElementById('wc-stats');
  var freqEl  = document.getElementById('wc-freq');
  var statusEl = document.getElementById('wc-status');
  var copyBtn = document.getElementById('wc-copy');
  var clearBtn = document.querySelector('[data-clear]');
  var demoBtn  = document.querySelector('[data-demo]');
  if (!input || !statsEl) return;

  /* --- 字符集与分词规则 -------------------------------------------------- */
  /* 中日韩统一表意文字 + 扩展A + 兼容表意文字 + 日文假名 + 韩文谚文 */
  var RE_CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/g;
  /* 英文单词：字母数字串，允许词内撇号与连字符 */
  var RE_WORD = /[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g;
  /* 句末标点 */
  var RE_SENTENCE = /[。！？…]+|[.!?]+(?=\s|$)/g;
  /* 段落分隔：一个空行 */
  var RE_PARA = /\n[ \t]*\n+/;

  var DEMO = [
    '工具箱是一个纯静态的个人在线工具箱。',
    'All tools run entirely in your browser, so your data never leaves the device.',
    '',
    '试着改动这段文字，右侧的统计会实时更新。中英文的计数规则不同，这里分开处理。'
  ].join('\n');

  /* --- 工具函数 ---------------------------------------------------------- */
  function num(n) { return n.toLocaleString('zh-CN'); }

  function countMatches(text, re) {
    var m = text.match(re);
    return m ? m.length : 0;
  }

  /* --- 核心统计 ---------------------------------------------------------- */
  function analyse(text) {
    var chars = Array.from(text).length;                       /* 码点数 */
    var charsNoSpace = Array.from(text.replace(/\s/g, '')).length;
    var cjk = countMatches(text, RE_CJK);
    var words = countMatches(text, RE_WORD);
    var lines = text ? text.split(/\r\n|\r|\n/).length : 0;
    var paragraphs = text.split(RE_PARA)
      .filter(function (p) { return p.trim().length > 0; }).length;
    var sentences = countMatches(text, RE_SENTENCE);
    var minutes = cjk / 400 + words / 220;

    return {
      chars: chars,
      charsNoSpace: charsNoSpace,
      cjk: cjk,
      words: words,
      lines: lines,
      paragraphs: paragraphs,
      sentences: sentences,
      minutes: minutes
    };
  }

  /* --- 高频词 ------------------------------------------------------------ */
  function frequencies(text) {
    var map = Object.create(null);

    /* 英文：小写化，只保留长度 >= 2 的词 */
    var latin = text.toLowerCase().match(/[a-z0-9]{2,}(?:['’\-][a-z0-9]+)*/g) || [];
    latin.forEach(function (w) { map[w] = (map[w] || 0) + 1; });

    /* 中文：按相邻二字组合统计，近似「词」的概念 */
    var runs = text.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+/g) || [];
    runs.forEach(function (run) {
      var a = Array.from(run);
      for (var i = 0; i + 1 < a.length; i++) {
        var g = a[i] + a[i + 1];
        map[g] = (map[g] || 0) + 1;
      }
    });

    return Object.keys(map)
      .map(function (k) { return { word: k, n: map[k] }; })
      .filter(function (x) { return x.n > 1; })
      .sort(function (a, b) { return b.n - a.n || a.word.localeCompare(b.word); })
      .slice(0, 10);
  }

  /* --- 渲染 -------------------------------------------------------------- */
  function stat(label, value) {
    return '<div class="stat">' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + value + '</div>' +
      '</div>';
  }

  function renderStats(a) {
    statsEl.innerHTML =
      stat('总字符数', num(a.chars)) +
      stat('不含空格', num(a.charsNoSpace)) +
      stat('汉字', num(a.cjk)) +
      stat('英文单词', num(a.words)) +
      stat('行数', num(a.lines)) +
      stat('段落', num(a.paragraphs)) +
      stat('句子', num(a.sentences)) +
      stat('阅读时长', T.util.formatDuration(a.minutes));
  }

  function renderFreq(list) {
    if (!list.length) {
      freqEl.innerHTML = '<li class="freq-empty">还没有重复出现的词</li>';
      return;
    }
    var max = list[0].n;
    freqEl.innerHTML = list.map(function (x) {
      var pct = Math.max(6, Math.round((x.n / max) * 100));
      return '<li class="freq-item">' +
        '<span class="freq-word" title="' + T.util.esc(x.word) + '">' + T.util.esc(x.word) + '</span>' +
        '<span class="freq-bar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="freq-count">' + x.n + '</span>' +
        '</li>';
    }).join('');
  }

  /* --- 主循环 ------------------------------------------------------------ */
  var last = null;

  var render = T.util.debounce(update, 70);

  function update() {
    var text = input.value;
    last = analyse(text);
    renderStats(last);
    renderFreq(frequencies(text));
    if (statusEl) {
      statusEl.textContent = text ? '已统计 ' + num(last.chars) + ' 个字符' : '';
    }
  }

  input.addEventListener('input', render);

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      input.value = '';
      render();
      input.focus();
    });
  }

  if (demoBtn) {
    demoBtn.addEventListener('click', function () {
      input.value = DEMO;
      render();
      input.focus();
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var a = last || analyse(input.value);
      var text = [
        '总字符数（含空格）：' + num(a.chars),
        '字符数（不含空格）：' + num(a.charsNoSpace),
        '汉字：' + num(a.cjk),
        '英文单词：' + num(a.words),
        '行数：' + num(a.lines),
        '段落：' + num(a.paragraphs),
        '句子：' + num(a.sentences),
        '预计阅读时长：' + T.util.formatDuration(a.minutes)
      ].join('\n');
      T.util.copy(text, copyBtn);
    });
  }

  /* 首屏：立即渲染一次，不要等防抖 */
  update();
})();
