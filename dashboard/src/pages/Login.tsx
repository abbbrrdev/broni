import React, { useState } from 'react';
import { api } from '../api';
import { Bot, ChevronRight, Lock, Mail } from 'lucide-react';

interface LoginProps {
  onLogin: () => void;
}

export function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.login(email, password);
      onLogin();
    } catch (err: any) {
      setError(err.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: 400, padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ 
            display: 'inline-flex', 
            padding: 12, 
            background: 'var(--accent-glow)', 
            borderRadius: '50%',
            marginBottom: 16
          }}>
            <Bot size={32} color="var(--accent-color)" />
          </div>
          <h1 style={{ fontSize: 28, marginBottom: 8 }}>Вход в систему</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Управление AI-ассистентом для бизнеса
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Mail size={14} /> Email
            </label>
            <input 
              type="email" 
              className="input-field" 
              placeholder="admin@restaurant.kz"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="input-group" style={{ marginBottom: 24 }}>
            <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Lock size={14} /> Пароль
            </label>
            <input 
              type="password" 
              className="input-field" 
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div style={{ 
              background: 'rgba(239, 68, 68, 0.1)', 
              color: 'var(--danger)', 
              padding: '12px 16px', 
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
              marginBottom: 24,
              border: '1px solid rgba(239, 68, 68, 0.2)'
            }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Загрузка...' : 'Войти в панель'} 
            <ChevronRight size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
