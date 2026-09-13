const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');
content = content.replace('app.use(vite.middlewares);', 'app.use(vite.middlewares);\n  httpServer.on("upgrade", (req, socket, head) => {\n    console.log("[HTTP Upgrade] Request to:", req.url);\n  });');
fs.writeFileSync('server.ts', content);
