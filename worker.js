/**
 * fal OpenRouter -> OpenAI 兼容代理
 * 
 * 功能：
 * - 将标准 OpenAI 格式的请求转换为 fal 格式
 * - 支持普通请求和流式响应
 * - 支持 CORS 跨域
 * - /v1/models 从 OpenRouter 官方获取实时模型列表
 * - 图像生成模型自动添加 modalities 参数
 * - 图像生成响应自动转换为 Markdown 图片格式（只返回第一张）
 * - 思考模型自动路由（xxx-thinking -> xxx + reasoning.enabled，不区分大小写）
 * 
 * 注意：fal 不支持 image_config 透传，图片固定为 1K (1024x1024)
 * 如需 2K/4K 分辨率，请直接使用 OpenRouter 或 Google Gemini API
 * 
 * 部署步骤：
 * 1. 登录 Cloudflare Dashboard
 * 2. 创建 Workers & Pages -> Create Worker
 * 3. 粘贴此代码并 Deploy
 * 4. 获取 Worker URL 使用
 */

const FAL_BASE_URL = "https://fal.run/openrouter/router/openai/v1";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

// 思考模型映射配置
// 格式: "虚拟模型名" -> "实际模型名"
// 当请求虚拟模型时，自动路由到实际模型并开启 reasoning
const THINKING_MODEL_MAPPINGS = {
  "deepseek/deepseek-v3.2-thinking": "deepseek/deepseek-v3.2",
  "deepseek/deepseek-chat-v3.1-thinking": "deepseek/deepseek-chat-v3.1:free",
  // 可以继续添加更多映射
};

// CORS 响应头
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 处理 CORS 预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 首页显示使用说明
    if (url.pathname === "/" || url.pathname === "") {
      return jsonResponse({
        service: "fal OpenRouter Proxy",
        version: "1.9.0",
        usage: {
          base_url: `${url.origin}/v1`,
          api_key: "your-fal-api-key",
          example: "client = OpenAI(base_url='此URL/v1', api_key='your-fal-key')",
        },
        endpoints: [
          "/v1/chat/completions",
          "/v1/embeddings",
          "/v1/models",
          "/v1/responses",
        ],
        features: [
          "思考模型自动路由（xxx-thinking -> xxx + reasoning.enabled，不区分大小写）",
          "图像生成模型自动添加 modalities 参数",
          "图像生成响应自动转换为 Markdown 图片格式（只返回第一张）",
          "从 OpenRouter 获取实时模型列表",
        ],
        thinking_models: THINKING_MODEL_MAPPINGS,
        limitations: [
          "fal 不支持 image_config 透传，图片固定为 1K (1024x1024)",
          "如需 2K/4K，请直接使用 OpenRouter 或 Google Gemini API",
        ],
        docs: "https://fal.ai/models/openrouter/router",
      });
    }

    // /v1/models 端点 - 从 OpenRouter 官方获取模型列表
    if (url.pathname === "/v1/models" || url.pathname === "/models") {
      return await fetchOpenRouterModels();
    }

    // 获取 API Key
    const falKey = extractApiKey(request, env);
    if (!falKey) {
      return jsonResponse(
        {
          error: {
            message: "Missing API key. Provide 'Authorization: Bearer YOUR_FAL_KEY' header",
            type: "authentication_error",
            code: "invalid_api_key",
          },
        },
        401
      );
    }

    // 构建目标 URL
    let targetPath = url.pathname;
    if (targetPath.startsWith("/v1")) {
      targetPath = targetPath.slice(3);
    }
    const targetUrl = `${FAL_BASE_URL}${targetPath}${url.search}`;

    // 构建请求 headers
    const headers = new Headers();
    headers.set("Authorization", `Key ${falKey}`);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", request.headers.get("Accept") || "application/json");
    
    // 透传 User-Agent
    const userAgent = request.headers.get("User-Agent");
    if (userAgent) {
      headers.set("User-Agent", userAgent);
    }

    const fetchOptions = {
      method: request.method,
      headers: headers,
    };

    // 处理请求体（POST/PUT）
    if (request.method === "POST" || request.method === "PUT") {
      try {
        const bodyText = await request.text();
        let body = JSON.parse(bodyText);
        
        // 处理思考模型路由
        if (body.model) {
          body = applyThinkingModelRouting(body);
        }
        
        // 为图像生成模型添加 modalities 参数
        if (body.model && isImageGenerationModel(body.model)) {
          if (!body.modalities || !Array.isArray(body.modalities)) {
            body.modalities = ["image", "text"];
          }
        }
        
        fetchOptions.body = JSON.stringify(body);
      } catch (e) {
        // JSON 解析失败，使用原始请求
        fetchOptions.body = request.body;
      }
    }

    try {
      const response = await fetch(targetUrl, fetchOptions);
      const contentType = response.headers.get("Content-Type") || "";

      // 构建响应 headers
      const responseHeaders = new Headers(CORS_HEADERS);
      if (contentType) {
        responseHeaders.set("Content-Type", contentType);
      }

      // 透传 Rate Limit headers
      const rateLimitHeaders = [
        "x-ratelimit-limit",
        "x-ratelimit-remaining",
        "x-ratelimit-reset",
      ];
      for (const h of rateLimitHeaders) {
        const val = response.headers.get(h);
        if (val) responseHeaders.set(h, val);
      }

      // 流式响应：直接透传 body
      if (contentType.includes("text/event-stream")) {
        return new Response(response.body, {
          status: response.status,
          headers: responseHeaders,
        });
      }

      // 非流式响应：检查并转换图像格式
      const data = await response.text();
      
      if (contentType.includes("application/json")) {
        try {
          const jsonData = JSON.parse(data);
          const transformedData = transformImageResponse(jsonData);
          return new Response(JSON.stringify(transformedData), {
            status: response.status,
            headers: responseHeaders,
          });
        } catch (e) {
          // JSON 解析失败，返回原始数据
        }
      }

      return new Response(data, {
        status: response.status,
        headers: responseHeaders,
      });

    } catch (error) {
      return jsonResponse(
        {
          error: {
            message: `Proxy error: ${error.message}`,
            type: "proxy_error",
            code: "upstream_error",
          },
        },
        502
      );
    }
  },
};

