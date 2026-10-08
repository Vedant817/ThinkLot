/**
 * Which ideas belong together.
 *
 * Spec section 8's "idea clustering", done deterministically - no model, no API,
 * no per-call budget.
 *
 * ## Why this is not just "ideas sharing a tag"
 *
 * The obvious implementation groups any two ideas that share any tag, and it is
 * worthless in practice. Everybody tags something `#work` or `#idea`, so one common
 * tag chains the entire lot into a single cluster and the feature reports, proudly,
 * that all 400 of your ideas are related. It is technically true and completely
 * uninformative - the same failure as a search that matches everything.
 *
 * So a tag only earns a cluster if it is INFORMATIVE: shared by more than one idea,
 * and by only a minority of them. `#handover` on six of forty ideas says something.
 * `#work` on thirty-eight of forty says nothing, and is dropped.
 *
 * ## Why a cluster binds on ONE tag, not on a chain
 *
 * Connected components - A shares x with B, B shares y with C - produce clusters
 * where no two members share anything. "Why are these three together?" has no
 * answer, and an unexplained grouping is worse than no grouping. Every cluster here
 * is bound by a single named tag and can say so, which is also what makes the
 * grouping checkable rather than mysterious.
 *
 * ## Why an idea may appear in more than one cluster
 *
 * Because that is the truth. An idea tagged `#handover` and `#field` genuinely
 * belongs to both conversations. Forcing one cluster per idea would mean silently
 * discarding a real relationship, and the app would be quietly lying about the
 * user's own data. `primaryClusterFor` picks the strongest one when a single
 * answer is needed.
 *
 * Pure and offline: no database, no network, deterministic given the same input.
 */

export type Clusterable = {
	_id: string;
	tags: string[];
};

export type Cluster = {
	/** The tag that binds these ideas together. Always a real tag. */
	tag: string;
	memberIds: string[];
	/** Plain wording, so a grouping can explain itself on screen. */
	rationale: string;
	/**
	 * How discriminating this tag is: 1 for a tag only two ideas share, approaching
	 * 0 for one nearly everybody shares. Exposed because "how strong is this
	 * relationship" is a question worth answering even when nothing is displayed.
	 */
	specificity: number;
};

export type ClusterOptions = {
	/**
	 * The largest share of the lot a tag may appear on and still be considered
	 * informative. Above this, sharing the tag is the rule rather than the
	 * exception.
	 */
	maxShare?: number;
	/** Ignore clusters smaller than this. A pair is usually a coincidence. */
	minSize?: number;
};

const DEFAULTS = { maxShare: 0.4, minSize: 2 } as const;

/** Every tag in the set, lowercased, counting how many ideas carry each. */
function tagFrequency(ideas: Clusterable[]): Map<string, number> {
	const frequency = new Map<string, number>();
	for (const idea of ideas) {
		// A Set, because the same tag twice on one idea must not make it look like
		// two ideas share it.
		for (const tag of new Set(idea.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))) {
			frequency.set(tag, (frequency.get(tag) ?? 0) + 1);
		}
	}
	return frequency;
}

export function clusterIdeas(
	ideas: Clusterable[],
	options: ClusterOptions = {}
): Cluster[] {
	const { maxShare, minSize } = { ...DEFAULTS, ...options };
	if (ideas.length < minSize) return [];

	const frequency = tagFrequency(ideas);
	const members = new Map<string, string[]>();
	for (const idea of ideas) {
		for (const tag of new Set(idea.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))) {
			const list = members.get(tag);
			if (list) list.push(idea._id);
			else members.set(tag, [idea._id]);
		}
	}

	const clusters: Cluster[] = [];

	/**
	 * The largest group that still counts as a signal.
	 *
	 * `maxShare` alone is wrong on a small lot: with four ideas, ANY pair is 50% of
	 * the set, so a pure ratio dropped every tag and clustering silently did
	 * nothing. Two ideas sharing a tag out of four is obviously a relationship.
	 *
	 * So the cap has a floor of `minSize`. A group of two is never "the rule", even
	 * in a lot of two, and the ratio only starts excluding things once there are
	 * enough ideas for a majority to mean something.
	 */
	const cap = Math.max(minSize, Math.ceil(ideas.length * maxShare));

	for (const [tag, ids] of members) {
		if (ids.length < minSize) continue;

		// A tag on most of the lot carries no information: sharing it is the rule,
		// not the signal. This is the whole point of the module.
		if (ids.length > cap) continue;

		// Specificity falls as the tag spreads. Two ideas sharing a rare tag is the
		// strongest possible signal, so that starts at 1.
		const specificity = Math.max(0, 1 - (ids.length - minSize) / ideas.length);

		clusters.push({
			tag,
			memberIds: ids,
			rationale: `shares #${tag}`,
			specificity
		});
	}

	// Largest first, then by tag so the order is stable between renders. A list that
	// reshuffles on every keystroke makes people distrust it.
	return clusters.sort((a, b) => b.memberIds.length - a.memberIds.length || a.tag.localeCompare(b.tag));
}

/**
 * The ideas most closely related to one idea, strongest relationship first.
 *
 * Scoped to ideas that share an INFORMATIVE tag with this one, for the same reason
 * clustering drops common tags: "4 other ideas also mention #work" is not related,
 * it is arithmetic.
 */
export function relatedIdeas<T extends Clusterable>(
	target: T,
	ideas: T[],
	limit = 5
): { idea: T; via: string }[] {
	if (ideas.length < 2) return [];

	const frequency = tagFrequency(ideas);
	const total = ideas.length;
	const targetTags = new Set(target.tags.map((t) => t.trim().toLowerCase()).filter(Boolean));

	const cap = Math.max(DEFAULTS.minSize, Math.ceil(total * DEFAULTS.maxShare));
	const scored: { idea: T; via: string; weight: number }[] = [];
	for (const idea of ideas) {
		if (idea._id === target._id) continue;
		for (const tag of idea.tags.map((t) => t.trim().toLowerCase())) {
			if (!targetTags.has(tag) || !tag) continue;
			const shared = frequency.get(tag) ?? 0;
			// Same informativeness rule as clustering, including the small-lot floor.
			if (shared > cap) continue;
			scored.push({ idea, via: tag, weight: 1 - shared / total });
		}
	}

	// One entry per idea, keeping its strongest shared tag.
	const best = new Map<string, { idea: T; via: string; weight: number }>();
	for (const entry of scored) {
		const existing = best.get(entry.idea._id);
		if (!existing || entry.weight > existing.weight) best.set(entry.idea._id, entry);
	}

	return [...best.values()]
		.sort((a, b) => b.weight - a.weight || a.idea._id.localeCompare(b.idea._id))
		.slice(0, limit)
		.map(({ idea, via }) => ({ idea, via }));
}

/** The single best cluster for an idea, for where one answer is needed. */
export function primaryClusterFor(idea: Clusterable, clusters: Cluster[]): Cluster | null {
	const mine = clusters.filter((cluster) => cluster.memberIds.includes(idea._id));
	if (mine.length === 0) return null;
	return mine.reduce((best, cluster) =>
		cluster.memberIds.length > best.memberIds.length ||
		(cluster.memberIds.length === best.memberIds.length && cluster.tag.localeCompare(best.tag) < 0)
			? cluster
			: best
	);
}
