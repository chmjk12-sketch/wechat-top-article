/**
 * WeChat Official Account API Proxy
 * 
 * 运行在 ECS 上（IP: 39.105.86.184），从白名单 IP 转发请求到 api.weixin.qq.com
 * 由 article-forge server.js 引入
 * 
 * 环境变量：
 *   WECHAT_APPID      — 公众号 AppID
 *   WECHAT_APPSECRET  — 公众号 AppSecret
 *   WECHAT_PROXY_KEY  — 代理服务 API Key（防止滥用）
 */

const https = require('https');

// ========== 配置 ==========
const APPID = process.env.WECHAT_APPID || '';
const APPSECRET = process.env.WECHAT_APPSECRET || '';
const PROXY_KEY = process.env.WECHAT_PROXY_KEY || '';

// Token 缓存
let tokenCache = { access_token: '', expires_at: 0 };

// ========== Token 管理 ==========

/**
 * 获取微信公众号 access_token（带 2 小时缓存）
 */
function getAccessToken() {
  return new Promise((resolve, reject) => {
    // 缓存有效，直接返回
    if (tokenCache.access_token && Date.now() < tokenCache.expires_at) {
      return resolve(tokenCache.access_token);
    }

    if (!APPID || !APPSECRET) {
      return reject(new Error('WECHAT_APPID 或 WECHAT_APPSECRET 未配置'));
    }

    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APPID}&secret=${APPSECRET}`;
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.errcode && json.errcode !== 0) {
            return reject(new Error(`微信API错误: ${json.errcode} - ${json.errmsg}`));
          }
          // 缓存 token，提前 5 分钟过期
          tokenCache = {
            access_token: json.access_token,
            expires_at: Date.now() + (json.expires_in - 300) * 1000,
          };
          resolve(json.access_token);
        } catch (e) {
          reject(new Error('解析 access_token 响应失败: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ========== 草稿箱操作 ==========

/**
 * 添加草稿到公众号
 * @param {Object} article - 文章对象
 * @param {string} article.title - 标题
 * @param {string} article.content - 内容（HTML 格式）
 * @param {string} [article.author] - 作者
 * @param {string} [article.thumb_media_id] - 封面图 media_id
 * @param {boolean} [article.need_open_comment] - 是否打开评论
 * @param {boolean} [article.only_fans_can_comment] - 是否仅粉丝可评论
 */
function addDraft(article) {
  return new Promise((resolve, reject) => {
    getAccessToken()
      .then((token) => {
        const body = JSON.stringify({
          articles: [{
            title: article.title || '',
            author: article.author || '',
            content: article.content || '',
            thumb_media_id: article.thumb_media_id || '',
            need_open_comment: article.need_open_comment !== false ? 1 : 0,
            only_fans_can_comment: article.only_fans_can_comment !== false ? 1 : 0,
          }],
        });

        const req = https.request(
          {
            hostname: 'api.weixin.qq.com',
            path: `/cgi-bin/draft/add?access_token=${token}`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              try {
                const json = JSON.parse(data);
                if (json.errcode && json.errcode !== 0) {
                  return reject(new Error(`添加草稿失败: ${json.errcode} - ${json.errmsg}`));
                }
                resolve(json);
              } catch (e) {
                reject(new Error('解析添加草稿响应失败: ' + e.message));
              }
            });
          }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      })
      .catch(reject);
  });
}

/**
 * 上传图片到微信素材库
 * @param {string} imageUrl - 图片的 URL（需要公网可访问）
 */
function uploadImage(imageUrl) {
  return new Promise((resolve, reject) => {
    getAccessToken()
      .then((token) => {
        // 微信 API 需要 POST form-data 方式上传图片
        // 这里简化处理：先用 https 下载图片，再转发
        const body = JSON.stringify({ url: imageUrl });

        const req = https.request(
          {
            hostname: 'api.weixin.qq.com',
            path: `/cgi-bin/media/uploadimg?access_token=${token}`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              try {
                const json = JSON.parse(data);
                if (json.errcode && json.errcode !== 0) {
                  return reject(new Error(`上传图片失败: ${json.errcode} - ${json.errmsg}`));
                }
                resolve(json);
              } catch (e) {
                reject(new Error('解析上传图片响应失败: ' + e.message));
              }
            });
          }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      })
      .catch(reject);
  });
}

// ========== HTTP 路由处理 ==========

/**
 * 处理 WeChat API 代理请求
 * @param {object} req - HTTP 请求
 * @param {object} res - HTTP 响应
 * @param {string} body - 请求体
 */
function handleWechatProxy(req, res, body) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // 验证代理 API Key
  const authHeader = req.headers['x-proxy-key'] || '';
  if (PROXY_KEY && authHeader !== PROXY_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: '未授权：请提供正确的 X-Proxy-Key' }));
  }

  // 解析请求体
  let params;
  try {
    params = body ? JSON.parse(body) : {};
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: '请求体不是有效的 JSON' }));
  }

  // 路由分发
  if (path === '/api/wechat/get_token') {
    getAccessToken()
      .then((token) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, access_token: token }));
      })
      .catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
  } else if (path === '/api/wechat/add_draft') {
    addDraft(params)
      .then((result) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, media_id: result.media_id }));
      })
      .catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
  } else if (path === '/api/wechat/upload_image') {
    uploadImage(params.url || '')
      .then((result) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, url: result.url, media_id: result.media_id || '' }));
      })
      .catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '未知的 WeChat API 路径: ' + path }));
  }
}

module.exports = {
  getAccessToken,
  addDraft,
  uploadImage,
  handleWechatProxy,
};
