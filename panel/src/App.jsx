import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import ChannelHealth from './components/ChannelHealth.jsx';
import TraeCard from './components/TraeCard.jsx';
import WorkBuddyCard from './components/WorkBuddyCard.jsx';
import QoderCard from './components/QoderCard.jsx';

export default function App() {
  const [health, setHealth] = useState(null);
  const [trae, setTrae] = useState(null);
  const [wb, setWb] = useState(null);
  const [qoder, setQoder] = useState(null);
  const [error, setError] = useState('');

  const loadTrae = useCallback(async () => { setTrae(await api.getTrae()); }, []);
  const loadWb = useCallback(async () => { setWb(await api.getWorkBuddy()); }, []);
  const loadQoder = useCallback(async () => { setQoder(await api.getQoder()); }, []);

  const reload = useCallback(async () => {
    try {
      setError('');
      const [h] = await Promise.all([api.getHealth(), loadTrae(), loadWb(), loadQoder()]);
      setHealth(h);
    } catch (e) {
      setError(String(e.message ?? e));
    }
  }, [loadTrae, loadWb, loadQoder]);

  useEffect(() => { reload(); }, [reload]);

  const refreshTrae = useCallback(async (region) => {
    await api.postTraeRefresh(region);
    await loadTrae();
  }, [loadTrae]);

  const checkinTrae = useCallback(async (region) => {
    const out = await api.postTraeCheckin(region);
    await loadTrae();
    return out;
  }, [loadTrae]);

  const controlWb = useCallback(async (variant, action) => {
    const out = await api.postWorkBuddyControl(variant, action);
    await loadWb();
    return out;
  }, [loadWb]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>local-relay 控制面板</h1>
        <p className="muted">本地订阅中转网关 · Trae / WorkBuddy / Qoder</p>
      </header>
      {error && <div className="banner err">{error}</div>}
      <main className="app-body">
        <ChannelHealth health={health} />
        <TraeCard data={trae} onRefresh={refreshTrae} onCheckin={checkinTrae} />
        <WorkBuddyCard data={wb} onControl={controlWb} />
        <QoderCard data={qoder} />
      </main>
    </div>
  );
}
