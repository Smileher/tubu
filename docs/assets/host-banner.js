(() => {
  'use strict';

  // 千问托管会在 DOMContentLoaded 时注入顶部品牌栏，并下移页面及固定控件。
  // 只触发已确认的关闭按钮，让宿主自身恢复留白和控件位置；不要直接删除广告 DOM。
  // 不按坐标点击、不匹配通用关闭按钮，也不处理右下角入口。更换托管或本地阅读时，
  // 找不到此特定按钮便结束，避免误触手册的导出、主题和目录等控件。
  function closeHostBanner(attemptsLeft) {
    const button = document.querySelector('#mulepage-bar button#mulepage-bar-close');
    if (button) {
      button.click();
      return;
    }
    if (attemptsLeft > 1) setTimeout(() => closeHostBanner(attemptsLeft - 1), 500);
  }

  // 加载完成 1 秒后首次检查，最多检查 5 次（到第 3 秒）；点击一次即停止，
  // 不常驻轮询、不监听后续路由切换，宿主标识变化时允许品牌栏正常保留。
  function scheduleClose() { setTimeout(() => closeHostBanner(5), 1000); }
  if (document.readyState === 'complete') scheduleClose();
  else window.addEventListener('load', scheduleClose, { once: true });
})();
