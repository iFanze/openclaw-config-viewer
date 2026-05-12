import express from "express";
import fs from "fs/promises";
import os from "os";
import path from "path";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const HOME_DIR = path.resolve(process.env.HOME_DIR || os.homedir() || "/root");
const INITIAL_ROOT = path.resolve(process.env.ROOT_DIR || HOME_DIR);
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const TEXT_SAMPLE_SIZE = 4096;

if (INITIAL_ROOT !== HOME_DIR && !INITIAL_ROOT.startsWith(HOME_DIR + path.sep)) {
  console.warn(
    `[warn] ROOT_DIR (${INITIAL_ROOT}) 不在 HOME_DIR (${HOME_DIR}) 内，` +
      `切根 API 仅允许 HOME_DIR 范围内的目录。`
  );
}

let currentRoot = INITIAL_ROOT;

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

function isUnderHome(absPath) {
  return absPath === HOME_DIR || absPath.startsWith(HOME_DIR + path.sep);
}

function normalizeHomePath(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("路径不能为空");
  }

  let raw = input.trim();
  if (raw === "~") {
    raw = HOME_DIR;
  } else if (raw.startsWith("~/")) {
    raw = path.join(HOME_DIR, raw.slice(2));
  } else if (!path.isAbsolute(raw)) {
    raw = path.join(HOME_DIR, raw);
  }

  const abs = path.resolve(raw);
  if (!isUnderHome(abs)) {
    throw new Error(`路径必须在 HOME_DIR (${HOME_DIR}) 内`);
  }
  return abs;
}

async function safeResolve(rel = "") {
  const normalizedRel = String(rel).replace(/\\/g, "/");
  const full = path.resolve(currentRoot, normalizedRel);
  if (full !== currentRoot && !full.startsWith(currentRoot + path.sep)) {
    throw new Error("非法路径");
  }

  return {
    full,
    rel: normalizedRel
  };
}

async function readFileSample(full, size = TEXT_SAMPLE_SIZE) {
  const handle = await fs.open(full, "r");

  try {
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function isValidUtf8Sample(buffer) {
  const maxTrim = Math.min(3, buffer.length - 1);

  for (let trim = 0; trim <= maxTrim; trim += 1) {
    const candidate = trim === 0 ? buffer : buffer.subarray(0, buffer.length - trim);

    try {
      // 抽样读取可能刚好截断在 UTF-8 多字节字符中间。
      // 允许最多裁掉末尾 1~3 个字节，避免把中文 Markdown 误判成二进制。
      new TextDecoder("utf-8", { fatal: true }).decode(candidate);
      return true;
    } catch {
      // keep trying
    }
  }

  return false;
}

function looksLikeTextBuffer(buffer) {
  if (buffer.length === 0) return true;
  if (buffer.includes(0)) return false;
  if (!isValidUtf8Sample(buffer)) return false;

  let controlChars = 0;
  for (const byte of buffer) {
    const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13;
    if (isControl) controlChars += 1;
  }

  return controlChars / buffer.length < 0.02;
}

async function isProbablyTextFile(full) {
  const sample = await readFileSample(full);
  return looksLikeTextBuffer(sample);
}

async function describeEntry(parentRel, dirent) {
  const itemPath = path.posix.join(parentRel.replace(/\\/g, "/"), dirent.name);
  const item = {
    name: dirent.name,
    type: dirent.isDirectory() ? "dir" : "file",
    path: itemPath,
    isSymlink: dirent.isSymbolicLink()
  };

  try {
    const { full } = await safeResolve(itemPath);
    if (dirent.isSymbolicLink()) {
      const st = await fs.stat(full);
      item.type = st.isDirectory() ? "dir" : "file";
    }

    if (item.type === "file") {
      item.canOpen = await isProbablyTextFile(full);
    }
  } catch (e) {
    if (dirent.isSymbolicLink()) {
      item.linkError = e.message;
    } else if (item.type === "file") {
      item.canOpen = false;
      item.linkError = e.message;
    }
  }

  return item;
}

async function listSubdirs(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const subdirs = [];
  for (const dirent of entries) {
    const full = path.join(dir, dirent.name);
    let isDir = dirent.isDirectory();
    if (dirent.isSymbolicLink()) {
      try {
        const st = await fs.stat(full);
        isDir = st.isDirectory();
      } catch {
        continue;
      }
    }
    if (!isDir) continue;
    subdirs.push({ name: dirent.name, path: full });
  }

  subdirs.sort((a, b) => a.name.localeCompare(b.name));
  return subdirs;
}

app.get("/api/root", async (_req, res) => {
  try {
    const presets = await listSubdirs(currentRoot);
    res.json({
      ok: true,
      home: HOME_DIR,
      root: currentRoot,
      initialRoot: INITIAL_ROOT,
      presets
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/root", async (req, res) => {
  try {
    const input = req.body?.path;
    const next = normalizeHomePath(input);

    const st = await fs.stat(next);
    if (!st.isDirectory()) throw new Error("目标不是目录");

    currentRoot = next;
    const presets = await listSubdirs(currentRoot);
    res.json({ ok: true, home: HOME_DIR, root: currentRoot, presets });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get("/api/tree", async (req, res) => {
  try {
    const rel = req.query.path || "";
    const { full: dir } = await safeResolve(rel);
    const items = await fs.readdir(dir, { withFileTypes: true });

    const result = (await Promise.all(
      items.map((d) => describeEntry(rel, d))
    ))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));

    res.json({ ok: true, items: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get("/api/file", async (req, res) => {
  try {
    const rel = req.query.path;
    if (!rel) throw new Error("缺少 path");

    const { full: file } = await safeResolve(rel);
    const st = await fs.stat(file);
    if (!st.isFile()) throw new Error("不是文件");
    if (st.size > MAX_FILE_SIZE) throw new Error("文件太大（>2MB）");
    if (!(await isProbablyTextFile(file))) throw new Error("非文本文件，已禁止打开");

    const content = await fs.readFile(file, "utf8");
    res.json({ ok: true, path: rel, content });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/file", async (req, res) => {
  try {
    const rel = req.body?.path;
    const content = req.body?.content;

    if (!rel || typeof rel !== "string") throw new Error("缺少 path");
    if (typeof content !== "string") throw new Error("content 必须是字符串");

    const { full: file } = await safeResolve(rel);
    const st = await fs.stat(file);
    if (!st.isFile()) throw new Error("不是文件");
    if (!(await isProbablyTextFile(file))) throw new Error("非文本文件，禁止覆盖保存");

    const size = Buffer.byteLength(content, "utf8");
    if (size > MAX_FILE_SIZE) throw new Error("内容太大（>2MB）");

    await fs.writeFile(file, content, "utf8");
    res.json({ ok: true, path: rel, size });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.delete("/api/file", async (req, res) => {
  try {
    const rel = req.query.path || req.body?.path;
    if (!rel || typeof rel !== "string") throw new Error("缺少 path");

    const { full: file } = await safeResolve(rel);
    const st = await fs.lstat(file);

    if (st.isDirectory()) throw new Error("暂不支持删除目录");

    await fs.unlink(file);
    res.json({ ok: true, path: rel });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Viewer running: http://${HOST}:${PORT}`);
  console.log(`HOME_DIR: ${HOME_DIR}`);
  console.log(`Initial root: ${currentRoot}`);
});
