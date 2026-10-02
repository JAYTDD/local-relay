import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import ChannelHealth from './components/ChannelHealth.jsx';
import TraeCard from './components/TraeCard.jsx';

export default function App() {
  const [health, setHealth] = useState(null);
  const [trae, setTrae] = useState(null);
  const [error, setError] = useState('');

  const loadTrae = useCallback(async () => {
    setTrae(await api.getTrae());
  }, []);

  const reload = useCallback(async () => {
    try {
      setError('');
      const [h] = await Promise.all([api.getHealth(), loadTrae()]);
      setHealth(h);
    } catch (e) {
      setError(String(e.message ?? e));
    }
  }, [loadTrae]);

  useEffect(() => { reload(); }, [reload]);

  const refreshTrae = useCallback(async (region) => {
    await api.postTraeRefresh(region);
    await loadTrae();
  }, [loadTrae]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>local-relay 控制面板</h1>
        <p className="muted">本地订阅中转网关 · Trae / WorkBuddy / Qoder</p>
      </header>
      {error && <div className="banner err">{error}</div>}
      <main className="app-body">
        <ChannelHealth health={health} />
        <TraeCard data={trae} onRefresh={refreshTrae} onCheckin={() => {}} />
      </main>
    </div>
  );
}
