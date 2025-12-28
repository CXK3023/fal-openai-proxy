# fal-proxy Docker 部署

将 fal.ai OpenRouter 代理部署到你自己的服务器。

## 功能

- ✅ OpenAI 兼容 API 格式
- ✅ 支持流式响应
- ✅ 图像生成模型自动配置（Gemini/Seedream 默认 4K）
- ✅ 思考模型自动路由（xxx-thinking）
- ✅ 完整模型列表（含图像模型）
- ✅ 账户余额查询
- ✅ **无超时限制**（相比 CF Worker 100s 限制）

## 快速部署

```bash
# 1. 进入目录
cd fal-proxy-docker

# 2. 构建镜像
docker compose build

# 3. 启动服务
docker compose up -d

# 4. 查看日志
docker compose logs -f
```

## 配置

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `8787` |
| `FAL_KEY` | 默认 fal.ai API Key（可选） | 无 |

### 修改端口

编辑 `docker-compose.yml`:

```yaml
ports:
  - "9000:9000"  # 改为你想要的端口
environment:
  - PORT=9000
```

### 设置默认 API Key

如果你希望所有请求使用同一个 API Key，可以设置环境变量：

```yaml
environment:
  - FAL_KEY=your-fal-api-key
```

## 使用方式

### API 地址

```
http://你的服务器IP:8787/v1
```

### 在 NewAPI 中配置

1. 添加新渠道
2. 类型选择 **OpenAI**
3. 上游地址填写：`http://localhost:8787/v1`（如果在同一服务器）
4. 密钥填写你的 fal.ai API Key

### 在 CherryStudio 中配置

```
API 地址: http://你的服务器IP:8787/v1
API Key: 你的 fal.ai API Key
```

### Python 示例

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://你的服务器IP:8787/v1",
    api_key="your-fal-api-key"
)

# 文本生成
response = client.chat.completions.create(
    model="deepseek/deepseek-chat",
    messages=[{"role": "user", "content": "你好"}]
)

# 图像生成（自动 4K）
response = client.chat.completions.create(
    model="bytedance-seed/seedream-4.5",
    messages=[{"role": "user", "content": "一只可爱的猫咪"}]
)
```

## 端点列表

| 端点 | 说明 |
|------|------|
| `GET /` | 服务信息和使用说明 |
| `GET /v1/models` | 获取模型列表 |
| `POST /v1/chat/completions` | 聊天补全 |
| `POST /v1/embeddings` | 文本嵌入 |
| `GET /v1/dashboard/billing/subscription` | 余额查询 |

## 运维命令

```bash
# 查看状态
docker compose ps

# 查看日志
docker compose logs -f

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 更新代码后重新部署
docker compose build --no-cache
docker compose up -d
```

## 与 NewAPI 同网络

如果 NewAPI 使用自定义 Docker 网络，编辑 `docker-compose.yml`:

```yaml
services:
  fal-proxy:
    # ... 其他配置 ...
    networks:
      - newapi_default  # 改为 NewAPI 的网络名

networks:
  newapi_default:
    external: true
```

然后在 NewAPI 中使用内网地址：`http://fal-proxy:8787/v1`

## 故障排查

### 检查服务是否正常

```bash
curl http://localhost:8787/
```

### 测试 API

```bash
curl http://localhost:8787/v1/models | head
```

### 查看容器日志

```bash
docker compose logs --tail=100
```

