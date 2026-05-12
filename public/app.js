const treeRoot = document.getElementById("treeRoot");
const editor = document.getElementById("editor");
const reader = document.getElementById("reader");
const fileTitle = document.getElementById("fileTitle");
const saveBtn = document.getElementById("saveBtn");
const deleteBtn = document.getElementById("deleteBtn");
const reloadBtn = document.getElementById("reloadBtn");
const readBtn = document.getElementById("readBtn");
const toggleTreeBtn = document.getElementById("toggleTreeBtn");
const statusEl = document.getElementById("status");
const rootBtn = document.getElementById("rootBtn");
const rootPanel = document.getElementById("rootPanel");
const rootCurrentEl = document.getElementById("rootCurrent");
const rootHomeEl = document.getElementById("rootHome");
const rootInput = document.getElementById("rootInput");
const rootApplyBtn = document.getElementById("rootApplyBtn");
const rootHomeBtn = document.getElementById("rootHomeBtn");
const rootResetBtn = document.getElementById("rootResetBtn");
const rootPresetsEl = document.getElementById("rootPresets");

let currentFilePath = "";
let currentFileCanOpen = false;
let originalContent = "";
let isSaving = false;
let activeFileLi = null;
let rootState = { home: "", root: "", initialRoot: "", presets: [] };
let isReadingMode = false;

function isMarkdownPath(p) {
  if (!p) return false;
  return /\.(md|markdown|mdown|mkd)$/i.test(p);
}

function canEnterReadMode() {
  return Boolean(currentFilePath) && currentFileCanOpen && isMarkdownPath(currentFilePath);
}

function refreshReadButton() {
  const allowed = canEnterReadMode();
  readBtn.disabled = !allowed;
  if (!allowed && isReadingMode) {
    setReadingMode(false);
    return;
  }
  readBtn.setAttribute("aria-pressed", isReadingMode ? "true" : "false");
  readBtn.title = isReadingMode ? "切回编辑" : "阅读模式（Markdown 渲染）";
}

function renderMarkdownInto(text) {
  if (typeof window.marked === "undefined") {
    reader.innerHTML = "<p style='color:#b91c1c'>marked.js 未加载</p>";
    return;
  }
  try {
    reader.innerHTML = window.marked.parse(text || "", { gfm: true, breaks: false });
  } catch (e) {
    reader.innerHTML = `<p style='color:#b91c1c'>渲染失败：${e.message}</p>`;
  }
}

