import { Text, View } from "react-native";
import { router } from "expo-router";
import { api, IDEA_STATUSES } from "../../lib/api";
import { useLiveQuery } from "../../lib/live-query";
import {
  Button,
  Failure,
  Heading,
  Loading,
  Note,
  Page,
  mono,
  usePalette,
} from "../../components/ui";
export default function Dashboard() {
  const query = useLiveQuery(api.ideas.stats, {});
  const c = usePalette();
  return (
    <Page>
      <Heading
        title="Make room for ideas."
        subtitle="Keep the sparks. Build the ones that matter."
      />
      <Button
        title="Capture an idea →"
        primary
        onPress={() => router.push("/ideas")}
      />
      <Failure message={query.error} retry={query.retry} />
      {query.data ? (
        <>
          {/*
            One quiet sentence, not two mono-caps captions.

            This was a `N ideas captured` label and a separate
            `N unscored · N favorites · N archived` line, both in the loud
            uppercase-mono eyebrow style. Two rows of chrome to state three numbers,
            when the pipeline below already shows the stage counts.
          */}
          <Note>
            {query.data.total} idea{query.data.total === 1 ? "" : "s"}
            {query.data.unscored
              ? ` · ${query.data.unscored} still to score`
              : " · all scored"}
            {query.data.archived
              ? ` · ${query.data.archived} archived`
              : " · nothing archived"}
          </Note>

          {/*
            The stage pipeline as one row of chips.

            It was six stacked `Label`/`Note` rows, which on a phone is roughly a
            third of the screen stating numbers that are mostly zero, and which the
            screenshot showed reading as a list of six captions rather than a
            pipeline. Chips put all six stages in one line: the eye scans across for
            the non-zero one instead of reading down past five zeros.

            Stages with ideas are tinted; empty ones stay plain, so the eye lands on
            the work. Amber is reserved for the plate, so the count is ink and the
            tint is panel - not another colour competing for meaning.
          */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {IDEA_STATUSES.map((status) => {
              const count = query.data!.byStatus[status] ?? 0;
              return (
                <View
                  key={status}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    borderWidth: 1,
                    borderColor: count ? c.line : c.line,
                    borderRadius: 8,
                    backgroundColor: count ? c.panel : "transparent",
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                  }}
                >
                  <Text
                    style={{
                      color: c.ink2,
                      fontSize: 12,
                      lineHeight: 15,
                      fontWeight: "600",
                    }}
                  >
                    {status.toLowerCase()}
                  </Text>
                  <Text
                    style={{
                      color: count ? c.ink : c.muted,
                      fontFamily: mono,
                      fontSize: 12,
                      lineHeight: 15,
                      fontWeight: "700",
                    }}
                  >
                    {count}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      ) : (
        !query.error && <Loading />
      )}
    </Page>
  );
}
