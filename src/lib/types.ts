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

/** One checklist row. Mirrors `ideaTasks` in the Convex schema. */
export type IdeaTask = {
	_id: string;
	ideaId: string;
	title: string;
	completed: boolean;
	position: number;
	createdAt: number;
};