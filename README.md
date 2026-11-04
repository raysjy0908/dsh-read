# DeepSeek Harness 论文阅读器

适用于提供原生右侧栏标签接口的 DeepSeek Harness。按桌面版 0.2.1-rc.2 的接口开发。

## 安装

在 PowerShell 中进入安装包所在目录，运行以下命令。若尚未启用 `dsh` 命令，可在 Harness 的桌面菜单中安装命令行命令，或直接调用安装目录下的 `resources\runtime\cli\bin\dsh.cmd`。

```powershell
dsh plugin --profile desktop add (Resolve-Path .\dsh-paper-reader-0.1.0.tgz).Path
```

退出并重新打开 Harness。进入一个会话，打开右侧栏，点标签栏的「＋」，选择「论文阅读器」。使用 Web profile 时，把安装命令中的 `desktop` 改为 `web`。

## 阅读与批注

- 「导入 PDF」将原始文件保存到当前 Harness 界面的本地资料库。可从下拉菜单重新打开已导入的论文，也可下载原件。
- 阅读器使用 PDF.js 6.3.289 按页渲染原 PDF，保留页面尺寸、嵌入字体、公式、图表和图片。未嵌入的字体由渲染器按可用字体替代。原文件字节保持原样。
- 在文字上拖动选择后，浮动菜单提供「高亮」「添加笔记」和「在会话中提问」。标注独立存储，可在标注面板定位和删除。纯图片扫描件需要先具有可选文字层，才能使用选区操作。
- 「在会话中提问」把文件名、PDF 页码和选段写入当前会话草稿。默认模板跟随 Harness 自带的简体中文和英文界面，可编辑后发送。第三方界面语言包使用英文模板。
- 论文及标注保存在当前界面来源的 IndexedDB 中。清除该来源的应用数据会移除本地资料库。

PDF.js 以 Apache-2.0 授权分发，相关许可位于 `vendor`。

## ChatGPT 适配版

`chatgpt/` 提供 ChatGPT 的 MCP 服务和阅读界面，复用同一套 PDF 阅读、标注和笔记功能。应用同时声明侧边栏和会话面板入口，实际入口取决于 ChatGPT 客户端和账号支持。

PDF 和批注保存在阅读器所在浏览器的本地存储。两个平台的本地论文库各自独立。在 ChatGPT 适配版中，点击「在会话中提问」会打开可编辑的提问框，确认「发送到会话」后才通过宿主发送。建议在会话面板里使用提问；若当前宿主不支持发送，可复制提问到会话。默认模板使用宿主界面的简体中文或英文。

### 本地运行

需要 Node.js 22 或更新版本。

```powershell
cd chatgpt
npm ci
npm run build
npm start
```

打开 [本地阅读器预览](http://localhost:8787/) 可导入 PDF 和批注。会话发送需要 MCP 宿主连接。

### 接入 ChatGPT

1. 使用 HTTPS 部署服务，或配置 [Secure MCP Tunnel](https://developers.openai.com/plugins/deploy/connect-chatgpt)。服务的默认监听地址是 `127.0.0.1`。在支持公网部署的容器里可把 `HOST` 设为 `0.0.0.0`。
2. 将 `PAPER_READER_URL` 设为界面可访问的 HTTPS 源地址，例如 `https://reader.example.com`。阅读界面需要从该地址加载组件和 PDF.js 资源。MCP 地址为 `<源地址>/mcp`。当前服务只提供静态资源和打开阅读器的工具，PDF 文件本身在浏览器内处理。
3. 在 [ChatGPT 插件](https://chatgpt.com/plugins) 选择「＋ → 添加自定义 MCP 服务器」，连接服务器并安装。若侧边栏入口不可用，可在支持插件的会话中选择该插件并让它打开论文阅读器。账号和工作区规则决定自定义服务器及界面扩展是否可用。

在测试宿主中已验证 MCP 工具发现、PDF 导入、高亮、笔记、原件下载和中文提问交给会话。首次接入 ChatGPT 时需在目标客户端验证入口及发送能力。
