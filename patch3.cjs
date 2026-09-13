const fs = require('fs');
let content = fs.readFileSync('src/components/MatcherStudio.tsx', 'utf8');

content = content.replace(
  "console.error('WebSocket Error:', error);",
  "console.error('WebSocket Error details:', JSON.stringify(error), error.message, error.type);"
);
content = content.replace(
  "ws.onerror = (error) => {",
  "ws.onclose = (event) => console.log('WS Closed:', event.code, event.reason);\n    ws.onerror = (error) => {"
);

fs.writeFileSync('src/components/MatcherStudio.tsx', content);
