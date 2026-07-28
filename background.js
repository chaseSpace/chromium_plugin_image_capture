const HISTORY_KEY = "imageCaptureHistory";
const MAX_HISTORY_ITEMS = 100;
const DOWNLOAD_FOLDER_PREFIX = "精灵捕手";

// 统一处理 popup 与 content script 之间的消息。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "CAPTURE_CURRENT_TAB") {
    captureCurrentTab()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "GET_CAPTURE_HISTORY") {
    getHistory()
      .then((history) => sendResponse({ ok: true, history }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "CLEAR_CAPTURE_HISTORY") {
    chrome.storage.local.remove(HISTORY_KEY, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "DELETE_CAPTURE_RECORD") {
    deleteHistoryRecord(message.recordId)
      .then((history) => sendResponse({ ok: true, history }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "UPDATE_CAPTURE_RECORD") {
    updateHistoryRecord(message.record)
      .then((history) => sendResponse({ ok: true, history }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "DOWNLOAD_IMAGES") {
    downloadImages(message.record)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function captureCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error("未找到当前活动标签页。");
  }

  if (!isCaptureSupportedUrl(tab.url)) {
    throw new Error("当前页面不支持内容脚本，例如浏览器内置页面或扩展商店页面。");
  }

  // 主动注入一次，确保用户点击 popup 时页面里一定有 content.js。
  // 如果 manifest 已经注入过，重复注入也不会影响捕获结果。
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"]
  });

  const pageResult = await sendMessageToTab(tab.id, {
    type: "COLLECT_IMAGE_URLS"
  });

  if (!pageResult || !pageResult.ok) {
    throw new Error(pageResult?.error || "页面图片捕获失败。");
  }

  const images = filterDownloadableImageUrls(pageResult.images);
  const record = {
    id: crypto.randomUUID(),
    title: pageResult.title || tab.title || "未命名页面",
    pageUrl: pageResult.pageUrl || tab.url || "",
    capturedAt: new Date().toISOString(),
    count: images.length,
    images,
    selectedText: pageResult.selectedText || ""
  };

  await prependHistory(record);
  return { ok: true, record };
}

function isCaptureSupportedUrl(url = "") {
  return /^(https?:|file:)/.test(url);
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function getHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [HISTORY_KEY]: [] }, (result) => {
      resolve(result[HISTORY_KEY]);
    });
  });
}

async function prependHistory(record) {
  const history = await getHistory();
  const nextHistory = [record, ...history].slice(0, MAX_HISTORY_ITEMS);

  return new Promise((resolve) => {
    chrome.storage.local.set({ [HISTORY_KEY]: nextHistory }, resolve);
  });
}

async function updateHistoryRecord(record) {
  if (!record || !record.id) {
    throw new Error("缺少要更新的历史记录。");
  }

  const history = await getHistory();
  const nextHistory = history.map((item) => {
    if (item.id !== record.id) {
      return item;
    }

    const images = filterDownloadableImageUrls(record.images);
    return {
      ...item,
      images,
      count: images.length
    };
  });

  return new Promise((resolve) => {
    chrome.storage.local.set({ [HISTORY_KEY]: nextHistory }, () => resolve(nextHistory));
  });
}

async function deleteHistoryRecord(recordId) {
  if (!recordId) {
    throw new Error("缺少要删除的历史记录 ID。");
  }

  const history = await getHistory();
  const nextHistory = history.filter((item) => item.id !== recordId);

  return new Promise((resolve) => {
    chrome.storage.local.set({ [HISTORY_KEY]: nextHistory }, () => resolve(nextHistory));
  });
}

async function downloadImages(record) {
  if (!record || !Array.isArray(record.images) || record.images.length === 0) {
    throw new Error("当前没有可下载的图片地址。");
  }

  const folderName = buildDownloadFolderName(record.title);
  const images = filterDownloadableImages(record.images);
  const results = await Promise.allSettled(
    images.map((image, index) => downloadImage(image, folderName, index))
  );
  const downloadIds = results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  if (downloadIds.length > 0) {
    chrome.downloads.showDefaultFolder();
  }

  return {
    total: images.length,
    started: downloadIds.length,
    failed: results.filter((result) => result.status === "rejected").length,
    downloadIds
  };
}

function downloadImage(image, folderName, index) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: image.url,
        filename: `${folderName}/${buildDownloadFileName(image, index)}`,
        conflictAction: "uniquify",
        saveAs: false
      },
      (downloadId) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(downloadId);
      }
    );
  });
}

function buildDownloadFileName(image, index) {
  let name = "";
  try {
    const pathname = new URL(image.url).pathname;
    name = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    name = "";
  }

  const safeName = buildShortFileName(name, index, image);
  return `${String(index + 1).padStart(3, "0")}-${safeName}`;
}

function buildShortFileName(name, index, image) {
  const rawName = name || `image-${index + 1}`;
  const extensionMatch = rawName.match(/(\.[a-z0-9]{1,8})$/i);
  const extension = extensionMatch ? extensionMatch[1] : ".jpg";
  const baseName = extensionMatch ? rawName.slice(0, -extension.length) : rawName;
  const fallbackName = `image-${index + 1}`;
  const shortBaseName = sanitizeFileNamePart(baseName, fallbackName).slice(0, 20);
  return `${shortBaseName}${formatResolutionSuffix(image)}${sanitizeFileNamePart(extension, "")}`;
}

function sanitizePathSegment(value) {
  return value
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "untitled";
}

function buildDownloadFolderName(title = "") {
  const englishTitle = title.match(/[a-z]+/gi)?.join("") || "untitled";
  return sanitizePathSegment(`${DOWNLOAD_FOLDER_PREFIX}_${englishTitle}_${formatTimeSuffix()}`);
}

function sanitizeFileNamePart(value, fallback) {
  return value
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || fallback;
}

function formatTimeSuffix() {
  const now = new Date();
  return [
    now.getHours(),
    now.getMinutes(),
    now.getSeconds()
  ].map((value) => String(value).padStart(2, "0")).join("");
}

function filterDownloadableImageUrls(urls = []) {
  return Array.from(
    new Set(
      urls.filter((url) => (
        typeof url === "string"
        && url.startsWith("https://")
        && !isSvgUrl(url)
      ))
    )
  );
}

function filterDownloadableImages(items = []) {
  const seen = new Set();
  return items
    .map((item) => normalizeDownloadImage(item))
    .filter((image) => {
      if (!image || seen.has(image.url)) {
        return false;
      }
      seen.add(image.url);
      return true;
    });
}

function normalizeDownloadImage(item) {
  const url = typeof item === "string" ? item : item?.url;
  if (typeof url !== "string" || !url.startsWith("https://") || isSvgUrl(url)) {
    return null;
  }

  return {
    url,
    width: Number(item?.width) || 0,
    height: Number(item?.height) || 0
  };
}

function formatResolutionSuffix(image) {
  if (!image?.width || !image?.height) {
    return "";
  }
  return `_${image.width}x${image.height}`;
}

function isSvgUrl(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".svg");
  } catch {
    return /\.svg(\?.*)?$/i.test(url);
  }
}
