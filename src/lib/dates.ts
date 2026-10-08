/**
 * How dates read on screen.
 *
 * This lived inside two route files, which is the shape that guarantees they drift:
 * the idea list and the review queue each had a copy, and the timeline needed a
 * third. Extracted when the third call site appeared rather than when someone
 * noticed the duplication, which is the only time duplication is cheap to fix.
 *
 * `now` is injectable because these strings are read in loops and a value that
 * changes mid-render makes a list of "3d ago" entries quietly disagree with each
 * other.
 */
export function relativeDay(ts: number, now: number = Date.now()): string {
	const days = Math.floor((now - ts) / 86_400_000);
	// A future timestamp is a clock skew or a bad write, not a negative age. Saying
	// "-1d" would be a lie; saying "today" is the least-wrong thing.
	if (days <= 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 30) return `${days}d`;
	const months = Math.floor(days / 30);
	// Past a year, months stop being useful and start being wrong ("14mo").
	if (months < 12) return `${months}mo`;
	return `${Math.floor(days / 365)}y`;
}
