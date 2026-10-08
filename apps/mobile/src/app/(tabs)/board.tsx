import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from 'convex/react';
import { api, IDEA_STATUSES, lotPlate, type Id } from '../../lib/api';
import { useLiveQuery } from '../../lib/live-query';
import { errorMessage } from '../../lib/auth';
import { Button, Failure, Heading, Label, Loading, Note, Page, usePalette } from '../../components/ui';
export default function Board() {
  const c = usePalette(); const query = useLiveQuery(api.ideas.list, {}); const setStatus = useMutation(api.ideas.setStatus);
  const [selected, setSelected] = useState<Id<'ideas'> | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  async function move(stage: typeof IDEA_STATUSES[number]) { if (!selected || busy) return; setBusy(true); setError(undefined); try { await setStatus({ ideaId: selected, status: stage }); setSelected(null); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  return <Page><Heading title="From spark to done." subtitle="Select an idea, then choose its destination stage." /><Failure message={query.error} retry={query.retry} /><Failure message={error} />{query.data?.truncated && <Note>Showing {query.data.ideas.length} of {query.data.total}. Use the lot’s stage filter to find more.</Note>}{selected && <Button title="Cancel move" disabled={busy} onPress={() => setSelected(null)} />}{query.data ? <ScrollView horizontal contentContainerStyle={{ gap: 16 }} showsHorizontalScrollIndicator><>{IDEA_STATUSES.map((stage) => <View key={stage} style={{ width: 270, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line, padding: 16, gap: 14 }}><Label>{stage} / {query.data!.ideas.filter((idea) => idea.status === stage).length}</Label>{selected && <Button title={`Move here: ${stage}`} primary disabled={busy} onPress={() => void move(stage)} />}{query.data!.ideas.filter((idea) => idea.status === stage).map((idea) => <View key={idea._id} style={{ gap: 10, borderTopWidth: 1, borderColor: c.line, paddingTop: 14 }}><Note>{lotPlate(idea.seq)}</Note><Label>{idea.title}</Label><Button title="Open idea" onPress={() => router.push({ pathname: '/idea/[id]', params: { id: idea._id } })} /><Button title={selected === idea._id ? 'Selected to move ✓' : 'Move idea'} disabled={busy} onPress={() => setSelected(idea._id as Id<'ideas'>)} /></View>)}</View>)}</></ScrollView> : !query.error && <Loading />}</Page>;
}
