# 部署说明

## 1. 架构：一个容器，一个端口，一个域名

线上只有**一个进程**：`packages/server` 既跑 socket.io 转发器，也用 express 托管
`packages/client/dist` 里的前端静态文件，两者共用 `PORT`（默认 3001）。

```
浏览器 ──┬── GET /            → express.static → packages/client/dist
         ├── GET /任意路径     → 回退到 index.html（前端路由自己接管）
         ├── GET /healthz     → 200 ok（平台存活探针）
         └── /socket.io/*     → socket.io（挂在同一个 http.Server 上）
```

这么设计是因为部署目标 ClawCloud Run 的免费档只有约 1C/1G。拆成"前端静态站点 + 后端服务"
要占两份资源、两个域名，还得处理跨域；合成一个之后前端和 socket **天然同源**，
`cors` 那一条配置纯粹是留给本地开发的（Vite dev server 在 5173 端口）。

代价是前端和后端绑死在一起发版：改一行 CSS 也要重新构建整个镜像。黑客松阶段这不是问题。

### 请求的先后顺序有个坑

socket.io 挂到 `http.Server` 上时会**抢先接管** `request` 事件，只有不属于它的请求才往下
交给 express。所以 SPA 回退那条通配路由永远看不到 `/socket.io/*` 的握手请求，
不需要在里面特意排除它。

### Express 5 的通配符写法

`packages/server/src/index.ts` 里 SPA 回退写的是 `app.get('/{*splat}', ...)`。
Express 5 换成了 path-to-regexp v8，**Express 4 时代的 `app.get('*')` 会直接抛异常**。
花括号表示"零个或多个路径段"，这样根路径 `/` 也能兜住。

## 2. 镜像

`ghcr.io/fomalhautb/ai-duel`，两个 tag：

- `latest` —— 永远指向 main 的最新一次构建。
- `<commit sha>` —— 部署时真正用的那个，这样回滚就是改成上一个 sha 重新 `set image`。

镜像基于 `node:22-alpine`，多阶段构建，最终约 180MB，以非 root 的 `node` 用户运行。

### 为什么镜像里放的是 TypeScript 源码

这个仓库**三个包都不经过 tsc 产出 JS**（见 `docs/architecture.md` 第 2 节）：
client 交给 Vite 打包，core 的 `exports` 直接指向 `src/index.ts`，
而 server 的源码就这么原样跑在 `tsx` 上。

所以有两条容易踩的约束：

- **`tsx` 必须在 `dependencies` 里，不能放 `devDependencies`**，否则 `pnpm install --prod`
  装出来的镜像根本起不来。
- 镜像里拷贝的是 `packages/server/src`，不是什么 `dist`。

（`packages/core/src` **没有**拷进运行阶段：server 不依赖 core，它根本不需要知道游戏是什么。
哪天 server 真的 import 了 core，Dockerfile 和 `packages/server/package.json` 要一起改。）

### 为什么必须保持 packages/* 的目录结构

server 用 `new URL('../../client/dist/', import.meta.url)` 定位前端产物，只有一条相对路径，
没有分环境的分支。这条路径在本地 pnpm 开发和容器里都成立，前提是镜像里
`packages/server/src` 和 `packages/client/dist` 的相对位置和仓库里一样。
调整 Dockerfile 的 COPY 目标时别把这个关系破坏了。

### pnpm 的 node_modules 是符号链接

运行阶段同时拷了 `/app/node_modules` 和 `/app/packages/server/node_modules`，
而且工作目录固定在 `/app`。pnpm 装出来的包是指向根部 `.pnpm` 仓库的**相对符号链接**，
少拷一个、或者换个工作目录，链接就断了。

运行阶段用的是 `pnpm install --prod --frozen-lockfile --filter @ai-duel/server`，
把 client 那一大坨前端依赖挡在外面。但 `packages/client/package.json` 和
`packages/core/package.json` 仍然要 COPY 进去——少了它们 `--frozen-lockfile`
会认为工作区和锁文件对不上而报错。

## 3. 自动部署链路

`.github/workflows/deploy.yml`，触发条件是 push 到 `main` 或手动 `workflow_dispatch`：

```
push main → docker buildx 构建 linux/amd64 → 推 GHCR（latest + sha）
          → kubectl set image deployment/ai-duel ai-duel=<image>:<sha>
          → kubectl rollout status --timeout=5m
```

几个要点：

- **固定 `platforms: linux/amd64`**，ClawCloud 的节点是 x86。
- 用内置的 `GITHUB_TOKEN` 登录 ghcr.io，不需要额外的 registry 凭据（靠
  `permissions: packages: write`）。
- 开了 `cache-from/cache-to: type=gha`，命中缓存时 pnpm install 那一层可以跳过。
- **不指定 namespace**：ClawCloud 发的 kubeconfig 里 context 自带默认 namespace，
  写死反而会跟平台对不上。
- 部署用 sha 而不是 `latest`。Kubernetes 只有镜像引用变了才会触发滚动更新，
  一直推 `latest` 的话 `set image` 是空操作，Pod 不会重启。

### GHCR 上的镜像默认是私有的

第一次推送后，镜像包的可见性是 private，Kubernetes 拉不到。要么在 GitHub 的
Package settings 里把它改成 public（这个项目没什么可藏的，推荐），
要么在 ClawCloud 那边配一个 `imagePullSecret`。

### 需要的 GitHub secret

只有一个：**`CLAWCLOUD_KUBECONFIG`**，内容是 ClawCloud 控制台给的完整 kubeconfig 文本。

工作流会先在一个 step 里把"这个 secret 存不存在"写成 output，再用它控制部署 step 的 `if`。
这么绕是因为 **GitHub Actions 不允许在 job 级 `if` 里直接引用 `secrets`**。
好处是：secret 还没配好的时候，工作流照样绿着跑完，只是跳过滚动更新并打印一行提示，
镜像该推的还是推上去了——第一次把这些改动合进 main 时不会红一片。

kubeconfig 是从环境变量 `printf` 进临时文件的（`umask 077`），不走命令行参数，
避免内容出现在日志里。

### ClawCloud 那边需要先手工准备

工作流只负责**更新**已存在的 Deployment，不负责创建。第一次要在 ClawCloud 控制台建好：

- Deployment 名字 `ai-duel`，容器名也叫 `ai-duel`（`kubectl set image` 靠这两个名字定位）。
- 容器端口 3001，对外暴露 HTTP。
- 存活/就绪探针指向 `GET /healthz`。

## 4. 本地验证镜像

```bash
docker build -t ai-duel:test .
docker run --rm -p 3001:3001 ai-duel:test
```

另开一个终端：

```bash
curl -i http://localhost:3001/healthz                          # 200 ok
curl -I http://localhost:3001/                                 # 200 text/html
curl -I http://localhost:3001/随便一个不存在的路径              # 200 text/html（SPA 回退）
curl 'http://localhost:3001/socket.io/?EIO=4&transport=polling' # 0{"sid":...}
```

宿主机上的 `node_modules` 和 `dist` 被 `.dockerignore` 挡在外面了——它们是 macOS 平台的产物，
带进镜像会覆盖里面装好的 Linux 依赖。
