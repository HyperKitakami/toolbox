/* ==========================================================================
   密码强度检测（password-strength）测试
   --------------------------------------------------------------------------
   用真实 DOM 交互驱动（设 input.value + dispatch input + 等防抖），
   不直接调工具内部函数。估算模型本身的正确性在 password-utils.mjs 里测，
   这里测的是「页面把它画对了没有」，以及三条页面级的硬约束：

     1. **密码不进任何持久化**：localStorage / URL / 表单；
     2. **含密码文本的节点都是建出来的**（不是拼 HTML），顺带用 innerHTML 反查；
     3. **「隐藏」是前后一致的**：关着的时候，页面文本里不该出现密码的任何片段 ——
        这条最容易漏（拆解表遮了、说明文案里又点名了一遍）。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

const PW = 'Fr33d0m2019!';       /* 弱：命中常见密码表 + l33t + 年份 + 符号 */
const STRONG = 'X7#kq2!mZp9$Lw'; /* 强：14 位、四类字符、没命中任何模式 */

/* 把「13 天」「1.8 分钟」这样的读数换回秒，用来验证场景表的单调性。
   这是刻度的逆运算 —— 刻度本身在 password-utils.mjs 里用四个手算值钉住了，
   这里只用它做相对比较。 */
const UNIT_SEC = {
  '秒': 1, '分钟': 60, '小时': 3600, '天': 86400,
  '年': 31536000, '万年': 31536000e4, '亿年': 31536000e8, '万亿年': 31536000e12
};
function toSeconds(label) {
  if (label === '瞬间') return 1e-3;
  const m = /^(?:约 10\^)?([\d.]+)\s*(万亿年|亿年|万年|分钟|小时|秒|天|年)$/.exec(label);
  return m ? Number(m[1]) * UNIT_SEC[m[2]] : NaN;
}

