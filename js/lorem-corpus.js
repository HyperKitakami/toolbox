/* ==========================================================================
   lorem-corpus.js — 占位文本语料（拉丁 + 中文）
   --------------------------------------------------------------------------
   挂在 window.TOOLBOX.corpus 上，必须在 registry.js 之后加载。

   **拉丁语料（la）**
     第 1–6 段出自 Cicero《De Finibus Bonorum et Malorum》1.10.32–1.10.33，
     也就是通常说的 Lorem ipsum 的出处。成文于公元前 45 年，早已进入公有领域。
     第 7–8 段**不是** Cicero 原文 —— 它们是网络模板里流传的另一套拉丁填充句
     （pellentesque / accumsan / scelerisque 这些词来自别处），出处已不可考。
     上游把八段一起标成 De Finibus，这里把标注改准，数据本身原样保留：
     拉丁文本身不涉及版权，去掉两段只会让句子数量少掉三分之一。
     来源与改动见 THIRD-PARTY.md 第 14 条。

   **中文语料（zh）**
     本项目自撰（随本仓库以 MIT 发布，可自由使用）。占位文本的用途就是「看着像正文、
     但不表达任何实际内容」，所以写的是关于排版与阅读本身的中性叙述 ——
     看上去是正常的现代汉语散文，读进去却什么信息都没有，正好符合占位文本的要求。
     没有引用任何受版权保护的文学作品。
   ========================================================================== */
(function () {
  'use strict';

  var T = (window.TOOLBOX = window.TOOLBOX || {});

  var LA = [
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
    'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.',
    'Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem. Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur?',
    'Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur? At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.',
    'Similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga. Et harum quidem rerum facilis est et expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus.',
    'Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat.',
    /* 以下两段出处不可考，见文件头说明 */
    'Nulla facilisi. Donec et odio pellentesque diam volutpat commodo sed egestas egestas. Imperdiet dui accumsan sit amet nulla facilisi morbi tempus iaculis. Ornare arcu odio ut sem nulla pharetra diam sit amet. Commodo viverra maecenas accumsan lacus vel facilisis volutpat est velit.',
    'Amet consectetur adipiscing elit pellentesque habitant morbi tristique senectus. Vitae ultricies leo integer malesuada nunc vel risus commodo. Lacus luctus accumsan tortor posuere ac ut consequat semper viverra. Viverra accumsan in nisl nisi scelerisque eu ultrices vitae auctor.'
  ];

  var ZH = [
    '这是一段用于排版预览的示例文字，本身不表达任何观点。它的作用是在正式内容到位之前，把版面的疏密、行距与留白先撑起来。文字的长度和标点都按正常行文排布，所以看上去与真实内容没有区别。',
    '在实际的界面里，一段文字的宽度、行高和字号共同决定了阅读的节奏。把示例文字放进去，可以更直观地判断这些参数是否合适。调整的时候不必纠结具体写了什么，只要看整体的灰度是否均匀就够了。',
    '中文的排布与西文不同：没有词间空格，标点也大多是全角。因此用中文占位时，更容易看出字距与标点挤压的问题。如果一套版式要同时承载两种语言，建议两边都试一遍。',
    '标题通常比正文更短，也更有分量。副标题负责补充说明，长度一般不超过一行。正文承担主要的叙述任务，段落之间留出适当的间隔，阅读时才不会觉得拥挤。',
    '列表适合表达并列关系。每一项的结构最好保持一致，长度也不要相差太多。层级不宜超过三层，再深就该考虑换一种表达方式了。',
    '表格用来呈现结构化的信息。列数过多时，横向滚动会打断阅读；行高过密时，眼睛容易串行。设计的时候先在纸上画一画，往往比直接在屏幕上改要快。',
    '空状态、加载中和出错提示，都是界面的一部分。它们出现得不多，却常常决定用户对产品的印象。写这些文案的时候，把话说清楚比说得漂亮更重要。',
    '最后需要说明的是，这段文字没有任何实际含义。你可以放心地把它替换掉，也可以把它当成一个参照：如果换上真实内容之后版面依然稳定，说明这套样式是可靠的。'
  ];

  T.corpus = { la: LA, zh: ZH };
})();
