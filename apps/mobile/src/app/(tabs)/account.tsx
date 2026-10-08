import { useState } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import { api } from '../../lib/api';
import { useLiveQuery } from '../../lib/live-query';
import { errorMessage } from '../../lib/auth';
import { Button, Failure, Heading, Loading, Note, Page } from '../../components/ui';
export default function Account() {
  const { signOut } = useAuthActions(); const profile = useLiveQuery(api.users.current, {});
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  async function logout() { setBusy(true); setError(undefined); try { await signOut(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  return <Page><Heading title="Your lot." /><Failure message={profile.error} retry={profile.retry} />{profile.data ? <Note>{profile.data.email}</Note> : !profile.error && <Loading />}<Note>Your ideas sync with the same account on web and mobile. Theme follows your device.</Note><Failure message={error} /><Button title={busy ? 'Signing out…' : 'Sign out'} disabled={busy} onPress={() => void logout()} /></Page>;
}
