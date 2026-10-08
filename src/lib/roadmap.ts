/**
 * Which ideas to work on now, which next, and which not yet.
 *
 * Spec section 8's "idea roadmap builder".
 *
 * ## Why this is not "sort by score, cut into thirds"
 *
 * That is what most planning screens do and it is wrong in three specific ways,
 * each of which produces a confident, useless answer rather than an error:
 *
 * 1. **Equal buckets are not a plan.** Splitting forty ideas into thirds fills
 *    `later` with thirteen entries whether or not thirteen ideas deserve deferral.
 *    The screen looks decisive because the columns are full.
 * 2. **You cannot work on an idea you cannot act on.** A title with no score and no
 *    tasks ranks fine and is unstartable. Let it into `now` and the roadmap is
 *    telling you to begin something you have not yet decided whether to do.
 * 3. **Ranking forgets what you already started.** An idea with tasks half done
 *    loses its place to something that merely scores higher, so the plan quietly
 *    asks you to abandon work in progress. That is never the right answer, and no
 *    score should be able to produce it.
 *
 * So there are FOUR lanes, not three. The extra one is the honest one: `unready`
 * holds ideas that have not earned a place in a plan yet, and says what they are
 * missing instead of padding a column with them.
 *
 * ## Every placement can explain itself
 *
 * Each item carries a `reason`, same rule as `clustering.ts`. A roadmap you cannot
 * interrogate is a roadmap you stop trusting the first time it is wrong.
 *
 * ## Capacity is the actual feature
 *
 * `now` holding forty items is not a roadmap, it is the list again. `nowCapacity`
 * is a real WIP limit and, when something is displaced by it, the overflow is
 * reported rather than hidden - otherwise the roadmap's silence implies you were
 * never going to reach those things, which is a claim nobody can check.
 *
 * Pure and offline: no database, no network, deterministic given the same input.
 */

import { priorityScore } from './scoring';
import { maturityOf, type MaturityInput, type MaturityStage } from './maturity';

/** Anything the roadmap can look at. Generic so callers keep their row type. */
export type Roadmapable = MaturityInput & {
	_id: string;
	/** Insertion order; the tiebreak, and stable between renders. */
	seq?: number;
};

export type Lane = 'now' | 'next' | 'later' | 'unready';

export type RoadmapItem<T> = {
	idea: T;
	lane: Lane;
	/** Null when unscored, which is precisely why it cannot be ranked. */
	score: number | null;
	stage: MaturityStage;
	/** Why this lane. Never empty. */
	reason: string;
	/** The single next action, from maturity. Empty only at `committed`. */
	next: string;
};

export type RoadmapOptions = {
	/**
	 * How many ideas may be in `now`. Three, because that is roughly one week's
	 * worth of real focus and a limit you will actually notice you hit.
	 */
	nowCapacity?: number;
	/** How many may be in `next`. A queue, not a commitment. */
	nextCapacity?: number;
	/**
	 * Include committed ideas as `later`. Off by default: a finished idea is not a
	 * future plan item, and putting it in one quietly inflates the backlog.
	 */
	includeCommitted?: boolean;
};

const DEFAULTS = { nowCapacity: 3, nextCapacity: 7, includeCommitted: false } as const;

/**
 * The stages at which an idea can be planned, ascending.
 *
 * `judged` is the floor, and deliberately so: it means the three core questions are
 * answered AND it carries a score, which is exactly the point at which "should we
 * do this?" has an answer. Below that, an idea is a note - real, worth keeping, but
 * not plannable, and letting it into a lane makes the plan a fiction.
 */
const PLANNABLE_STAGES: MaturityStage[] = ['judged', 'actioned', 'committed'];

/** Sentence-case the first letter, so a maturity step reads mid-sentence. */
function lowerFirst(text: string): string {
	return text.charAt(0).toLowerCase() + text.slice(1);
}

export type Roadmap<T> = {
	items: RoadmapItem<T>[];
	now: RoadmapItem<T>[];
	next: RoadmapItem<T>[];
	later: RoadmapItem<T>[];
	unready: RoadmapItem<T>[];
	/**
	 * Plannable ideas that were ready for `now` but did not fit. Reported, because
	 * a roadmap that silently drops them implies a decision was made that nobody
	 * made.
	 */
	overflow: RoadmapItem<T>[];
	/** Committed ideas left out. Counted so the UI can say so rather than guess. */
	skipped: number;
	/**
	 * True when there is not a single plannable idea. A young lot should be told
	 * "score three ideas to build a roadmap", not shown three empty columns.
	 */
	empty: boolean;
};