function setReadingMode(on) {
  isReadingMode = Boolean(on) && canEnterReadMode();
  if (isReadingMode) {
    renderMarkdownInto(editor.value);
    editor.classList.add("hidden");
    editor.setAttribute("aria-hidden", "true");
    reader.classList.remove("hidden");
    reader.setAttribute("aria-hidden", "false");
  } else {
    reader.classList.add("hidden");
    reader.setAttribute("aria-hidden", "true");
    editor.classList.remove("hidden");
    editor.setAttribute("aria-hidden", "false");
  }
  readBtn.setAttribute("aria-pressed", isReadingMode ? "true" : "false");
  readBtn.classList.toggle("active", isReadingMode);
  readBtn.title = isReadingMode ? "切回编辑" : "阅读模式（Markdown 渲染）";
}

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function isDirty() {
  return Boolean(currentFilePath) && currentFileCanOpen && editor.value !== originalContent;
}

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`.trim();
}

function refreshSaveState() {
  const dirty = isDirty();
  saveBtn.disabled = !dirty || isSaving;
  deleteBtn.disabled = !currentFilePath || isSaving;
  refreshReadButton();

  const suffix = dirty ? " *" : "";
  fileTitle.textContent = currentFilePath ? `${currentFilePath}${suffix}` : "未选择文件";
}

async function api(url, options = {}) {
  const resp = await fetch(url, options);
  const data = await resp.json();
  if (!data.ok) throw new Error(data.error || "请求失败");
  return data;
}

function setActiveFile(li) {
  if (activeFileLi) activeFileLi.classList.remove("active");
  activeFileLi = li;
  if (activeFileLi) activeFileLi.classList.add("active");
}

function clearCurrentFile() {
  currentFilePath = "";
  currentFileCanOpen = false;
  originalContent = "";
  editor.readOnly = false;
  editor.value = "";
  setReadingMode(false);
  setActiveFile(null);
  refreshSaveState();
}

function selectBlockedFile(filePath, liEl = null) {
  currentFilePath = filePath;
  currentFileCanOpen = false;
  originalContent = "不能打开";
  editor.readOnly = true;
  editor.value = "不能打开";
  setReadingMode(false);
  setActiveFile(liEl);
  refreshSaveState();
  setStatus(`不能打开：${filePath}（非文本文件）`, "error");

  if (isMobile()) {
    document.body.classList.remove("tree-open");
  }
}

async function openFile(filePath, liEl = null) {
  try {
    setStatus("读取中...");
    const f = await api(`/api/file?path=${encodeURIComponent(filePath)}`);

    currentFilePath = f.path;
    currentFileCanOpen = true;
    editor.readOnly = false;
    editor.value = f.content;
    originalContent = f.content;
    setActiveFile(liEl);
    if (isReadingMode && !canEnterReadMode()) {
      setReadingMode(false);
    } else if (isReadingMode) {
      renderMarkdownInto(editor.value);
    }
    refreshSaveState();
    setStatus("已读取", "success");

    if (isMobile()) {
      document.body.classList.remove("tree-open");
    }
    return true;
  } catch (e) {
    setStatus(`读取失败：${e.message}`, "error");
    return false;
  }
}

async function deleteCurrentFile() {
  if (!currentFilePath || isSaving) return false;

  const extraWarning = isDirty() ? "\n当前文件有未保存修改，删除后将无法恢复。" : "";
  const ok = window.confirm(`确定删除 ${currentFilePath} 吗？此操作不可恢复。${extraWarning}`);
  if (!ok) return false;

  const targetPath = currentFilePath;
  deleteBtn.disabled = true;

  try {
    setStatus(`删除中：${targetPath}`);
    await api(`/api/file?path=${encodeURIComponent(targetPath)}`, {
      method: "DELETE"
    });

    activeFileLi?.remove();
    clearCurrentFile();
    setStatus(`已删除：${targetPath}`, "success");
    return true;
  } catch (e) {
    setStatus(`删除失败：${e.message}`, "error");
    refreshSaveState();
    return false;
  }
}

async function loadDir(rel = "", parentEl = treeRoot) {
  const data = await api(`/api/tree?path=${encodeURIComponent(rel)}`);

  const container = parentEl === treeRoot ? parentEl : document.createElement("ul");

  for (const item of data.items) {
    const li = document.createElement("li");
    li.className = item.type;
    if (item.isSymlink) li.classList.add("symlink");
    if (item.linkError) li.classList.add("invalid-link");
    if (item.type === "file" && item.canOpen === false) li.classList.add("blocked");

    const iconWrap = document.createElement("span");
    iconWrap.className = "tree-icon";
    iconWrap.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${item.type === "dir" ? "i-folder" : "i-file"}"/></svg>`;
    li.appendChild(iconWrap);

    const label = document.createElement("span");
    label.className = "entry-label";
    label.textContent = item.name;
    li.appendChild(label);

    if (item.isSymlink) {
      const badge = document.createElement("span");
      badge.className = "symlink-badge";
      badge.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-link"/></svg>`;
      badge.title = item.linkError ? `符号链接不可用：${item.linkError}` : "符号链接";
      li.appendChild(badge);
    }

    if (item.type === "file" && item.canOpen === false) {
      const badge = document.createElement("span");
      badge.className = "blocked-badge";
      badge.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-alert"/></svg>`;
      badge.title = "非文本文件，不能打开，但可以删除";
      li.appendChild(badge);
    }

    if (item.linkError) {
      li.onclick = async (e) => {
        e.stopPropagation();
        setStatus(`无法打开 ${item.path}：${item.linkError}`, "error");
      };
    } else if (item.type === "dir") {
      li.onclick = async (e) => {
        e.stopPropagation();
        if (li.dataset.loaded === "1") {
          const sub = li.querySelector("ul");
          if (sub) sub.style.display = sub.style.display === "none" ? "block" : "none";
          return;
        }
        try {
          await loadDir(item.path, li);
          li.dataset.loaded = "1";
        } catch (err) {
          setStatus(`加载目录失败：${err.message}`, "error");
        }
      };
    } else if (item.canOpen === false) {
      li.onclick = async (e) => {
        e.stopPropagation();
        selectBlockedFile(item.path, li);
      };
    } else {
      li.onclick = async (e) => {
        e.stopPropagation();
        await openFile(item.path, li);
      };
    }
    container.appendChild(li);
  }

  if (parentEl !== treeRoot) {
    parentEl.appendChild(container);
  }
}

async function saveCurrentFile() {
  if (!currentFilePath || !currentFileCanOpen) return;

  try {
    isSaving = true;
    refreshSaveState();
    setStatus("保存中...");

    await api("/api/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: currentFilePath,
        content: editor.value
      })
    });

    originalContent = editor.value;
    setStatus(`已保存（${new Date().toLocaleTimeString()}）`, "success");
  } catch (e) {
    setStatus(`保存失败：${e.message}`, "error");
  } finally {
    isSaving = false;
    refreshSaveState();
  }
}

