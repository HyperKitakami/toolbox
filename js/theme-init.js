/* ==========================================================================
   theme-init.js — 必须在 <head> 里同步加载（不 defer）
   作用：在首次绘制前套用已保存的主题，避免深色模式闪白。
   ========================================================================== */
(function () {
  'use strict';
  try {
    var saved = localStorage.getItem('toolbox-theme');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) { /* 隐私模式下 localStorage 不可用，忽略即可 */ }
})();
