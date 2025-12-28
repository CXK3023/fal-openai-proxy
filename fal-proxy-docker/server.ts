/**
 * fal OpenRouter -> OpenAI 兼容代理 (Deno 版本)
 *
 * 功能：
 * - 将标准 OpenAI 格式的请求转换为 fal 格式
 * - 支持普通请求和流式响应
 * - 支持 CORS 跨域
 * - /v1/models 从 OpenRouter 获取完整模型列表（含图像模型）
 * - 图像生成模型自动添加 modalities 参数
 * - 智能 image_config（仅 Gemini/Seedream）：默认 4K 1:1，支持从提示词解析
 * - 图像生成响应自动转换为 Markdown 图片格式（只返回第一张）
 * - 思考模型自动路由（xxx-thinking -> xxx + reasoning.enabled，不区分大小写）
 *
 * 智能 image_config（仅 Gemini/Seedream）优先级：提示词 > 请求参数 > 默认值(4K, 1:1)
 * 支持的提示词关键词：1K/2K/4K, 16:9/9:16/1:1, 横屏/竖屏/方形
 * 其他图像模型不会自动添加 image_config，需手动指定
 *
 * 部署步骤：
 * 1. docker compose build
 * 2. docker compose up -d
 * 3. 服务监听 8787 端口
 */

const FAL_BASE_URL = "https://fal.run/openrouter/router/openai/v1";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_IMAGE_MODELS_URL =
  "https://openrouter.ai/api/frontend/models/find?output_modalities=image";
const FAL_BALANCE_URL = "https://rest.alpha.fal.ai/billing/user_balance";

const VERSION = "1.12.0-docker";
const PORT = parseInt(Deno.env.get("PORT") || "8787");

// 图像生成模型默认配置
const IMAGE_MODEL_DEFAULTS = {
  image_size: "4K",
  aspect_ratio: "1:1",
};

// 需要应用智能 image_config 的模型（已测试过）
const SMART_IMAGE_CONFIG_MODELS = [
  "google/gemini-3-pro-image-preview",
  "bytedance-seed/seedream-4.5",
];

// 已知的图像生成模型列表（用于判断是否需要添加 modalities）
const KNOWN_IMAGE_MODELS = [
  "google/gemini-3-pro-image-preview",
  "google/gemini-2.5-flash-image",
  "google/gemini-2.5-flash-image-preview",
  "bytedance-seed/seedream-4.5",
  "openai/gpt-5-image",
  "openai/gpt-5-image-mini",
  "black-forest-labs/flux.2-max",
  "black-forest-labs/flux.2-flex",
  "black-forest-labs/flux.2-pro",
  "sourceful/riverflow-v2-max-preview",
  "sourceful/riverflow-v2-standard-preview",
  "sourceful/riverflow-v2-fast-preview",
];

// 思考模型映射配置
const THINKING_MODEL_MAPPINGS: Record<string, string> = {
  "deepseek/deepseek-v3.2-thinking": "deepseek/deepseek-v3.2",
  "deepseek/deepseek-chat-v3.1-thinking": "deepseek/deepseek-chat-v3.1:free",
};

// CORS 响应头
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

// 类型定义
interface Message {
  role: string;
  content: string | { type: string; text?: string }[];
}

interface ImageConfig {
  image_size?: string;
  aspect_ratio?: string;
}

interface RequestBody {
  model?: string;
  messages?: Message[];
  modalities?: string[];
  image_config?: ImageConfig;
  reasoning?: { enabled: boolean };
  [key: string]: unknown;
}