async function reloadAll() {
  if (isDirty()) {
    const ok = window.confirm("当前文件有未保存修改，重载会丢失这些改动，继续吗？");
    if (!ok) return;
  }

  const reopenPath = currentFilePath;
  const reopenBlocked = Boolean(reopenPath) && !currentFileCanOpen;

  try {
    setStatus("重载中...");
    setActiveFile(null);
    treeRoot.innerHTML = "";

    await loadDir();

    if (reopenPath) {
      if (reopenBlocked) {
        selectBlockedFile(reopenPath, null);
      } else {
        const opened = await openFile(reopenPath, null);
        if (!opened) {
          clearCurrentFile();
          return;
        }
      }
    }

    setStatus("已重载", "success");
  } catch (e) {
    setStatus(`重载失败：${e.message}`, "error");
  }
}

function renderRootPanel() {
  rootCurrentEl.textContent = rootState.root || "—";
  rootHomeEl.textContent = rootState.home || "—";
  rootInput.value = rootState.root || "";

  rootPresetsEl.innerHTML = "";
  for (const preset of rootState.presets || []) {
    const li = document.createElement("li");
    li.className = "root-preset";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "root-preset-btn";
    btn.textContent = preset.name;
    btn.title = preset.path;
    if (preset.path === rootState.root) {
      btn.classList.add("active");
    }
    btn.addEventListener("click", () => switchRoot(preset.path));
    li.appendChild(btn);
    rootPresetsEl.appendChild(li);
  }
}

async function loadRootState() {
  try {
    const data = await api("/api/root");
    rootState = {
      home: data.home,
      root: data.root,
      initialRoot: data.initialRoot,
      presets: data.presets || []
    };
    renderRootPanel();
  } catch (e) {
    setStatus(`加载根目录信息失败：${e.message}`, "error");
  }
}

function setRootPanelOpen(open) {
  rootPanel.classList.toggle("hidden", !open);
  rootBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

function isRootPanelOpen() {
  return !rootPanel.classList.contains("hidden");
}

async function switchRoot(targetPath) {
  if (!targetPath) {
    setStatus("根路径不能为空", "error");
    return;
  }
  if (targetPath === rootState.root) {
    setStatus(`已是当前根：${targetPath}`);
    return;
  }
  if (isDirty()) {
    const ok = window.confirm("当前文件有未保存修改，切根会丢失这些改动，继续吗？");
    if (!ok) return;
  }

  try {
    setStatus(`切根中：${targetPath}`);
    const data = await api("/api/root", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: targetPath })
    });

    rootState.root = data.root;
    rootState.home = data.home;
    rootState.presets = data.presets || [];
    renderRootPanel();

    clearCurrentFile();
    treeRoot.innerHTML = "";
    await loadDir();

    setStatus(`已切到根：${data.root}`, "success");
  } catch (e) {
    setStatus(`切根失败：${e.message}`, "error");
  }
}

editor.addEventListener("input", refreshSaveState);

saveBtn.addEventListener("click", saveCurrentFile);
deleteBtn.addEventListener("click", deleteCurrentFile);
reloadBtn.addEventListener("click", reloadAll);
readBtn.addEventListener("click", () => {
  if (readBtn.disabled) return;
  setReadingMode(!isReadingMode);
});

toggleTreeBtn.addEventListener("click", () => {
  document.body.classList.toggle("tree-open");
});

rootBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const opening = !isRootPanelOpen();
  setRootPanelOpen(opening);
  if (opening) {
    loadRootState();
  }
});

rootApplyBtn.addEventListener("click", () => switchRoot(rootInput.value.trim()));
rootInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    switchRoot(rootInput.value.trim());
  }
});
rootHomeBtn.addEventListener("click", () => switchRoot(rootState.home));
rootResetBtn.addEventListener("click", () => switchRoot(rootState.initialRoot));

document.addEventListener("click", (e) => {
  if (!isRootPanelOpen()) return;
  if (rootPanel.contains(e.target) || rootBtn.contains(e.target)) return;
  setRootPanelOpen(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isRootPanelOpen()) {
    setRootPanelOpen(false);
  }
});

window.addEventListener("beforeunload", (e) => {
  if (!isDirty()) return;
  e.preventDefault();
  e.returnValue = "";
});

window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveCurrentFile();
  }
});

if (!isMobile()) {
  document.body.classList.add("tree-open");
}

(async () => {
  try {
    await loadRootState();
    await loadDir();
    refreshSaveState();
    setStatus("就绪", "success");
  } catch (e) {
    setStatus(`初始化失败：${e.message}`, "error");
  }
})();
