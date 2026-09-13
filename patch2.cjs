const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(
  "const wss = new WebSocketServer({ server: httpServer, path: '/stream' });",
  "const wss = new WebSocketServer({ noServer: true });\n  httpServer.on('upgrade', (request, socket, head) => {\n    console.log('[UPGRADE]', request.url);\n    if (request.url.startsWith('/stream')) {\n      wss.handleUpgrade(request, socket, head, (ws) => {\n        wss.emit('connection', ws, request);\n      });\n    } else {\n      socket.destroy();\n    }\n  });"
);
content = content.replace('httpServer.on("upgrade", (req) => console.log("UPGRADE:", req.url));', '');
fs.writeFileSync('server.ts', content);
