import express from "express";
import fs from "fs/promises";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(process.env.ROOT_DIR || "/config");
const MAX_FILE_SIZE = 2 * 1024 * 1024;

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

function safeResolve(rel = "") {
  const full = path.resolve(ROOT_DIR, rel);
  if (full !== ROOT_DIR && !full.startsWith(ROOT_DIR + path.sep)) {
    throw new Error("非法路径");
  }
  return full;
}

app.get("/api/tree", async (req, res) => {
  try {
    const rel = req.query.path || "";
    const dir = safeResolve(rel);
    const items = await fs.readdir(dir, { withFileTypes: true });

    const result = items
      .filter((d) => !d.name.startsWith("."))
      .map((d) => ({
        name: d.name,
        type: d.isDirectory() ? "dir" : "file",
        path: path.posix.join(rel.replace(/\\/g, "/"), d.name)
      }))
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

    const file = safeResolve(rel);
    const st = await fs.stat(file);
    if (!st.isFile()) throw new Error("不是文件");
    if (st.size > MAX_FILE_SIZE) throw new Error("文件太大（>2MB）");

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

    const file = safeResolve(rel);
    const st = await fs.stat(file);
    if (!st.isFile()) throw new Error("不是文件");

    const size = Buffer.byteLength(content, "utf8");
    if (size > MAX_FILE_SIZE) throw new Error("内容太大（>2MB）");

    await fs.writeFile(file, content, "utf8");
    res.json({ ok: true, path: rel, size });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Viewer running: http://0.0.0.0:${PORT}`);
});
