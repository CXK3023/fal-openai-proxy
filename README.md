# fal OpenRouter Proxy v1.5.1

通过 Cloudflare Worker 将 fal.ai 的 OpenRouter 转换为标准 OpenAI API 格式。

## 功能特性

- ✅ 标准 OpenAI API 格式（Bearer 认证）
- ✅ 流式输出 (Streaming)
- ✅ 图片识别 (Vision)
- ✅ 思考模式 (Reasoning)
- ✅ 文本向量化 (Embeddings)
- ✅ 多轮对话
- ✅ CORS 跨域支持
- ✅ 图像生成响应自动转换为 Markdown 格式（只返回第一张）
- ✅ 从 OpenRouter 官方获取实时模型列表

## 文件说明

| 文件 | 说明 |
|------|------|
| `worker.js` | CF Worker 代码，复制到 Cloudflare 部署 |
| `test_quick.py` | 快速测试脚本（基本功能） |
| `test_simple.py` | 简单测试脚本（对话+流式） |
| `test_full.py` | 完整功能测试脚本 |
| `test_image.py` | 图像生成测试脚本 |

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

```python
response = client.chat.completions.create(
    model="google/gemini-3-pro-image-preview",
    messages=[{"role": "user", "content": "画一只猫"}],
)
# 图片会以 Markdown 格式返回在 content 中
print(response.choices[0].message.content)
```

### Embeddings

```python
response = client.embeddings.create(
    model="openai/text-embedding-3-small",
    input="要向量化的文本",
)
vector = response.data[0].embedding
```

## 接入第三方应用

### new-api / one-api

| 配置项 | 值 |
|--------|-----|
| 渠道类型 | OpenAI |
| 代理地址 | `https://your-worker.workers.dev` |
| 密钥 | 你的 fal API Key |

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

## 常用模型

| 模型 | 特点 |
|------|------|
| `google/gemini-2.0-flash-001` | 快速、便宜、支持图片 |
| `google/gemini-2.5-flash` | 支持深度思考推理 |
| `google/gemini-3-pro-image-preview` | 图像生成 |
| `anthropic/claude-3-5-sonnet-latest` | 最强编程能力 |
| `anthropic/claude-3-5-haiku-latest` | Claude 快速版 |
| `openai/gpt-4o` | GPT-4o |
| `openai/gpt-4o-mini` | 性价比高 |
| `x-ai/grok-4.1-fast:free` | 免费模型 |
| `openai/text-embedding-3-small` | Embeddings |

## 版本历史

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
