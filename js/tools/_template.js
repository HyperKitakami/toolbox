/* ==========================================================================
   _template.js — 工具逻辑模板
   --------------------------------------------------------------------------
   复制本文件为 js/tools/<slug>.js，然后：
     - 改 DOM id 前缀（下面用 tpl 作为示例前缀）
     - 写自己的 render() 逻辑
   公共方法都挂在 window.TOOLBOX.util 上，见 js/site.js
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  /* --- 1. 取元素 --------------------------------------------------------- */
  var input = document.getElementById('tpl-input');
  var output = document.getElementById('tpl-output');
  if (!input || !output) return;

  var clearBtn = document.querySelector('[data-clear]');
  var demoBtn = document.querySelector('[data-demo]');

  var DEMO = '把这段文字换成你的示例输入。\n第二行用来演示多行处理。';

  /* --- 2. 核心逻辑 ------------------------------------------------------- */
  /**
   * 纯函数：输入字符串 -> 输出字符串。保持无副作用，方便单测。
   */
  function transform(text) {
    if (!text) return '';
    return text.split('\n').map(function (line, i) {
      return (i + 1) + '. ' + line;
    }).join('\n');
  }

  /* --- 3. 渲染 ----------------------------------------------------------- */
  var render = T.util.debounce(function () {
    output.textContent = transform(input.value);
  }, 80);

  /* --- 4. 事件 ----------------------------------------------------------- */
  input.addEventListener('input', render);

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      input.value = '';
      output.textContent = '';
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

  /* Ctrl/Cmd + Enter 也能触发（如果工具是「点击才计算」的形态） */
  input.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      render();
    }
  });

  /* --- 5. 首屏 ----------------------------------------------------------- */
  render();
})();
