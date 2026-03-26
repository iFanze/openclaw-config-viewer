const treeRoot = document.getElementById("treeRoot");
const editor = document.getElementById("editor");
const fileTitle = document.getElementById("fileTitle");
const saveBtn = document.getElementById("saveBtn");
const reloadBtn = document.getElementById("reloadBtn");
const toggleTreeBtn = document.getElementById("toggleTreeBtn");
const statusEl = document.getElementById("status");

let currentFilePath = "";
let originalContent = "";
let isSaving = false;
let activeFileLi = null;

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function isDirty() {
  return Boolean(currentFilePath) && editor.value !== originalContent;
}

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`.trim();
}

function refreshSaveState() {
  const dirty = isDirty();
  saveBtn.disabled = !dirty || isSaving;

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

async function openFile(filePath, liEl = null) {
  try {
    setStatus("读取中...");
    const f = await api(`/api/file?path=${encodeURIComponent(filePath)}`);

    currentFilePath = f.path;
    editor.value = f.content;
    originalContent = f.content;
    setActiveFile(liEl);
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

async function loadDir(rel = "", parentEl = treeRoot) {
  const data = await api(`/api/tree?path=${encodeURIComponent(rel)}`);

  const container = parentEl === treeRoot ? parentEl : document.createElement("ul");

  for (const item of data.items) {
    const li = document.createElement("li");
    li.textContent = item.name;
    li.className = item.type;

    if (item.type === "dir") {
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
  if (!currentFilePath) return;

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

  try {
    setStatus("重载中...");
    setActiveFile(null);
    treeRoot.innerHTML = "";

    await loadDir();

    if (reopenPath) {
      const opened = await openFile(reopenPath, null);
      if (!opened) return;
    }

    setStatus("已重载", "success");
  } catch (e) {
    setStatus(`重载失败：${e.message}`, "error");
  }
}

editor.addEventListener("input", refreshSaveState);

saveBtn.addEventListener("click", saveCurrentFile);
reloadBtn.addEventListener("click", reloadAll);

toggleTreeBtn.addEventListener("click", () => {
  document.body.classList.toggle("tree-open");
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
    await loadDir();
    setStatus("就绪", "success");
  } catch (e) {
    setStatus(`初始化失败：${e.message}`, "error");
  }
})();
