(() => {
  'use strict';
  const dialog = document.getElementById('download-dialog');
  const open = document.getElementById('download-open');
  const title = document.getElementById('download-unlock');
  const description = document.getElementById('download-description');
  const form = document.getElementById('download-form');
  const password = document.getElementById('download-password');
  const verify = document.getElementById('download-verify');
  const status = document.getElementById('download-status');
  const files = document.getElementById('download-files');
  const more = document.getElementById('download-more');
  const repository = atob('dmNoZW5oZXYvdHVidQ==');
  let clicks = 0, lastClick = 0, page = 1, authorizedHour = '', controller;

  // 固定北京时间，避免访问者所在时区改变日期和小时；131 为约定的生日数字。
  function currentAccess() {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const date = now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
    const hour = now.getUTCHours();
    return { hour: date + '-' + hour, code: String((date + hour) * 131 % 1000000).padStart(6, '0') };
  }
  function reset() {
    if (controller) controller.abort();
    controller = null;
    clicks = 0; lastClick = 0; page = 1; authorizedHour = '';
    title.textContent = '访问受限';
    description.textContent = '请联系技术支持获取下载权限。';
    form.hidden = true; form.reset(); verify.disabled = false;
    password.removeAttribute('aria-invalid');
    status.textContent = ''; files.replaceChildren(); files.hidden = true; more.hidden = true; more.disabled = false;
  }
  function checkHour() {
    if (authorizedHour === currentAccess().hour) return true;
    authorizedHour = ''; page = 1; files.replaceChildren(); files.hidden = true; more.hidden = true;
    title.textContent = '访问验证';
    description.textContent = '请联系技术支持获取当前有效的访问密码。';
    form.hidden = false; password.value = '';
    status.textContent = '访问密码已过期，请重新验证。'; password.focus();
    return false;
  }
  async function loadReleases() {
    if (!checkHour() || controller) return;
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 15000);
    more.disabled = true; verify.disabled = true;
    status.textContent = '正在获取下载列表…';
    try {
      const response = await fetch('https://api.github.com/repos/' + repository + '/releases?per_page=10&page=' + page,
        { signal: request.signal, cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
      if (!response.ok) throw new Error(response.status === 403 || response.status === 429
        ? '下载列表请求过于频繁，请稍后重试。' : '下载列表获取失败，请稍后重试。');
      const releases = await response.json();
      if (controller !== request || !dialog.open || !checkHour()) return;
      if (!Array.isArray(releases)) throw new Error('下载列表格式异常，请稍后重试。');
      let count = 0;
      for (const release of releases) {
        if (release.draft || !Array.isArray(release.assets)) continue;
        const section = document.createElement('section');
        const heading = document.createElement('h3');
        heading.textContent = release.name || release.tag_name || '发布版本'; section.append(heading);
        for (const asset of release.assets) {
          if (asset.state !== 'uploaded' || !asset.name || !asset.browser_download_url) continue;
          let url;
          try { url = new URL(asset.browser_download_url); } catch (_) { continue; }
          if (url.protocol !== 'https:' || url.host !== 'github.com' || !url.pathname.startsWith('/' + repository + '/releases/download/')) continue;
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'download-file';
          const name = document.createElement('span'); name.textContent = asset.name;
          const size = document.createElement('small'); size.textContent = (Number(asset.size) / 1048576).toFixed(1) + ' MB ↓';
          button.append(name, size);
          button.addEventListener('click', () => {
            if (!checkHour()) return;
            window.location.assign(url.href);
            status.textContent = '已发起下载；若未开始，请检查浏览器下载记录或重试。';
          });
          section.append(button); count++;
        }
        if (section.childElementCount > 1) files.append(section);
      }
      files.hidden = false; form.hidden = true;
      title.textContent = '软件下载'; description.textContent = '请选择需要的版本和安装文件。';
      more.hidden = releases.length < 10; more.textContent = '更早版本';
      status.textContent = count ? '' : (page === 1 ? '当前没有可下载文件。' : '本页没有可下载文件。');
      page++;
    } catch (error) {
      if (controller !== request || !dialog.open) return;
      status.textContent = request.signal.aborted ? '获取下载列表超时，请检查网络后重试。'
        : (error instanceof TypeError ? '无法连接下载服务，请检查网络后重试。' : error.message);
      more.hidden = false; more.textContent = '重试';
    } finally {
      clearTimeout(timeout);
      if (controller === request) { controller = null; more.disabled = false; verify.disabled = false; }
    }
  }
  open.addEventListener('click', () => { reset(); dialog.showModal(); dialog.scrollTop = 0; });
  title.addEventListener('click', () => {
    if (!form.hidden || authorizedHour) return;
    const now = Date.now(); clicks = now - lastClick <= 1000 ? clicks + 1 : 1; lastClick = now;
    if (clicks < 5) return;
    form.hidden = false; password.focus();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (controller || form.hidden) return;
    const access = currentAccess();
    if (!/^\d{6}$/.test(password.value.trim()) || password.value.trim() !== access.code) {
      password.setAttribute('aria-invalid', 'true'); status.textContent = '访问密码不正确或已过期。';
      password.focus(); password.select(); return;
    }
    password.removeAttribute('aria-invalid'); password.value = '';
    authorizedHour = access.hour; loadReleases();
  });
  more.addEventListener('click', loadReleases);
  document.getElementById('download-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // 忽略快速重开前排队的旧关闭事件。
    reset(); open.focus({ preventScroll: true });
  });
  // 模态窗口内的按键不触发正文搜索快捷键。
  dialog.addEventListener('keydown', event => event.stopPropagation());
})();
