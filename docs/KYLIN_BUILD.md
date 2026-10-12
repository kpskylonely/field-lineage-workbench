# 麒麟 V10 / Ubuntu 20.04 打包说明

对齐 `en-word` 项目的打包架构，产出可在麒麟 V10（glibc ≤ 2.31）安装的 `.deb`。

## 架构

```
GitHub Actions runner (amd64 / arm64)
        │
        ▼
  Docker (ubuntu:20.04)          ← glibc 2.31 基线
        │
        ├─ indygreg CPython 3.10
        ├─ Node.js tarball
        └─ dpkg-dev
        │
        ▼
  scripts/build_kylin.sh
  scripts/verify_glibc.sh
        │
        ▼
  release/field-lineage-workbench_*_{amd64|arm64}.deb
```

## 命令

```bash
# 推荐：本机有 Docker 时
bash scripts/build_kylin_docker.sh

# 指定架构
ARCH=amd64 bash scripts/build_kylin_docker.sh
ARCH=arm64 bash scripts/build_kylin_docker.sh

# 在麒麟 / Ubuntu 20.04 本机（已装 Node + 可用 Python）
bash scripts/build_kylin.sh
```

## 安装（目标机）

```bash
sudo dpkg -i field-lineage-workbench_0.1.0_amd64.deb
sudo systemctl enable --now field-lineage-workbench
# 浏览器打开 http://127.0.0.1:8766
```

## 设计原则

| 规则 | 原因 |
|------|------|
| Docker 基镜像只用 **ubuntu:20.04** | 锁定 glibc 2.31 |
| **禁止** PPA / deadsnakes | CI 不稳定 |
| Python 用 **indygreg standalone** 并打进 deb | 目标机无需系统 Python 依赖 |
| 打包后 **verify_glibc.sh** | 防止把高 glibc 二进制发给麒麟 |
