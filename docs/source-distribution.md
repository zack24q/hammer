# 源码交付

集成 chat-overlay 1.1.1 后，组合应用以 AGPL-3.0 分发。完整许可证见 LICENSE；原有 MIT 代码授权及第三方声明一并保留。

发布二进制时，必须同时提供该二进制对应的完整可构建源码，包括根项目、锁文件、构建脚本、chat-overlay 全部源码及本地修改。不能只提供 GitHub 自动生成的源码 ZIP：它不包含 Git 子模块内容。

`npm run make` / `npm run publish` 的 Forge postMake 钩子会自动生成并附带完整源码归档，发布器会与安装包一起上传。也可单独运行 `npm run source:archive`，将生成的 `out/hammer-source-<版本>.tar.gz` 与安装包放在同一个 Release，并在下载说明中给出源码链接。该脚本收集 Git 跟踪文件的当前工作区内容和必要的新文件，不打包 node_modules、用户配置或凭据。源码有未提交改动时也能准确包含，发布者须确认工作区与实际构建一致。

源码构建要求 Node.js 22.15+、npm、Git；解压后 `npm ci`、`npm test`、`npm run typecheck:overlay`、`npm run package`。归档已包含子模块源码，无须再执行 submodule update。Git 克隆则先执行 `git submodule update --init --recursive`。

如果提供通过网络交互的修改版服务，还需要按 AGPL 第 13 条提供相应源码获取方式。仅桌面本地使用不触发对外分发义务。此文档是项目的交付操作说明，许可证原文为准。
