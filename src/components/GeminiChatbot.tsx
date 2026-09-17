/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, RefreshCw, Copy, Check, Terminal } from 'lucide-react';
import { ChatMessage } from '../types';

export const GeminiChatbot: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: 'init-1',
    role: 'model',
    content: "Connection established. Secure PySpark AI Architect is online. Awaiting inquiry regarding DGX/NGX configuration, Regex parsing, or NLP implementation.",
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, isLoading]);

  const handleSendMessage = async (textToSend?: string) => {
    const msg = (textToSend || input).trim();
    if (!msg || isLoading) return;

    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: msg, timestamp: new Date().toLocaleTimeString() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
          systemInstruction: 'You are the Senior NGX Spark & Australian Banking OCR Systems Architect operating inside a secure, classified terminal. Be highly technical, concise, and provide production-grade PySpark/Regex code snippets.',
        }),
      });

      const data = await response.json();
      setMessages(prev => [...prev, {
        id: `model-${Date.now()}`,
        role: 'model',
        content: data.reply || 'No response.',
        timestamp: new Date().toLocaleTimeString()
      }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { id: `err-${Date.now()}`, role: 'model', content: `[ERROR]: Connection failed - ${err.message}`, timestamp: new Date().toLocaleTimeString() }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] neon-card">
      {/* Header */}
      <div className="border-b border-matrix-500/15 bg-black/40 p-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-matrix-400" />
          <h2 className="glitch-heading text-sm uppercase">AI Intelligence Terminal</h2>
          <span className="px-2 py-0.5 border border-matrix-500/40 bg-matrix-900/30 text-matrix-400 text-[9px] font-mono uppercase tracking-widest animate-pulse">Live</span>
        </div>
        <button onClick={() => setMessages([messages[0]])} className="text-slate-500 hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#050505] font-sans">
        {messages.map((message) => {
          const isUser = message.role === 'user';
          return (
            <div key={message.id} className={`flex items-start gap-4 max-w-4xl ${isUser ? 'ml-auto flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 flex items-center justify-center shrink-0 border ${isUser ? 'bg-slate-900 border-slate-700 text-slate-300' : 'bg-amber-950/20 border-amber-900 text-amber-500'}`}>
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
                <div className="flex items-center gap-2 text-[10px] font-mono text-slate-600 uppercase tracking-widest">
                  <span>{isUser ? 'OPERATOR' : 'SYS.ARCHITECT'}</span>
                  <span>// {message.timestamp}</span>
                </div>
                <div className={`p-4 text-sm leading-relaxed whitespace-pre-wrap ${isUser ? 'bg-slate-900 text-slate-200 border border-slate-800' : 'bg-[#0a0a0a] text-slate-300 border border-slate-800'}`}>
                  {message.content}
                </div>
              </div>
            </div>
          );
        })}
        {isLoading && (
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 flex items-center justify-center shrink-0 border bg-amber-950/20 border-amber-900 text-amber-500">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-[#0a0a0a] border border-slate-800 p-4 text-xs font-mono text-amber-500/70 uppercase tracking-widest animate-pulse">
              Computing Response Payload...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-800 bg-black p-4">
        <form onSubmit={e => { e.preventDefault(); handleSendMessage(); }} className="flex items-center gap-3 max-w-4xl mx-auto">
          <span className="text-emerald-500 font-mono font-bold">{'>'}</span>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="ENTER COMMAND OR QUERY..."
            className="flex-1 bg-transparent border-none text-white font-mono text-xs uppercase tracking-widest focus:outline-none placeholder:text-slate-700"
            disabled={isLoading}
            autoFocus
          />
          <button type="submit" disabled={isLoading || !input.trim()} className="text-slate-500 hover:text-cyan-400 disabled:opacity-50 transition-colors">
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
