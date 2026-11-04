# genlab

给本地 agent（Claude Code、Codex 等）用的 AI 媒体生成命令行工具。通过 [kie.ai](https://kie.ai) 生成图片、视频、音频（音乐、音效、语音），产物与完整生成记录保存在本机的库里。

## 安装

需要 Node.js 22.19 及以上。推荐直接用 npx 运行，每次都是最新版本；下文的 `genlab` 均可写作 `npx -y genlab@latest`。

```bash
npx -y genlab@latest <命令>
npm install -g genlab   # 也可全局安装，需自行更新
```

初始化配置（API Key 与库目录，写入 `~/.config/genlab/.env`，同名环境变量优先）：

```bash
genlab init
# 或：genlab init --key <KIE_API_KEY> --library ~/GenLab
```

可选：安装 skill，让 agent 需要生成媒体时自动想到 genlab（完整用法由 `genlab guide` 输出，不依赖 skill）。`genlab init` 时会询问，也可单独运行：

```bash
genlab skill          # 安装；重复运行即更新（即 npx skills add WBBB0730/genlab -g -s genlab）
genlab skill remove   # 卸载
```

## 用法

```bash
genlab models --kind image --search gpt-image
genlab models gpt-image-2-5-sunburst-text-to-image      # 价格与参数表
genlab create 角色/主角立绘 -m gpt-image-2-5-sunburst-text-to-image -p prompt="像素风骑士立绘" -n 4
genlab edit 角色/主角立绘 2 -m gpt-image-2-5-sunburst-image-to-image -p prompt="盔甲改成蓝色" -p input_urls=@source
genlab use 角色/主角立绘 3
genlab create 片头/镜头 -m wan/3-0-video -p prompt="骑士转身拔剑" -p first_frame_url=@<库>/<项目>/角色/主角立绘/v3.png
genlab list
```

参数用 `-p key=value`（`key:=JSON` 传 JSON 值，同键重复即数组）；值写 `@<路径>` 上传本机文件，`@source` 引用 AI 编辑的源版本。

完整用法见 `genlab guide`。

## 库

```
<GENLAB_LIBRARY>/
  projects.json                 代码项目 → 项目的映射
  <项目>/<文件夹…>/<素材>/
    asset.json                  素材、生成、版本的完整记录
    v1.png  v2.png …            各版本产物
    references/<生成编号>/      参考输入副本
```

项目由当前代码项目自动确定：有远程仓库时取仓库名，没有时用 `genlab project <名字>` 登记一次。

## 模型

模型清单与参数实时取自 kie 的模型目录与 schema（缓存一天，`genlab models --refresh` 强制刷新），覆盖 kie 上全部图片、视频、音频模型。

## 开发

```bash
pnpm install
pnpm dev <命令>      # 直接运行源码
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm link --global   # 本机全局使用开发版
```

## 发布

推送 `v*` tag 后由 GitHub Actions 发布到 npm，tag 含 `-beta` 时以 `beta` 标签发布。首次使用前需在 npmjs.com 为本包配置 Trusted Publishing，指向 `.github/workflows/publish.yml`。

```bash
pnpm release   # bumpp：改版本号、提交、打 tag 并推送
```

设计文档：[CONTEXT.md](CONTEXT.md)、[DESIGN.md](DESIGN.md)、[docs/prd](docs/prd)、[docs/adr](docs/adr)。
