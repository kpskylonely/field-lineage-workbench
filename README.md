# 字段级数据血缘与重构影响分析工作台

前端已按 Figma Make《数据库重构辅助系统》**原样对齐**（React + 设计稿 CSS）。

## 启动

```bash
cd /Users/shenwei/Documents/workspace/field-lineage-workbench
./run.sh
```

浏览器：http://127.0.0.1:8766

首次若无 `frontend/dist`，`run.sh` 会自动 `npm install && npm run build`。

## 麒麟 V10 / Ubuntu 20.04 打包（与 en-word 同套路）

```bash
# 本机 Docker
ARCH=amd64 bash scripts/build_kylin_docker.sh

# 或推送 main → GitHub Actions 产出 amd64/arm64 .deb（见 Actions Artifacts / Pre-release）
```

说明：[docs/KYLIN_BUILD.md](docs/KYLIN_BUILD.md)

前端开发热更新：

```bash
cd frontend && npm run dev   # http://127.0.0.1:5173 ，API 代理到 8766
```

改完 UI 后正式构建：

```bash
cd frontend && npm run build
```

## 界面结构（与 Make 一致）

| 左轨 | 内容 |
|---|---|
| 分析过程 | P0–P6 / 29 表流水线 |
| 数据视图 | 数据视图 / 接口视图；引用树与触达树 |
| 系统配置 | 阶段与表模版配置 |

讨论纪要：[docs/血缘探索-讨论纪要与设计思路.md](docs/血缘探索-讨论纪要与设计思路.md)  
演进路线（→ 数据中台）：[docs/工作台到数据中台演进说明.md](docs/工作台到数据中台演进说明.md)  
Make 源码备份：`docs/figma-make/` · 旧版静态页：`frontend.legacy/`

## 后端

FastAPI + SQLite（`data/workbench.db`），API：http://127.0.0.1:8766/docs

## 边界

| 本工作台 | 不做 |
|---|---|
| 摸清有什么、谁用、能否改 | 业务办理 |
| 重构前影响分析与闸门 | 生产数据中台供数 |
| 向中台导出元数据/血缘候选（后续） | 全息综合展示 |
