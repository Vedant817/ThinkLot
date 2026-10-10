/**
 * Scheduled work.
 *
 * This file was empty until now, which is why nothing in this app ever reminded anyone
 * of anything: `review:remindDueSnoozes` has existed and been tested, but a cron is the
 * only thing that runs it. A queue you have to remember to check is a queue you will not
 * check - which is the exact failure twelve product agents and a CEO named
 * independently, and the reason the CEO's retention metric depends on this file more
 * than on any other.
 */

import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

/**
 * Once a day, at 07:00 UTC.
 *
 * Daily is deliberate rather than hourly, and not just for cost. A park is expressed in
 * WHOLE days, so there is nothing to say about it at 08:00 that is not better said at
 * 07:00 the following day - and an app that interrupts you about an idea you parked for
 * 30 days, more than once a day, has misread the request.
 *
 * 07:00 UTC is early enough that a US morning and a European morning both land on the
 * same working day, and no hour is right for everybody. The honest answer to "what
 * time should it fire" is that the app cannot know, so it picks one boring one rather
 * than pretending to be clever.
 */
crons.cron(
	'remind due parks',
	'0 7 * * *',
	internal.review.remindDueSnoozes,
	{}
);

/**
 * A wider net for the same job, as a safety net rather than a second reminder.
 *
 * Every six hours, the internal mutation is idempotent - it re-reminds only when the
 * last reminder for an idea predates its revisit date - so running it more often
 * cannot produce more notifications. This exists because a daily cron that fires once
 * and fails silently (a deploy in flight, a transient error) would mean a user's whole
 * park comes back with nobody told. Cheap insurance for the one thing that determines
 * whether they open the app again.
 */
crons.interval(
	'remind due parks, safety net',
	{ hours: 6 },
	internal.review.remindDueSnoozes,
	{}
);

/**
 * Owner analytics rollup, once a day at 08:00 UTC - an hour after the reminder
 * cron, so reminder-driven activity from the morning batch lands in the same
 * day's numbers rather than splitting the cause from the effect.
 *
 * One row per day, written by `owner:rollupDay`. Idempotent (same day rewrites
 * the same row), so a retry or a second schedule cannot double-count. No 6-hour
 * safety net here: a missed analytics day is a visible gap, which is honest,
 * while a silent re-run that double-writes would be neither.
 */
crons.cron(
	'roll up owner analytics',
	'0 8 * * *',
	internal.owner.rollupDay,
	{}
);

export default crons;
