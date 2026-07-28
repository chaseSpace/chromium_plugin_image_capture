const captureBtn = document.querySelector("#captureBtn");
const copyBtn = document.querySelector("#copyBtn");
const sortByResolutionBtn = document.querySelector("#sortByResolutionBtn");
const downloadBtn = document.querySelector("#downloadBtn");
const downloadFilterBtn = document.querySelector("#downloadFilterBtn");
const downloadFaqBtn = document.querySelector("#downloadFaqBtn");
const clearBtn = document.querySelector("#clearBtn");
const prevPageBtn = document.querySelector("#prevPageBtn");
const nextPageBtn = document.querySelector("#nextPageBtn");
const statusText = document.querySelector("#statusText");
const currentSummary = document.querySelector("#currentSummary");
const imageUrlList = document.querySelector("#imageUrlList");
const queryResultCount = document.querySelector("#queryResultCount");
const searchInput = document.querySelector("#searchInput");
const historyList = document.querySelector("#historyList");
const pageInfo = document.querySelector("#pageInfo");
const filterModal = document.querySelector("#filterModal");
const closeFilterBtn = document.querySelector("#closeFilterBtn");
const saveFilterBtn = document.querySelector("#saveFilterBtn");
const resetFilterBtn = document.querySelector("#resetFilterBtn");
const minWidthInput = document.querySelector("#minWidthInput");
const minHeightInput = document.querySelector("#minHeightInput");

const PAGE_SIZE = 5;
const LINK_TEXT_LIMIT = 30;
const IMAGE_SIZE_TIMEOUT_MS = 2500;
const QUERY_FILTER_KEY = "imageQueryFilter";
let currentRecord = null;
let history = [];
let currentPage = 1;
let renderToken = 0;
let tipTimer = null;
let resolutionSortDirection = "desc";
let downloadFilter = {
  minWidth: 0,
  minHeight: 0
};
const imageSizeCache = new Map();

document.addEventListener("DOMContentLoaded", async () => {
  showTip(statusText.textContent);
  await loadQueryFilter();
  loadHistory();
});
captureBtn.addEventListener("click", captureCurrentPage);
copyBtn.addEventListener("click", copyCurrentUrls);
sortByResolutionBtn.addEventListener("click", sortCurrentRecordByResolution);
downloadBtn.addEventListener("click", downloadCurrentImages);
downloadFilterBtn.addEventListener("click", openDownloadFilterModal);
downloadFaqBtn.addEventListener("click", () => {
  showTip("打开浏览器设置--搜索【下载前询问每个文件的保存位置】--关闭选项即可。");
});
closeFilterBtn.addEventListener("click", closeDownloadFilterModal);
saveFilterBtn.addEventListener("click", saveDownloadFilter);
resetFilterBtn.addEventListener("click", resetDownloadFilter);
filterModal.addEventListener("click", (event) => {
  if (event.target === filterModal) {
    closeDownloadFilterModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !filterModal.hidden) {
    closeDownloadFilterModal();
  }
});
clearBtn.addEventListener("click", clearHistory);
prevPageBtn.addEventListener("click", () => changePage(-1));
nextPageBtn.addEventListener("click", () => changePage(1));
searchInput.addEventListener("input", () => {
  currentPage = 1;
  renderHistory();
});

async function captureCurrentPage() {
  setBusy(true, "正在捕获当前页面图片地址...");

  const response = await sendRuntimeMessage({ type: "CAPTURE_CURRENT_TAB" });

  if (!response.ok) {
    setBusy(false, response.error || "捕获失败。");
    return;
  }

  currentRecord = response.record;
  resolutionSortDirection = "desc";
  renderCurrentRecord(currentRecord);
  await loadHistory();
  setBusy(false, `已捕获当前网站 ${currentRecord.title} 中的 ${currentRecord.count} 个图片地址。`);
}

async function copyCurrentUrls() {
  const urls = getVisibleImageUrls();
  if (!currentRecord || urls.length === 0) {
    return;
  }

  await navigator.clipboard.writeText(urls.join("\n"));
  showTip("图片地址已复制到剪贴板。");
}

async function clearHistory() {
  const response = await sendRuntimeMessage({ type: "CLEAR_CAPTURE_HISTORY" });
  if (response.ok) {
    history = [];
    currentRecord = null;
    resetCurrentRecord();
    renderHistory();
    showTip("历史记录已清空。");
  }
}

async function loadHistory() {
  const response = await sendRuntimeMessage({ type: "GET_CAPTURE_HISTORY" });
  if (!response.ok) {
    showTip(response.error || "历史记录读取失败。");
    return;
  }

  history = response.history;
  renderHistory();
}

