const WebSocket = require('ws');
const fs = require('fs');

const customText = "Just some text to test";

const ws = new WebSocket('ws://localhost:3000/stream');
ws.on('open', () => {
  console.log('Connected');
  ws.send(JSON.stringify({ type: 'INGEST_DOCUMENT', text: customText }));
});
ws.on('message', (msg) => {
  console.log('Received:', msg.toString());
});
ws.on('error', (err) => {
  console.error('Error:', err);
  process.exit(1);
});
ws.on('close', () => console.log('Closed'));
setTimeout(() => { console.log('Timeout'); process.exit(0); }, 3000);
