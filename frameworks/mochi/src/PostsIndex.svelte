<div class="wrap">
  <h1>Mochi — interactive blogs benchmark</h1>
  <p>
    Three increasingly long posts, each embedding one interactive
    <code>&lt;Counter mochi:hydrate /&gt;</code> island. The prose is static server-rendered HTML;
    only the counter ships JavaScript — so the client bundle stays flat
    (<strong>~48 KB / 18.5 KB gzip</strong>) no matter how long the post is.
  </p>
  <ul>
    <li><a href="/posts/post1/">post1</a> — ~8.8k words (~950 DOM nodes)</li>
    <li><a href="/posts/post2/">post2</a> — ~23k words (~2.5k DOM nodes)</li>
    <li><a href="/posts/post3/">post3</a> — ~71k words (~7.5k DOM nodes)</li>
  </ul>
  <p class="hint">Scroll down inside any post to find the counter — click it; the count is live.</p>
</div>

<style>
  .wrap {
    max-width: 42rem;
    margin: 4rem auto;
    padding: 0 1.5rem;
    font-family: system-ui, sans-serif;
    line-height: 1.6;
    color: #1a1a1a;
  }
  h1 {
    font-size: 1.7rem;
    margin-bottom: 1rem;
  }
  code {
    background: #f0f0f0;
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.9em;
  }
  ul {
    padding-left: 1.2rem;
  }
  li {
    margin: 0.4rem 0;
  }
  a {
    color: #d6336c;
    font-weight: 600;
  }
  .hint {
    color: #666;
    font-size: 0.9rem;
  }
</style>
