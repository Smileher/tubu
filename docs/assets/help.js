(() => {
  'use strict';
  const articles = window.HELP_ARTICLES || [];
  const main = document.getElementById('main');
  const toc = document.getElementById('contents');
  const search = document.getElementById('search');
  const navigation = document.getElementById('navigation');
  const manualVersion = document.querySelector('meta[name=manual-version]')?.content || '';
  const formatVersion = value => { const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value); return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}` : value; };
  const manualVersionLabel = formatVersion(manualVersion);
  const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // File URLs may deny browser storage. Reading settings still works for the current tab.
  function readSetting(key) { try { return localStorage.getItem('help-' + key); } catch (_) { return null; } }
  function saveSetting(key, value) { try { localStorage.setItem('help-' + key, String(value)); } catch (_) {} }
  let size = Number(readSetting('size')) || 16;
  size = Math.max(14, Math.min(22, size));
  let theme = readSetting('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const themeButton = document.getElementById('theme');
  function applySettings() {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty('--body-size', size + 'px');
    document.getElementById('font-size').textContent = Math.round(size / 16 * 100) + '%';
    document.getElementById('font-down').disabled = size <= 14;
    document.getElementById('font-up').disabled = size >= 22;
    themeButton.classList.toggle('dark', theme === 'dark');
    themeButton.setAttribute('aria-checked', String(theme === 'dark'));
    themeButton.title = theme === 'dark' ? '切换为浅色主题' : '切换为深色主题';
  }
  document.getElementById('font-down').addEventListener('click', () => { size = Math.max(14, size - 1); saveSetting('size', size); applySettings(); });
  document.getElementById('font-up').addEventListener('click', () => { size = Math.min(22, size + 1); saveSetting('size', size); applySettings(); });
  themeButton.addEventListener('click', async () => {
    const apply = () => { theme = theme === 'dark' ? 'light' : 'dark'; saveSetting('theme', theme); applySettings(); };
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(); return; }
    const rect = themeButton.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    let applied = false;
    const applyOnce = () => { if (!applied) { applied = true; apply(); } };
    themeButton.disabled = true;
    document.documentElement.classList.add('appearance-changing');
    try {
      const transition = document.startViewTransition(applyOnce);
      try {
        await transition.ready;
        await document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 900, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' }).finished;
      } catch (_) { /* Keep the applied theme if snapshots or animation are unavailable. */ }
      await transition.finished.catch(() => {});
    } catch (_) { applyOnce(); }
    finally { themeButton.disabled = false; document.documentElement.classList.remove('appearance-changing'); }
  });
  applySettings();
  const compactSettings = matchMedia('(max-width: 600px)');
  const syncReadingSettings = () => { document.querySelector('.reading-settings').open = !compactSettings.matches; };
  syncReadingSettings(); compactSettings.addEventListener('change', syncReadingSettings);
  if (!articles.length) {
    main.innerHTML = '<p class="load-error">帮助内容未能加载，请检查是否完整复制了 Help 文件夹。</p>';
    return;
  }
  const categories = [...new Set(articles.map(article => article.category))];
  navigation.innerHTML = '<a class="nav-link" href="#overview"><span class="nav-number">⌂</span>手册概览<span class="nav-arrow">↗</span></a>' + categories.map((category, index) =>
    `<details class="nav-group"${index === 0 ? ' open' : ''}><summary>${escape(category)}<span>${articles.filter(article => article.category === category).length}</span></summary>` + articles.filter(article => article.category === category).map(article =>
      `<a class="nav-link" href="#${article.id}"><span class="nav-number">${String(articles.indexOf(article) + 1).padStart(2, '0')}</span>${escape(article.title)}<span class="nav-arrow">↗</span></a>`).join('') + '</details>').join('');

  function route() {
    const [path, query = ''] = location.hash.slice(1).split('?');
    const [id, section] = (path || 'overview').split('/');
    const params = new URLSearchParams(query);
    return { id, section, query: (params.get('q') || '').slice(0, 120).trim(), category: categories.includes(params.get('category')) ? params.get('category') : '' };
  }
  function highlight(root, query) {
    const words = window.HELP_SEARCH.terms(query);
    if (!words.length) return;
    const expression = new RegExp(words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.parentElement.closest('script,style,mark,button,.search-form')) nodes.push(walker.currentNode);
    }
    nodes.forEach(node => {
      const text = node.textContent;
      const matches = [...text.matchAll(expression)];
      if (!matches.length) return;
      const fragment = document.createDocumentFragment();
      let start = 0;
      matches.forEach(match => {
        fragment.append(text.slice(start, match.index));
        const mark = document.createElement('mark'); mark.textContent = match[0]; fragment.append(mark);
        start = match.index + match[0].length;
      });
      fragment.append(text.slice(start)); node.replaceWith(fragment);
    });
  }
  const validLink = (id, section) => articles.some(article => article.id === id && (!section || article.sections.some(item => item.id === section)));
  const chapterLink = (id, section, title) => validLink(id, section) ? `<a href="#${id}${section ? '/'+section : ''}">${escape(title)} <span aria-hidden="true">↗</span></a>` : '';
  const popular = ['换卷', '抓边', '存图', 'PLC', '报警复位', 'CPK'];
  function queryLink(query, category = '') { return '#search?' + new URLSearchParams({ q: query, ...(category ? { category } : {}) }); }
  function searchForm(id, value = '', hero = false) {
    return `<form class="search-form ${hero ? 'hero-search' : 'page-search'}" role="search"><label class="sr-only" for="${id}">搜索操作、参数或提示文字</label><span aria-hidden="true">⌕</span><input id="${id}" type="search" maxlength="120" placeholder="试试搜索：换卷、尺寸偏差、PLC…" value="${escape(value)}" autocomplete="off" /><button type="submit">搜索 <span aria-hidden="true">↵</span></button></form>`;
  }
  function overview() {
    const paths = [
      ['01', '开始一次检测', '从准备到运行，按顺序完成首次检查。', [['daily','preparation','运行前核对'],['recipes','switch','确认料号'],['daily','start','开始与观察']]],
      ['02', '建立新料号', '准备图像、测量与检测，保存可用配置。', [['recipes','guide','创建引导'],['sizes','workflow','建立尺寸'],['ai','registration','注册模板']]],
      ['03', '调整检测效果', '先判断图像和定位，再调整检测参数。', [['calibration','workflow','标定与标零'],['sizes','parameters','抓边调参'],['inspection','regions','检测区域']]],
      ['04', '查找生产异常', '从现象进入，逐项核对数据和设备。', [['diagnostics',null,'问题排查'],['communication',null,'PLC 与 MES'],['alarms','alarm-reset','报警复位']]]
    ];
    const recent = articles.map((article,index) => ({article,index})).sort((a,b) => b.article.updated.localeCompare(a.article.updated) || a.index-b.index).slice(0,4);
    let saved;
    try { saved = JSON.parse(readSetting('reading') || 'null'); } catch (_) {}
    const resume = saved && validLink(saved.id, saved.section) ? chapterLink(saved.id, saved.section, '继续阅读 · ' + articles.find(a => a.id === saved.id).title) : '';
    return `<div class="overview"><section class="overview-hero"><p class="eyebrow">VISIONMEASURE / HELP CENTER</p><div class="hero-heading"><h1>涂布检测软件<br /><em>操作手册</em></h1><span class="hero-seal" aria-hidden="true">V<span>操作手册</span></span></div><p class="intro">查找操作方法、理解运行过程，快速定位生产中的问题。</p>${searchForm('home-search', '', true)}<div class="popular-searches"><span>常用搜索</span>${popular.map(word => `<a href="${queryLink(word)}">${word}</a>`).join('')}</div><div class="hero-meta"><span>${articles.length} 个功能主题</span>${manualVersionLabel ? `<time class="manual-updated" datetime="${escape(manualVersionLabel.replace(' ', 'T'))}"><small>手册更新</small><strong>${escape(manualVersionLabel)}</strong></time>` : ''}</div>${resume ? `<div class="resume-link">${resume}</div>` : ''}</section>
      <section><div class="section-caption"><h2>从你要完成的事开始</h2><span>按步骤查阅</span></div><div class="task-grid">${paths.map(([number,title,description,links]) => `<section class="task-card"><span class="task-number">${number}</span><h3>${title}</h3><p>${description}</p><div>${links.map(args => chapterLink(...args)).join('')}</div></section>`).join('')}</div></section>
      <section><div class="section-caption"><h2>浏览功能手册</h2><span>${categories.length} 个分类 · 按功能查找</span></div><div class="category-grid">${categories.map((category,index) => `<section class="category-card"><div class="category-heading"><span>${String(index+1).padStart(2,'0')}</span><h3>${escape(category)}</h3></div>${articles.filter(article => article.category === category).map(article => `<a href="#${article.id}"><span><strong>${escape(article.title)}</strong><small>${escape(article.summary)}</small></span><span aria-hidden="true">↗</span></a>`).join('')}</section>`).join('')}</div></section>
      <div class="home-bottom"><section><div class="section-caption"><h2>常见问题</h2><span>从现象查找</span></div><div class="faq-links">${[
        ['cameras','camera-problems','运行中没有新图像'],['sizes','troubleshooting','测量尺寸不稳定或有偏差'],['inspection','troubleshooting','瑕疵误报或漏检'],['rolls','check','换卷后计米或报表异常'],['communication','troubleshooting','PLC 没有动作'],['images','troubleshooting','找不到保存的图像']
      ].map(args => chapterLink(...args)).join('')}</div></section><section><div class="section-caption"><h2>最近更新</h2><span>按内容更新时间</span></div><div class="recent-list">${recent.map(({article}) => `<a href="#${article.id}"><time datetime="${article.updated}">${article.updated}</time><span>${escape(article.title)}</span><span aria-hidden="true">↗</span></a>`).join('')}</div></section></div></div>`;
  }
  function searchResults(query, category) {
    const all = window.HELP_SEARCH.find(articles, query);
    const filtered = all.filter(match => !category || match.article.category === category);
    const direct = filtered.filter(match => match.direct);
    const suggestions = query && !direct.length && filtered.length;
    const matches = direct.length ? direct : filtered.slice(0,12);
    const available = name => new Set(all.filter(match => match.direct && (!name || match.article.category === name)).map(match => match.article.id + '/' + match.section.id)).size;
    main.innerHTML = `<section class="search-page"><p class="eyebrow">SEARCH / 全文搜索</p><h1 class="search-title">找到你需要的答案</h1>${searchForm('page-search', query)}<nav class="search-filters" aria-label="搜索分类">${['',...categories].map(name => `<a href="${queryLink(query,name)}"${category === name ? ' aria-current="true"' : ''}>${escape(name || '全部')}<span>${available(name)}</span></a>`).join('')}</nav><p class="search-description" role="status">${!query ? '输入功能名称、参数或完整提示文字。也支持常用别名与多个关键词。' : direct.length ? `找到 ${direct.length} 个匹配章节${category ? ' · '+escape(category) : ''}` : '没有完全匹配的章节。'}</p>` +
      (suggestions ? '<h2 class="suggestion-heading">相关建议</h2><p class="search-description">以下章节仅匹配部分关键词，可尝试缩短搜索词。</p>' : '') +
      (matches.length ? matches.map(({article,section,excerpt}) => `<a class="search-result" href="#${article.id}/${section.id}?${new URLSearchParams({q:query,...(category ? {category} : {})})}"><div class="result-category">${escape(article.category)} / ${escape(article.title)}</div><h2>${escape(section.title)} <span aria-hidden="true">↗</span></h2><p>${escape(excerpt)}</p></a>`).join('') : `<div class="empty-state"><strong>${query ? '换一种说法再试试' : '从一个关键词开始'}</strong><p>${category ? '可以选择“全部”扩大查找范围，或' : ''}尝试较短的功能名称，多个关键词之间可以用空格分隔。</p><div class="quick-links">${popular.map(word => `<a href="${queryLink(word)}">${word}</a>`).join('')}</div><a href="#overview">浏览全部功能 →</a></div>`) + '</section>';
    highlight(main, query);
  }
  let observer;
  let activeArticle = '';
  let restoreSearchFocus = false;
  function render() {
    if (observer) observer.disconnect();
    const focused = document.activeElement;
    const keepFocus = focused.id === 'page-search';
    const inputText = keepFocus ? focused.value : '';
    const cursor = keepFocus ? focused.selectionStart : null;
    const current = route();
    activeArticle = '';
    document.getElementById('reading-progress').hidden = true;
    const exportScope = document.getElementById('export-scope');
    const currentOption = exportScope.querySelector('[value="current"]');
    const hasArticle = articles.some(article => article.id === current.id);
    currentOption.disabled = !hasArticle;
    if (!hasArticle) exportScope.value = 'all';
    if (focused !== search) search.value = current.query;
    toc.innerHTML = ''; toc.hidden = true;
    navigation.querySelectorAll('a').forEach(link => {
      if (link.getAttribute('href') === '#' + current.id) {
        link.setAttribute('aria-current','page');
        const group = link.closest('details');
        if (group) group.open = true;
      }
      else link.removeAttribute('aria-current');
    });
    if (current.id === 'overview') {
      main.innerHTML = overview();
      document.getElementById('breadcrumb').textContent = '手册概览';
      document.title = '操作手册 · 涂布检测软件';
    } else if (current.id === 'search') {
      searchResults(current.query, current.category);
      document.getElementById('breadcrumb').textContent = '搜索结果';
      document.title = '搜索 · 操作手册';
      if (keepFocus || restoreSearchFocus) {
        const input = document.getElementById('page-search');
        if (keepFocus) input.value = inputText;
        input.focus({ preventScroll: true });
        if (cursor !== null) { try { input.setSelectionRange(cursor,cursor); } catch (_) {} }
      }
      restoreSearchFocus = false;
    } else {
      const article = articles.find(item => item.id === current.id);
      if (!article) {
        main.innerHTML = '<h1 class="search-title">未找到这篇说明</h1><p class="search-description">该链接可能已调整，请从左侧选择章节。</p><a class="quick-links" href="#overview">返回手册概览 →</a>';
        document.getElementById('breadcrumb').textContent = '页面未找到';
        document.title = '页面未找到 · 操作手册';
        window.scrollTo(0,0); return;
      }
      const index = articles.indexOf(article);
      main.innerHTML = `<header class="article-header"><p class="eyebrow">CHAPTER ${String(index+1).padStart(2,'0')} / 功能与操作</p><h1>${escape(article.title)}</h1><p class="description">${escape(article.summary)}</p><div class="article-meta"><span>更新时间：${escape(manualVersionLabel || article.updated + ' 00:00:00')}</span><span>${article.sections.length} 个主题</span></div></header><article class="article-body">${article.html}</article><nav class="article-pagination" aria-label="相邻章节">${index > 0 ? `<a href="#${articles[index-1].id}"><small>← 上一篇</small>${escape(articles[index-1].title)}</a>` : '<a href="#overview"><small>← 返回</small>手册概览</a>'}${index < articles.length-1 ? `<a href="#${articles[index+1].id}"><small>下一篇 →</small>${escape(articles[index+1].title)}</a>` : '<a href="#overview"><small>全部章节 →</small>手册概览</a>'}</nav>`;
      toc.hidden = false;
      toc.innerHTML = '<h2>本篇目录</h2>' + article.sections.map(section => `<a href="#${article.id}/${section.id}${current.query ? '?q='+encodeURIComponent(current.query) : ''}">${escape(section.title)}</a>`).join('');
      main.querySelectorAll('.article-body h2[id]').forEach(heading => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'copy-section'; button.textContent = '#';
        button.dataset.section = heading.id;
        button.setAttribute('aria-label', '复制章节链接：' + heading.textContent);
        button.title = '复制章节链接'; heading.append(button);
      });
      main.querySelectorAll('.article-body table').forEach(table => {
        const wrapper = document.createElement('div'); wrapper.className = 'table-scroll';
        wrapper.tabIndex = 0; wrapper.setAttribute('role','region'); wrapper.setAttribute('aria-label','参数表，可横向滚动');
        table.replaceWith(wrapper); wrapper.append(table);
      });
      highlight(main.querySelector('.article-body'), current.query);
      // Search matches inside notes must be visible when arriving from a result.
      main.querySelectorAll('details').forEach(note => { if (note.querySelector('mark')) note.open = true; });
      document.getElementById('breadcrumb').textContent = article.title;
      document.title = article.title + ' · 操作手册';
      activeArticle = article.id;
      document.getElementById('reading-progress').hidden = false;
      if (current.section) {
        const section = main.querySelector('#' + CSS.escape(current.section));
        if (section) section.scrollIntoView(); else window.scrollTo(0,0);
      } else {
        let saved;
        try { saved = JSON.parse(readSetting('reading') || 'null'); } catch (_) {}
        const heading = saved && saved.id === article.id && saved.section && validLink(saved.id,saved.section) && !current.query && main.querySelector('#' + CSS.escape(saved.section));
        if (heading && Number.isFinite(saved.offset)) window.scrollTo(0, Math.max(0, heading.getBoundingClientRect().top + window.scrollY + saved.offset));
        else window.scrollTo(0,0);
      }
      updateReading(false);
      observer = new IntersectionObserver(entries => {
        const visible = entries.find(entry => entry.isIntersecting);
        if (!visible) return;
        toc.querySelectorAll('a').forEach(link => {
          if (link.hash.split('?')[0].endsWith('/' + visible.target.id)) link.setAttribute('aria-current','location');
          else link.removeAttribute('aria-current');
        });
      }, { rootMargin: '-80px 0px -60% 0px' });
      main.querySelectorAll('h2[id]').forEach(heading => observer.observe(heading));
      return;
    }
    window.scrollTo(0,0);
  }
  let searchTimer, composing = false;
  function performSearch(input) {
    clearTimeout(searchTimer);
    const query = input.value.trim().slice(0,120);
    const target = queryLink(query, route().id === 'search' ? route().category : '');
    if (input.id === 'home-search') restoreSearchFocus = true;
    if (drawerOpen) { setDrawer(false); restoreSearchFocus = true; }
    if (route().id === 'search') { history.replaceState(null,'',target); render(); }
    else location.hash = target;
  }
  const isSearch = target => target.matches('.search-form input');
  document.addEventListener('compositionstart', event => { if (isSearch(event.target)) { composing = true; clearTimeout(searchTimer); } });
  document.addEventListener('compositionend', event => { if (isSearch(event.target)) { composing = false; if (event.target.id !== 'home-search') performSearch(event.target); } });
  document.addEventListener('input', event => {
    if (!isSearch(event.target) || composing || event.isComposing || event.target.id === 'home-search') return;
    clearTimeout(searchTimer); searchTimer = setTimeout(() => performSearch(event.target),180);
  });
  document.addEventListener('submit', event => {
    if (!event.target.matches('.search-form')) return;
    event.preventDefault(); if (!composing) performSearch(event.target.querySelector('input'));
  });

  const sidebar = document.getElementById('sidebar');
  const mobile = matchMedia('(max-width: 900px)');
  let drawerOpen = false, drawerReturn;
  function setDrawer(open, focusTarget) {
    drawerOpen = open && mobile.matches;
    if (drawerOpen) drawerReturn = document.activeElement;
    document.body.classList.toggle('drawer-open', drawerOpen);
    document.getElementById('nav-toggle').setAttribute('aria-expanded', String(drawerOpen));
    document.getElementById('nav-backdrop').hidden = !drawerOpen;
    document.querySelector('.workspace').inert = drawerOpen;
    if (drawerOpen) {
      sidebar.setAttribute('role','dialog'); sidebar.setAttribute('aria-modal','true');
      requestAnimationFrame(() => { if (drawerOpen) (focusTarget || document.getElementById('nav-close')).focus(); });
    } else {
      sidebar.removeAttribute('role'); sidebar.removeAttribute('aria-modal');
      if (drawerReturn && drawerReturn.isConnected) drawerReturn.focus({preventScroll:true});
      drawerReturn = null;
    }
  }
  document.getElementById('nav-toggle').addEventListener('click', () => setDrawer(!drawerOpen));
  document.getElementById('nav-close').addEventListener('click', () => setDrawer(false));
  document.getElementById('nav-backdrop').addEventListener('click', () => setDrawer(false));
  mobile.addEventListener('change', () => { if (!mobile.matches) setDrawer(false); });

  let readingFrame, saveTimer;
  function updateReading(persist) {
    if (!activeArticle) return;
    const body = main.querySelector('.article-body');
    const start = body.getBoundingClientRect().top + window.scrollY - 100;
    const length = Math.max(1, body.offsetHeight - window.innerHeight + 180);
    const progress = Math.max(0,Math.min(100,Math.round((window.scrollY-start)/length*100)));
    const bar = document.getElementById('reading-progress');
    bar.setAttribute('aria-valuenow', String(progress)); bar.firstElementChild.style.width = progress + '%';
    if (!persist) return;
    const headings = [...body.querySelectorAll('h2[id]')];
    const heading = headings.filter(item => item.getBoundingClientRect().top <= 125).pop() || headings[0];
    if (heading) saveSetting('reading', JSON.stringify({ id:activeArticle, section:heading.id, offset:-(heading.getBoundingClientRect().top) }));
  }
  window.addEventListener('scroll', () => {
    if (!readingFrame) readingFrame = requestAnimationFrame(() => { updateReading(false); readingFrame = null; });
    clearTimeout(saveTimer); saveTimer = setTimeout(() => updateReading(true),250);
  }, {passive:true});
  window.addEventListener('pagehide', () => updateReading(true));
  document.addEventListener('keydown', event => {
    if (drawerOpen && event.key === 'Tab') {
      const controls = [...sidebar.querySelectorAll('a,button,input,summary')].filter(item => item.getClientRects().length);
      const first = controls[0], last = controls[controls.length-1];
      if (!sidebar.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    if (event.key === 'Escape' && drawerOpen) { event.preventDefault(); setDrawer(false); return; }
    const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if (event.key === '/' && !editing && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const input = main.querySelector('.search-form input');
      if (input) input.focus(); else if (mobile.matches) setDrawer(true, search); else search.focus();
    }
    if (event.key === 'Escape' && isSearch(document.activeElement)) {
      const input = document.activeElement; input.value=''; performSearch(input);
    }
  });
  // Cancel queued input before following a result or navigation link.
  document.addEventListener('click', async event => {
    const copy = event.target.closest('.copy-section');
    if (copy) {
      const link = location.href.split('#')[0] + '#' + route().id + '/' + copy.dataset.section;
      try { await navigator.clipboard.writeText(link); document.getElementById('reader-status').textContent = '章节链接已复制'; copy.textContent = '✓'; setTimeout(() => { if (copy.isConnected) copy.textContent='#'; },1500); }
      catch (_) { window.prompt('复制章节链接',link); }
      return;
    }
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    if (link.classList.contains('skip-link')) { event.preventDefault(); main.focus(); return; }
    clearTimeout(searchTimer);
    clearTimeout(saveTimer); updateReading(true);
    if (drawerOpen) setDrawer(false);
    if (link.getAttribute('href') === location.hash) { event.preventDefault(); render(); }
  });
  window.addEventListener('hashchange', () => { clearTimeout(searchTimer); clearTimeout(saveTimer); if (drawerOpen) setDrawer(false); render(); });
  render();
})();
