# fal OpenRouter Proxy v1.13.0

通过 Cloudflare Worker 将 fal.ai 的 OpenRouter 转换为标准 OpenAI API 格式。

## 功能特性

### 核心功能
- ✅ 标准 OpenAI API 格式（Bearer 认证）
- ✅ 流式输出 (Streaming)
- ✅ 图片识别 (Vision)
- ✅ 文本向量化 (Embeddings)
- ✅ 多轮对话
- ✅ CORS 跨域支持

### 智能模型路由
- ✅ **思考模型自动路由**：`xxx-thinking` → `xxx` + `reasoning.enabled`（不区分大小写）
  - 例如：`deepseek/deepseek-v3.2-thinking` 自动转换为基础模型并启用推理模式
- ✅ **图像生成模型自动识别**：自动添加 `modalities: ["image", "text"]` 参数

### 图像生成增强
- ✅ **智能 image_config**（仅 Gemini/Seedream）：
  - 默认配置：4K 分辨率 + 1:1 宽高比
  - 从提示词自动解析：1K/2K/4K、16:9/9:16/1:1 等
  - 支持中文关键词：横屏/竖屏/方形
  - 优先级：提示词 > 请求参数 > 默认值
- ✅ **图像响应转换**：自动转换为 Markdown 格式（只返回第一张）

### 实用工具
- ✅ **实时模型列表**：从 OpenRouter 官方 API 获取（含完整图像模型）
- ✅ **余额查询**：OpenAI 兼容格式（供 NewAPI 等工具使用）
- ✅ **通用 CORS 代理**：`/proxy?url=xxx` 转发任意请求

## 文件说明

| 文件 | 说明 |
|------|------|
| `worker.js` | CF Worker 代码，复制到 Cloudflare 部署 |


## 部署步骤

### 1. 创建 Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages**
3. 点击 **Create** -> **Create Worker**
4. 给 Worker 起名（如 `fal-openai-proxy`）
5. 点击 **Deploy**

### 2. 编辑代码

1. 点击 **Edit code**
2. 删除默认代码，粘贴 `worker.js` 内容
3. 点击 **Save and Deploy**

### 3. 获取 URL

部署后会得到类似：
```
https://fal-openai-proxy.your-name.workers.dev
```

### 4. (可选) 设置默认 Key

在 Worker 的 **Settings** -> **Variables and Secrets** 添加：
- Name: `FAL_KEY`
- Value: 你的 fal API Key
- Type: Encrypt

## 使用方式

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-worker.workers.dev/v1",
    api_key="your-fal-api-key",
)

response = client.chat.completions.create(
    model="google/gemini-2.0-flash-001",
    messages=[{"role": "user", "content": "你好"}],
)