export default async function run() {
  const ctx = await loadPage('tools/password-strength/index.html');
  const { d, w, errors } = ctx;

  const $ = (sel) => d.querySelector(sel);
  const input = d.getElementById('ps-input');
  const strength = d.getElementById('ps-strength');
  const levelEl = d.getElementById('ps-level');
  const verdictEl = d.getElementById('ps-verdict');
  const statusEl = d.getElementById('ps-status');
  const patterns = d.getElementById('ps-patterns');
  const findings = d.getElementById('ps-findings');
  const revealBtn = d.getElementById('ps-reveal');

  const level = () => strength.getAttribute('data-level');
  const status = () => statusEl.textContent;
  const bodyText = () => d.body.textContent;

  const statVal = (label) => {
    const hit = [...d.querySelectorAll('#ps-stats .stat')]
      .find((s) => s.querySelector('.stat-label').textContent === label);
    return hit ? hit.querySelector('.stat-value').textContent : '(没有这一格)';
  };
  const attackRows = () => [...d.querySelectorAll('#ps-attacks .value-row')].map((r) => ({
    name: r.querySelector('.value-label').textContent,
    time: r.querySelector('.value-text').textContent
  }));
  const segRows = () => [...d.querySelectorAll('#ps-patterns .data-table tbody tr')]
    .map((r) => [...r.children].map((c) => c.textContent));
  const findingByLevel = (lv) => [...d.querySelectorAll('#ps-findings .ps-finding')]
    .filter((f) => f.getAttribute('data-level') === lv);

  const setPw = async (v) => {
    input.value = v;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(280);   /* 输入走 150ms 防抖，全量跑时留足余量 */
  };
  const click = async (sel, wait = 60) => {
    const el = typeof sel === 'string' ? $(sel) : sel;
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };

  /* ---------- 1. 基本渲染 ---------- */
  section('1. 基本渲染');

  ok('无脚本错误', errors.length === 0, errors.join(' | '));
  ok('页面声明了 data-tool 与 data-hub',
    d.body.getAttribute('data-tool') === 'password-strength' &&
    d.body.getAttribute('data-hub') === 'security');
  ok('面包屑中间一项指向安全分类',
    $('.breadcrumb a[href="../../hubs/security/"]') !== null);
  ok('徽章标明本地运行与不保存',
    [...d.querySelectorAll('.tool-head-meta .badge')].some((b) => b.textContent.includes('本地运行')) &&
    [...d.querySelectorAll('.tool-head-meta .badge')].some((b) => b.textContent.includes('不保存')),
    [...d.querySelectorAll('.tool-head-meta .badge')].map((b) => b.textContent).join(' / '));
  ok('顶部有一条「不会被发到任何地方」的常驻提示',
    $('.tool-stack > .notice--warn') !== null &&
    $('.tool-stack > .notice--warn').textContent.includes('不会被发到任何地方'));
  ok('输入框默认是密码类型',
    input.getAttribute('type') === 'password', input.getAttribute('type'));
  ok('相关工具区块渲染了同分类工具',
    count(d, '#related-grid .tool-card') > 0, String(count(d, '#related-grid .tool-card')));

  /* ---------- 2. 空状态 ---------- */
  section('2. 空状态');

  ok('强度条停在 0 档（一段都不点亮）', level() === '0', String(level()));
  ok('等级标签为空', levelEl.textContent === '');
  ok('结论行给出引导文案', /输入/.test(verdictEl.textContent), verdictEl.textContent);
  ok('四个统计格子都是占位',
    ['长度', '字符集大小', '朴素上界', '有效熵'].every((k) => statVal(k) === '—'),
    ['长度', '字符集大小', '朴素上界', '有效熵'].map(statVal).join(' / '));
  ok('五个破解场景已列出，时间都是占位', attackRows().length === 5 &&
    attackRows().every((r) => r.time === '—'), JSON.stringify(attackRows()));
  ok('拆解区是空状态', count(d, '#ps-patterns .ps-empty') === 1);
  ok('建议区是空状态', count(d, '#ps-findings .ps-empty') === 1);
  ok('状态行提示不保存', status().includes('不保存'), status());

  /* ---------- 3. 弱密码的完整报告 ---------- */
  section('3. 弱密码 ' + PW);

  await setPw(PW);
  ok('强度条落在 1 档（弱）', level() === '1', String(level()));
  ok('等级标签是「弱」', levelEl.textContent === '弱', levelEl.textContent);
  ok('结论行同时给出有效熵与朴素上界',
    verdictEl.textContent.includes(statVal('朴素上界').replace(' 比特', '')) &&
    /每个字符都独立随机/.test(verdictEl.textContent),
    verdictEl.textContent);
  ok('四个统计格子都有值',
    ['长度', '字符集大小', '朴素上界', '有效熵'].every((k) => statVal(k) !== '—'),
    ['长度', '字符集大小', '朴素上界', '有效熵'].map(statVal).join(' / '));
  ok('长度是 12 位', statVal('长度') === '12 位', statVal('长度'));
  ok('字符集是 95 种（数字 10 + 大小写 52 + 符号 33）',
    statVal('字符集大小') === '95 种', statVal('字符集大小'));
  ok('朴素上界 = 12 × log₂(95) = 78.8 比特',
    statVal('朴素上界') === (12 * Math.log2(95)).toFixed(1) + ' 比特', statVal('朴素上界'));
  ok('有效熵远低于朴素上界（不到三分之一）',
    parseFloat(statVal('有效熵')) < parseFloat(statVal('朴素上界')) / 3,
    statVal('有效熵') + ' vs ' + statVal('朴素上界'));
  ok('字符构成把四类都列出来了',
    /数字 ×7/.test($('#ps-classes').textContent) &&
    /小写字母 ×3/.test($('#ps-classes').textContent) &&
    /大写字母 ×1/.test($('#ps-classes').textContent) &&
    /符号 ×1/.test($('#ps-classes').textContent),
    $('#ps-classes').textContent);

  ok('五个破解场景都算出了时间', attackRows().length === 5 &&
    attackRows().every((r) => r.time !== '—'), JSON.stringify(attackRows()));
  ok('场景名与 registry 里的顺序一致',
    attackRows().map((r) => r.name).join('|') ===
    w.TOOLBOX.password.ATTACKS.map((a) => a.name).join('|'),
    attackRows().map((r) => r.name).join(' / '));
  ok('每个读数都能解析回秒', attackRows().every((r) => !isNaN(toSeconds(r.time))),
    attackRows().map((r) => r.time).join(' / '));
  ok('攻击者越强时间越短（表格按攻击能力排）',
    attackRows().every((r, i) => i === 0 ||
      toSeconds(r.time) <= toSeconds(attackRows()[i - 1].time) + 1e-9),
    attackRows().map((r) => r.time).join(' → '));
  ok('最弱的攻击者（在线限速）要 13 年、最强的（集群）是瞬间 —— 差 11 个数量级',
    attackRows()[0].time === '13 年' && attackRows()[4].time === '瞬间',
    attackRows()[0].time + ' → ' + attackRows()[4].time);

  ok('拆解表画出 3 段（Fr33d0m / 2019 / !）', segRows().length === 3,
    JSON.stringify(segRows().map((r) => r[1])));
  ok('第一段判定为词表 / 常见密码', segRows()[0][1].includes('词表'), segRows()[0][1]);
  ok('第二段判定为日期', segRows()[1][1] === '日期', segRows()[1][1]);
  ok('第三段判定为逐字符暴力', segRows()[2][1] === '逐字符暴力', segRows()[2][1]);
  ok('代价列带单位', /比特$/.test(segRows()[0][2]), segRows()[0][2]);

  ok('建议区给出了 danger 档（命中最常见密码表）', findingByLevel('danger').length >= 1,
    count(d, '#ps-findings .ps-finding') + ' 条建议');
  ok('建议里有一条讲 l33t 替换挡不住字典攻击',
    [...d.querySelectorAll('#ps-findings .ps-finding-title')]
      .some((t) => /l33t/.test(t.textContent)),
    [...d.querySelectorAll('#ps-findings .ps-finding-title')].map((t) => t.textContent).join(' / '));
  ok('建议里有一条点名年份段',
    [...d.querySelectorAll('#ps-findings .ps-finding-title')]
      .some((t) => /日期|年份/.test(t.textContent)));

  /* ---------- 4. 「隐藏」是前后一致的 ---------- */
  section('4. 隐藏 / 显示');

  ok('默认遮着：输入框是 password 类型', input.getAttribute('type') === 'password');
  ok('按钮文案是「显示」', revealBtn.textContent === '显示', revealBtn.textContent);
  ok('按钮没有 aria-pressed（文案换的是动作，不是状态名）',
    !revealBtn.hasAttribute('aria-pressed'));

  ok('遮着的时候，拆解表里看不到密码片段',
    segRows().every((r) => r[0].indexOf('•') === 0 && r[0].indexOf('Fr33d0m') < 0),
    segRows().map((r) => r[0]).join(' | '));
  ok('遮罩长度与原片段一致（Fr33d0m → 7 个圆点）',
    segRows()[0][0].length === 7, JSON.stringify(segRows()[0][0]));
  ok('遮着的时候，建议文案里也看不到密码片段',
    [...d.querySelectorAll('#ps-findings code')].every((c) => c.textContent.indexOf('•') === 0),
    [...d.querySelectorAll('#ps-findings code')].map((c) => c.textContent).join(' | '));
  ok('整页文本里既没有原密码、也没有它的片段',
    bodyText().indexOf('Fr33d0m') < 0 && bodyText().indexOf('2019') < 0 &&
    bodyText().indexOf(PW) < 0, 'body 里出现了密码片段');

  await click(revealBtn);
  ok('点「显示」后输入框变 text', input.getAttribute('type') === 'text');
  ok('按钮文案变成「隐藏」', revealBtn.textContent === '隐藏', revealBtn.textContent);
  ok('按钮的 title 说明了它能做什么', /显示|隐藏/.test(revealBtn.getAttribute('title') || ''),
    String(revealBtn.getAttribute('title')));
  ok('显示后拆解表里能看到原文', segRows()[0][0] === 'Fr33d0m', segRows()[0][0]);
  ok('显示后建议文案里也点名了片段',
    [...d.querySelectorAll('#ps-findings code')].some((c) => c.textContent === 'Fr33d0m'),
    [...d.querySelectorAll('#ps-findings code')].map((c) => c.textContent).join(' | '));

  await click(revealBtn);
  ok('再点一次能回到隐藏（来回都通）',
    input.getAttribute('type') === 'password' && revealBtn.textContent === '显示' &&
    segRows()[0][0].length === 7, input.getAttribute('type') + '/' + revealBtn.textContent);
  ok('回到隐藏后页面文本里又没有片段了', bodyText().indexOf('Fr33d0m') < 0);

  /* ---------- 5. 强密码 ---------- */
  section('5. 强密码 ' + STRONG);

  await setPw(STRONG);
  ok('强度条落在 4 档（很强）', level() === '4', String(level()));
  ok('有效熵接近朴素上界（没有模式可扣）',
    Math.abs(parseFloat(statVal('有效熵')) - parseFloat(statVal('朴素上界'))) < 1,
    statVal('有效熵') + ' vs ' + statVal('朴素上界'));
  ok('14 段全是逐字符暴力', segRows().length === 14 &&
    segRows().every((r) => r[1] === '逐字符暴力'), segRows()[0] && segRows()[0][1]);
  ok('给出「没有命中任何已知模式」的 ok 档建议', findingByLevel('ok').length === 1,
    count(d, '#ps-findings .ps-finding') + ' 条建议');
  ok('集群离线爆破也挡得住（不是「瞬间」）',
    attackRows()[4].time !== '瞬间', attackRows()[4].time);

  /* ---------- 6. 超长输入 ---------- */
  section('6. 超长输入');

  await setPw('a'.repeat(600));
  ok('状态行给出 warn 档提示', count(d, '#ps-status .is-warn') === 1, status());
  ok('状态行说明只给了朴素估计', /512/.test(status()), status());
  ok('拆解区说明没有拆解结果', count(d, '#ps-patterns .ps-empty') === 1);

  await setPw('hello');
  ok('换回短输入后恢复正常', segRows().length >= 1 && count(d, '#ps-patterns .ps-empty') === 0);

  /* ---------- 7. 示例与清空 ---------- */
  section('7. 填入示例与清空');

  /* 示例是页面自己定的（js/tools/password-strength.js 里的 DEMO）。
     注意它和 PW 不是同一个 —— 页面说明文案里拿 P@ssw0rd 当过例子，
     所以「有没有泄漏」那几条断言不能用它做样本。 */
  const DEMO = 'P@ssw0rd2024';

  await click('[data-demo]');
  ok('示例填进去了', input.value === DEMO, input.value);
  ok('示例顺手亮出来（是给人看的）', input.getAttribute('type') === 'text');
  ok('示例的分析结果立刻出现', level() === '1' && segRows().length === 2,
    String(level()) + ' / ' + segRows().length + ' 段');

  await click('[data-clear]');
  ok('清空后输入框为空', input.value === '');
  ok('清空后强度条回到 0 档', level() === '0');
  ok('清空后建议区回到空状态', count(d, '#ps-findings .ps-empty') === 1);
  ok('清空后页面文本里不含刚才那一整串示例密码', bodyText().indexOf(DEMO) < 0);

  /* ---------- 8. 隐私约束 ---------- */
  section('8. 隐私约束');

  /* 上一节点「填入示例」时故意把内容亮出来了（示例是给人看的），
     这里先回到隐藏态，否则下面「看不见片段」的断言量的是显示态 */
  if (input.getAttribute('type') === 'text') await click(revealBtn);
  ok('先回到隐藏态再验', input.getAttribute('type') === 'password' &&
    revealBtn.textContent === '显示');

  await setPw(PW);
  ok('localStorage 里一个键都没写（本页没有草稿功能）',
    w.localStorage.length === 0,
    JSON.stringify(Object.keys(w.localStorage)));
  ok('sessionStorage 也是空的', w.sessionStorage.length === 0,
    JSON.stringify(Object.keys(w.sessionStorage)));
  ok('页面上没有 form（不可能被提交出去）', count(d, 'form') === 0);
  ok('输入框没挂 name 属性（不会被浏览器当登录表单存）',
    !input.hasAttribute('name'));
  ok('输入框关掉了自动完成与拼写检查',
    input.getAttribute('autocomplete') === 'off' && input.getAttribute('spellcheck') === 'false');
  ok('URL 里没有密码', w.location.href.indexOf('Fr33d0m') < 0, w.location.href);
  ok('分析之后（仍是隐藏态）页面文本里没有密码片段',
    bodyText().indexOf('Fr33d0m') < 0 && bodyText().indexOf('2019') < 0);
  ok('整页 innerHTML 里也搜不到密码（说明没有拼串渲染）',
    d.body.innerHTML.indexOf('Fr33d0m') < 0, 'innerHTML 里出现了密码片段');

  /* ---------- 9. 与 registry / 说明区一致 ---------- */
  section('9. 与 registry / 说明区一致');

  const T = w.TOOLBOX;
  const tool = T.tools.find((t) => t.slug === 'password-strength');
  ok('registry 里挂在安全分类且已上线',
    tool && tool.hub === 'security' && tool.status === 'ready',
    tool && (tool.hub + '/' + tool.status));

  const notes = $('.tool-notes').textContent;
  ok('说明区讲清了两个数字为什么要并排给', /上界/.test(notes) && /有效熵/.test(notes));
  ok('说明区列了字符集档位', /字符集档位/.test(notes));
  ok('说明区列了五个破解场景的量级假设', /慢哈希/.test(notes) && /快哈希/.test(notes));
  ok('说明区讲清了会偏高的四种情况', /偏高/.test(notes));
  ok('说明区讲了为什么不做批量', /不做批量/.test(notes));
  ok('说明区点出了与密码生成器共用同一份实现', /password-utils\.js/.test(notes));
  ok('说明区给了「最后一句实话」——分数不等于安全', /撞库/.test(notes));
}
