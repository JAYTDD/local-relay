for (const p of ['dsh-connect-trae','dsh-workbuddy-connect','dsh-qoder-connect']) {
  try {
    const m = await import(p);
    const shim = Object.keys(m).filter(k => /shim/i.test(k));
    const gw = Object.keys(m).filter(k => /gateway|createServer/i.test(k));
    console.log(`✅ ${p}`);
    console.log('   shim相关:', shim.join(', ') || '(无)');
    console.log('   gateway相关:', gw.join(', ') || '(无)');
  } catch (e) {
    console.log(`❌ ${p}: ${e.message.slice(0,150)}`);
  }
}
