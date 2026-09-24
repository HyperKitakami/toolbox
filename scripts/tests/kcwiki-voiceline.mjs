/* ==========================================================================
   KCWiki 语音台词（kcwiki-voiceline）测试
   --------------------------------------------------------------------------
   真实 DOM 交互驱动：点按钮、设 textarea.value + dispatch input、勾复选框后
   派发 change，不直接调工具内部函数。
   期望值一律手算，不是「跑一遍看输出是多少」抄下来的 —— 尤其是生成结果那一段，
   档名清单是照着 28 个常规场合的顺序一个个数出来的。
   ========================================================================== */

import { ok, section, loadPage, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const { d, w, errors } = await loadPage('tools/kcwiki-voiceline/index.html', {
    clipboard: (t) => { copied = t; }
  });

  const $ = (sel) => d.querySelector(sel);
  const cards = () => [...d.querySelectorAll('#kv-groups .kv-card')];
  const cardOf = (suffix) => cards().find((c) => c.querySelector('.kv-code').textContent === suffix);
  const groupOf = (id) => d.querySelector('#kv-groups .kv-group[data-group="' + id + '"]');
  const groupIds = () => [...d.querySelectorAll('#kv-groups .kv-group')].map((g) => g.getAttribute('data-group'));
  const visible = () => cards().filter((c) => !c.hidden);
  const statusOf = (suffix) => cardOf(suffix).getAttribute('data-status');
  const statVals = () => [...d.querySelectorAll('#kv-stats .stat-value')].map((e) => e.textContent);
  const out = () => $('#kv-output').textContent;
  const outLines = () => out().split('\n');
  const field = (suffix, key) => cardOf(suffix).querySelector('[data-field="' + key + '"]');
  const omitBox = (suffix) => cardOf(suffix).querySelector('[data-omit]');

  const fire = async (el, type, wait = 30) => {
    el.dispatchEvent(new w.Event(type, { bubbles: true }));
    await sleep(wait);
  };
  const click = async (el, wait = 30) => {
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const clickSel = (sel, wait) => click($(sel), wait);

  /** 设文本。展开状态不参与断言，直接确保它是展开的，方便读回 value。 */
  const setText = async (suffix, key, value) => {
    const c = cardOf(suffix);
    if (c.classList.contains('kv-card--collapsed')) await click(c.querySelector('.kv-card-head'));
    const ta = field(suffix, key);
    ta.value = value;
    await fire(ta, 'input');
  };

  /* 复选框统一用「设 checked + 派发 change」，与 lorem-ipsum / uuid 套件一致 ——
     不依赖 jsdom 对 click 激活行为的实现细节 */
  const setCheck = async (el, on) => {
    el.checked = on;
    await fire(el, 'change');
  };
  const setOmit = async (suffix, on) => {
    if (omitBox(suffix).checked !== on) await setCheck(omitBox(suffix), on);
  };
  const setFilter = async (name) => {
    if ($('[data-filter="' + name + '"]').getAttribute('aria-pressed') !== 'true') {
      await clickSel('[data-filter="' + name + '"]');
    }
  };
  const setHideOmit = async (on) => {
    if ($('#kv-hide-omit').checked !== on) await setCheck($('#kv-hide-omit'), on);
  };
  const setCharId = async (value) => {
    $('#kv-charid').value = value;
    await fire($('#kv-charid'), 'input');
  };

  /* 一句会破坏 HTML 的台词：用来验证「用户输入不进 HTML 解析器」 */
  const RAW = '<b>x</b> & "y" </textarea>';

  /* ---------- 1. 基本渲染与场合表 ---------- */
  section('1. 基本渲染与场合表');

  ok('无脚本错误', errors.length === 0, errors.join(' | '));
  ok('共 52 张条目卡片（28 常规 + 24 时报）', cards().length === 52, String(cards().length));
  ok('两个内置分组', JSON.stringify(groupIds()) === JSON.stringify(['main', 'hour']),
     JSON.stringify(groupIds()));
  ok('常规台词 28 条',
     d.querySelectorAll('#kv-groups .kv-group[data-group="main"] .kv-card').length === 28);
  ok('时报 24 条',
     d.querySelectorAll('#kv-groups .kv-group[data-group="hour"] .kv-card').length === 24);
  ok('分组名正确',
     groupOf('main').querySelector('.kv-group-name').textContent === '常规台词' &&
     groupOf('hour').querySelector('.kv-group-name').textContent === '时报');

  ok('第一条是 Intro / 入手/登入时',
     cards()[0].querySelector('.kv-code').textContent === 'Intro' &&
     cards()[0].querySelector('.kv-name').textContent === '入手/登入时');
  ok('常规台词最后一条是 Idle / 放置',
     cards()[27].querySelector('.kv-code').textContent === 'Idle' &&
     cards()[27].querySelector('.kv-name').textContent === '放置');
  ok('时报第一条是 0000 / 〇〇〇〇时报',
     cardOf('0000').querySelector('.kv-name').textContent === '〇〇〇〇时报');
  ok('时报 1000 的场合名是汉字数字「一〇〇〇时报」',
     cardOf('1000').querySelector('.kv-name').textContent === '一〇〇〇时报');
  ok('时报 1600 → 一六〇〇时报',
     cardOf('1600').querySelector('.kv-name').textContent === '一六〇〇时报');
  ok('时报最后一条是 2300 / 二三〇〇时报',
     cardOf('2300').querySelector('.kv-name').textContent === '二三〇〇时报');

  ok('默认全部折叠', cards().every((c) => c.classList.contains('kv-card--collapsed')));
  ok('折叠头的 aria-expanded 与之一致',
     cards().every((c) => c.querySelector('.kv-card-toggle').getAttribute('aria-expanded') === 'false'));
  /* 这一条是「折叠到底生没生效」的真判据：光有 kv-card--collapsed 类不算数，
     正文必须真的被藏起来（旧版就漏了 CSS 规则，箭头转了正文还在）。 */
  ok('默认折叠时正文是真的被藏起来的',
     cards().every((c) => c.querySelector('.kv-card-body').hidden === true));
  ok('每条都有日文与中文两个输入框',
     cards().every((c) => c.querySelectorAll('textarea[data-field]').length === 2));
  ok('每条都有「整条省略」开关',
     cards().every((c) => c.querySelector('[data-omit]') !== null));
  /* 开关住在卡片常驻行里，不能落在会被折叠的正文里 —— 这是「收起时也能标省略」的前提 */
  ok('省略开关挂在常驻行（.kv-card-head）而不是正文里',
     cards().every((c) => c.querySelector('.kv-card-head [data-omit]') !== null &&
                          c.querySelector('.kv-card-body [data-omit]') === null));
  ok('内置场合没有删除按钮', d.querySelector('#kv-groups [data-remove]') === null);

  ok('统计格 4 个', d.querySelectorAll('#kv-stats .stat').length === 4);
  ok('统计格标题正确',
     JSON.stringify([...d.querySelectorAll('#kv-stats .stat-label')].map((e) => e.textContent)) ===
     JSON.stringify(['已完成', '部分缺失', '未填写', '已省略']));
  ok('首屏统计：0 已完成 / 0 部分缺失 / 52 未填写 / 0 已省略',
     JSON.stringify(statVals()) === JSON.stringify(['0', '0', '52', '0']), JSON.stringify(statVals()));
  ok('底栏显示总数', $('#kv-foot').textContent === '共 52 条场合 · 全部显示中',
     $('#kv-foot').textContent);
  ok('结果区是空态', out() === '' && $('#kv-out-foot').textContent === '—');
  ok('筛选默认「全部」',
     $('[data-filter="all"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-filter="complete"]').getAttribute('aria-pressed') === 'false');
  ok('「隐藏已省略」默认关闭', $('#kv-hide-omit').checked === false);
  ok('确认条默认收起', $('#kv-confirm').getAttribute('data-open') !== 'true');
  ok('没有草稿时不报「已恢复」', $('#kv-status').textContent === '', $('#kv-status').textContent);
  ok('缺失的库函数会 bail（本轮 site.js 具备全部依赖，故不显示）',
     d.querySelector('#kv-status .is-error') === null);

  /* ---------- 2. 角色 ID 与档名 ---------- */
  section('2. 角色 ID 与档名');

  ok('角色 ID 为空时档名是 ???-后缀',
     cardOf('Intro').querySelector('.kv-file').textContent === '???-Intro',
     cardOf('Intro').querySelector('.kv-file').textContent);

  ok('角色 ID 的输入示例是数字形式（wiki 上就是编号）',
     $('#kv-charid').getAttribute('placeholder') === '例如 560',
     $('#kv-charid').getAttribute('placeholder'));
  ok('说明里的档名示例也是数字 ID',
     $('#kv-charid').parentNode.querySelector('.hint').textContent.indexOf('560-Intro') >= 0,
     $('#kv-charid').parentNode.querySelector('.hint').textContent);

  await setCharId('  560  ');
  ok('填角色 ID 后档名立刻更新（含首尾空格被去掉）',
     cardOf('Intro').querySelector('.kv-file').textContent === '560-Intro',
     cardOf('Intro').querySelector('.kv-file').textContent);
  ok('长后缀也照拼', cardOf('ConstComplete').querySelector('.kv-file').textContent === '560-ConstComplete');
  ok('时报的档名是四位数字', cardOf('2300').querySelector('.kv-file').textContent === '560-2300');

  /* ---------- 3. 填写与状态判定 ---------- */
  section('3. 填写与状态判定');

  const intro = cardOf('Intro');
  await click(intro.querySelector('.kv-card-head'));
  ok('点卡片头展开', !intro.classList.contains('kv-card--collapsed') &&
     intro.querySelector('.kv-card-toggle').getAttribute('aria-expanded') === 'true');

  await setText('Intro', 'jp', 'あ');
  ok('只填日文 → 部分缺失', statusOf('Intro') === 'partial', statusOf('Intro'));
  ok('统计随之更新', JSON.stringify(statVals()) === JSON.stringify(['0', '1', '51', '0']),
     JSON.stringify(statVals()));
  ok('分组计数更新', groupOf('main').querySelector('.kv-group-count').textContent === '28 条 · 已完成 0',
     groupOf('main').querySelector('.kv-group-count').textContent);
  ok('时报分组不受影响', groupOf('hour').querySelector('.kv-group-count').textContent === '24 条 · 已完成 0');

  await setText('Intro', 'zh', '啊');
  ok('两边都填 → 已完成', statusOf('Intro') === 'complete', statusOf('Intro'));
  ok('统计：1 已完成 / 51 未填写',
     JSON.stringify(statVals()) === JSON.stringify(['1', '0', '51', '0']), JSON.stringify(statVals()));
  ok('分组计数：已完成 1', groupOf('main').querySelector('.kv-group-count').textContent === '28 条 · 已完成 1');

  await setText('Intro', 'zh', '   ');
  ok('只有空白不算填过 → 退回部分缺失', statusOf('Intro') === 'partial', statusOf('Intro'));
  await setText('Intro', 'zh', '啊');

  await setText('Sec1', 'jp', RAW);
  ok('台词里的 HTML 原样保留在输入框里',
     field('Sec1', 'jp').value === RAW, JSON.stringify(field('Sec1', 'jp').value));
  ok('台词没有被当作标记渲染', d.querySelector('#kv-groups b') === null);
  ok('页面里没有多出 textarea', d.querySelectorAll('#kv-groups textarea').length === 104,
     String(d.querySelectorAll('#kv-groups textarea').length));

  /* 触发一次整表重绘（添加自定义场合走 renderAll），确认重绘后正文不丢、不被解析 */
  $('#kv-new-suffix').value = 'RedrawProbe';
  $('#kv-new-label').value = '重绘探针';
  await clickSel('#kv-add');
  ok('重绘后台词仍是原文', field('Sec1', 'jp').value === RAW, JSON.stringify(field('Sec1', 'jp').value));
  ok('重绘后仍没有被解析成 HTML', d.querySelector('#kv-groups b') === null);
  ok('重绘后卡片总数 +1', cards().length === 53, String(cards().length));
  await click(cardOf('RedrawProbe').querySelector('[data-remove]'));
  ok('删掉探针后回到 52 条', cards().length === 52, String(cards().length));
  ok('删除后分组也收掉了', JSON.stringify(groupIds()) === JSON.stringify(['main', 'hour']),
     JSON.stringify(groupIds()));
  ok('删除不会动到别的台词', field('Sec1', 'jp').value === RAW && field('Intro', 'zh').value === '啊');

  /* ---------- 4. 折叠（条目级 + 分组级，两层都必须真的收起来） ---------- */
  section('4. 折叠');

  const bodyOf = (suffix) => cardOf(suffix).querySelector('.kv-card-body');
  const grpCollapsed = (id) => groupOf(id).classList.contains('kv-group--collapsed');
  const grpToggle = (id) => groupOf(id).querySelector('[data-group-toggle]');

  /* -- 条目级 -- */
  ok('展开的条目正文没有被藏', bodyOf('Intro').hidden === false && bodyOf('Sec1').hidden === false);

  await click(cardOf('Intro').querySelector('.kv-card-head'));
  ok('再点一次收起',
     cardOf('Intro').classList.contains('kv-card--collapsed') &&
     cardOf('Intro').querySelector('.kv-card-toggle').getAttribute('aria-expanded') === 'false');
  ok('收起后正文真的被藏起来', bodyOf('Intro').hidden === true, String(bodyOf('Intro').hidden));
  ok('收起一条不会连累旁边的', bodyOf('Sec1').hidden === false);
  ok('收起后输入框仍在 DOM 里（只是被隐藏）', field('Intro', 'zh') !== null);

  /* 省略开关住在常驻行里，卡片收起来时它必须还露在外面。
     判据用「逐级往上找 hidden 祖先」，而不是数 class 名 ——
     「到底藏没藏起来」只有 DOM 上的 hidden 算数（jsdom 不计算样式表）。 */
  const hiddenByAncestor = (node) => {
    for (let n = node; n && n !== d.body; n = n.parentNode) if (n.hidden) return true;
    return false;
  };
  ok('收起状态下省略开关仍然露在外面（没有任何祖先藏着它）',
     omitBox('Intro') !== null && !hiddenByAncestor(omitBox('Intro')));
  ok('对照：正文确实是藏起来的', hiddenByAncestor(field('Intro', 'zh')) === true);

  /* 开关紧挨着折叠按钮，点它不能把卡片折起来 */
  await click(cardOf('Intro').querySelector('.kv-omit'));
  ok('点省略开关不会顺手折叠这张卡片',
     cardOf('Intro').classList.contains('kv-card--collapsed') && bodyOf('Intro').hidden === true);

  /* 收起状态下标省略 —— 这次改动的目的就是省掉「先展开、再勾、再收起」 */
  await setOmit('Intro', true);
  ok('收起状态下能勾上省略',
     omitBox('Intro').checked === true && statusOf('Intro') === 'omitted', statusOf('Intro'));
  ok('勾完还收着（标一条不该打断浏览）',
     cardOf('Intro').classList.contains('kv-card--collapsed'));
  ok('统计里计入已省略', statVals()[3] === '1', JSON.stringify(statVals()));
  await setOmit('Intro', false);
  ok('也能在收起状态下取消，状态跟着回退',
     omitBox('Intro').checked === false && statusOf('Intro') === 'complete', statusOf('Intro'));

  /* -- 分组级：两个内置分组各自独立 -- */
  await click(grpToggle('main'));
  ok('分组折叠生效',
     grpCollapsed('main') && grpToggle('main').getAttribute('aria-expanded') === 'false');
  ok('另一个分组不受影响（常规台词 / 时报各自独立）', !grpCollapsed('hour'));
  ok('分组折叠不影响卡片自身的折叠状态', cards().length === 52);
  ok('分组切换按钮带上鼠标提示', grpToggle('main').title === '展开这一组', grpToggle('main').title);

  /* 整行可点：点「条数」那一块也该折叠，不必精确点中那个小箭头 */
  await click(groupOf('hour').querySelector('.kv-group-count'));
  ok('点分组标题行的「条数」也能折叠该组', grpCollapsed('hour'));
  ok('整行点击只动被点的那一组', grpCollapsed('main'));

  /* 但行内的操作按钮不能被误当成「折叠分组」 */
  await click(grpToggle('hour'));
  ok('前置条件：时报已展开', !grpCollapsed('hour'));
  await click(groupOf('hour').querySelector('[data-batch-omit="1"]'));
  ok('点「全部省略」不会顺手把分组折叠掉',
     !grpCollapsed('hour') && statVals()[3] === '24', JSON.stringify(statVals()));
  await click(groupOf('hour').querySelector('[data-batch-omit="0"]'));
  ok('还原：取消省略后回到 0 条省略', statVals()[3] === '0', JSON.stringify(statVals()));

  /* 上面第一次分组测试把 main 收起来了，先展开 */
  await click(grpToggle('main'));
  ok('前置条件：两个分组都已展开', !grpCollapsed('main') && !grpCollapsed('hour'));

  /* 整行可点：连 .kv-group-head 自身的空白处也算折叠 */
  await click(groupOf('main').querySelector('.kv-group-head'));
  ok('点标题行本身（.kv-group-head）也能折叠', grpCollapsed('main'));
  await click(groupOf('main').querySelector('.kv-group-head'));
  ok('再点标题行能展开回去', !grpCollapsed('main'));

  /* -- 全部展开 / 全部折叠 -- */
  await clickSel('#kv-expand');
  ok('「展开全部」把 52 条都展开',
     cards().every((c) => !c.classList.contains('kv-card--collapsed')));
  ok('「展开全部」把 52 条的正文都放出来',
     cards().every((c) => c.querySelector('.kv-card-body').hidden === false));

  /* 收起一个分组再点「展开全部」：它必须跟着展开，否则按钮看起来没生效 */
  await click(grpToggle('hour'));
  ok('前置条件：时报被收起', grpCollapsed('hour'));
  await clickSel('#kv-expand');
  ok('「展开全部」会把收起的分组一起展开', !grpCollapsed('hour'));
  ok('展开后正文都是可见的', cards().every((c) => c.querySelector('.kv-card-body').hidden === false));

  await clickSel('#kv-collapse');
  ok('「折叠全部」把 52 条都收起',
     cards().every((c) => c.classList.contains('kv-card--collapsed')));
  ok('「折叠全部」把 52 条的正文都藏起来',
     cards().every((c) => c.querySelector('.kv-card-body').hidden === true));
  ok('「折叠全部」保留分组标题（分组不跟着收起）',
     !grpCollapsed('main') && !grpCollapsed('hour'));

  await clickSel('#kv-expand');
  ok('再点「展开全部」回到全展开',
     cards().every((c) => c.querySelector('.kv-card-body').hidden === false));

  /* ---------- 5. 省略 ---------- */
  section('5. 省略');

  await setOmit('Sec2', true);
  ok('勾上省略 → 已省略', statusOf('Sec2') === 'omitted', statusOf('Sec2'));
  ok('统计：1 已省略 / 50 未填写',
     JSON.stringify(statVals()) === JSON.stringify(['1', '1', '49', '1']), JSON.stringify(statVals()));
  ok('分组计数带上省略数',
     groupOf('main').querySelector('.kv-group-count').textContent === '28 条 · 已完成 1 · 省略 1',
     groupOf('main').querySelector('.kv-group-count').textContent);

  await setHideOmit(true);
  ok('隐藏已省略后卡片被隐藏', cardOf('Sec2').hidden === true);
  ok('可见数减一', visible().length === 51, String(visible().length));
  ok('底栏说明当前显示的条数', $('#kv-foot').textContent === '共 52 条场合 · 当前筛选下显示 51 条',
     $('#kv-foot').textContent);
  await setHideOmit(false);
  ok('取消隐藏后恢复', cardOf('Sec2').hidden === false && visible().length === 52);

  await click(groupOf('main').querySelector('[data-batch-omit="1"]'));
  ok('整组「全部省略」把 28 条常规台词都标成省略',
     d.querySelectorAll('#kv-groups .kv-group[data-group="main"] .kv-card[data-status="omitted"]').length === 28);
  ok('统计：28 已省略 / 24 未填写',
     JSON.stringify(statVals()) === JSON.stringify(['0', '0', '24', '28']), JSON.stringify(statVals()));
  ok('时报没有被动到',
     d.querySelectorAll('#kv-groups .kv-group[data-group="hour"] .kv-card[data-status="omitted"]').length === 0);

  await click(groupOf('main').querySelector('[data-batch-omit="0"]'));
  ok('「取消省略」恢复原状态',
     JSON.stringify(statVals()) === JSON.stringify(['1', '1', '50', '0']), JSON.stringify(statVals()));
  ok('整组操作走的是局部同步，台词没有丢', field('Sec1', 'jp').value === RAW);

  /* ---------- 6. 筛选 ---------- */
  section('6. 筛选');

  await setOmit('Sec2', true);   /* 上一步的整组取消把它一起清掉了，这里重设 */
  ok('前置条件：1 条已省略', statVals()[3] === '1', JSON.stringify(statVals()));

  await setFilter('complete');
  ok('筛选「已完成」只剩 Intro', visible().length === 1 && visible()[0].querySelector('.kv-code').textContent === 'Intro',
     visible().map((c) => c.querySelector('.kv-code').textContent).join(','));
  ok('筛选后 aria-pressed 正确',
     $('[data-filter="complete"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-filter="all"]').getAttribute('aria-pressed') === 'false');

  await setFilter('partial');
  ok('筛选「部分缺失」只剩 Sec1',
     visible().length === 1 && visible()[0].querySelector('.kv-code').textContent === 'Sec1');

  await setFilter('empty');
  ok('筛选「未填写」是 49 条（已省略的不算在未填写里）',
     visible().length === 49, String(visible().length));

  await setHideOmit(true);
  ok('「未填写」与「隐藏已省略」叠加仍是 49 条', visible().length === 49, String(visible().length));
  await setFilter('all');
  ok('「全部」下隐藏已省略 → 51 条', visible().length === 51, String(visible().length));
  await setHideOmit(false);
  await setFilter('all');
  ok('全部显示 52 条', visible().length === 52);

  /* ---------- 7. 生成 Wikitext ---------- */
  section('7. 生成 Wikitext');

  await setCharId('');
  await clickSel('#kv-generate');
  ok('没填角色 ID 时拒绝生成并给出提示',
     $('#kv-status .is-error') !== null && $('#kv-status').textContent.indexOf('角色 ID') >= 0,
     $('#kv-status').textContent);
  ok('拒绝生成时不动已有的结果区', out() === '');

  await setCharId('560');
  /* 把整组时报标成省略：这样剩下要生成的就是 28 条常规台词去掉 Sec2 */
  await click(groupOf('hour').querySelector('[data-batch-omit="1"]'));
  ok('前置条件：时报 24 条全部省略', statVals()[3] === '25', JSON.stringify(statVals()));

  await clickSel('#kv-generate');
  const lines = outLines();

  ok('首行是页头模板', lines[0] === '{{台词翻译表/页头}}', lines[0]);
  ok('末行是页尾模板', lines[lines.length - 1] === '{{页尾}}', lines[lines.length - 1]);
  ok('倒数第二行是一条记录的结束', lines[lines.length - 2] === '}}', lines[lines.length - 2]);
  ok('共 27 条记录 × 6 行 + 两行页套 = 164 行', lines.length === 164, String(lines.length));
  ok('27 个 {{台词翻译表}} 块', lines.filter((l) => l === '{{台词翻译表').length === 27,
     String(lines.filter((l) => l === '{{台词翻译表').length));

  ok('第一条记录的六行完全符合模板格式',
     JSON.stringify(lines.slice(0, 7)) === JSON.stringify([
       '{{台词翻译表/页头}}',
       '{{台词翻译表',
       ' | 档名 = 560-Intro',
       ' | 场合 = 入手/登入时',
       ' | 日文台词 = あ',
       ' | 中文译文 = 啊',
       '}}'
     ]),
     JSON.stringify(lines.slice(0, 7)));
  ok('日文台词原样进入 Wikitext（不转义、不丢字）',
     lines.indexOf(' | 日文台词 = ' + RAW) >= 0);
  ok('空着的另一栏生成空值而不是省略该行', lines.indexOf(' | 中文译文 = ') >= 0);
  ok('被标成省略的场合不出现',
     lines.indexOf(' | 档名 = 560-Sec2') < 0 && lines.indexOf(' | 档名 = 560-0000') < 0);

  /* 手算的档名顺序：28 条常规台词去掉 Sec2，再没有时报 */
  const EXPECT_ORDER = ['Intro', 'Sec1', 'Sec3', 'ConstComplete', 'Return', 'Achievement',
    'Equip1', 'Equip2', 'DockLightDmg', 'DockMedDmg', 'FleetOrg', 'Sortie', 'Battle', 'Atk1',
    'Atk2', 'NightBattle', 'LightDmg1', 'LightDmg2', 'MedDmg', 'Sunk', 'MVP', 'Proposal',
    'LibIntro', 'Equip3', 'Resupply', 'SecWed', 'Idle'];
  const names = lines.filter((l) => l.indexOf(' | 档名 = ') === 0)
    .map((l) => l.slice(' | 档名 = '.length));
  ok('档名顺序与场合表一致（27 条）',
     JSON.stringify(names) === JSON.stringify(EXPECT_ORDER.map((s) => '560-' + s)),
     JSON.stringify(names.slice(0, 4)) + '…');

  ok('结果区说明写明生成了多少条、跳过了多少条',
     $('#kv-out-foot').textContent === '已生成 27 条，跳过 25 条省略', $('#kv-out-foot').textContent);
  ok('结果区说明用的是「成功」色', $('#kv-out-foot .is-ok') !== null);

  /* 台词里混进 | 会被 MediaWiki 当成参数分隔符 —— 工具要提醒，但不能替用户改 */
  await setText('Atk1', 'jp', 'A|B');
  await clickSel('#kv-generate');
  ok('台词含 | 时给出警告', $('#kv-out-foot .is-warn') !== null, $('#kv-out-foot').textContent);
  ok('警告里点明了条数', $('#kv-out-foot').textContent.indexOf('其中 1 条') >= 0,
     $('#kv-out-foot').textContent);
  ok('警告里给出 {{!}} 的写法', $('#kv-out-foot').textContent.indexOf('{{!}}') >= 0);
  ok('含 | 的台词仍原样输出（不静默改写）', outLines().indexOf(' | 日文台词 = A|B') >= 0);
  ok('花括号也算进警告', (await (async () => {
    await setText('Atk1', 'jp', 'A{{B}}');
    await clickSel('#kv-generate');
    return $('#kv-out-foot').textContent.indexOf('其中 1 条') >= 0;
  })()));
  await setText('Atk1', 'jp', '');
  await clickSel('#kv-generate');
  ok('台词清干净后警告消失', $('#kv-out-foot .is-warn') === null &&
     $('#kv-out-foot .is-ok') !== null, $('#kv-out-foot').textContent);

  /* ---------- 8. 复制与下载 ---------- */
  section('8. 复制与下载');

  copied = null;
  await clickSel('#kv-copy');
  ok('复制到的是生成结果全文', copied === out(), JSON.stringify(copied && copied.slice(0, 24)));

  let threw = false;
  try { await clickSel('#kv-download'); } catch (e) { threw = true; }
  ok('jsdom 里没有 createObjectURL，点下载不抛异常', !threw);
  ok('下载失败时给出提示', (d.querySelector('.toast') || {}).textContent === '当前环境不支持下载',
     (d.querySelector('.toast') || {}).textContent);

  /* ---------- 9. 自定义场合 ---------- */
  section('9. 自定义场合');

  await clickSel('#kv-add');
  ok('缺字段时不添加并给出提示',
     $('#kv-status .is-error') !== null && $('#kv-status').textContent.indexOf('都要填') >= 0,
     $('#kv-status').textContent);
  ok('卡片数没变', cards().length === 52);

  $('#kv-new-suffix').value = 'Intro';
  $('#kv-new-label').value = '重复后缀';
  await clickSel('#kv-add');
  ok('后缀重复时拒绝',
     $('#kv-status .is-error') !== null && $('#kv-status').textContent.indexOf('已经用过') >= 0,
     $('#kv-status').textContent);

  $('#kv-new-suffix').value = 'Bad|Suffix';
  await clickSel('#kv-add');
  ok('后缀含 | 时拒绝并说明原因',
     $('#kv-status .is-error') !== null && $('#kv-status').textContent.indexOf('不能包含 |') >= 0,
     $('#kv-status').textContent);

  $('#kv-new-suffix').value = 'Xmas2024';
  $('#kv-new-label').value = '圣诞节';
  $('#kv-new-group').value = '';
  await clickSel('#kv-add');
  ok('添加成功后卡片数 +1', cards().length === 53, String(cards().length));
  ok('留空分组名时用场合名当分组',
     groupOf('圣诞节') !== null &&
     JSON.stringify(groupIds()) === JSON.stringify(['main', 'hour', '圣诞节']),
     JSON.stringify(groupIds()));
  ok('自定义场合带「自定义」徽章',
     cardOf('Xmas2024').querySelector('.badge').textContent === '自定义');
  ok('自定义场合有删除按钮', cardOf('Xmas2024').querySelector('[data-remove]') !== null);
  ok('添加后输入框清空',
     $('#kv-new-suffix').value === '' && $('#kv-new-label').value === '' && $('#kv-new-group').value === '');
  ok('添加后给出成功提示', $('#kv-status .is-ok') !== null, $('#kv-status').textContent);
  ok('自定义场合默认展开', !cardOf('Xmas2024').classList.contains('kv-card--collapsed'));

  $('#kv-new-suffix').value = 'NewYear';
  $('#kv-new-label').value = '元旦';
  $('#kv-new-group').value = '活动';
  await clickSel('#kv-add');
  ok('自定义分组按添加顺序排在最后',
     JSON.stringify(groupIds()) === JSON.stringify(['main', 'hour', '圣诞节', '活动']),
     JSON.stringify(groupIds()));

  await click(cardOf('NewYear').querySelector('[data-remove]'));
  ok('删除自定义场合', cardOf('NewYear') === undefined);
  ok('该分组没有别的场合，分组一起收掉',
     JSON.stringify(groupIds()) === JSON.stringify(['main', 'hour', '圣诞节']), JSON.stringify(groupIds()));
  ok('删掉的是自定义的那条，内置的还在', cards().length === 53, String(cards().length));

  await setFilter('all');
  await setCharId('560');
  await setText('Xmas2024', 'jp', 'メリークリスマス');
  await setText('Xmas2024', 'zh', '圣诞快乐');
  ok('自定义场合也算进完成度', statVals()[0] === '2', JSON.stringify(statVals()));
  ok('自定义分组计数只算自己组的条目',
     groupOf('圣诞节').querySelector('.kv-group-count').textContent === '1 条 · 已完成 1',
     groupOf('圣诞节').querySelector('.kv-group-count').textContent);

  /* 自定义分组与两个内置分组一样，可以独立折叠 */
  await click(groupOf('圣诞节').querySelector('[data-group-toggle]'));
  ok('自定义分组也能独立折叠',
     groupOf('圣诞节').classList.contains('kv-group--collapsed') &&
     !groupOf('main').classList.contains('kv-group--collapsed') &&
     !groupOf('hour').classList.contains('kv-group--collapsed'));
  ok('折叠自定义分组后条目仍在 DOM 里', cardOf('Xmas2024') !== undefined);
  await click(groupOf('圣诞节').querySelector('[data-group-toggle]'));
  ok('自定义分组能再展开回去', !groupOf('圣诞节').classList.contains('kv-group--collapsed'));

  await clickSel('#kv-generate');
  ok('自定义场合排在生成结果最后',
     outLines().filter((l) => l.indexOf(' | 档名 = ') === 0).pop() === ' | 档名 = 560-Xmas2024',
     outLines().filter((l) => l.indexOf(' | 档名 = ') === 0).pop());
  ok('自定义场合的台词进了结果', outLines().indexOf(' | 日文台词 = メリークリスマス') >= 0);

  /* ---------- 10. 清空（两步确认） ---------- */
  section('10. 清空');

  await clickSel('#kv-clear');
  ok('第一次点「清空内容」只展开确认条',
     $('#kv-confirm').getAttribute('data-open') === 'true' &&
     field('Intro', 'zh').value === '啊');
  await clickSel('#kv-confirm-no');
  ok('取消后确认条收起、内容不动',
     $('#kv-confirm').getAttribute('data-open') === 'false' && field('Intro', 'zh').value === '啊');

  await clickSel('#kv-clear');
  await clickSel('#kv-confirm-yes');
  ok('确认后确认条收起', $('#kv-confirm').getAttribute('data-open') === 'false');
  ok('所有台词清空',
     cards().every((c) => c.querySelector('[data-field="jp"]').value === '' &&
                         c.querySelector('[data-field="zh"]').value === ''));
  ok('省略标记清空', cards().every((c) => c.querySelector('[data-omit]').checked === false));
  ok('自定义场合被删掉', cards().length === 52 && groupIds().length === 2, String(cards().length));
  ok('统计回到全空', JSON.stringify(statVals()) === JSON.stringify(['0', '0', '52', '0']),
     JSON.stringify(statVals()));
  ok('角色 ID 保留',
     $('#kv-charid').value === '560' &&
     cardOf('Intro').querySelector('.kv-file').textContent === '560-Intro');
  ok('结果区回到空态', out() === '' && $('#kv-out-foot').textContent === '—');
  ok('清空后给出提示', $('#kv-status .is-ok') !== null, $('#kv-status').textContent);

  await setFilter('complete');
  ok('筛不到条目时显示空态提示',
     visible().length === 0 && $('#kv-empty').hidden === false);
  ok('空态提示的文案是引导性的', $('#kv-empty').textContent.indexOf('当前筛选下没有条目') >= 0);
  await setFilter('all');
  ok('切回「全部」后空态提示收起', $('#kv-empty').hidden === true);

  /* ---------- 11. 草稿（另开一个页面，预置 localStorage） ---------- */
  section('11. 草稿');

  const draft = {
    v: 1,
    charId: '204',
    filter: 'partial',
    hideOmitted: true,
    groups: ['main', 'hour', '活动'],
    groupCollapsed: { main: true, hour: false, '活动': false },
    scenes: [
      { suffix: 'Intro', label: '入手/登入时', group: 'main', jp: 'あ', zh: '啊',
        omit: false, collapsed: false, custom: false },
      { suffix: '0000', label: '〇〇〇〇时报', group: 'hour', jp: '', zh: '',
        omit: true, collapsed: true, custom: false },
      { suffix: 'Xmas2024', label: '圣诞节', group: '活动', jp: 'x', zh: 'y',
        omit: false, collapsed: false, custom: true }
    ]
  };

  const p2 = await loadPage('tools/kcwiki-voiceline/index.html', {
    storage: { 'toolbox-kcwiki-voiceline': JSON.stringify(draft) }
  });
  const d2 = p2.d;
  const cards2 = () => [...d2.querySelectorAll('#kv-groups .kv-card')];
  const card2 = (suffix) => cards2().find((c) => c.querySelector('.kv-code').textContent === suffix);
  const stat2 = () => [...d2.querySelectorAll('#kv-stats .stat-value')].map((e) => e.textContent);

  ok('草稿页无脚本错误', p2.errors.length === 0, p2.errors.join(' | '));
  ok('恢复了角色 ID', d2.querySelector('#kv-charid').value === '204');
  ok('恢复了筛选项',
     d2.querySelector('[data-filter="partial"]').getAttribute('aria-pressed') === 'true' &&
     d2.querySelector('[data-filter="all"]').getAttribute('aria-pressed') === 'false');
  ok('恢复了「隐藏已省略」', d2.querySelector('#kv-hide-omit').checked === true);
  ok('恢复了台词文本',
     card2('Intro').querySelector('[data-field="jp"]').value === 'あ' &&
     card2('Intro').querySelector('[data-field="zh"]').value === '啊');
  ok('恢复了省略标记',
     card2('0000').getAttribute('data-status') === 'omitted' &&
     card2('0000').querySelector('[data-omit]').checked === true);
  ok('恢复了自定义场合与它的分组',
     card2('Xmas2024') !== undefined && card2('Xmas2024').querySelector('.badge').textContent === '自定义' &&
     d2.querySelector('#kv-groups .kv-group[data-group="活动"]') !== null);
  ok('恢复了分组折叠状态',
     d2.querySelector('#kv-groups .kv-group[data-group="main"]').classList.contains('kv-group--collapsed') &&
     !d2.querySelector('#kv-groups .kv-group[data-group="hour"]').classList.contains('kv-group--collapsed'));
  ok('恢复了展开的卡片', card2('Intro').querySelector('.kv-card-toggle').getAttribute('aria-expanded') === 'true');
  ok('草稿里收起的条目正文是藏着的、展开的是放出来的',
     card2('0000').querySelector('.kv-card-body').hidden === true &&
     card2('Intro').querySelector('.kv-card-body').hidden === false);
  ok('统计按草稿算：2 已完成 / 1 已省略 / 50 未填写',
     JSON.stringify(stat2()) === JSON.stringify(['2', '0', '50', '1']), JSON.stringify(stat2()));
  ok('「部分缺失」筛不到东西 → 显示空态，且已省略的那条被隐藏',
     d2.querySelector('#kv-empty').hidden === false && card2('0000').hidden === true);
  ok('状态行说明草稿已恢复',
     d2.querySelector('#kv-status').textContent.indexOf('已恢复') >= 0,
     d2.querySelector('#kv-status').textContent);

  /* 坏草稿不能把页面搞挂 */
  const p3 = await loadPage('tools/kcwiki-voiceline/index.html', {
    storage: { 'toolbox-kcwiki-voiceline': '{ 这不是 JSON' }
  });
  ok('草稿是坏 JSON 时无脚本错误', p3.errors.length === 0, p3.errors.join(' | '));
  ok('坏草稿下仍渲染 52 条', p3.d.querySelectorAll('#kv-groups .kv-card').length === 52);
  ok('坏草稿不算「已恢复」', p3.d.querySelector('#kv-status').textContent === '',
     p3.d.querySelector('#kv-status').textContent);

  const p4 = await loadPage('tools/kcwiki-voiceline/index.html', {
    storage: { 'toolbox-kcwiki-voiceline': JSON.stringify({ scenes: 'nope', groups: 123, filter: 'zzz' }) }
  });
  ok('草稿字段类型不对时降级到默认值',
     p4.errors.length === 0 &&
     p4.d.querySelectorAll('#kv-groups .kv-card').length === 52 &&
     p4.d.querySelector('[data-filter="all"]').getAttribute('aria-pressed') === 'true',
     p4.errors.join(' | '));

  /* 保存：改一处之后草稿要落到 localStorage */
  const saved = await (async () => {
    $('#kv-charid').value = '127';
    await fire($('#kv-charid'), 'input');
    await sleep(380);                     /* 保存走 300ms 防抖 */
    return w.localStorage.getItem('toolbox-kcwiki-voiceline');
  })();
  ok('改动后草稿写进了 localStorage', typeof saved === 'string' && saved.length > 0);
  ok('草稿里记的是最新的角色 ID',
     saved.indexOf('"charId":"127"') >= 0, String(saved).slice(0, 60));

  ok('全程无脚本错误', errors.length === 0, errors.join(' | '));
}
