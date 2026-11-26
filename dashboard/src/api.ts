const BASE_URL = 'http://localhost:3001/api';

const getHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
};

export const api = {
  login: async (email: string, password: string) => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Login failed');
    localStorage.setItem('token', data.token);
    return data;
  },
  
  logout: () => {
    localStorage.removeItem('token');
    window.location.reload();
  },

  getCompanyInfo: async () => {
    const res = await fetch(`${BASE_URL}/companies/me`, {
      headers: getHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.company;
  },

  updateCompany: async (updates: any) => {
    const res = await fetch(`${BASE_URL}/companies/me`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.company;
  },

  getLogs: async (page = 1, limit = 20) => {
    const res = await fetch(`${BASE_URL}/companies/me/logs?page=${page}&limit=${limit}`, {
      headers: getHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  }
};
