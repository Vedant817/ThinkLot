/**
 * How far an idea has actually been developed.
 *
 * The product is described as an "Idea Lifecycle Manager + Decision System +
 * Execution Tool", and the thing that makes those three different is usually
 * written down rather than built. An idea in a list might be a title, or it might
 * be a decision somebody can act on, and nothing on screen says which.
 *
 * Maturity answers that, and - more usefully - answers "what is missing next",
 * because that is the question worth asking of a parked idea. It is deliberately
 * DERIVED, not stored: no migration, no backfill, no way for a stored stage to
 * disagree with the fields it was computed from.
 *
 * It reads only fields that already exist on `ideas`, so both clients get it for
 * free from this one module.
 */

/** Ordered least to most developed. */
export const MATURITY_STAGES = [
	'spark',
	'shaped',
	'judged',
	'actioned',
	'committed'
] as const;

export type MaturityStage = (typeof MATURITY_STAGES)[number];

/** What maturity is measuring. Kept structural so callers cannot drift. */
export type MaturityInput = {
	title?: string;
	description?: string;
	problem?: string;
	audience?: string;
	outcome?: string;
	trigger?: string;
	tags?: string[];
	status?: string;
	impact?: number;
	effort?: number;
	confidence?: number;
	favorite?: boolean;
	archived?: boolean;
	/** Completed checklist rows, if the caller has them. */
	doneTasks?: number;
	/** Total checklist rows, if the caller has them. */
	totalTasks?: number;
	/**
	 * How many of `problem` / `audience` / `outcome` are answered, when the caller has
	 * only that count.
	 *
	 * Needed because list responses deliberately omit the three: they are long free
	 * text and the list is capped. Without this, "omitted" and "empty" are
	 * indistinguishable and every listed idea computes as `spark`.
	 *
	 * When absent, the three strings are read directly - so callers holding whole rows
	 * (the detail page) need do nothing.
	 */
	coreFields?: number;
};

export type Maturity = {
	stage: MaturityStage;
	/** 0-100. Comparable between ideas; the stage is not a rounding of it. */
	percent: number;
	/** The single most useful next thing to do. Empty only at `committed`. */
	next: string;
	/** Everything still missing, in the order it would be filled. */
	missing: string[];
};

/**
 * The three questions that turn a sentence into something you can decide on.
 *
 * Section 2 of the spec asks for exactly these three, and they are weighted above
 * tags, description and a favourite star because they are the difference between
 * "an idea" and "a decision". The description is deliberately NOT counted: it is
 * where dictation lands, so a long dictated note would otherwise make an
 * unconsidered idea look considered.
 */
const CORE = ['problem', 'audience', 'outcome'] as const;

function present(value: string | undefined): boolean {
	return typeof value === 'string' && value.trim().length > 0;
}

function scored(input: MaturityInput): boolean {
	return (
		typeof input.impact === 'number' &&
		typeof input.effort === 'number' &&
		typeof input.confidence === 'number' &&
		input.effort > 0
	);
}

