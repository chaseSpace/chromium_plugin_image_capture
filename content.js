(() => {
  if (window.__leafImageCaptureInstalled) {
    return;
  }

  window.__leafImageCaptureInstalled = true;

  // content script 运行在网页上下文中，负责读取页面 DOM。
  // 这里除了图片地址，也顺手返回用户当前选中文本，便于后续扩展“选中文本关联捕获”。
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "COLLECT_IMAGE_URLS") {
      return false;
    }

    try {
      const images = collectImageUrls();
      sendResponse({
        ok: true,
        title: document.title,
        pageUrl: location.href,
        selectedText: window.getSelection().toString().trim(),
        images
      });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }

    return false;
  });

  function collectImageUrls() {
    const urls = new Set();

    // <img src> / <img currentSrc> 是页面图片最主要来源。
    document.querySelectorAll("img").forEach((img) => {
      addUrl(urls, img.currentSrc);
      addUrl(urls, img.src);
      addSrcSet(urls, img.srcset);
    });

    // <source srcset> 常见于 <picture> 响应式图片。
    document.querySelectorAll("source[srcset]").forEach((source) => {
      addSrcSet(urls, source.getAttribute("srcset"));
    });

    // <a href="*.jpg"> 这类链接也经常是图片资源。
    document.querySelectorAll("a[href]").forEach((anchor) => {
      const href = anchor.getAttribute("href");
      if (isLikelyImageUrl(href)) {
        addUrl(urls, href);
      }
    });

    // CSS background-image 中的 url(...)。
    document.querySelectorAll("*").forEach((node) => {
      const backgroundImage = getComputedStyle(node).backgroundImage;
      extractCssUrls(backgroundImage).forEach((url) => addUrl(urls, url));
    });

    return Array.from(urls);
  }

  function addUrl(urls, rawUrl) {
    if (!rawUrl) {
      return;
    }

    try {
      const absoluteUrl = new URL(rawUrl, location.href).href;
      if (absoluteUrl.startsWith("https://") && !isSvgUrl(absoluteUrl)) {
        urls.add(absoluteUrl);
      }
    } catch {
      // 忽略非法 URL，避免单个异常中断整页捕获。
    }
  }

  function addSrcSet(urls, srcset = "") {
    srcset
      .split(",")
      .map((item) => item.trim().split(/\s+/)[0])
      .filter(Boolean)
      .forEach((url) => addUrl(urls, url));
  }

  function extractCssUrls(backgroundImage = "") {
    const urls = [];
    const pattern = /url\((["']?)(.*?)\1\)/g;
    let match = pattern.exec(backgroundImage);

    while (match) {
      if (match[2]) {
        urls.push(match[2]);
      }
      match = pattern.exec(backgroundImage);
    }

    return urls;
  }

  function isLikelyImageUrl(url = "") {
    return /\.(png|jpe?g|gif|webp|bmp|avif)(\?.*)?$/i.test(url);
  }

  function isSvgUrl(url = "") {
    try {
      return new URL(url, location.href).pathname.toLowerCase().endsWith(".svg");
    } catch {
      return /\.svg(\?.*)?$/i.test(url);
    }
  }
})();
