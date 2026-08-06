<script>
  let count = $state(0);
</script>

<div style="margin:1rem 0">
  <span>Count: {count}</span>
  <button onclick={() => (count += 1)}>Click me</button>
</div>
