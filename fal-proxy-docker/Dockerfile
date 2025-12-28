# fal-proxy Docker 镜像
# 基于 Deno 官方 Alpine 镜像，体积小且安全

FROM denoland/deno:alpine-2.1.4

LABEL maintainer="fal-proxy"
LABEL version="1.12.0"
LABEL description="fal OpenRouter to OpenAI compatible proxy"

WORKDIR /app

# 复制源码
COPY server.ts .

# 预缓存依赖（Deno 会自动下载外部依赖）
RUN deno cache server.ts

# 暴露端口
EXPOSE 8787

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8787/ || exit 1

# 运行服务
# --allow-net: 允许网络请求（代理必需）
# --allow-env: 允许读取环境变量（FAL_KEY、PORT）
CMD ["deno", "run", "--allow-net", "--allow-env", "server.ts"]