async function renderCurrentRecord(record) {
  const token = ++renderToken;
  currentSummary.classList.remove("empty");
  currentSummary.textContent = `已捕获当前网站 ${record.title} 中的 ${record.count} 个图片地址，点击复制。`;
  copyBtn.disabled = record.images.length === 0;
  downloadBtn.disabled = record.images.length === 0;
  sortByResolutionBtn.disabled = record.images.length <= 1;
  updateSortButtonLabel();
  renderImageUrls(record.images.map((url) => ({ url, size: imageSizeCache.get(url) })));

  const sortedItems = await getImagesSortedByResolution(record.images);
  if (token !== renderToken || currentRecord?.id !== record.id) {
    return;
  }

  currentRecord = {
    ...record,
    images: sortedItems.map((item) => item.url)
  };
  renderImageUrls(sortedItems);
}

function renderHistory() {
  const matched = getMatchedHistory();
  const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageItems = matched.slice(pageStart, pageStart + PAGE_SIZE);

  historyList.innerHTML = "";

  if (pageItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent = searchInput.value.trim() ? "没有匹配的历史记录" : "暂无历史记录";
    historyList.append(empty);
  } else {
    pageItems.forEach((record) => {
      const item = document.createElement("div");
      item.className = "historyItem";

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "historyOpenButton";
      openButton.innerHTML = `
        <span class="historyTitle"></span>
        <span class="historyMeta"></span>
      `;

      openButton.querySelector(".historyTitle").textContent = record.title;
      openButton.querySelector(".historyMeta").textContent =
        `${record.count} 个 https 图片地址 · ${formatTime(record.capturedAt)}`;

      openButton.addEventListener("click", () => {
        currentRecord = record;
        resolutionSortDirection = "desc";
        renderCurrentRecord(record);
        showTip(`已打开历史记录：${record.title}`);
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "historyDeleteButton";
      deleteButton.title = "删除历史记录";
      deleteButton.textContent = "×";
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteHistoryRecord(record.id);
      });

      item.append(openButton, deleteButton);
      historyList.append(item);
    });
  }

  pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
}

function resetCurrentRecord() {
  currentSummary.classList.add("empty");
  currentSummary.textContent = "暂无捕获结果";
  copyBtn.disabled = true;
  downloadBtn.disabled = true;
  sortByResolutionBtn.disabled = true;
  imageUrlList.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "emptyState";
    empty.textContent = "捕获到的图片地址会显示在这里";
    imageUrlList.append(empty);
  updateQueryResultCount();
}

async function deleteHistoryRecord(recordId) {
  const previousRecord = currentRecord;
  const previousHistory = history;

  history = history.filter((record) => record.id !== recordId);
  if (currentRecord?.id === recordId) {
    currentRecord = null;
    resetCurrentRecord();
  }
  renderHistory();
  showTip("正在删除历史记录...");

  const response = await sendRuntimeMessage({
    type: "DELETE_CAPTURE_RECORD",
    recordId
  });

  if (!response.ok) {
    currentRecord = previousRecord;
    history = previousHistory;
    if (currentRecord) {
      renderCurrentRecord(currentRecord);
    } else {
      resetCurrentRecord();
    }
    renderHistory();
    showTip(response.error || "删除历史记录失败。");
    return;
  }

  history = response.history;
  renderHistory();
  showTip("历史记录已删除。");
}

