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
	total: number;
	archived: number;
	byStatus: Record<string, number>;
	unscored: number;
	favorites: number;
};