(() => {
  'use strict';
  const loads = new Map();
  function forget(asset) {
    if (!asset) return;
    delete window.HELP_IMAGE_DATA?.[asset.hash];
    loads.delete(asset.hash);
  }
  function load(source, asset) {
    if (!/^assets\/screenshots\/(?:[a-z][a-z0-9-]*\/)*[a-z][a-z0-9-]*\.js$/.test(source) ||
        !asset || !/^[a-f0-9]{64}$/.test(asset.hash) || asset.mime !== 'image/webp' || !(asset.width > 0 && asset.height > 0)) {
      return Promise.reject(Error('截图索引无效，请完整复制手册。'));
    }
    const url = () => 'data:image/webp;base64,' + window.HELP_IMAGE_DATA[asset.hash];
    if (window.HELP_IMAGE_DATA?.[asset.hash]) return Promise.resolve(url());
    if (!loads.has(asset.hash)) {
      const pending = new Promise((resolve,reject) => {
        const script = document.createElement('script');
        let settled = false;
        const finish = error => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout); script.onload = script.onerror = null; script.remove();
          if (error) reject(error); else resolve(url());
        };
        const timeout = setTimeout(() => finish(Error('加载截图超时，请重试。')),15000);
        script.src = source;
        script.onload = () => finish(window.HELP_IMAGE_DATA?.[asset.hash] ? null : Error('截图数据无效，请重新部署手册。'));
        script.onerror = () => finish(Error('缺少截图数据，请完整复制 Help 文件夹后重试。'));
        document.head.append(script);
      });
      loads.set(asset.hash,pending);
      pending.catch(() => loads.delete(asset.hash));
    }
    return loads.get(asset.hash);
  }
  async function png(source, asset) {
    const url = await load(source,asset);
    // data URL 保持画布可读；不读取 file:// 图片，避免本地文件跨域限制。
    return new Promise((resolve,reject) => {
      const image = new Image();
      let settled = false;
      const finish = (error,bytes) => {
        if (settled) return;
        settled = true; clearTimeout(timeout); image.onload = image.onerror = null;
        if (error) { forget(asset); reject(error); } else resolve(bytes);
      };
      const timeout = setTimeout(() => finish(Error('截图转换超时，请重试。')),15000);
      image.onerror = () => finish(Error('无法解码截图，请使用支持 WebP 的浏览器。'));
      image.onload = () => {
        let canvas;
        try {
          if (image.naturalWidth !== asset.width || image.naturalHeight !== asset.height) throw Error('截图尺寸与索引不符，请重新部署手册。');
          canvas = document.createElement('canvas'); canvas.width = asset.width; canvas.height = asset.height;
          canvas.getContext('2d').drawImage(image,0,0);
          const encoded = canvas.toDataURL('image/png');
          if (!encoded.startsWith('data:image/png;base64,')) throw Error('浏览器无法转换截图。');
          finish(null,Uint8Array.from(atob(encoded.split(',')[1]),char => char.charCodeAt(0)));
        } catch (error) { finish(error); }
        finally { if (canvas) { canvas.width = 0; canvas.height = 0; } }
      };
      image.src = url;
    });
  }
  window.HELP_IMAGES = {load,png,forget};
})();
