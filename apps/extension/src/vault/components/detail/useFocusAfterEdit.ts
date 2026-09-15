import { useEffect, useRef } from "react";

/**
 * Returns a ref for the detail title. Leaving the edit form, by Save or Cancel, unmounts
 * the button that was pressed and would drop focus on the page body; the title takes it
 * instead, so keyboard and screen-reader users land on the item they just saved.
 */
export function useFocusAfterEdit(editing: boolean) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) titleRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  return titleRef;
}
