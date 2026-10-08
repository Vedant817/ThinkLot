import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthToken } from '@convex-dev/auth/react';
import { useMutation } from 'convex/react';
import { api } from '../lib/api';
import { errorMessage } from '../lib/auth';
import { Button, Failure, Field } from './ui';
export function Capture() {
  const capture = useMutation(api.ideas.capture);
  const token = useAuthToken();
  let owner = '';
  try { owner = JSON.parse(atob(token!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub.split('|')[0]; } catch { /* Only namespace local drafts; never used as auth. */ }
  const storageKey = `thinklot:capture:${owner}`;
  const [draft, setDraft] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(storageKey).then((saved) => { if (active) { setDraft((current) => current || saved || ''); setLoaded(true); } }).catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [storageKey]);
  useEffect(() => {
    if (!loaded || !owner) return;
    const timer = setTimeout(() => { void AsyncStorage.setItem(storageKey, draft).catch(() => setError('Could not keep a local draft. Keep this screen open until your idea is saved.')); }, 250);
    return () => clearTimeout(timer);
  }, [draft, loaded, owner, storageKey]);
  async function submit() {
    if (busy || !draft.trim()) return; setBusy(true); setError(undefined);
    const submitted = draft;
    try { await capture({ title: submitted, source: 'typed' }); setDraft((current) => current === submitted ? '' : current); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <><Field label="Capture a spark" placeholder="What’s on your mind?" value={draft} onChangeText={setDraft} multiline maxLength={20000} /><Button title={busy ? 'Parking…' : 'Park this idea'} primary disabled={busy || !draft.trim()} onPress={() => void submit()} /><Failure message={error} /></>;
}
