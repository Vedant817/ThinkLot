/**
 * Wording for an idea's timeline.
 *
 * Deliberately NOT in `src/convex/ideas.ts`, even though the events are written
 * there. Importing anything from a Convex module into a component pulls that
 * module into the browser bundle - Convex logs "Convex functions should not be
 * imported in the browser. This will throw an error in future versions", and it
 * did exactly that the first time this lived on the server side.
 *
 * The server stores `kind` and `detail`; what a human reads is a client concern.
 *
 * Here rather than in the route because two clients must not describe the same
 * event differently - drift there means your own data tells two stories.
 */
export function describeEvent(kind: string, detail: string | null): string {
	switch (kind) {
		case 'captured':
			return detail ?? 'Captured';
		case 'status': {
			// Stored as "from → to". Each side is checked, because a malformed half
			// would otherwise render as "undefined → ready" - which is worse than
			// saying nothing about the direction.
			if (detail && detail.includes('→')) {
				const [from, to] = detail.split('→').map((part) => part.trim());
				if (from && to) return `Moved from ${from} to ${to}`;
			}
			return 'Stage changed';
		}
		case 'archived':
			return 'Archived';
		case 'restored':
			return 'Restored from the archive';
		case 'scored':
			return detail ? `Judged — priority ${detail}` : 'Judged';
		case 'unscored':
			return 'Score cleared';
		// The four review decisions. Separate cases rather than falling through to a
	// generic "reviewed", because a history is only worth reading if it says WHICH
	// decision was made - "let it go" and "tried it" are opposite outcomes, and a
	// timeline that called both "reviewed" would hide the actual behaviour.
	case 'letGo': {
		// The reason is the point. Never drop it: it is what makes the archive readable
		// a year later rather than a graveyard.
		return detail ? `Let go — ${detail.replace(/^let go:\s*/i, '')}` : 'Let go';
	}
	case 'reviewed':
		return detail ? detail : 'Reviewed';
	case 'snoozed':
			return detail ? `Snoozed for ${detail}` : 'Snoozed';
		case 'favorited':
			return 'Starred';
		default:
			// An unknown kind is shown as its own name rather than hidden. A timeline
			// that quietly drops entries it does not understand is lying by omission,
			// and the next kind added would simply vanish from the screen.
			return detail ? `${kind}: ${detail}` : kind;
	}
}
