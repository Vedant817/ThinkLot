import { View } from 'react-native';
import { router } from 'expo-router';
import { api, IDEA_STATUSES } from '../../lib/api';
import { useLiveQuery } from '../../lib/live-query';
import { Button, Failure, Heading, Label, Loading, Note, Page, styles } from '../../components/ui';
export default function Dashboard() {
  const query = useLiveQuery(api.ideas.stats, {});
  return <Page><Heading title="Make room for ideas." subtitle="Keep the sparks. Build the ones that matter." /><Button title="Capture an idea →" primary onPress={() => router.push('/ideas')} /><Failure message={query.error} retry={query.retry} />{query.data ? <><View style={styles.section}><Label>{query.data.total} ideas captured</Label><Note>{query.data.unscored} unscored · {query.data.favorites} favorites · {query.data.archived} archived</Note></View>{IDEA_STATUSES.map((status) => <View key={status} style={styles.row}><Label>{status}</Label><Note>{query.data!.byStatus[status] ?? 0}</Note></View>)}</> : !query.error && <Loading />}</Page>;
}
