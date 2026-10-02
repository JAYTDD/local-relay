import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import ChannelHealth from './components/ChannelHealth.jsx';

export default function App() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      setError('');
      setHealth(await api.getHealth());
    } catch (e) {
      setError(String(e.message ?? e));
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>local-relay 控制面板</h1>
        <p className="muted">本地订阅中转网关 · Trae / WorkBuddy / Qoder</p>
      </header>
      {error && <div className="banner err">{error}</div>}
      <main className="app-body">
        <ChannelHealth health={health} />
      </main>
    </div>
  );
}
