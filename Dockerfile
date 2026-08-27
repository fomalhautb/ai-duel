# 前端静态文件和 socket.io 转发器打包进同一个镜像、同一个进程、同一个端口。
# 详见 docs/deploy.md。

FROM node:22-alpine AS base
WORKDIR /app

# 只装依赖的中间层：先单独 COPY 各个 package.json，改业务代码时这一层能命中缓存。
FROM base AS deps
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/

# 构建阶段要完整依赖（vite、typescript 这些都在 devDependencies 里）。
FROM deps AS build-deps
RUN pnpm install --frozen-lockfile

# 运行阶段只要 server 的生产依赖。--filter 把 client 那一大坨前端依赖挡在外面，
# 但 client/core 的 package.json 仍然要在场，否则 --frozen-lockfile 会认为工作区和锁文件对不上。
FROM deps AS prod-deps
RUN pnpm install --prod --frozen-lockfile --filter @ai-duel/server

FROM build-deps AS builder
COPY . .
RUN pnpm --filter @ai-duel/client build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3001

# pnpm 的 node_modules 是符号链接指向根部的 .pnpm 仓库，两边都得拷，
# 而且工作目录必须还是 /app，否则那些相对链接会断。
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/server/node_modules ./packages/server/node_modules

# server 的源码不编译，由 tsx 在运行时直接跑 TypeScript，所以镜像里放的是 src 而不是产物。
COPY package.json tsconfig.base.json ./
COPY packages/server/package.json packages/server/tsconfig.json ./packages/server/
COPY packages/server/src ./packages/server/src

# 保持 packages/client/dist 这个相对位置，server 里那条 '../../client/dist' 才算得对。
COPY --from=builder /app/packages/client/dist ./packages/client/dist

USER node
EXPOSE 3001
CMD ["packages/server/node_modules/.bin/tsx", "packages/server/src/index.ts"]
