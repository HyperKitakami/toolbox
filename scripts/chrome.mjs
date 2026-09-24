/* ==========================================================================
   chrome.mjs — 页头 / 页脚的唯一来源
   --------------------------------------------------------------------------
   被 scripts/build-pages.mjs 使用，把统一的页头页脚注入到每个 HTML 文件里。
   改导航只改这里，然后跑一次 `node scripts/build-pages.mjs`。
   ========================================================================== */

const HUBS = [
  ['developer', '开发者'],
  ['security', '安全'],
  ['color', '颜色'],
  ['converters', '转换'],
  ['generators', '生成器'],
  ['text', '文本']
];

const LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Z"/><path d="M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M4 12.5h16"/></svg>`;

const ICON_SEARCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.2"/><path d="m15.6 15.6 4.1 4.1"/></svg>`;

const ICON_MOON = `<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>`;

const ICON_SUN = `<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/></svg>`;

/** @param {string} p 站点根前缀，例如 '' 或 '../../' */
export function header(p) {
  const home = p || './';
  const nav = HUBS
    .map(([id, name]) => `      <a href="${p}hubs/${id}/">${name}</a>`)
    .join('\n');

  return `<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="${home}">
      <span class="brand-mark" aria-hidden="true">
        ${LOGO}
      </span>
      <span>工具箱 <span class="brand-sub">Toolbox</span></span>
    </a>

    <nav class="site-nav" aria-label="主导航">
${nav}
      <a href="${p}about/">关于</a>
    </nav>

    <div class="header-actions">
      <button class="search-trigger" type="button" aria-label="搜索工具">
        ${ICON_SEARCH}
        <span>搜索</span>
        <span class="kbd">/</span>
      </button>
      <button class="theme-toggle btn btn--icon" type="button" aria-label="切换主题">
        ${ICON_MOON}
        ${ICON_SUN}
      </button>
    </div>
  </div>
</header>`;
}

/** @param {string} p 站点根前缀，例如 '' 或 '../../' */
export function footer(p) {
  const home = p || './';
  const hubLinks = HUBS
    .map(([id, name]) => `          <li><a href="${p}hubs/${id}/">${name}</a></li>`)
    .join('\n');

  return `<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <div class="footer-brand">
          <span class="brand-mark" aria-hidden="true">
            ${LOGO}
          </span>
          <span>工具箱</span>
        </div>
        <p class="footer-about">
          纯静态的个人在线工具箱。所有工具都在浏览器本地运行，
          不收集数据，不加载第三方资源。
        </p>
      </div>
      <div>
        <p class="footer-title">分类</p>
        <ul class="footer-list">
${hubLinks}
        </ul>
      </div>
      <div>
        <p class="footer-title">站点</p>
        <ul class="footer-list">
          <li><a href="${home}">首页</a></li>
          <li><a href="${p}about/">关于本站</a></li>
          <li><a href="${p}privacy/">隐私说明</a></li>
          <li><a href="${p}tools/_template/">工具模板</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <p>© <span data-year>2026</span> 工具箱 · 纯静态 · 无追踪 · 无账号</p>
      <div class="footer-links">
        <a href="${p}about/">关于</a>
        <a href="${p}privacy/">隐私</a>
        <a href="${p}sitemap.xml">站点地图</a>
      </div>
    </div>
  </div>
</footer>`;
}
