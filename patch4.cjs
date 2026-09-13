const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

// Remove WebSocket stuff
content = content.replace(/const wss = new WebSocketServer[\s\S]*?socket\.destroy\(\);\n    }\n  \}\);\n/m, '');
content = content.replace("const { WebSocketServer } = await import(\"ws\");", "");

// Add the POST endpoint before startServer
const endpoint = `
// NGX-Spark High-Throughput Data Plane HTTP Stream
app.post("/api/process-document", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  
  const jobId = Date.now().toString();
  
  const sendEvent = (type, data) => {
    res.write(\`data: \${JSON.stringify({ type, ...data })}\\n\\n\`);
  };

  sendEvent("ACK", { status: "QUEUED", jobId });
  
  const text = req.body.text || "";
  const buffer = Buffer.from(text);
  
  sendEvent("STATUS", { jobId, message: "Initiating Multi-Pass OCR (GCP, Azure, AWS)..." });
  
  try {
    const ocrResult = await ocrEngine.processDocument(buffer, (msg) => {
      sendEvent("STATUS", { jobId, message: msg });
    });

    sendEvent("STATUS", { jobId, message: "Spawning Worker Thread for SIMD Pattern Matching..." });
    
    await new Promise(resolve => setImmediate(resolve));
    
    const matchedFields = extractBankFieldsFromText(text);
    
    sendEvent("FINAL_RESULT", {
      jobId,
      status: "SUCCESS",
      engineUsed: ocrResult.engine,
      data: matchedFields
    });
  } catch (err) {
    console.error(err);
    sendEvent("ERROR", { message: "Internal Server Error" });
  }
  
  res.end();
});
`;

content = content.replace('// Start Express server and mount Vite middleware', endpoint + '\n// Start Express server and mount Vite middleware');

fs.writeFileSync('server.ts', content);