function renderImageUrls(items) {
  imageUrlList.innerHTML = "";
  const visibleItems = items.filter((item) => matchesQueryFilter(item.size));

  if (visibleItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent = hasQueryFilter()
      ? "没有满足查询条件的图片地址"
      : "当前页面没有捕获到 https:// 开头的图片地址";
    imageUrlList.append(empty);
    updateCurrentActionState();
    updateQueryResultCount();
    return;
  }

  visibleItems.forEach((itemData) => {
    const url = itemData.url;
    const item = document.createElement("div");
    item.className = "imageUrlItem";
    item.dataset.url = url;
    applyItemSizeDataset(item, itemData.size);

    const thumbnail = document.createElement("img");
    thumbnail.className = "imageThumbnail";
    thumbnail.src = url;
    thumbnail.alt = "";
    thumbnail.loading = "lazy";
    thumbnail.referrerPolicy = "no-referrer";

    const textWrap = document.createElement("div");
    textWrap.className = "imageUrlContent";

    const resolution = document.createElement("span");
    resolution.className = "imageResolution";
    resolution.textContent = formatResolution(itemData.size);

    const linkButton = document.createElement("button");
    linkButton.type = "button";
    linkButton.className = "imageUrlText";
    linkButton.title = "点击复制完整链接";
    linkButton.textContent = truncateUrl(url);
    linkButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(url);
      showTip("复制成功。");
    });

    thumbnail.addEventListener("load", () => {
      const size = {
        width: thumbnail.naturalWidth,
        height: thumbnail.naturalHeight,
        area: thumbnail.naturalWidth * thumbnail.naturalHeight
      };
      imageSizeCache.set(url, size);
      applyItemSizeDataset(item, size);
      resolution.textContent = formatResolution(size);
      if (!matchesQueryFilter(size)) {
        item.remove();
        updateCurrentActionState();
        updateQueryResultCount();
      }
    });
    thumbnail.addEventListener("error", () => {
      resolution.textContent = "未知分辨率";
    });

    const visitButton = document.createElement("button");
    visitButton.type = "button";
    visitButton.className = "visitButton";
    visitButton.textContent = "访问";
    visitButton.addEventListener("click", () => {
      chrome.tabs.create({ url });
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "deleteButton";
    deleteButton.title = "删除链接";
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteImageUrl(url);
    });

    textWrap.append(resolution, linkButton);
    item.append(thumbnail, textWrap, visitButton, deleteButton);
    imageUrlList.append(item);
  });
  updateCurrentActionState();
  updateQueryResultCount();
}

async function sortCurrentRecordByResolution() {
  if (!currentRecord || currentRecord.images.length <= 1) {
    showTip("当前没有可排序的图片地址。");
    return;
  }

  renderToken += 1;
  resolutionSortDirection = resolutionSortDirection === "desc" ? "asc" : "desc";
  const nextDirection = resolutionSortDirection;
  const previousDirection = nextDirection === "desc" ? "asc" : "desc";
  sortByResolutionBtn.disabled = true;
  sortByResolutionBtn.textContent = "排序中...";
  showTip(`正在按分辨率${getSortDirectionText(nextDirection)}排序...`);

  const previousRecord = currentRecord;
  const previousHistory = history;
  const sortedItems = await getImagesSortedByResolution(currentRecord.images, nextDirection);
  const knownSizeCount = sortedItems.filter((item) => getArea(item.size) > 0).length;

  currentRecord = {
    ...currentRecord,
    images: sortedItems.map((item) => item.url)
  };
  history = history.map((record) => (record.id === currentRecord.id ? currentRecord : record));
  currentSummary.textContent = `已捕获当前网站 ${currentRecord.title} 中的 ${currentRecord.count} 个图片地址，点击复制。`;
  renderImageUrls(sortedItems);
  renderHistory();

  const response = await sendRuntimeMessage({
    type: "UPDATE_CAPTURE_RECORD",
    record: currentRecord
  });

  if (!response.ok) {
    currentRecord = previousRecord;
    history = previousHistory;
    resolutionSortDirection = previousDirection;
    renderCurrentRecord(currentRecord);
    renderHistory();
    updateSortButtonLabel();
    sortByResolutionBtn.disabled = currentRecord.images.length <= 1;
    showTip(response.error || "排序同步失败。");
    return;
  }

  history = response.history;
  renderHistory();
  updateSortButtonLabel();
  sortByResolutionBtn.disabled = currentRecord.images.length <= 1;
  showTip(`已按分辨率${getSortDirectionText(nextDirection)}排序，识别到 ${knownSizeCount} 张图片尺寸。`);
}

async function downloadCurrentImages() {
  const images = getVisibleImageDownloads();
  if (!currentRecord || images.length === 0) {
    showTip("没有满足查询条件的图片。");
    return;
  }

  downloadBtn.disabled = true;
  downloadBtn.textContent = "下载中...";
  showTip("正在创建下载任务...");

  const response = await sendRuntimeMessage({
    type: "DOWNLOAD_IMAGES",
    record: {
      title: currentRecord.title,
      pageUrl: currentRecord.pageUrl,
      images
    }
  });

  downloadBtn.textContent = "一键下载";
  downloadBtn.disabled = getVisibleImageUrls().length === 0;

  if (!response.ok) {
    showTip(response.error || "下载失败。");
    return;
  }

  if (response.started === 0) {
    showTip(`下载任务创建失败，共 ${response.total} 个地址。`);
    return;
  }

  showTip(`已创建 ${response.started}/${response.total} 个下载任务，正在下载...`);
  watchDownloadProgress(response.downloadIds, response.total);
}

