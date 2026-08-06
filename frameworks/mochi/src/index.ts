import { Mochi, silenceInternalRoutes } from 'mochi-framework';
import { compile as mdsvexCompile } from 'mdsvex';
import rehypeSlug from 'rehype-slug';

const PORT = Number(process.env.PORT) || 3333;

await Mochi.serve({
  port: PORT,
  development: process.env.MODE === 'development',
  htmlShell: './src/shell.html',
  trailingSlash: 'always',
  filters: {
    'consoleLogger:line': silenceInternalRoutes,
  },
  markdown: {
    compile: mdsvexCompile,
    rehypePlugins: [rehypeSlug],
  },
  routes: {
    '/': Mochi.page('./src/PostsIndex.svelte'),
    '/posts/post1': Mochi.page('./src/posts/post1.md'),
    '/posts/post2': Mochi.page('./src/posts/post2.md'),
    '/posts/post3': Mochi.page('./src/posts/post3.md'),
  },
});

console.log('Server running at http://localhost:' + PORT);
