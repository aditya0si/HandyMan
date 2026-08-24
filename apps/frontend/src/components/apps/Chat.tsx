import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { AppProps } from '../../utils/appRegistry';
import { get as storageGet, set as storageSet } from '../../utils/storage';
import { friendlyErrorText } from '../../utils/errorMessages';
import type { ChatMessage } from '../../utils/chat';
import { appendMessage, isDemoMode, updateLastMessage } from '../../utils/chat';
import type { ApiMode } from '../../utils/apiProxy';
import { DEFAULT_PROXY_URL, resolveApiMode } from '../../utils/apiProxy';
import { GeminiProvider } from '../../utils/llm/geminiProvider';
import { ProxyGeminiProvider } from '../../utils/llm/proxyGeminiProvider';
import { MockLLMProvider } from '../../utils/llm/mockProvider';
import { workspaceTools, executeReadOnlyTool, executeMutationTool, isMutationTool } from '../../utils/llm/tools';
import type { LLMProvider } from '../../utils/llm/llmProvider';
import type { GeminiFunctionCall } from '@jarvis/shared';

const CHAT_SAVE_DEBOUNCE_MS = 500;
const API_KEY: string = import.meta.env.VITE_GEMINI_API_KEY ?? '';
const PROXY_BASE: string = import.meta.env.VITE_API_PROXY_URL ?? DEFAULT_PROXY_URL;

type ChatStatus = 'idle' | 'streaming' | 'error' | 'awaiting_confirmation';

const inputStyle = {
  flex: 1,
  minWidth: 0,
  background: 'rgba(0, 0, 0, 0.35)',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  borderRadius: 6,
  color: '#e8eaed',
  fontFamily: 'inherit',
  fontSize: 9,
  padding: '2px 5px',
} as const;
const sendButtonStyle = {
  background: 'rgba(255, 255, 255, 0.05)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'rgba(255, 255, 255, 0.18)',
  borderRadius: 6,
  color: '#d3d6db',
  fontFamily: 'inherit',
  fontSize: 9,
  padding: '2px 6px',
  cursor: 'pointer',
} as const;
const disabledSendStyle = {
  ...sendButtonStyle,
  color: '#8b8f98',
  borderColor: 'rgba(139, 143, 152, 0.3)',
  cursor: 'default',
} as const;