function openDownloadFilterModal() {
  minWidthInput.value = downloadFilter.minWidth || "";
  minHeightInput.value = downloadFilter.minHeight || "";
  filterModal.hidden = false;
  minWidthInput.focus();
}

function closeDownloadFilterModal() {
  filterModal.hidden = true;
}

async function saveDownloadFilter() {
  downloadFilter = {
    minWidth: normalizeMinSize(minWidthInput.value),
    minHeight: normalizeMinSize(minHeightInput.value)
  };
  await persistQueryFilter();
  closeDownloadFilterModal();
  updateDownloadFilterButton();
  if (currentRecord) {
    await renderCurrentRecord(currentRecord);
  }
  showTip(`查询条件已保存，当前查询结果 ${getVisibleImageUrls().length} 条。`);
}

async function resetDownloadFilter() {
  downloadFilter = {
    minWidth: 0,
    minHeight: 0
  };
  await persistQueryFilter();
  minWidthInput.value = "";
  minHeightInput.value = "";
  closeDownloadFilterModal();
  updateDownloadFilterButton();
  if (currentRecord) {
    await renderCurrentRecord(currentRecord);
  }
  showTip(`查询条件已重置，当前查询结果 ${getVisibleImageUrls().length} 条。`);
}

function getVisibleImageDownloads() {
  return Array.from(imageUrlList.querySelectorAll(".imageUrlItem"))
    .map((item) => ({
      url: item.dataset.url,
      width: Number(item.dataset.width) || 0,
      height: Number(item.dataset.height) || 0
    }))
    .filter((item) => item.url && item.url.startsWith("https://") && !isSvgUrl(item.url));
}

function getVisibleImageUrls() {
  return getVisibleImageDownloads().map((item) => item.url);
}

function applyItemSizeDataset(item, size) {
  if (!size || !size.width || !size.height) {
    delete item.dataset.width;
    delete item.dataset.height;
    return;
  }
  item.dataset.width = String(size.width);
  item.dataset.height = String(size.height);
}

function normalizeMinSize(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function updateDownloadFilterButton() {
  const hasFilter = downloadFilter.minWidth > 0 || downloadFilter.minHeight > 0;
  downloadFilterBtn.textContent = hasFilter
    ? `修改查询条件 ${downloadFilter.minWidth}x${downloadFilter.minHeight}`
    : "修改查询条件";
}

function hasQueryFilter() {
  return downloadFilter.minWidth > 0 || downloadFilter.minHeight > 0;
}

function matchesQueryFilter(size) {
  if (!hasQueryFilter()) {
    return true;
  }
  return Boolean(
    size
    && size.width >= downloadFilter.minWidth
    && size.height >= downloadFilter.minHeight
  );
}

function updateCurrentActionState() {
  const hasVisibleUrls = getVisibleImageUrls().length > 0;
  copyBtn.disabled = !hasVisibleUrls;
  downloadBtn.disabled = !hasVisibleUrls;
}

function updateQueryResultCount() {
  queryResultCount.innerHTML = `查询结果：<span>${getVisibleImageUrls().length}</span> 条`;
}

function loadQueryFilter() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [QUERY_FILTER_KEY]: downloadFilter }, (result) => {
      const savedFilter = result[QUERY_FILTER_KEY] || {};
      downloadFilter = {
        minWidth: normalizeMinSize(savedFilter.minWidth),
        minHeight: normalizeMinSize(savedFilter.minHeight)
      };
      updateDownloadFilterButton();
      resolve();
    });
  });
}

function persistQueryFilter() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [QUERY_FILTER_KEY]: downloadFilter }, resolve);
  });
}

function watchDownloadProgress(downloadIds = [], total) {
  const ids = downloadIds.filter((id) => Number.isInteger(id));
  if (ids.length === 0 || !chrome.downloads?.search) {
    return;
  }

  let ticks = 0;
  const timer = window.setInterval(() => {
    ticks += 1;
    chrome.downloads.search({ id: ids[0] }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        window.clearInterval(timer);
        showTip(`已创建 ${ids.length}/${total} 个下载任务，请查看浏览器下载记录。`);
        return;
      }

      Promise.all(ids.map((id) => searchDownloadItem(id))).then((items) => {
        const complete = items.filter((item) => item?.state === "complete").length;
        const interrupted = items.filter((item) => item?.state === "interrupted").length;

        if (complete + interrupted >= ids.length) {
          window.clearInterval(timer);
          showTip(`下载完成 ${complete} 个，失败 ${interrupted} 个。`);
          return;
        }

        showTip(`下载中：${complete}/${ids.length} 完成。`);
      });
    });

    if (ticks >= 60) {
      window.clearInterval(timer);
      showTip(`下载仍在进行，请查看浏览器下载记录。`);
    }
  }, 1000);
}