export function maturityOf(input: MaturityInput): Maturity {
	const missing: string[] = [];
	const next: string[] = [];

	// --- the three core questions ------------------------------------------------
	//
	// Prefer the caller's COUNT when given, because that is the only signal available
	// from a list response. Falling back to the strings is correct for whole rows.
	//
	// Note what a count does NOT buy: WHICH question is missing. With only a count,
	// naming a field would be a confident guess - an idea that answered audience and
	// outcome but not the problem would be told to "describe the problem", which is
	// the one thing it has already done. So field-level advice is only given when the
	// fields are actually in hand, and a count produces honest count-level advice.
	const hasFieldLevel = typeof input.coreFields !== 'number';
	const answered = hasFieldLevel
		? CORE.filter((field) => present(input[field])).length
		: Math.max(0, Math.min(CORE.length, Math.trunc(input.coreFields as number)));
	const absent = hasFieldLevel ? CORE.filter((field) => !present(input[field])) : [];
	const coreShort = CORE.length - answered;
	const LABEL: Record<(typeof CORE)[number], string> = {
		problem: 'the problem it solves',
		audience: 'who it is for',
		outcome: 'the outcome it should produce'
	};
	for (const field of absent) missing.push(LABEL[field]);
	if (!hasFieldLevel && coreShort > 0) {
		missing.push(`${coreShort} of the three core questions`);
	}

	// --- a judgement -------------------------------------------------------------
	const hasScore = scored(input);
	if (!hasScore) {
		missing.push('a score');
		next.push('Score impact, confidence and effort');
	}

	// --- what prompted it --------------------------------------------------------
	if (!present(input.trigger)) missing.push('what prompted it');

	// --- turning it into work ----------------------------------------------------
	const total = input.totalTasks ?? 0;
	const done = input.doneTasks ?? 0;
	const hasTasks = total > 0;
	if (!hasTasks) {
		missing.push('a next step');
		next.push('Add one task, so this is not just a note');
	}

	// --- stage -------------------------------------------------------------------
	//
	// Each stage requires the one before it, and each is about a DIFFERENT kind of
	// work: writing, judging, acting. Conflating them was a bug in the first
	// version, which demanded a checklist row before calling an idea "judged" -
	// so a fully written and scored idea with no tasks yet reported as "shaped",
	// understating it. Judging is a decision; actioning is a task. Keep them apart.
	let stage: MaturityStage = 'spark';
	if (coreShort === 0) stage = 'shaped';
	if (stage === 'shaped' && hasScore) stage = 'judged';
	if (stage === 'judged' && hasTasks) stage = 'actioned';
	// Committed once the work is genuinely happening or finished - not merely
	// planned, and not merely started. "One of five tasks ticked" is not a
	// commitment, it is a Tuesday; the first version treated it as one.
	if (hasTasks && total > 0 && done >= total) stage = 'committed';
	if (stage === 'actioned' && (input.status === 'building' || input.status === 'done')) {
		stage = 'committed';
	}

	// --- percent -----------------------------------------------------------------
	//
	// Weighted so that the three core questions dominate. Ten core points each, six
	// for a score, four for a trigger, ten for having any next step - 100 total.
	let percent = 0;
	percent += answered * 10;
	if (hasScore) percent += 6;
	if (present(input.trigger)) percent += 4;
	if (hasTasks) percent += 10;
	// Finishing the work you defined is worth something on top of defining it.
	if (hasTasks && total > 0) percent += Math.round((done / total) * (100 - percent));
	percent = Math.max(0, Math.min(100, percent));

	// --- the single next thing ---------------------------------------------------
	//
	// Ordered by leverage, not by the order of `missing`. Writing the three core
	// answers is worth more than any score, and a score is worth more than a task,
	// because an unscored idea cannot be ranked and a taskless one cannot be done.
	let nextStep = '';
	if (absent.length > 0) {
		nextStep = `Describe ${absent[0] === 'problem' ? 'the problem' : LABEL[absent[0]]}`;
	} else if (coreShort > 0) {
		// Count-only, so the specific field is genuinely unknown. Say how many are
		// outstanding rather than guessing which - the detail page, which holds the
		// fields, will name it.
		nextStep = `Answer ${coreShort} more of the three core question${coreShort === 1 ? '' : 's'}`;
	} else if (!hasScore) {
		nextStep = 'Score impact, confidence and effort';
	} else if (!hasTasks) {
		nextStep = 'Add one task, so this is not just a note';
	} else if (!present(input.trigger)) {
		nextStep = 'Note what prompted this, so you can retrace it later';
	} else if (done < total) {
		nextStep = `Finish the remaining ${total - done} task${total - done === 1 ? '' : 's'}`;
	}

	return { stage, percent, next: nextStep, missing };
}

/** One-line wording. The list shows this, so it must not wrap into a paragraph. */
export function maturityLabel(stage: MaturityStage): string {
	switch (stage) {
		case 'spark':
			return 'Spark';
		case 'shaped':
			return 'Shaped';
		case 'judged':
			return 'Judged';
		case 'actioned':
			return 'Actioned';
		case 'committed':
			return 'Committed';
	}
}
