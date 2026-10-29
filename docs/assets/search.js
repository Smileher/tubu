(() => {
  'use strict';
  // Keep aliases explicit: related names help retrieval without changing manual terminology.
  const aliases = [
    ['换卷', '膜卷', '卷号'], ['取图', '抓图', '采集', '获取图像'],
    ['存图', '保存图像', '图像保存'], ['报警', '告警'],
    ['cpk', '过程能力'], ['料号', '配方'], ['标零', '零点'],
    ['瑕疵', '缺陷'], ['错位', '对齐偏差'], ['日志', '错误记录'],
    ['间隔涂布', '间涂'], ['直接拼图', '拼图检测', '拼图检测模式'],
    ['过滤间隙', '间隙过滤', '屏蔽间隙', '屏蔽间隙模式']
  ];
  const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const stop = new Set(['的','了','在','和','与','及','后','前','如何','怎么','为什么','怎样','进行','是否','一个','没有','不能','不']);
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh-CN', { granularity: 'word' }) : null;
  function tokens(query) {
    const normalized = normalize(query);
    const words = normalized.split(/[\s,，。；;：:？！?!、]+/).filter(Boolean);
    if (words.length > 1) return [...new Set(words)];
    if (aliases.some(group => group.includes(normalized))) return [normalized];
    if (!segmenter) return words;
    const parts = [...segmenter.segment(normalized)].filter(part => part.isWordLike).map(part => part.segment).filter(word => !stop.has(word));
    return [...new Set(parts.length ? parts : words)];
  }
  function groups(query) {
    return tokens(query).map(word => [...new Set([word, ...(aliases.find(group => group.includes(word)) || [])])]);
  }
  function terms(query) { return [...new Set([normalize(query), ...groups(query).flat()])].filter(Boolean).sort((a,b) => b.length-a.length); }
  function find(articles, query) {
    const phrase = normalize(query), wordGroups = groups(query);
    if (!phrase) return [];
    const matches = [];
    articles.forEach(article => article.sections.forEach(section => {
      const fields = [article.title, section.title, (article.keywords || '') + ' ' + (section.keywords || ''), section.text].map(normalize);
      let count = 0, score = 0;
      const hits = [];
      wordGroups.forEach(group => {
        let best = 0;
        group.forEach((word, index) => {
          let weight = 0;
          fields.forEach((field, position) => {
            if (field.includes(word)) { weight += [80,60,30,10][position]; hits.push(word); }
          });
          best = Math.max(best, weight * (index ? .7 : 1));
        });
        if (best) { count++; score += best; }
      });
      const literal = fields[0].includes(phrase) || fields[1].includes(phrase) || fields[3].includes(phrase);
      if (!literal && !count) return;
      const direct = literal || count === wordGroups.length;
      const hit = hits.find(word => normalize(section.text).includes(word)) || phrase;
      const position = Math.max(0, normalize(section.text).indexOf(hit) - 32);
      const excerpt = (position ? '…' : '') + section.text.slice(position, position + 155) + (section.text.length > position + 155 ? '…' : '');
      matches.push({ article, section, score: score + (literal ? 150 : 0), direct, excerpt });
    }));
    // Partial matches are suggestions only when no full result exists in the chosen category.
    return matches.sort((a,b) => Number(b.direct)-Number(a.direct) || b.score-a.score);
  }
  window.HELP_SEARCH = { find, terms };
})();
