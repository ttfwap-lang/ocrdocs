const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000/stream');
ws.on('open', () => {
  console.log('Connected');
  ws.send(JSON.stringify({ type: 'INGEST_DOCUMENT', text: 'test' }));
});
ws.on('message', (msg) => {
  console.log('Received:', msg.toString());
  process.exit(0);
});
ws.on('error', (err) => {
  console.error('Error:', err);
  process.exit(1);
});
ws.on('close', () => console.log('Closed'));
setTimeout(() => { console.log('Timeout'); process.exit(1); }, 5000);
