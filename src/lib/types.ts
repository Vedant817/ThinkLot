export type IdeaStatus = 'inbox' | 'parked' | 'reviewing' | 'ready' | 'building' | 'done';

export const IDEA_STATUSES: IdeaStatus[] = [
	'inbox',
	'parked',
	'reviewing',
	'ready',
	'building',
	'done'
];

/** What the client sees. Mirrors `ideas` in the Convex schema. */
export type Idea = {
	_id: string;
	seq: number;
	title: string;
	description?: string;
	problem?: string;
	/** Spec field: "Who is it for". */
	audience?: string;
	/** Spec field: "Expected outcome". */
	outcome?: string;
	/** Spec field: "Source / trigger" - what prompted the idea. Not dictation. */
	trigger?: string;
	/**
	 * First 160 characters of `description`, supplied by the list query. The list
	 * deliberately does not ship the full (up to 20 KB) body.
	 */
	preview?: string;
	/**
	 * Why this idea was let go, supplied by the list query when there is one.
	 *
	 * Present on the phone and the web detail and archive views. It was collected from
	 * the first version and then rendered nowhere, so the reason a user was required to
	 * type when rejecting an idea was unreadable afterwards - which made the question
	 * decorative.
	 */
	letGoReason?: string;
	/**
	 * When this idea was let go, supplied by the list query when set.
	 *
	 * Conditional like `letGoReason`: analytics needs "finished vs let go" counts
	 * without fetching every idea, and a timestamp is a few bytes. Absent for
	 * ideas never let go, so the common case costs nothing.
	 */
	letGoAt?: number;
	/**
	 * Whether a verbatim transcript was kept, without shipping it.
	 *
	 * The list must never carry transcript text (up to 20 KB of dictated speech
	 * per idea), but the voice-quality metric needs to know it exists. A boolean
	 * answers "your words were kept" for zero bytes in the common typed case.
	 */
	hasTranscript?: boolean;
	/**
	 * How many of `problem` / `audience` / `outcome` are answered (0-3).
	 *
	 * The list omits all three - they are long free text and the list is capped - so
	 * without this count `maturityOf` reads every listed idea as an unformed spark.
	 * It is a count rather than the text precisely so it can be carried cheaply.
	 */
	coreFields?: number;
	status: IdeaStatus;
	tags: string[];
	impact?: number;
	effort?: number;
	confidence?: number;
	favorite: boolean;
	archived: boolean;
	revisitAt?: number;
	source: 'typed' | 'dictated';
	transcript?: string;
	createdAt: number;
	updatedAt: number;
};

export type IdeaStats = {
	/** Every idea ever parked, archived included. */
	total: number;
	/** Still in the lot. `total` minus `archived`. */
	active: number;
	archived: number;
	byStatus: Record<string, number>;
	unscored: number;
	favorites: number;
};

/**
 * One entry in an idea's history.
 *
 * `kind` is a wire value, not a closed union: a timeline that hides events it does
 * not recognise is lying by omission, and the next kind added would simply vanish
 * from the screen. Unknown kinds are rendered as their own name.
 */
export type TimelineEvent = {
	id: string;
	kind: string;
	detail: string | null;
	createdAt: number;
};

/** One checklist row. Mirrors `ideaTasks` in the Convex schema. */
export type IdeaTask = {	_id: string;
	ideaId: string;
	title: string;
	completed: boolean;
	position: number;
	createdAt: number;
};