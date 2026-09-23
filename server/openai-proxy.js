#!/usr/bin/env node
const http = require('http');
const ModelRouter = require('./model-router');

const PORT = parseInt(process.env.ANCHOR_PROXY_PORT || '8765', 10);
const HOST = '127.0.0.1';

const modelRouter = new ModelRouter();

function formatMessagesToPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }
  
  if (messages.length === 1) {
    return messages[0].content || '';
  }

  const parts = [];
  for (const m of messages) {
    const role = (m.role || 'user').toUpperCase();
    const content = m.content || '';
    if (role === 'SYSTEM') {
      parts.push(`[System Instructions]:\n${content}`);
    } else if (role === 'USER') {
      parts.push(`[User]:\n${content}`);
    } else if (role === 'ASSISTANT') {
      parts.push(`[Assistant]:\n${content}`);
    } else {
      parts.push(`[${role}]:\n${content}`);
    }
  }
  return parts.join('\n\n');
}

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  // Health check
  if ((req.method === 'GET' || req.method === 'HEAD') && (url === '/health' || url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'anchor-openai-proxy',
      model: modelRouter.getModel(),
      auth: 'opencode-openai-oauth'
    }));
    return;
  }

  // Models list
  if (req.method === 'GET' && (url === '/v1/models' || url === '/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'openai/gpt-5.6-luna', object: 'model', owned_by: 'openai' },
        { id: 'openai/gpt-4o', object: 'model', owned_by: 'openai' },
        { id: 'openai/gpt-4o-mini', object: 'model', owned_by: 'openai' }
      ]
    }));
    return;
  }

  // Chat completions
  if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/chat/completions')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const targetModel = payload.model || modelRouter.getModel() || 'openai/gpt-5.6-luna';
        const promptText = formatMessagesToPrompt(payload.messages || []);
        console.log(`[ANCHOR OPENAI PROXY] Incoming request for ${targetModel} (${(payload.messages || []).length} msgs, ${promptText.length} chars)`);

        if (!promptText) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Missing messages in request' } }));
          return;
        }

        // Query model-router (which invokes opencode with Cody's OpenAI auth login)
        const startTime = Date.now();
        const result = modelRouter.query(promptText, targetModel, { timeoutMs: 120000 });

        if (!result.success) {
          console.error(`[ANCHOR OPENAI PROXY] Error from OpenCode: ${result.error}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              message: result.error || 'Failed to query model via OpenCode',
              type: 'opencode_error'
            }
          }));
          return;
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[ANCHOR OPENAI PROXY] Response generated via OpenCode in ${duration}s (${(result.response || '').length} chars)`);

        const responseContent = result.response || '';
        const promptTokens = Math.ceil(promptText.length / 4);
        const completionTokens = Math.ceil(responseContent.length / 4);

        const responsePayload = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: targetModel,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: responseContent
              },
              finish_reason: 'stop'
            }
          ],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
          }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responsePayload));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message, type: 'proxy_internal_error' } }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `Route not found: ${req.method} ${url}` } }));
});

function startServer(port = PORT) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚓ Anchor OpenAI Proxy: port ${port} already active.`);
    } else {
      console.error(`⚓ Anchor OpenAI Proxy error:`, err.message);
    }
  });
  server.listen(port, HOST, () => {
    console.log(`⚓ Anchor OpenAI Proxy listening on http://${HOST}:${port} (Auth: OpenCode OpenAI OAuth)`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { server, startServer, formatMessagesToPrompt };