function searchDownloadItem(id) {
  return new Promise((resolve) => {
    chrome.downloads.search({ id }, (items) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(items[0] || null);
    });
  });
}

async function deleteImageUrl(url) {
  if (!currentRecord) {
    return;
  }

  const previousRecord = currentRecord;
  const previousHistory = history;
  const nextImages = currentRecord.images.filter((imageUrl) => imageUrl !== url);
  currentRecord = {
    ...currentRecord,
    images: nextImages,
    count: nextImages.length
  };
  history = history.map((record) => {
    if (record.id !== currentRecord.id) {
      return record;
    }
    return currentRecord;
  });

  renderCurrentRecord(currentRecord);
  renderHistory();
  showTip("正在删除链接...");

  const response = await sendRuntimeMessage({
    type: "UPDATE_CAPTURE_RECORD",
    record: currentRecord
  });

  if (!response.ok) {
    currentRecord = previousRecord;
    history = previousHistory;
    renderCurrentRecord(currentRecord);
    renderHistory();
    showTip(response.error || "删除失败。");
    return;
  }

  history = response.history;
  renderCurrentRecord(currentRecord);
  renderHistory();
  showTip("链接已删除。");
}

function getMatchedHistory() {
  const keyword = searchInput.value.trim().toLowerCase();
  return history.filter((record) => {
    const searchable = [
      record.title,
      record.pageUrl,
      record.images.join(" ")
    ].join(" ").toLowerCase();
    return searchable.includes(keyword);
  });
}

function changePage(offset) {
  const matched = getMatchedHistory();
  const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(currentPage + offset, 1), totalPages);
  renderHistory();
}

function setBusy(isBusy, message) {
  captureBtn.disabled = isBusy;
  showTip(message);
}

function showTip(message) {
  window.clearTimeout(tipTimer);
  statusText.textContent = message;
  statusText.classList.remove("isHidden");
  tipTimer = window.setTimeout(() => {
    statusText.classList.add("isHidden");
  }, 3000);
}

function truncateUrl(url) {
  return url.length > LINK_TEXT_LIMIT ? `${url.slice(0, LINK_TEXT_LIMIT)}...` : url;
}

async function getImagesSortedByResolution(urls, direction = "desc") {
  const items = await Promise.all(
    urls.map(async (url, index) => ({
      url,
      index,
      size: await getImageSize(url)
    }))
  );

  return items.sort((left, right) => {
    const areaDiff = direction === "desc"
      ? getArea(right.size) - getArea(left.size)
      : getArea(left.size) - getArea(right.size);
    return areaDiff || left.index - right.index;
  });
}

function updateSortButtonLabel() {
  sortByResolutionBtn.textContent = resolutionSortDirection === "desc" ? "分辨率 ↓" : "分辨率 ↑";
}

function getSortDirectionText(direction) {
  return direction === "desc" ? "从大到小" : "从小到大";
}

function getImageSize(url) {
  if (imageSizeCache.has(url)) {
    return Promise.resolve(imageSizeCache.get(url));
  }

  return new Promise((resolve) => {
    const image = new Image();
    let done = false;

    const finish = (size) => {
      if (done) {
        return;
      }
      done = true;
      image.onload = null;
      image.onerror = null;
      imageSizeCache.set(url, size);
      resolve(size);
    };

    image.onload = () => {
      finish({
        width: image.naturalWidth,
        height: image.naturalHeight,
        area: image.naturalWidth * image.naturalHeight
      });
    };
    image.onerror = () => finish(null);
    window.setTimeout(() => finish(null), IMAGE_SIZE_TIMEOUT_MS);
    image.referrerPolicy = "no-referrer";
    image.src = url;
  });
}

function getArea(size) {
  return size?.area || 0;
}

function formatResolution(size) {
  if (!size || !size.width || !size.height) {
    return "未知分辨率";
  }
  return `${size.width} x ${size.height}`;
}

function isSvgUrl(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".svg");
  } catch {
    return /\.svg(\?.*)?$/i.test(url);
  }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ ok: false, error: error.message });
        return;
      }

      resolve(response || { ok: false, error: "插件未返回响应。" });
    });
  });
}

function formatTime(isoTime) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(isoTime));
}