export function buildRoadmap<T extends Roadmapable>(ideas: T[], options: RoadmapOptions = {}): Roadmap<T> {
	const { nowCapacity, nextCapacity, includeCommitted } = { ...DEFAULTS, ...options };

	const items: RoadmapItem<T>[] = [];
	let skipped = 0;

	for (const idea of ideas) {
		const maturity = maturityOf(idea);
		const score = priorityScore(idea);

		if (maturity.stage === 'committed' && !includeCommitted) {
			skipped++;
			continue;
		}

		items.push({
			idea,
			score,
			stage: maturity.stage,
			// Placeholder. Every item is re-assigned a real lane and a real reason
			// below; nothing is ever returned with this value, and returning `now`
			// rather than an empty string means a missed re-assignment shows up as a
			// visible wrong placement rather than a blank reason.
			lane: 'now',
			reason: '',
			next: maturity.next
		});
	}

	// --- unready -----------------------------------------------------------------
	//
	// Split out first, so capacity is decided among ideas that can actually be
	// planned. An unscored idea is not a low priority; it is an unranked one, and
	// pretending otherwise is how a note ends up competing with a decision.
	const unready: RoadmapItem<T>[] = [];
	const plannable: RoadmapItem<T>[] = [];
	for (const item of items) {
		// Each blocker named separately, then joined - so the reason reads as a list
		// of real gaps rather than one vague verdict. `maturityOf` is called once and
		// reused: the first version called it three times in a single expression,
		// which is both wasteful and how the three copies drifted apart.
		const blockers: string[] = [];
		if (item.score === null) blockers.push('not scored, so it cannot be ranked');
		if (!PLANNABLE_STAGES.includes(item.stage)) {
			blockers.push(item.next ? `still needs: ${lowerFirst(item.next)}` : 'not developed enough to plan');
		}

		if (blockers.length > 0) {
			unready.push({ ...item, lane: 'unready', reason: blockers.join('; ') });
		} else {
			plannable.push(item);
		}
	}

	// --- order -------------------------------------------------------------------
	//
	// Priority score first, then how far along it is, then newest first. Every
	// comparison is total, so two runs over the same lot produce the same plan - a
	// roadmap that reshuffles between renders stops being believed.
	const byRank = (a: RoadmapItem<T>, b: RoadmapItem<T>): number =>
		(b.score ?? 0) - (a.score ?? 0) ||
		maturityOf(b.idea).percent - maturityOf(a.idea).percent ||
		(b.idea.seq ?? 0) - (a.idea.seq ?? 0) ||
		a.idea._id.localeCompare(b.idea._id);

	plannable.sort(byRank);

	// --- lanes -------------------------------------------------------------------
	//
	// Work already started is not displaced. An idea at `actioned` has real tasks
	// against it and half-finished things are the most expensive thing to abandon,
	// so it holds its place in `now` regardless of rank. This is the one place the
	// roadmap deliberately ignores the score.
	//
	// Note `nowRoom` is clamped at zero: if more ideas are already started than the
	// capacity allows, every candidate overflows, which is the honest reading.
	const started = plannable.filter((item) => item.stage === 'actioned' || item.stage === 'committed');
	const candidates = plannable.filter((item) => !started.includes(item));

	const nowRoom = Math.max(nowCapacity - started.length, 0);
	const now = [...started.slice(0, Math.max(nowCapacity, 0)), ...candidates.slice(0, nowRoom)];

	/**
	 * Overflow is EVERY plannable idea that did not get a `now` slot.
	 *
	 * Not just the high-scoring candidates that ran out of room: with more work
	 * already in flight than the limit allows, the started ideas squeezed out by
	 * capacity are the ones most worth reporting, and the first version dropped them
	 * from the count entirely. `next` and `later` are then a capacity-limited view
	 * ON this set, so nothing is hidden by being outside the two of them.
	 */
	const overflow = plannable.filter((item) => !now.includes(item));
	const next = overflow.slice(0, Math.max(nextCapacity, 0));
	const later = overflow.slice(Math.max(nextCapacity, 0));

	const inProgress = (item: RoadmapItem<T>) => item.stage === 'actioned' || item.stage === 'committed';

	const reasonFor = (item: RoadmapItem<T>, lane: Lane): string => {
		switch (lane) {
			case 'now':
				return inProgress(item)
					? `already started - a score of ${item.score} does not justify stopping`
					: `top ${nowCapacity} by priority (score ${item.score})`;
			case 'next':
				// A started idea pushed out of `now` needs saying out loud, or it looks
				// like a fresh recommendation when it is really a delayed commitment.
				return inProgress(item)
					? 'already started, but `now` is full'
					: `next up (score ${item.score})`;
			case 'later':
				return `scored ${item.score}, behind the ideas ahead of it`;
			case 'unready':
				return '';
		}
	};

	const assign = (lane: Lane, list: RoadmapItem<T>[]): RoadmapItem<T>[] =>
		list.map((item) => ({ ...item, lane, reason: reasonFor(item, lane) }));

	const nowItems = assign('now', now);
	const nextItems = assign('next', next);
	const laterItems = assign('later', later);
	// Overflow is reported, not shown as a lane: these ideas are not in `now`, and
	// drawing them in a fourth column would defeat the capacity limit.
	const overflowItems = overflow.map((item) => ({
		...item,
		lane: 'later' as const,
		reason: `scored ${item.score}, but \`now\` is full at ${nowCapacity}`
	}));

	return {
		items: [...nowItems, ...nextItems, ...laterItems, ...unready],
		now: nowItems,
		next: nextItems,
		later: laterItems,
		unready,
		overflow: overflowItems,
		skipped,
		empty: plannable.length === 0
	};
}

/** Short lane heading for the UI. */
export const LANE_LABEL: Record<Lane, string> = {
	now: 'Now',
	next: 'Next',
	later: 'Later',
	unready: 'Not ready'
};

/** One-line explanation of a lane, so the columns are not just letters. */
export const LANE_MEANING: Record<Lane, string> = {
	now: 'Started or highest-scoring. The only column that is a commitment.',
	next: 'Scored and plausible, but not this week.',
	later: 'Scored, and genuinely behind. Not padding - nothing was deferred here by accident.',
	unready: 'Cannot be ranked or acted on yet. Each one says what it is missing.'
};