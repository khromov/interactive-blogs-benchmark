const posts = import.meta.glob('./posts/*/+page.svx');

let body = [];

for (const path in posts) {
	body.push(posts[path]().then(({ metadata }) => metadata));
}

/**
 * @type {import('@sveltejs/kit').PageLoad}
 */
export async function load() {
	const resolved = await Promise.all(body);

	return {
		posts: resolved
	};
}