export function Chat({ windowId }: AppProps) {
  const storageKey = `chat:${windowId}`;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [demoMode, setDemoMode] = useState(() => isDemoMode(API_KEY));
  const [errorText, setErrorText] = useState('');
  const [apiMode, setApiMode] = useState<ApiMode | 'resolving'>('resolving');
  
  const [pendingMutation, setPendingMutation] = useState<GeminiFunctionCall | null>(null);

  const apiModeRef = useRef<ApiMode | 'resolving'>('resolving');
  const messagesRef = useRef<ChatMessage[]>([]);
  const timerRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const commit = (next: ChatMessage[]): void => {
    dirtyRef.current = true;
    messagesRef.current = next;
    setMessages(next);
  };

  useEffect(() => {
    let cancelled = false;
    void resolveApiMode({
      kind: 'llm',
      proxyUrl: PROXY_BASE,
      directConfigured: !isDemoMode(API_KEY),
    }).then((mode) => {
      if (cancelled) return;
      apiModeRef.current = mode;
      setApiMode(mode);
      if (mode === 'demo') setDemoMode(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const stored = storageGet<ChatMessage[]>(storageKey);
    if (stored !== null && Array.isArray(stored)) {
      messagesRef.current = stored;
      setMessages(stored);
    }
    return () => {
      abortRef.current?.abort();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        storageSet(storageKey, messagesRef.current);
      }
    };
  }, [storageKey]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      dirtyRef.current = false;
      storageSet(storageKey, messagesRef.current);
    }, CHAT_SAVE_DEBOUNCE_MS);
  }, [messages, storageKey]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const generateAssistantReply = async (resumeHistory?: ChatMessage[]): Promise<void> => {
    setStatus('streaming');
    const controller = new AbortController();
    abortRef.current = controller;
    
    // Use resumeHistory if provided (e.g. after a function response), else use current messages minus the empty assistant bubble
    const history = resumeHistory || messagesRef.current.slice(0, -1);
    
    let received = '';
    
    try {
      const effectiveMode: ApiMode =
        apiModeRef.current === 'resolving'
          ? demoMode
            ? 'demo'
            : 'direct'
          : apiModeRef.current;
      
      let provider: LLMProvider;
      if (effectiveMode === 'proxy') {
        // dynamically import if needed or just use import
        // Since we import it, we can just new it up
        provider = new ProxyGeminiProvider(PROXY_BASE);
      } else if (effectiveMode === 'demo') {
        provider = new MockLLMProvider();
      } else {
        provider = new GeminiProvider(API_KEY);
      }
      
      const stream = provider.generateContentStream({
        messages: history.map(({ role, content, functionCall, functionResponse }) => ({ role, content, functionCall, functionResponse })),
        options: {
          systemInstruction: 'You are JARVIS, an AI workspace operator. Use your tools to fetch data and help the user.',
          tools: [{ functionDeclarations: workspaceTools }]
        }
      }, controller.signal);

      for await (const chunk of stream) {
        if (chunk.textDelta) {
          received += chunk.textDelta;
          commit(updateLastMessage(messagesRef.current, received));
        }
        if (chunk.functionCall) {
          const fn = chunk.functionCall;
          
          if (isMutationTool(fn.name)) {
            // Append the function call message so it's in history
            const withCall = appendMessage(messagesRef.current.slice(0, -1), 'assistant', '');
            withCall[withCall.length - 1].functionCall = fn;
            commit(withCall);
            
            setPendingMutation(fn);
            setStatus('awaiting_confirmation');
            return; // pause stream
          } else {
            // Auto-execute read-only tool
            const withCall = appendMessage(messagesRef.current.slice(0, -1), 'assistant', '');
            withCall[withCall.length - 1].functionCall = fn;
            commit(withCall);
            
            try {
              const result = await executeReadOnlyTool(fn.name, fn.args);
              const withResponse = appendMessage(messagesRef.current, 'user', '');
              withResponse[withResponse.length - 1].functionResponse = {
                name: fn.name,
                response: result
              };
              commit(appendMessage(withResponse, 'assistant', ''));
              
              // recurse to continue stream with updated history
              abortRef.current = null;
              void generateAssistantReply(messagesRef.current.slice(0, -1));
              return;
            } catch (err) {
              const errorResult = { error: String(err) };
              const withResponse = appendMessage(messagesRef.current, 'user', '');
              withResponse[withResponse.length - 1].functionResponse = {
                name: fn.name,
                response: errorResult
              };
              commit(appendMessage(withResponse, 'assistant', ''));
              
              abortRef.current = null;
              void generateAssistantReply(messagesRef.current.slice(0, -1));
              return;
            }
          }
        }
      }
      
      setStatus('idle');
    } catch (error) {
      if (!received) commit(messagesRef.current.slice(0, -1));
      setErrorText(friendlyErrorText(error));
      setStatus('error');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  };

  const handleSend = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = input.trim();
    if (!text || status === 'streaming') return;
    setInput('');
    setErrorText('');
    const withUser = appendMessage(messagesRef.current, 'user', text);
    commit(appendMessage(withUser, 'assistant', ''));
    void generateAssistantReply();
  };

  const handleRetry = (): void => {
    if (status === 'streaming') return;
    setErrorText('');
    const last = messagesRef.current[messagesRef.current.length - 1];
    if (!last || last.role !== 'assistant') {
      commit(appendMessage(messagesRef.current, 'assistant', ''));
    } else {
      commit(updateLastMessage(messagesRef.current, ''));
    }
    void generateAssistantReply();
  };
  
  const handleConfirmMutation = async () => {
    if (!pendingMutation) return;
    const fn = pendingMutation;
    setPendingMutation(null);
    setStatus('streaming');
    
    try {
      const result = await executeMutationTool(fn.name, fn.args);
      const withResponse = appendMessage(messagesRef.current, 'user', '');
      withResponse[withResponse.length - 1].functionResponse = {
        name: fn.name,
        response: result
      };
      commit(appendMessage(withResponse, 'assistant', ''));
      void generateAssistantReply(messagesRef.current.slice(0, -1));
    } catch (err) {
      const errorResult = { error: String(err) };
      const withResponse = appendMessage(messagesRef.current, 'user', '');
      withResponse[withResponse.length - 1].functionResponse = {
        name: fn.name,
        response: errorResult
      };
      commit(appendMessage(withResponse, 'assistant', ''));
      void generateAssistantReply(messagesRef.current.slice(0, -1));
    }
  };
  
  const handleDenyMutation = () => {
    if (!pendingMutation) return;
    const fn = pendingMutation;
    setPendingMutation(null);
    setStatus('streaming');
    
    const withResponse = appendMessage(messagesRef.current, 'user', '');
    withResponse[withResponse.length - 1].functionResponse = {
      name: fn.name,
      response: { error: 'User denied the action.' }
    };
    commit(appendMessage(withResponse, 'assistant', ''));
    void generateAssistantReply(messagesRef.current.slice(0, -1));
  };

  const busy = status === 'streaming';
  const sendDisabled = busy || input.trim() === '';
  const bannerReason = !isDemoMode(API_KEY)
    ? 'API key rejected'
    : apiMode === 'demo'
      ? 'no key (proxy & direct)'
      : 'no API key';

  return (
    <div style={{ fontSize: 10, lineHeight: 1.4, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {demoMode && (
        <div
          data-testid="chat-demo-banner"
          style={{
            color: '#8b8f98',
            fontStyle: 'italic',
            fontSize: 9,
            border: '1px dashed rgba(255, 255, 255, 0.14)',
            borderRadius: 6,
            padding: '1px 4px',
            marginBottom: 3,
          }}
        >
          DEMO MODE — {bannerReason}
        </div>
      )}
      <div
        ref={listRef}
        data-testid="chat-messages"
        style={{
          flex: 1,
          overflowY: 'auto',
          background: 'rgba(0, 0, 0, 0.35)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 6,
          padding: '4px',
          marginBottom: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}
      >
        {messages.map((message) => {
          if (message.functionCall) {
            return (
              <div key={message.id} style={{ color: '#8b8f98', fontStyle: 'italic', fontSize: 9 }}>
                JARVIS is calling {message.functionCall.name}...
              </div>
            );
          }
          if (message.functionResponse) {
             return null; // hide raw json responses from user
          }
          if (!message.content && !message.functionCall) return null;
          
          return (
            <div
              key={message.id}
              data-testid={
                message.role === 'user' ? 'chat-msg-user' : 'chat-msg-assistant'
              }
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: message.role === 'user' ? '#f4f5f7' : '#9aa0a8',
              }}
            >
              {message.role === 'user' ? 'YOU: ' : 'JARVIS: '}
              {message.content}
            </div>
          );
        })}
      </div>
      
      {status === 'awaiting_confirmation' && pendingMutation && (
        <div style={{
          background: 'rgba(50, 100, 200, 0.2)',
          border: '1px solid rgba(50, 100, 200, 0.5)',
          borderRadius: 6,
          padding: 6,
          marginBottom: 4
        }}>
          <div style={{ marginBottom: 4, color: '#e8eaed', fontWeight: 'bold' }}>
            Allow JARVIS to {pendingMutation.name}?
          </div>
          <div style={{ color: '#b0b5bd', fontSize: 9, marginBottom: 6 }}>
            Args: {JSON.stringify(pendingMutation.args)}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={handleConfirmMutation} style={{ ...sendButtonStyle, flex: 1, background: 'rgba(50, 100, 200, 0.4)' }}>
              Confirm
            </button>
            <button onClick={handleDenyMutation} style={{ ...sendButtonStyle, flex: 1 }}>
              Deny
            </button>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 3, alignItems: 'center' }}>
          <span
            data-testid="chat-error"
            style={{ color: '#ffd7d7', fontSize: 9, flex: 1, minWidth: 0 }}
          >
            {errorText}
          </span>
          <button
            type="button"
            data-testid="chat-retry"
            onClick={handleRetry}
            style={{
              ...sendButtonStyle,
              borderColor: '#ff5a5a',
              color: '#ffd7d7',
            }}
          >
            Retry
          </button>
        </div>
      )}
      
      {status !== 'awaiting_confirmation' && (
        <form onSubmit={handleSend} style={{ display: 'flex', gap: 4 }}>
          <input
            data-testid="chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask JARVIS…"
            spellCheck={false}
            style={inputStyle}
          />
          <button
            type="submit"
            data-testid="chat-send"
            disabled={sendDisabled}
            style={sendDisabled ? disabledSendStyle : sendButtonStyle}
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}