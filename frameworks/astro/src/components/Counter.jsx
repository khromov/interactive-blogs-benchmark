import { useState } from 'preact/hooks';

export default function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div style="margin:1rem 0">
      <span>Count: {count}</span>
      <button onClick={() => setCount(count + 1)}>Click me</button>
    </div>
  );
}
