import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	if (!params.id) {
		error(404, 'No idea id.');
	}
	return { id: params.id };
};