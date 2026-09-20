import type { AgentSkillLink, Skill } from "@devdigest/shared";

/** Initial display order: linked skills first (in their existing `order`),
    then every other workspace skill in useSkills()'s list order. Unlinked
    rows still render (dimmed, no drag) so the list always shows "N of M". */
export function buildInitialOrder(skills: Skill[], links: AgentSkillLink[]): string[] {
  const validIds = new Set(skills.map((sk) => sk.id));
  const linkedIds = [...links]
    .sort((a, b) => a.order - b.order)
    .map((l) => l.skill_id)
    .filter((id) => validIds.has(id)); // defensive: drop links to a since-deleted skill
  const linkedSet = new Set(linkedIds);
  const rest = skills.filter((sk) => !linkedSet.has(sk.id)).map((sk) => sk.id);
  return [...linkedIds, ...rest];
}

/** The set of currently-linked skill ids. */
export function toCheckedSet(links: AgentSkillLink[]): Set<string> {
  return new Set(links.map((l) => l.skill_id));
}

/** The array to POST as `skill_ids` — checked ids, in their current display
    order (order = position in the assembled prompt). */
export function orderedCheckedIds(order: string[], checked: Set<string>): string[] {
  return order.filter((id) => checked.has(id));
}

/** Case-insensitive filter over a skill's name + type (Skills-tab filter). */
export function filterSkillsBySearch(skills: Skill[], search: string): Skill[] {
  const q = search.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((sk) => `${sk.name} ${sk.type}`.toLowerCase().includes(q));
}

/**
 * Reorder `fullOrder`, moving `activeId` next to `overId`. `filteredIds` is
 * the currently-rendered (search-narrowed) subset, whose relative positions
 * decide whether the drop lands before or after `overId` in the full order —
 * this keeps drag-reorder correct even while the filter hides some rows.
 */
export function reorderFullOrder(
  fullOrder: string[],
  filteredIds: string[],
  activeId: string,
  overId: string,
): string[] {
  if (activeId === overId) return fullOrder;
  const withoutActive = fullOrder.filter((id) => id !== activeId);
  const overIndexInFull = withoutActive.indexOf(overId);
  if (overIndexInFull === -1) return fullOrder;
  const oldFilteredIndex = filteredIds.indexOf(activeId);
  const newFilteredIndex = filteredIds.indexOf(overId);
  const insertIndex = oldFilteredIndex < newFilteredIndex ? overIndexInFull + 1 : overIndexInFull;
  withoutActive.splice(insertIndex, 0, activeId);
  return withoutActive;
}
