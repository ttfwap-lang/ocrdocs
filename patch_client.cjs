const fs = require('fs');
let content = fs.readFileSync('src/components/MatcherStudio.tsx', 'utf8');

const oldEffect = `  // Initialize WebSocket connection to the NGX Data Plane
  React.useEffect(() => {
    // Protocol relative WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = \`\${protocol}//\${window.location.host}/stream\`;
    
    console.log('[CLIENT] Connecting to High-Throughput Data Plane at', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[CLIENT] Socket Online.');
      setServerStatus('Connected to NGX Cluster');
      // Trigger initial parse on load
      ws.send(JSON.stringify({ type: 'INGEST_DOCUMENT', text: customText }));
    };

    ws.onclose = (event) => console.log('WS Closed:', event.code, event.reason);
    ws.onerror = (error) => {
      console.error('WebSocket Error details:', JSON.stringify(error), error.message, error.type);
      setServerStatus('Socket Error (Fallback to Local)');
      // Fallback if socket fails in dev
      const rawResults = extractBankFieldsFromText(customText);
      setExtractionResults(enforceAustralianFormattingRules(rawResults));
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'ACK') {
          setIsProcessing(true);
          setServerStatus('Job Queued...');
        } else if (payload.type === 'STATUS') {
          setServerStatus(payload.message);
        } else if (payload.type === 'FINAL_RESULT') {
          // The backend now runs the enforceAustralianFormattingRules
          setExtractionResults(payload.data || []);
          setEngineUsed(payload.engineUsed || 'UNKNOWN_ENGINE');
          setIsProcessing(false);
          setServerStatus('Idle (Ready)');
        }
      } catch (err) {
        console.error('Socket message parse error:', err);
      }
    };

    return () => ws.close();
  }, []); // Run once on mount

  // Trigger backend processing when text changes, debounced
  React.useEffect(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    const timeoutId = setTimeout(() => {
      setIsProcessing(true);
      setServerStatus('Uploading payload...');
      wsRef.current?.send(JSON.stringify({ type: 'INGEST_DOCUMENT', text: customText }));
    }, 800);
    
    return () => clearTimeout(timeoutId);
  }, [customText]);`;

const newEffect = `  const abortControllerRef = React.useRef<AbortController | null>(null);

  // Trigger backend processing when text changes, debounced
  React.useEffect(() => {
    const timeoutId = setTimeout(async () => {
      setIsProcessing(true);
      setServerStatus('Uploading payload...');
      
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      
      try {
        const response = await fetch('/api/process-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: customText }),
          signal: abortControllerRef.current.signal
        });
        
        if (!response.body) throw new Error('No readable stream');
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const payload = JSON.parse(line.substring(6));
                if (payload.type === 'ACK') {
                  setServerStatus('Job Queued...');
                } else if (payload.type === 'STATUS') {
                  setServerStatus(payload.message);
                } else if (payload.type === 'FINAL_RESULT') {
                  setExtractionResults(payload.data || []);
                  setEngineUsed(payload.engineUsed || 'UNKNOWN_ENGINE');
                  setIsProcessing(false);
                  setServerStatus('Idle (Ready)');
                }
              } catch (e) {
                console.error('Failed to parse SSE payload:', e);
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return; // Ignore debounced aborts
        console.error('Data plane error:', err);
        setServerStatus('HTTP Stream Error (Fallback to Local)');
        const rawResults = extractBankFieldsFromText(customText);
        setExtractionResults(enforceAustralianFormattingRules(rawResults));
        setIsProcessing(false);
      }
    }, 800);
    
    return () => clearTimeout(timeoutId);
  }, [customText]);`;

content = content.replace(oldEffect, newEffect);
content = content.replace("const wsRef = React.useRef<WebSocket | null>(null);", "");
content = content.replace("WS://NGX-SPARK-STREAM", "HTTP://NGX-SPARK-STREAM");
content = content.replace("Latency: 0ms (Websocket Stream)", "Latency: <5ms (HTTP Chunked Stream)");

fs.writeFileSync('src/components/MatcherStudio.tsx', content);
