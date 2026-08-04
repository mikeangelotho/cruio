import { onCleanup, onMount } from "solid-js";

/** Fired by useChat after a turn that ran at least one mutating tool. */
export const AI_INVALIDATE = "cruio:invalidate";

/**
 * Re-run a page's loader when the assistant changes something.
 *
 * Router queries recover on their own via revalidate(), but most screens hold
 * data in a createResource with no cache key, so they need an explicit nudge
 * or an AI-made change stays invisible until the next navigation.
 */
export function onAiInvalidate(refetch: () => void) {
  onMount(() => {
    const handler = () => refetch();
    window.addEventListener(AI_INVALIDATE, handler);
    onCleanup(() => window.removeEventListener(AI_INVALIDATE, handler));
  });
}