/**
 * 处理思考模型路由
 * 将 xxx-thinking 模型路由到实际模型并开启 reasoning
 */
function applyThinkingModelRouting(body) {
  const model = body.model;
  
  // 检查是否在映射表中
  if (THINKING_MODEL_MAPPINGS[model]) {
    body.model = THINKING_MODEL_MAPPINGS[model];
    body.reasoning = { enabled: true };
    return body;
  }
  
  // 通用规则：如果模型名以 -thinking 结尾（不区分大小写），自动处理
  const thinkingMatch = model.match(/-thinking$/i);
  if (thinkingMatch) {
    const actualModel = model.slice(0, -thinkingMatch[0].length);
    body.model = actualModel;
    body.reasoning = { enabled: true };
  }
  
  return body;
}

/**
 * 判断是否是图像生成模型
 */
function isImageGenerationModel(model) {
  if (!model) return false;
  const modelLower = model.toLowerCase();
  return modelLower.includes("-image") || modelLower.includes("image-");
}

/**
 * 转换图像生成响应
 * 将非标准的 images 字段转换为 Markdown 图片格式
 * 只返回第一张图片，避免重复
 */
function transformImageResponse(data) {
  if (!data?.choices?.length) return data;

  for (const choice of data.choices) {
    const message = choice.message;
    if (!message?.images?.length) continue;

    // 构建 Markdown 格式的内容
    let content = "";

    // 保留原有文本
    if (message.content && typeof message.content === 'string' && message.content.trim()) {
      content = message.content.trim() + "\n\n";
    }

    // 只取第一张图片
    const img = message.images[0];
    const url = img?.image_url?.url || img?.image_url;
    if (url) {
      content += `![Generated Image](${url})`;
    }

    message.content = content.trim();
    delete message.images;
  }

  return data;
}

/**
 * 从 OpenRouter 官方获取模型列表
 */
async function fetchOpenRouterModels() {
  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "fal-openai-proxy/1.9.0",
      },
    });

    if (!response.ok) {
      return jsonResponse(
        { error: { message: `Failed to fetch models: ${response.status}`, type: "upstream_error" } },
        response.status
      );
    }

    return jsonResponse(await response.json());
  } catch (error) {
    return jsonResponse(
      { error: { message: `Failed to fetch models: ${error.message}`, type: "upstream_error" } },
      502
    );
  }
}

/**
 * 从请求中提取 API Key
 */
function extractApiKey(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
  if (authHeader.startsWith("Key ")) return authHeader.slice(4);
  return env.FAL_KEY || "";
}

/**
 * 返回 JSON 响应
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
