# Worship Library

私人敬拜歌曲资源库，适合 iPhone 主屏幕应用与 Windows 浏览器。React + TypeScript + Vite；歌曲信息使用 IndexedDB，附件使用 OPFS。没有账户、云同步、分析追踪或远程文件上传。

## 已实现

- 新增、查看、编辑、删除歌曲；搜索歌词、歌名、歌手、版本、调性、分类、标签和备注。
- 分类与标签筛选，中文 / 英文 / 双语歌词，多个音频播放器。
- 上传多个附件并调整新附件类型；已有附件在保存时才删除，取消编辑须确认。
- PDF 与常见图片尝试新窗口打开，其他格式交给下载与系统应用；所有附件可独立下载。
- `.wlib` 完整备份、摘要预览、恢复替换确认、CRC32 校验、校验进度与错误反馈。
- 本地存储用量、最近生成备份时间、存储不足提示、PWA 离线外壳、更新提示、安装图标。
- GitHub Pages 发布工作流。

## 在 Windows 本机运行

安装 Node.js 22 LTS 与 pnpm 11.19.0。解压后在项目目录打开终端：

```powershell
npm install -g pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm dev
```

打开终端显示的 localhost 网址。请勿双击 index.html：应用需要 HTTPS 或 localhost 安全环境。

生产构建与本机预览：

```powershell
pnpm build
pnpm preview
```

`pnpm build` 同时执行 TypeScript 检查。开发服务器不启用离线缓存；离线验收使用生产预览或正式 HTTPS 地址。

## 发布到 GitHub Pages

1. 在自己的 GitHub 账户创建仓库。只上传本项目源码与配置，包含 `.github/workflows/pages.yml`；不要上传 node_modules、任何真实歌曲、附件或备份。项目无需后端。
2. 将代码推送至 `main` 分支。在仓库 Settings → Pages 中，把 Source 设为 GitHub Actions。
3. Actions 中的 Publish Worship Library 会安装依赖、构建并发布。完成后从 Pages 页面取得 HTTPS 地址。
4. 以后修改源码并推送 main 即可更新。首次使用后保持域名及路径稳定，改网址前先备份。

可通过 GitHub 网页上传，或本地 git 提交推送。本项目仓库为 https://github.com/zhengcheng596-afk/worship-library 。发布前需在仓库 Settings → Pages 启用 GitHub Actions；私有仓库使用 Pages 需要支持该功能的 GitHub 套餐。程序公开不会把设备上的曲库上传。

## iPhone 使用

1. 用 Safari 打开正式 HTTPS 地址，通过“分享 → 添加到主屏幕”安装。
2. 固定从主屏幕图标进入，然后新增歌曲、填写歌词、选择音频与资料。
3. PPT 不内置预览，请下载后交给 PowerPoint、Keynote 或系统打开；能否打开也取决于文件格式及已安装应用。
4. 首次联网加载后可以离线打开；锁屏、后台播放与文件打开能力需在自己的 iPhone 上验证。
5. 更新提示出现时先保存编辑再更新，不在上传或恢复过程中刷新页面。

## 备份与换设备

点击右上角备份图标 → 导出 `.wlib` → 确认已保存文件。请额外复制到 Windows 或外接存储。

另一设备打开相同程序 → 备份与恢复 → 选择 `.wlib` → 核对时间和数量 → 确认恢复。**恢复替换整个曲库，不合并；备份没有加密。** 最近备份时间只是生成时间，不能证明系统下载成功。

Safari 标签页与主屏幕应用可能隔离存储。清理网站数据、卸载、存储回收或设备故障可造成丢失。持久存储请求不能替代备份。不要使用隐私浏览，也不要同时在多个窗口编辑或备份。

## 工程结构

- `src/lib/`：复用交接版本的存储与备份逻辑，保留 v1 `.wlib` 兼容性。
- `src/App.tsx`、`src/main.tsx`、`src/style.css`：界面、路由和交互。
- `public/`：安装图标与 favicon。
- `docs/reference-home-prototype.html`：原首页参考，示例数据不会进入正式曲库。
- `tests/browser-smoke.cjs`：独立浏览器回归脚本，只使用合成测试资料。
- `docs/VALIDATION.md`：验证记录与真机验收清单。
- `PROJECT_HANDOFF.md`：原始交接文档（历史基线，当前状态以 README 为准）。

## 已知限制

- 每次编辑会先保存歌曲文字，再逐个保存附件；附件失败时页面明确报告部分保存，可重试，已上传文件不重复添加。取消不回滚已经成功写入的部分。
- IndexedDB 与 OPFS 不能构成跨存储原子事务。恢复先写入新 revision 再切换数据库，写入失败保留原曲库；清理失败可能留孤立文件。
- 当前页面内串行执行写操作，但多个窗口之间没有全局写入锁。
- 备份附件按块校验，最终导出的 Blob 仍受浏览器内存、磁盘与单文件下载限制；大型曲库需在真实设备验证。
- 本版本没有自动滚动歌词、后台播放保证、云同步或原生 iOS 安装包。

## 浏览器回归脚本

另开终端启动 `pnpm preview`。安装 Playwright 测试工具与 Chromium 后运行 `node tests/browser-smoke.cjs`。脚本默认检查 `http://127.0.0.1:4173/`，使用独立临时浏览器数据，不修改个人曲库。可用 `TEST_URL`、`TEST_OUTPUT` 环境变量调整测试地址和结果目录。
