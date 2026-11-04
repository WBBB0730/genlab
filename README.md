# GenLab

给本地 agent（Claude Code、Codex 等）用的 AI 媒体生成命令行工具。通过 [Kie.ai](https://kie.ai) 生成图片、视频、音频（音乐、音效、语音），产物与完整生成记录保存在本机的库里。

## 安装与配置

需要 Node.js 22.19 及以上。推荐用 npx 运行，每次都是最新版本；下文的 `genlab` 均可写作 `npx -y genlab@latest`。也可 `npm install -g genlab` 全局安装，需自行更新。

```bash
genlab init                                          # 交互填写 API Key 与库目录
genlab init --key <KIE_API_KEY> --library ~/GenLab   # 或直接给出
```

配置写入 `~/.config/genlab/.env`，同名环境变量优先。

## 给 agent 使用

agent 使用前先运行 `genlab guide`：它输出完整用法（概念、流程、参数写法、命令参考），内容总与当前版本一致。

可选安装 GenLab skill，`genlab init` 时会询问，也可单独管理：

```bash
genlab skill          # 安装
genlab skill update   # 更新
genlab skill remove   # 卸载
```

库目录在代码项目之外。agent 在沙箱里运行时，需要允许它读写库目录与 `~/.cache/genlab`，并访问网络。

## 示例

```bash
# 新建项目，把当前目录关联到它
genlab project create pixel-quest
genlab project link pixel-quest

# 找模型，查看价格与参数表
genlab models --kind image --search gpt-image
genlab models gpt-image-2-5-sunburst-text-to-image

# 新建素材，一次出 4 张（v1–v4）
genlab create characters/hero -m gpt-image-2-5-sunburst-text-to-image -p prompt="像素风骑士立绘" -n 4

# 对 v2 做 AI 编辑（产出 v5），把 v3 设为当前版本
genlab edit characters/hero 2 -m gpt-image-2-5-sunburst-image-to-image -p prompt="盔甲改成蓝色" -p input_urls=@source
genlab use characters/hero 3

# 以 v3 为首帧生成视频
genlab create intro/shot -m wan/3-0-video -p prompt="骑士转身拔剑" -p first_frame_url=@<库目录>/pixel-quest/characters/hero/v3.png
```

参数用 `-p key=value`（`key:=JSON` 传 JSON 值，同键重复即数组），参数名以 `genlab models <模型>` 的参数表为准；值写 `@<路径>` 上传本机文件，`@source` 引用 AI 编辑的源版本。

## 项目与库

代码项目用 `genlab project link <项目>` 关联到库里的项目，关联记在代码项目的 `.genlab/` 里（自带忽略文件，不会被 git 提交）。未关联时素材命令会报错；不属于任何代码项目的素材放进内置项目 `default`。

库就是普通文件夹，可以直接在文件管理器里浏览、改名、移动、删除：

```
<库目录>/
  <项目>/<文件夹…>/<素材>/
    asset.json                  素材、生成、版本的完整记录
    v1.png  v2.png …            各版本产物
    references/<生成编号>/      参考输入副本
```

## 模型

模型清单与参数取自 Kie.ai 的模型目录，本地缓存一天，`genlab models --refresh` 强制刷新。支持 Kie.ai 上的图片、视频、音频生成模型，不支持对话模型。

## 开发

```bash
pnpm install
pnpm dev <命令>      # 直接运行源码
pnpm test
pnpm lint
pnpm typecheck
pnpm check           # 检查格式
pnpm format          # 格式化并自动修复
pnpm build
pnpm link --global   # 本机全局使用开发版
```

## 发布

```bash
pnpm release   # bumpp：改版本号、提交、打 tag 并推送
```

推送 `v*` tag 后由 GitHub Actions 经 npm Trusted Publishing 发布，tag 含 `-beta` 时以 `beta` 标签发布。

设计文档：术语表 [CONTEXT.md](CONTEXT.md)、命令行约定 [DESIGN.md](DESIGN.md)、需求 [docs/prd](docs/prd)、架构决策 [docs/adr](docs/adr)。
