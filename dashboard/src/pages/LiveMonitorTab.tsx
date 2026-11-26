import React, { useEffect, useRef } from 'react';
import { Phone, User, Bot, Loader2, PhoneOff } from 'lucide-react';
import type { ChatMessage } from './Dashboard';

interface Props {
  isActive: boolean;
  callerPhone: string | null;
  messages: ChatMessage[];
}

export function LiveMonitorTab({ isActive, callerPhone, messages }: Props) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="animate-fade-in" style={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ marginBottom: 8 }}>Live Мониторинг звонков</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
        Наблюдайте за общением вашего ИИ-администратора с клиентами в реальном времени.
      </p>

      <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Status Bar */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ 
              width: 12, height: 12, borderRadius: '50%', 
              background: isActive ? 'var(--success)' : 'var(--text-muted)',
              boxShadow: isActive ? '0 0 10px var(--success)' : 'none',
              animation: isActive ? 'pulse 2s infinite' : 'none'
            }} />
            <span style={{ fontWeight: 600, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {isActive ? 'Звонок в процессе...' : 'Ожидание звонка...'}
            </span>
          </div>
          {isActive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: 14 }}>
              <Phone size={16} /> {callerPhone}
            </div>
          )}
        </div>

        {/* Chat Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!isActive && messages.length === 0 ? (
            <div style={{ margin: 'auto', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <PhoneOff size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
              <p>Пока нет активных звонков.</p>
              <p style={{ fontSize: 13, marginTop: 4 }}>Позвоните на ваш номер, чтобы увидеть магию!</p>
            </div>
          ) : (
            <>
              {messages.map(msg => (
                <div key={msg.id} style={{ 
                  alignSelf: msg.sender === 'client' ? 'flex-start' : 'flex-end',
                  maxWidth: '70%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4
                }}>
                  <div style={{ 
                    fontSize: 12, 
                    color: 'var(--text-muted)', 
                    textAlign: msg.sender === 'client' ? 'left' : 'right',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    justifyContent: msg.sender === 'client' ? 'flex-start' : 'flex-end'
                  }}>
                    {msg.sender === 'client' ? <><User size={12}/> Клиент</> : <><Bot size={12}/> ИИ Ассистент</>}
                  </div>
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: 16,
                    borderBottomLeftRadius: msg.sender === 'client' ? 4 : 16,
                    borderBottomRightRadius: msg.sender === 'ai' ? 4 : 16,
                    background: msg.sender === 'client' ? 'rgba(255,255,255,0.05)' : 'var(--primary-color)',
                    color: msg.sender === 'client' ? 'var(--text-secondary)' : '#fff',
                    border: msg.sender === 'client' ? '1px solid var(--border-color)' : 'none',
                    lineHeight: 1.5,
                    fontSize: 15
                  }}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isActive && messages.length > 0 && messages[messages.length - 1].sender === 'client' && (
                 <div style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
                   <Loader2 size={14} className="spin" /> ИИ думает...
                 </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
          70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
          100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        .spin {
          animation: spin 2s linear infinite;
        }
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
