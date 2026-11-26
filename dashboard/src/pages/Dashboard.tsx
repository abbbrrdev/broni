import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Bot, LogOut, Settings, PhoneCall, Save, CheckCircle2 } from 'lucide-react';

import { LiveMonitorTab } from './LiveMonitorTab';
import { CalendarTab } from './CalendarTab';

export interface ChatMessage {
  id: string;
  sender: 'client' | 'ai';
  text: string;
}

export function Dashboard() {
  const [activeTab, setActiveTab] = useState<'settings' | 'logs' | 'live' | 'calendar'>('settings');
  const [company, setCompany] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [wsSocket, setWsSocket] = useState<WebSocket | null>(null);

  // Live Monitor State
  const [liveIsActive, setLiveIsActive] = useState(false);
  const [liveCallerPhone, setLiveCallerPhone] = useState<string | null>(null);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);

  // Settings State
  const [systemPrompt, setSystemPrompt] = useState('');
  const [sipNumber, setSipNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchData();
    
    // Подключение к WebSocket для риал-тайм фич
    const ws = new WebSocket('ws://localhost:3001/api/ws');
    setWsSocket(ws);
    
    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'call_start':
            setLiveIsActive(true);
            setLiveCallerPhone(data.callerPhone);
            setLiveMessages([]);
            break;
          case 'call_end':
            setLiveIsActive(false);
            break;
          case 'client_speaking':
            setLiveMessages(prev => [...prev, { id: Date.now().toString(), sender: 'client', text: data.text }]);
            break;
          case 'ai_speaking':
            setLiveMessages(prev => [...prev, { id: Date.now().toString(), sender: 'ai', text: data.text }]);
            break;
        }
      } catch (e) {}
    });

    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'logs') {
      fetchLogs();
    }
  }, [activeTab]);

  const fetchData = async () => {
    try {
      const data = await api.getCompanyInfo();
      setCompany(data);
      setSystemPrompt(data.systemPrompt);
      setSipNumber(data.sipNumber);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const data = await api.getLogs();
      setLogs(data.logs);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await api.updateCompany({ systemPrompt, sipNumber });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 40, color: 'var(--text-secondary)' }}>Загрузка...</div>;
  if (!company) {
    return (
      <div style={{ padding: 40 }}>
        <div style={{ color: 'var(--danger)', marginBottom: 16 }}>Ошибка загрузки компании. Возможно, сессия устарела.</div>
        <button className="btn btn-secondary" onClick={() => api.logout()}>Выйти и войти заново</button>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 40 }}>
          <div style={{ padding: 8, background: 'var(--accent-glow)', borderRadius: 'var(--radius-sm)' }}>
            <Bot size={24} color="var(--accent-color)" />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{company.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>AI Assistant</div>
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          <button 
            className={`btn ${activeTab === 'live' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', border: activeTab === 'live' ? 'none' : '1px solid transparent', background: activeTab === 'live' ? 'var(--primary-color)' : 'rgba(255,255,255,0.05)' }}
            onClick={() => setActiveTab('live')}
          >
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)', boxShadow: '0 0 8px var(--danger)' }} />
            Live Мониторинг
          </button>
          
          <button 
            className={`btn ${activeTab === 'calendar' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', border: activeTab === 'calendar' ? 'none' : '1px solid transparent' }}
            onClick={() => setActiveTab('calendar')}
          >
            <CheckCircle2 size={18} /> Календарь
          </button>

          <button 
            className={`btn ${activeTab === 'settings' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', border: activeTab === 'settings' ? 'none' : '1px solid transparent' }}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={18} /> Настройки ИИ
          </button>
          
          <button 
            className={`btn ${activeTab === 'logs' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', border: activeTab === 'logs' ? 'none' : '1px solid transparent' }}
            onClick={() => setActiveTab('logs')}
          >
            <PhoneCall size={18} /> История звонков
          </button>
        </nav>

        <button 
          className="btn btn-secondary" 
          style={{ justifyContent: 'flex-start', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.2)' }}
          onClick={() => api.logout()}
        >
          <LogOut size={18} /> Выйти
        </button>
      </div>

      {/* Main Content */}
      <div className="main-content">
        {activeTab === 'settings' && (
          <div className="animate-fade-in" style={{ maxWidth: 800 }}>
            <h1 style={{ marginBottom: 8 }}>Настройки ИИ-Администратора</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>
              Здесь вы можете изменить поведение вашего голосового робота и его настройки телефонии.
            </p>

            <div className="glass-panel" style={{ padding: 32, marginBottom: 24 }}>
              <h3 style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bot size={20} color="var(--accent-color)"/> Базовые настройки
              </h3>
              
              <div className="input-group">
                <label className="input-label">SIP Номер (Zadarma)</label>
                <input 
                  type="text" 
                  className="input-field" 
                  value={sipNumber}
                  onChange={e => setSipNumber(e.target.value)}
                />
              </div>

              <div className="input-group" style={{ marginTop: 24 }}>
                <label className="input-label">
                  Системный Промпт (Инструкция)
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontWeight: 400 }}>
                    Опишите, как должен вести себя бот. Что он должен предлагать, как отвечать на вопросы.
                  </span>
                </label>
                <textarea 
                  className="input-field" 
                  style={{ minHeight: 200, fontFamily: 'monospace', fontSize: 13 }}
                  value={systemPrompt}
                  onChange={e => setSystemPrompt(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
                <button className="btn btn-primary" onClick={handleSaveSettings} disabled={saving}>
                  {saved ? <CheckCircle2 size={18} /> : <Save size={18} />}
                  {saved ? 'Сохранено!' : saving ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="animate-fade-in">
            <h1 style={{ marginBottom: 8 }}>История звонков</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>
              Все входящие звонки и записи разговоров вашего бизнеса.
            </p>

            <div className="glass-panel" style={{ overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)' }}>
                    <th style={{ padding: '16px 24px', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>Дата</th>
                    <th style={{ padding: '16px 24px', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>Телефон клиента</th>
                    <th style={{ padding: '16px 24px', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>Итог / Транскрипция</th>
                    <th style={{ padding: '16px 24px', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>Статус</th>
                    <th style={{ padding: '16px 24px', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>Аудио</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        Пока нет записей звонков
                      </td>
                    </tr>
                  ) : (
                    logs.map(log => (
                      <tr key={log.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '16px 24px', fontSize: 14 }}>{new Date(log.createdAt).toLocaleString('ru-RU')}</td>
                        <td style={{ padding: '16px 24px', fontSize: 14 }}>{log.clientPhone || 'Неизвестно'}</td>
                        <td style={{ padding: '16px 24px', fontSize: 14, color: 'var(--text-secondary)', maxWidth: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {log.transcript || 'Нет транскрипции'}
                        </td>
                        <td style={{ padding: '16px 24px' }}>
                          <span style={{ 
                            padding: '4px 8px', 
                            borderRadius: '4px', 
                            fontSize: 12, 
                            fontWeight: 600,
                            background: log.status === 'COMPLETED' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                            color: log.status === 'COMPLETED' ? 'var(--success)' : 'var(--danger)'
                          }}>
                            {log.status}
                          </span>
                        </td>
                        <td style={{ padding: '16px 24px' }}>
                          {log.audioRecordUrl ? (
                            <audio controls src={`http://localhost:3001${log.audioRecordUrl}`} style={{ height: 32, maxWidth: 200 }} />
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Нет записи</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'live' && (
          <LiveMonitorTab 
            isActive={liveIsActive} 
            callerPhone={liveCallerPhone} 
            messages={liveMessages} 
          />
        )}
        {activeTab === 'calendar' && <CalendarTab wsSocket={wsSocket} />}
      </div>
    </div>
  );
}