interface Choice {
  message: {
    content?: string;
    images?: { image_url?: { url?: string } | string }[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ResponseData {
  choices?: Choice[];
  [key: string]: unknown;
}

/**
 * 主请求处理函数
 */
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // 处理 CORS 预检请求
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // 首页显示使用说明
  if (url.pathname === "/" || url.pathname === "") {
    return jsonResponse({
      service: "fal OpenRouter Proxy (Docker)",
      version: VERSION,
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
        "/v1/dashboard/billing/subscription",
        "/v1/dashboard/billing/credit_grants",
      ],
      features: [
        "思考模型自动路由（xxx-thinking -> xxx + reasoning.enabled，不区分大小写）",
        "图像生成模型自动添加 modalities 参数",
        "智能 image_config（仅 Gemini/Seedream）：默认 4K 1:1，支持从提示词解析",
        "图像生成响应自动转换为 Markdown 图片格式（只返回第一张）",
        "模型列表合并 frontend API，包含完整图像模型",
        "无超时限制（相比 CF Worker 100s 限制）",
      ],
      thinking_models: THINKING_MODEL_MAPPINGS,
      image_config: {
        enabled_models: SMART_IMAGE_CONFIG_MODELS,
        defaults: IMAGE_MODEL_DEFAULTS,
        prompt_keywords: {
          resolution: ["1K", "2K", "4K"],
          aspect_ratio: [
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "横屏",
            "竖屏",
            "方形",
          ],
        },
        priority: "提示词 > 请求参数 > 默认值",
      },
      docs: "https://fal.ai/models/openrouter/router",
    });
  }

  // /v1/models 端点 - 从 OpenRouter 官方获取模型列表
  if (url.pathname === "/v1/models" || url.pathname === "/models") {
    return await fetchOpenRouterModels();
  }

  // OpenAI 兼容的余额查询端点
  if (
    url.pathname === "/v1/dashboard/billing/subscription" ||
    url.pathname === "/dashboard/billing/subscription"
  ) {
    const falKey = extractApiKey(request);
    if (!falKey) {
      return jsonResponse(
        { error: { message: "Unauthorized", type: "authentication_error" } },
        401
      );
    }
    return await fetchFalBalanceOpenAIFormat(falKey, "subscription");
  }

  if (
    url.pathname === "/v1/dashboard/billing/credit_grants" ||
    url.pathname === "/dashboard/billing/credit_grants"
  ) {
    const falKey = extractApiKey(request);
    if (!falKey) {
      return jsonResponse(
        { error: { message: "Unauthorized", type: "authentication_error" } },
        401
      );
    }
    return await fetchFalBalanceOpenAIFormat(falKey, "credit_grants");
  }

  if (
    url.pathname === "/v1/dashboard/billing/usage" ||
    url.pathname === "/dashboard/billing/usage"
  ) {
    const falKey = extractApiKey(request);
    if (!falKey) {
      return jsonResponse(
        { error: { message: "Unauthorized", type: "authentication_error" } },
        401
      );
    }
    return await fetchFalBalanceOpenAIFormat(falKey, "usage");
  }

  // 获取 API Key
  const falKey = extractApiKey(request);
  if (!falKey) {
    return jsonResponse(
      {
        error: {
          message:
            "Missing API key. Provide 'Authorization: Bearer YOUR_FAL_KEY' header",
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

  const fetchOptions: RequestInit = {
    method: request.method,
    headers: headers,
  };

  // 处理请求体（POST/PUT）
  if (request.method === "POST" || request.method === "PUT") {
    try {
      const bodyText = await request.text();
      let body: RequestBody = JSON.parse(bodyText);

      // 处理思考模型路由
      if (body.model) {
        body = applyThinkingModelRouting(body);
      }

      // 为图像生成模型添加 modalities 参数和智能 image_config
      if (body.model && isImageGenerationModel(body.model)) {
        if (!body.modalities || !Array.isArray(body.modalities)) {
          body.modalities = ["image", "text"];
        }
        body = applySmartImageConfig(body);
      }

      fetchOptions.body = JSON.stringify(body);
    } catch (_e) {
      // JSON 解析失败，使用原始请求
      fetchOptions.body = await request.text();
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
        const jsonData: ResponseData = JSON.parse(data);
        const transformedData = transformImageResponse(jsonData);
        return new Response(JSON.stringify(transformedData), {
          status: response.status,
          headers: responseHeaders,
        });
      } catch (_e) {
        // JSON 解析失败，返回原始数据
      }
    }

    return new Response(data, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return jsonResponse(
      {
        error: {
          message: `Proxy error: ${errorMessage}`,
          type: "proxy_error",
          code: "upstream_error",
        },
      },
      502
    );
  }
}

/**
 * 处理思考模型路由
 */
function applyThinkingModelRouting(body: RequestBody): RequestBody {
  const model = body.model;
  if (!model) return body;

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
function isImageGenerationModel(model: string): boolean {
  if (!model) return false;
  const modelLower = model.toLowerCase();
  // 检查已知图像模型列表
  if (KNOWN_IMAGE_MODELS.some((m) => m.toLowerCase() === modelLower)) {
    return true;
  }
  // 通用规则：模型名包含 image 或 seedream 或 flux 或 riverflow
  return (
    modelLower.includes("-image") ||
    modelLower.includes("image-") ||
    modelLower.includes("seedream") ||
    modelLower.includes("flux") ||
    modelLower.includes("riverflow")
  );
}

/**
 * 从提示词中解析 image_config 参数
 */
function parseImageConfigFromPrompt(messages?: Message[]): ImageConfig {
  if (!messages || !Array.isArray(messages)) return {};

  // 获取最后一条用户消息
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length === 0) return {};

  const lastMessage = userMessages[userMessages.length - 1];
  const content =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : (lastMessage.content?.find?.((c) => c.type === "text")?.text || "");

  const result: ImageConfig = {};

  // 检测分辨率关键词
  if (/\b4k\b/i.test(content)) {
    result.image_size = "4K";
  } else if (/\b2k\b/i.test(content)) {
    result.image_size = "2K";
  } else if (/\b1k\b/i.test(content)) {
    result.image_size = "1K";
  }

  // 检测宽高比关键词
  if (/16[:：]9/.test(content)) {
    result.aspect_ratio = "16:9";
  } else if (/9[:：]16/.test(content)) {
    result.aspect_ratio = "9:16";
  } else if (/1[:：]1/.test(content)) {
    result.aspect_ratio = "1:1";
  } else if (/4[:：]3/.test(content)) {
    result.aspect_ratio = "4:3";
  } else if (/3[:：]4/.test(content)) {
    result.aspect_ratio = "3:4";
  } else if (/3[:：]2/.test(content)) {
    result.aspect_ratio = "3:2";
  } else if (/2[:：]3/.test(content)) {
    result.aspect_ratio = "2:3";
  }
  // 语义关键词
  else if (/横(屏|版|图)|landscape|widescreen|宽屏/i.test(content)) {
    result.aspect_ratio = "16:9";
  } else if (/竖(屏|版|图)|portrait|vertical|手机壁纸/i.test(content)) {
    result.aspect_ratio = "9:16";
  } else if (/方(形|图)|square|正方/i.test(content)) {
    result.aspect_ratio = "1:1";
  }

  return result;
}

/**
 * 应用智能 image_config
 */
function applySmartImageConfig(body: RequestBody): RequestBody {
  // 只对已测试的模型应用智能配置
  const modelLower = (body.model || "").toLowerCase();
  const shouldApply = SMART_IMAGE_CONFIG_MODELS.some(
    (m) => m.toLowerCase() === modelLower
  );

  if (!shouldApply) {
    return body;
  }

  // 从提示词解析配置
  const promptConfig = parseImageConfigFromPrompt(body.messages);

  // 合并配置（优先级: 提示词 > 请求参数 > 默认值）
  const finalConfig: ImageConfig = {
    image_size:
      promptConfig.image_size ||
      body.image_config?.image_size ||
      IMAGE_MODEL_DEFAULTS.image_size,
    aspect_ratio:
      promptConfig.aspect_ratio ||
      body.image_config?.aspect_ratio ||
      IMAGE_MODEL_DEFAULTS.aspect_ratio,
  };

  body.image_config = finalConfig;
  return body;
}

/**
 * 转换图像生成响应
 */
function transformImageResponse(data: ResponseData): ResponseData {
  if (!data?.choices?.length) return data;

  for (const choice of data.choices) {
    const message = choice.message;
    if (!message?.images?.length) continue;

    // 构建 Markdown 格式的内容
    let content = "";

    // 保留原有文本
    if (
      message.content &&
      typeof message.content === "string" &&
      message.content.trim()
    ) {
      content = message.content.trim() + "\n\n";
    }

    // 只取第一张图片
    const img = message.images[0];
    const url =
      (img?.image_url as { url?: string })?.url ||
      (img?.image_url as string | undefined);
    if (url) {
      content += `![Generated Image](${url})`;
    }

    message.content = content.trim();
    delete message.images;
  }

  return data;
}

/**
 * 查询 fal.ai 账户余额
 */
async function fetchFalBalanceOpenAIFormat(
  apiKey: string,
  format = "subscription"
): Promise<Response> {
  try {
    const response = await fetch(FAL_BALANCE_URL, {
      headers: {
        Authorization: `Key ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      let errorMsg = `Failed to fetch balance: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMsg =
          (errorData as { detail?: string; message?: string }).detail ||
          (errorData as { detail?: string; message?: string }).message ||
          errorMsg;
      } catch (_e) {
        // ignore
      }
      return jsonResponse(
        { error: { message: errorMsg, type: "upstream_error" } },
        response.status
      );
    }

    const balanceText = await response.text();
    const rawBalance = parseFloat(balanceText);

    if (isNaN(rawBalance)) {
      return jsonResponse(
        { error: { message: "Invalid balance format", type: "parse_error" } },
        502
      );
    }

    const balance = Math.round(rawBalance * 100) / 100;

    if (format === "subscription") {
      return jsonResponse({
        object: "billing_subscription",
        has_payment_method: true,
        soft_limit_usd: balance,
        hard_limit_usd: balance,
        system_hard_limit_usd: balance,
        access_until: Math.floor(Date.now() / 1000) + 86400 * 365,
      });
    }

    if (format === "credit_grants") {
      const balanceCents = Math.round(balance * 100);
      return jsonResponse({
        object: "credit_summary",
        total_granted: balanceCents,
        total_used: 0,
        total_available: balanceCents,
        grants: {
          object: "list",
          data: [
            {
              object: "credit_grant",
              id: "fal-balance",
              grant_amount: balanceCents,
              used_amount: 0,
              effective_at: Math.floor(Date.now() / 1000),
              expires_at: null,
            },
          ],
        },
      });
    }

    if (format === "usage") {
      return jsonResponse({
        object: "billing_usage",
        total_usage: 0,
        daily_costs: [],
      });
    }

    return jsonResponse({ balance: balance, currency: "USD" });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return jsonResponse(
      {
        error: {
          message: `Failed to fetch balance: ${errorMessage}`,
          type: "upstream_error",
        },
      },
      502
    );
  }
}

/**
 * 从 OpenRouter 获取模型列表
 */
async function fetchOpenRouterModels(): Promise<Response> {
  try {
    const [modelsResponse, imageModelsResponse] = await Promise.all([
      fetch(OPENROUTER_MODELS_URL, {
        headers: {
          Accept: "application/json",
          "User-Agent": `fal-openai-proxy/${VERSION}`,
        },
      }),
      fetch(OPENROUTER_IMAGE_MODELS_URL, {
        headers: {
          Accept: "application/json",
          "User-Agent": `fal-openai-proxy/${VERSION}`,
        },
      }),
    ]);

    if (!modelsResponse.ok) {
      return jsonResponse(
        {
          error: {
            message: `Failed to fetch models: ${modelsResponse.status}`,
            type: "upstream_error",
          },
        },
        modelsResponse.status
      );
    }

    const modelsData = (await modelsResponse.json()) as {
      data?: { id: string; architecture?: { output_modalities?: string[] } }[];
    };
    const existingModels = modelsData.data || [];
    const existingIds = new Set(existingModels.map((m) => m.id));

    // 尝试获取图像模型并合并
    if (imageModelsResponse.ok) {
      try {
        const imageData = (await imageModelsResponse.json()) as {
          data?: {
            models?: {
              slug: string;
              name?: string;
              description?: string;
              context_length?: number;
              input_modalities?: string[];
              output_modalities?: string[];
            }[];
          };
        };
        const imageModels = imageData?.data?.models || [];

        for (const imgModel of imageModels) {
          const modelId = imgModel.slug;
          if (modelId && !existingIds.has(modelId)) {
            existingModels.push({
              id: modelId,
              name: imgModel.name || modelId,
              description: imgModel.description || "",
              context_length: imgModel.context_length || 4096,
              architecture: {
                modality: "text+image->text+image",
                input_modalities: imgModel.input_modalities || ["text", "image"],
                output_modalities: imgModel.output_modalities || ["image"],
                tokenizer: "Unknown",
              },
              pricing: {
                prompt: "0",
                completion: "0",
                image: "0.04",
              },
              top_provider: {
                context_length: imgModel.context_length || 4096,
                is_moderated: false,
              },
            } as never);
            existingIds.add(modelId);
          } else if (modelId && existingIds.has(modelId)) {
            const existing = existingModels.find((m) => m.id === modelId);
            if (existing && existing.architecture) {
              if (!existing.architecture.output_modalities?.includes("image")) {
                existing.architecture.output_modalities =
                  imgModel.output_modalities || ["image"];
              }
            }
          }
        }
      } catch (_e) {
        // 忽略图像模型获取失败
      }
    }

    return jsonResponse({ object: "list", data: existingModels });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return jsonResponse(
      {
        error: {
          message: `Failed to fetch models: ${errorMessage}`,
          type: "upstream_error",
        },
      },
      502
    );
  }
}

/**
 * 从请求中提取 API Key
 */
function extractApiKey(request: Request): string {
  const authHeader = request.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
  if (authHeader.startsWith("Key ")) return authHeader.slice(4);
  return Deno.env.get("FAL_KEY") || "";
}

/**
 * 返回 JSON 响应
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// 启动服务器
console.log(`🚀 fal-proxy server starting on port ${PORT}...`);
console.log(`📖 API docs: http://localhost:${PORT}/`);
console.log(`🔗 Base URL: http://localhost:${PORT}/v1`);

Deno.serve({ port: PORT }, handleRequest);

