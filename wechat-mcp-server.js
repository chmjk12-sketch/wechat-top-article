#!/usr/bin/env node
/**
 * WeChat Official Account MCP Server
 *
 * 本地运行的 MCP Server，通过 ECS WeChat Proxy 转发请求到 api.weixin.qq.com
 * 被 WorkBuddy 通过 mcp.json 自动启动
 *
 * 环境变量：
 *   WECHAT_PROXY_URL  — ECS 代理地址（默认 http://39.105.86.184:8003）
 *   WECHAT_PROXY_KEY  — 代理服务 API Key（防止滥用）
 */

const http = require('http');

const PROXY_URL = process.env.WECHAT_PROXY_URL || 'http://39.105.86.184:8003';
const PROXY_KEY = process.env.WECHAT_PROXY_KEY || '';

// ========== MCP 协议工具 ==========

/**
 * 从 stdin 读取一个 MCP 消息（Content-Length 格式）
 */
function readMessage(input) {
  // 读取 headers（直到 \r\n\r\n）
  let headerEnd = input.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;

  const headerPart = input.slice(0, headerEnd);
  const bodyStart = headerEnd + 4;

  // 解析 Content-Length
  const contentLengthMatch = headerPart.match(/Content-Length:\s*(\d+)/i);
  if (!contentLengthMatch) return null;

  const contentLength = parseInt(contentLengthMatch[1], 10);
  const body = input.slice(bodyStart, bodyStart + contentLength);

  if (body.length < contentLength) return null; // 数据不完整

  try {
    return { message: JSON.parse(body), consumed: bodyStart + contentLength };
  } catch (e) {
    return null;
  }
}

/**
 * 发送 MCP 消息到 stdout
 */
function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
  process.stdout.write(header + json);
}

/**
 * 发送错误响应
 */
function sendError(id, code, message) {
  sendMessage({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
}

/**
 * 发送成功响应
 */
function sendResult(id, result) {
  sendMessage({
    jsonrpc: '2.0',
    id,
    result,
  });
}

// ========== MCP Handler 处理 ==========

function handleRequest(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      handleInitialize(id, params);
      break;
    case 'tools/list':
      handleListTools(id);
      break;
    case 'tools/call':
      handleToolCall(id, params);
      break;
    case 'notifications/initialized':
      // 忽略，不回复
      break;
    case 'ping':
      sendResult(id, {});
      break;
    default:
      sendError(id, -32601, `Method not found: ${method}`);
  }
}

function handleInitialize(id) {
  sendResult(id, {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'wechat-official',
      version: '1.0.0',
    },
  });
}

function handleListTools(id) {
  sendResult(id, {
    tools: [
      {
        name: 'wechat_get_token',
        description: '获取微信公众号 access_token（用于测试连接是否正常）',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'wechat_add_draft',
        description: '添加草稿到微信公众号草稿箱',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: '文章标题',
            },
            content: {
              type: 'string',
              description: '文章内容（HTML 格式，符合公众号内容规范）',
            },
            author: {
              type: 'string',
              description: '作者名称（可选）',
            },
            thumb_media_id: {
              type: 'string',
              description: '封面图片素材 ID（可选，来自微信素材库）',
            },
            need_open_comment: {
              type: 'boolean',
              description: '是否打开评论（默认 true）',
            },
            only_fans_can_comment: {
              type: 'boolean',
              description: '是否仅粉丝可评论（默认 true）',
            },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'wechat_upload_image',
        description: '上传封面图片到微信素材库（通过公网可访问的图片 URL）',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: '图片的公网可访问 URL',
            },
          },
          required: ['url'],
        },
      },
    ],
  });
}

function handleToolCall(id, params) {
  const toolName = params.name;
  const args = params.arguments || {};

  switch (toolName) {
    case 'wechat_get_token':
      callProxy('/api/wechat/get_token', {})
        .then((result) => {
          sendResult(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          });
        })
        .catch((err) => {
          sendResult(id, {
            content: [
              {
                type: 'text',
                text: `❌ 获取 token 失败：${err.message}\n\n请确保：\n1. ECS WeChat Proxy 已部署并运行\n2. WEChaT_APPID 和 WECHAT_APPSECRET 已正确配置\n3. ECS IP 39.105.86.184 已在公众号后台加入 IP 白名单`,
              },
            ],
            isError: true,
          });
        });
      break;

    case 'wechat_add_draft':
      callProxy('/api/wechat/add_draft', {
        title: args.title,
        content: args.content,
        author: args.author || '',
        thumb_media_id: args.thumb_media_id || '',
        need_open_comment: args.need_open_comment !== false,
        only_fans_can_comment: args.only_fans_can_comment !== false,
      })
        .then((result) => {
          sendResult(id, {
            content: [
              {
                type: 'text',
                text: `✅ 草稿推送成功！\n\n标题：${args.title}\nMedia ID：${result.media_id}\n\n请在公众号后台「草稿箱」中查看并发布。`,
              },
            ],
          });
        })
        .catch((err) => {
          sendResult(id, {
            content: [
              {
                type: 'text',
                text: `❌ 推送草稿失败：${err.message}`,
              },
            ],
            isError: true,
          });
        });
      break;

    case 'wechat_upload_image':
      callProxy('/api/wechat/upload_image', { url: args.url })
        .then((result) => {
          sendResult(id, {
            content: [
              {
                type: 'text',
                text: `✅ 图片上传成功！\n\nURL：${result.url}\nMedia ID：${result.media_id || '（无需 media_id，可直接使用 url）'}`,
              },
            ],
          });
        })
        .catch((err) => {
          sendResult(id, {
            content: [
              {
                type: 'text',
                text: `❌ 上传图片失败：${err.message}`,
              },
            ],
            isError: true,
          });
        });
      break;

    default:
      sendError(id, -32601, `Tool not found: ${toolName}`);
  }
}

// ========== HTTP 请求到 ECS Proxy ==========

function callProxy(path, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(PROXY_URL);
    const body = JSON.stringify(data);

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    // 如果配置了代理 Key，添加认证头
    if (PROXY_KEY) {
      options.headers['X-Proxy-Key'] = PROXY_KEY;
    }

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(responseBody);
          if (json.error) {
            reject(new Error(json.error));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`解析响应失败: ${responseBody.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`连接 ECS Proxy 失败 (${PROXY_URL})：${e.message}\n\n请确保：\n1. ECS WeChat Proxy 已部署并运行在 ${PROXY_URL}\n2. 没有网络防火墙阻止连接`));
    });

    req.write(body);
    req.end();
  });
}

// ========== 启动 MCP Server ==========

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (buffer.length > 0) {
    const result = readMessage(buffer);
    if (!result) break;
    handleRequest(result.message);
    buffer = buffer.slice(result.consumed);
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});

// 给 Stdout 加一个初始信号（MCP 协议需要）
// 注意：不要发送任何非 MCP 格式的输出到 stdout
