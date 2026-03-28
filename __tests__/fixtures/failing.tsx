import { useRef, useState } from "react";

// Conditional hook call — compiler will bail
export function ConditionalHook({ show }: { show: boolean }) {
  if (show) {
    const [val] = useState(0);
    return <div>{val}</div>;
  }
  return null;
}

// Ref mutation during render — compiler will bail
export function RefMutation() {
  const ref = useRef(0);
  ref.current = ref.current + 1;
  return <div>{ref.current}</div>;
}