print(response.choices[0].message.content)
```

### 流式输出

```python
stream = client.chat.completions.create(
    model="google/gemini-2.0-flash-001",
    messages=[{"role": "user", "content": "写一首诗"}],
    stream=True,
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

### 图片识别

```python
response = client.chat.completions.create(
    model="google/gemini-2.0-flash-001",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "描述这张图片"},
            {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}},
        ],
    }],
)
```

### 图像生成

#### 基础使用
```python
response = client.chat.completions.create(
    model="google/gemini-3-pro-image-preview",
    messages=[{"role": "user", "content": "画一只猫"}],
)
# 图片会以 Markdown 格式返回在 content 中
print(response.choices[0].message.content)
```

#### 智能 image_config（Gemini/Seedream）
提示词中直接指定分辨率和宽高比，无需手动配置：

```python
# 从提示词自动解析配置
response = client.chat.completions.create(
    model="google/gemini-3-pro-image-preview",
    messages=[{"role": "user", "content": "画一只猫，4K，横屏"}],
)
# 自动应用：image_config = {"image_size": "4K", "aspect_ratio": "16:9"}

# 支持的关键词
# 分辨率：1K、2K、4K
# 宽高比：16:9、9:16、1:1、4:3、3:4
# 中文：横屏(16:9)、竖屏(9:16)、方形(1:1)
```

#### 手动配置（所有图像模型）
```python
response = client.chat.completions.create(
    model="bytedance-seed/seedream-4.5",
    messages=[{"role": "user", "content": "画一只猫"}],
    image_config={"image_size": "2K", "aspect_ratio": "9:16"},
)
```

### Embeddings

```python
response = client.embeddings.create(
    model="openai/text-embedding-3-small",
    input="要向量化的文本",
)
vector = response.data[0].embedding
```

### 思考模型（Reasoning）

只需在模型名后加 `-thinking` 后缀，自动启用推理模式：

```python
# 方式一：使用 -thinking 后缀（推荐）
response = client.chat.completions.create(
    model="deepseek/deepseek-v3.2-thinking",  # 自动路由到 deepseek-v3.2 + reasoning
    messages=[{"role": "user", "content": "解释量子纠缠"}],
)

# 方式二：手动配置（也支持）
response = client.chat.completions.create(
    model="deepseek/deepseek-v3.2",
    messages=[{"role": "user", "content": "解释量子纠缠"}],
    reasoning={"enabled": True},
)
```

## 接入第三方应用

### new-api / one-api

| 配置项 | 值 |
|--------|-----|
| 渠道类型 | OpenAI |
| 代理地址 | `https://your-worker.workers.dev` |
| 密钥 | 你的 fal API Key |

**思考模型配置**：在模型名称后加 `-thinking` 后缀即可启用推理模式
- 例如：`deepseek/deepseek-v3.2-thinking`

### ChatGPT-Next-Web / Cherry Studio

```
接口地址: https://your-worker.workers.dev
API Key: 你的 fal API Key
自定义模型: google/gemini-2.0-flash-001
```

### LobeChat / ChatBox

```
API 代理地址: https://your-worker.workers.dev/v1
API Key: 你的 fal API Key
```

## 高级功能

### 通用 CORS 代理

使用 `/proxy` 端点转发任意请求并自动添加 CORS 头：

```bash
# 查询 fal.ai 模型使用情况
curl "https://your-worker.workers.dev/proxy?url=https://api.fal.ai/v1/models/usage" \
  -H "Authorization: Key your-fal-api-key"

# 支持 POST 请求
curl "https://your-worker.workers.dev/proxy?url=https://api.example.com/data" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'
```

**特性**：
- 支持 GET/POST/PUT/DELETE 等所有方法
- 自动透传请求头和响应头
- 添加 CORS 头，解决跨域问题

### 余额查询（OpenAI 兼容格式）

```python
# 订阅信息
response = client.get("https://your-worker.workers.dev/v1/dashboard/billing/subscription")

# 额度详情
response = client.get("https://your-worker.workers.dev/v1/dashboard/billing/credit_grants")

# 使用情况
response = client.get("https://your-worker.workers.dev/v1/dashboard/billing/usage")
```

这些端点返回 OpenAI 兼容的余额格式，可直接在 NewAPI 等工具中使用。


## 版本历史

- **v1.13.0** (Current)
  - ✨ 新增通用 CORS 代理端点 `/proxy?url=xxx`
  - ✨ 思考模型自动路由（`-thinking` 后缀）
  - ✨ 智能 image_config（从提示词解析，支持中文关键词）
  - ✨ 余额查询端点（OpenAI 兼容格式）
  - 🔧 合并 OpenRouter frontend API 图像模型列表
  - 🔧 图像生成模型自动添加 modalities 参数
- **v1.5.1** - 代码优化，版本号统一
- **v1.5.0** - 图像生成只返回第一张图片
- **v1.4.0** - 图像生成响应转换为 Markdown 格式
- **v1.3.0** - 支持图像生成模型
- **v1.2.0** - 从 OpenRouter 官方获取模型列表
- **v1.0.0** - 基础代理功能

## 参考链接

- [fal.ai OpenRouter](https://fal.ai/models/openrouter/router)
- [fal.ai 文档](https://docs.fal.ai)
- [OpenRouter](https://openrouter.ai)
- [OpenRouter 模型列表](https://openrouter.ai/models)

## 支持的模型

### 对话模型（部分示例）
- `google/gemini-2.0-flash-001` - Google Gemini 2.0 Flash
- `deepseek/deepseek-v3.2` - DeepSeek V3.2
- `deepseek/deepseek-v3.2-thinking` - DeepSeek V3.2 + 推理模式
- `anthropic/claude-3.5-sonnet` - Claude 3.5 Sonnet
- `openai/gpt-4o` - GPT-4 Omni

### 图像生成模型（部分示例）
- `google/gemini-3-pro-image-preview` - Gemini 3 Pro Image（支持智能 config）
- `google/gemini-2.5-flash-image` - Gemini 2.5 Flash Image
- `bytedance-seed/seedream-4.5` - Seedream 4.5（支持智能 config）
- `black-forest-labs/flux.2-pro` - FLUX.2 Pro
- `openai/gpt-5-image` - GPT-5 Image

完整模型列表请访问：`https://your-worker.workers.dev/v1/models`

## 注意事项

- Gemini 4K 图像生成可能因 Cloudflare Worker 超时限制（100秒）失败
- Seedream 4.5 4K 正常工作（约 15 秒完成）
- 智能 image_config 仅对 Gemini 和 Seedream 模型生效，其他模型需手动配置
- 思考模型映射关系可在首页查看：`https://your-worker.workers.dev/`
