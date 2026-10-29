(() => {
  'use strict';
  const articles = window.HELP_ARTICLES || [];
  const toggle = document.getElementById('export-toggle');
  const menu = document.getElementById('export-menu');
  const scope = document.getElementById('export-scope');
  const status = document.getElementById('export-status');
  const xml = text => String(text).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]));
  function closeMenu() { menu.hidden = true; toggle.setAttribute('aria-expanded','false'); }
  toggle.addEventListener('click', () => { menu.hidden = !menu.hidden; if (!menu.hidden) scope.value = 'all'; toggle.setAttribute('aria-expanded',String(!menu.hidden)); status.textContent = ''; });
  document.addEventListener('click', event => { if (!event.target.closest('.export-control')) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { closeMenu(); toggle.focus(); } });
  function selectedArticles() {
    if (scope.value === 'all') return articles;
    const id = location.hash.slice(1).split(/[/?]/)[0];
    return articles.filter(article => article.id === id);
  }
  function selection() {
    const selected = selectedArticles();
    if (!selected.length) throw Error('请先打开需要导出的文章。');
    return selected;
  }
  function exportName(selected) {
    const now = new Date();
    const timestamp = [now.getFullYear(),now.getMonth()+1,now.getDate(),now.getHours(),now.getMinutes(),now.getSeconds()].map(value => String(value).padStart(2,'0')).join('');
    const name = scope.value === 'all' ? '涂布检测软件操作手册' : selected[0].title;
    return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-') + '-v' + timestamp;
  }

  // DOCX is a ZIP of XML parts. Store entries without compression to keep this offline export dependency-free.
  const encoder = new TextEncoder();
  const crcTable = Uint32Array.from({length:256}, (_, value) => {
    for (let bit=0; bit<8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  function zip(parts) {
    const local = [], central = []; let offset = 0, centralSize = 0;
    Object.entries(parts).forEach(([name,text]) => {
      const filename = encoder.encode(name), data = encoder.encode(text);
      let crc = 0xffffffff;
      data.forEach(byte => { crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); });
      crc = (crc ^ 0xffffffff) >>> 0;
      const header = new Uint8Array(30 + filename.length), view = new DataView(header.buffer);
      view.setUint32(0,0x04034b50,true); view.setUint16(4,20,true); view.setUint16(10,0,true); view.setUint16(12,33,true);
      view.setUint32(14,crc,true); view.setUint32(18,data.length,true); view.setUint32(22,data.length,true); view.setUint16(26,filename.length,true); header.set(filename,30);
      const entry = new Uint8Array(46 + filename.length), cv = new DataView(entry.buffer);
      cv.setUint32(0,0x02014b50,true); cv.setUint16(4,20,true); cv.setUint16(6,20,true); cv.setUint16(14,33,true);
      cv.setUint32(16,crc,true); cv.setUint32(20,data.length,true); cv.setUint32(24,data.length,true); cv.setUint16(28,filename.length,true); cv.setUint32(42,offset,true); entry.set(filename,46);
      local.push(header,data); central.push(entry); offset += header.length + data.length; centralSize += entry.length;
    });
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0,0x06054b50,true); ev.setUint16(8,central.length,true); ev.setUint16(10,central.length,true); ev.setUint32(12,centralSize,true); ev.setUint32(16,offset,true);
    return new Blob([...local,...central,end],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
  }
  function wordDocument(selected) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    let listId=0; const lists=[], contents=[];
    const run = (text,bold=false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
    const field = instruction => `<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> ${xml(instruction)} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    const paragraph = (content,style='',extra='') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${content}</w:p>`;
    function heading(text,level,extra='') {
      const id=contents.length+1, anchor='HelpHeading'+id;
      contents.push({text,level,anchor});
      return paragraph(`<w:bookmarkStart w:id="${id}" w:name="${anchor}"/>${run(text)}<w:bookmarkEnd w:id="${id}"/>`,'Heading'+level,extra);
    }
    const inline = node => [...node.childNodes].map(child => child.nodeType === 3 ? run(child.textContent) : child.nodeName === 'BR' ? '<w:r><w:br/></w:r>' : /^(STRONG|B|TH)$/.test(child.nodeName) ? run(child.textContent,true) : inline(child)).join('');
    function blocks(parent) {
      return [...parent.children].map(node => {
        const tag=node.tagName;
        if (tag === 'H2') return heading(node.textContent,3);
        if (/^H[1-6]$/.test(tag)) return paragraph(inline(node),'Heading4');
        if (tag === 'P' || tag === 'SUMMARY') return paragraph(inline(node),tag === 'SUMMARY' ? 'SummaryTitle' : '');
        if (tag === 'UL' || tag === 'OL') {
          const id=++listId; lists.push(`<w:num w:numId="${id}"><w:abstractNumId w:val="${tag === 'OL' ? 1 : 0}"/></w:num>`);
          return [...node.children].map(item => paragraph(inline(item),'',`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`)).join('');
        }
        if (tag === 'TABLE') {
          const rows=[...node.rows], columns=rows[0]?.cells.length || 1;
          const widths=Array.from({length:columns},(_,index)=>columns === 2 ? (index ? 6938 : 2700) : Math.floor(9638/columns));
          return `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(side=>`<w:${side} w:val="single" w:sz="4" w:color="D9D9D9"/>`).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(width=>`<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows.map(row=>`<w:tr>${row.querySelector('th') ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${[...row.cells].map((cell,index)=>`<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/><w:vAlign w:val="center"/>${cell.tagName === 'TH' ? '<w:shd w:fill="EEF1F4"/>' : ''}</w:tcPr>${paragraph(cell.tagName === 'TH' ? run(cell.textContent,true) : inline(cell),'TableText')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
        }
        return blocks(node);
      }).join('');
    }
    // 与网页导航使用相同的分类及文章顺序；目录与正文共用标题记录，避免链接和层级不一致。
    let chapters='';
    [...new Set(selected.map(article=>article.category))].forEach((category,categoryIndex)=>{
      chapters+=heading(category,1,categoryIndex ? '<w:pageBreakBefore/>' : '');
      selected.filter(article=>article.category === category).forEach((article,index)=>{
        const content=document.createElement('div'); content.innerHTML=article.html;
        chapters+=heading(article.title,2,index ? '<w:pageBreakBefore/>' : '') + paragraph(run('更新时间：'+article.updated),'Subtitle') + paragraph(run(article.summary)) + blocks(content);
      });
    });
    let body = paragraph(run('涂布检测软件操作手册'),'CoverTitle');
    body += paragraph(run('VISIONMEASURE'),'CoverSubtitle');
    body += paragraph(run(selected.length === articles.length ? '完整操作手册' : '当前文章导出'),'CoverMeta');
    body += paragraph(run('导出日期：' + new Date().toLocaleDateString('zh-CN')),'CoverMeta');
    body += pageBreak;
    body += paragraph(run('目录'),'TocHeading');
    body += paragraph(run('目录按网页分类排列，可通过链接跳转。需要目录页码时，在 Word 中右键目录并选择“更新域”，再选择“更新整个目录”。'),'Subtitle');
    // Word 受保护视图不会刷新目录域，因此必须预填完整结果，不能用“1”占位。
    // 浏览器无法计算 Word 的真实分页，缓存仅包含标题和书签链接；用户更新目录后由 Word 补齐页码。
    const tocStart='<w:r><w:fldChar w:fldCharType="begin" w:dirty="false"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o &quot;1-3&quot; \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
    body += contents.map(({text,level,anchor},index)=>paragraph(
      (index ? '' : tocStart) + `<w:hyperlink w:anchor="${anchor}" w:history="1"><w:r><w:rPr><w:color w:val="245A81"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:hyperlink>` + (index === contents.length-1 ? '<w:r><w:fldChar w:fldCharType="end"/></w:r>' : ''),'TOC'+level)).join('');
    body += pageBreak;
    body += chapters;
    const styles=`<w:styles xmlns:w="${ns}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:color w:val="000000"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${[['CoverTitle',52,0],['CoverSubtitle',28,0],['CoverMeta',22,0],['TocHeading',34,0],['Heading1',34,0],['Heading2',28,1],['Heading3',24,2],['Heading4',22,3],['SummaryTitle',22,0]].map(([id,size,level])=>`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id.startsWith('Heading') ? 'heading '+id.slice(7) : id}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="${level ? 240 : 0}" w:after="180"/>${id.startsWith('Heading') ? `<w:outlineLvl w:val="${level}"/>` : ''}${id.startsWith('Cover') ? '<w:jc w:val="center"/>' : ''}</w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="${size}"/></w:rPr></w:style>`).join('')}${[1,2,3].map(level=>`<w:style w:type="paragraph" w:styleId="TOC${level}"><w:name w:val="toc ${level}"/><w:basedOn w:val="Normal"/><w:pPr>${level === 1 ? '<w:keepNext/>' : ''}<w:spacing w:before="${level === 1 ? 180 : 0}" w:after="40" w:line="260" w:lineRule="auto"/><w:ind w:left="${(level-1)*360}"/></w:pPr><w:rPr>${level === 1 ? '<w:b/>' : ''}<w:sz w:val="${level === 1 ? 24 : 22}"/></w:rPr></w:style>`).join('')}<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="666666"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="TableText"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60" w:line="280"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style></w:styles>`;
    const numbering=`<w:numbering xmlns:w="${ns}">${[0,1].map(id=>`<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${id ? 'decimal' : 'bullet'}"/><w:lvlText w:val="${id ? '%1.' : '•'}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="420"/></w:tabs><w:ind w:left="420" w:hanging="300"/></w:pPr></w:lvl></w:abstractNum>`).join('')}${lists.join('')}</w:numbering>`;
    const footer=`<w:ftr xmlns:w="${ns}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run('第 ')}${field('PAGE')}${run(' 页 / 共 ')}${field('NUMPAGES')}${run(' 页')}</w:p></w:ftr>`;
    // 保留可手动更新的目录，但不在打开文档时强制更新域或要求启用编辑。
    const settings=`<w:settings xmlns:w="${ns}"><w:updateFields w:val="false"/></w:settings>`;
    const types='http://schemas.openxmlformats.org/package/2006/content-types';
    const rels='http://schemas.openxmlformats.org/package/2006/relationships';
    const office='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    return zip({
      '[Content_Types].xml':`<Types xmlns="${types}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/> ${[['document','document.main'],['styles','styles'],['numbering','numbering'],['footer1','footer'],['settings','settings']].map(([file,type])=>`<Override PartName="/word/${file}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`).join('')}</Types>`,
      '_rels/.rels':`<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${office}officeDocument" Target="word/document.xml"/></Relationships>`,
      'word/document.xml':`<w:document xmlns:w="${ns}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720"/><w:footerReference w:type="default" r:id="rId3" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></w:sectPr></w:body></w:document>`,
      'word/styles.xml':styles,
      'word/numbering.xml':numbering,
      'word/footer1.xml':footer,
      'word/settings.xml':settings,
      'word/_rels/document.xml.rels':`<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${office}styles" Target="styles.xml"/><Relationship Id="rId2" Type="${office}numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="${office}footer" Target="footer1.xml"/><Relationship Id="rId4" Type="${office}settings" Target="settings.xml"/></Relationships>`
    });
  }
  document.getElementById('export-word').addEventListener('click', () => {
    try {
      const selected=selection(), url=URL.createObjectURL(wordDocument(selected));
      const link=document.createElement('a'); link.href=url; link.download=exportName(selected)+'.docx';
      document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
      status.textContent='已生成 Word 文件，已包含分类目录和章节链接；目录页码可在 Word 中更新域生成。';
    } catch (error) { status.textContent='导出失败：'+error.message; }
  });
})();
