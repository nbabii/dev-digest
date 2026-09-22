/* SkillsTab — the Agent editor's Skills tab. Lists ALL workspace skills
   cross-referenced against this agent's linked set (GET /agents/:id/skills,
   existing/unchanged endpoint). Checking/unchecking or reordering recomputes
   the ordered checked-id array and calls the existing
   POST /agents/:id/skills { skill_ids } — no new endpoint. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Checkbox, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent, Skill } from "@devdigest/shared";
import { useAgentSkillLinks, useSetAgentSkills } from "../../../../../../../lib/hooks/agents";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import { skillTypeColor } from "../../../../../../../lib/skill-type-style";
import { DRAG_ACTIVATION_DISTANCE } from "./constants";
import {
  buildInitialOrder,
  filterSkillsBySearch,
  orderedCheckedIds,
  reorderFullOrder,
  toCheckedSet,
} from "./helpers";
import { s } from "./styles";

function SkillRow({ skill, checked, onToggle }: { skill: Skill; checked: boolean; onToggle: (v: boolean) => void }) {
  const t = useTranslations("skills");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: skill.id,
    disabled: !checked,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : checked ? 1 : 0.55,
  };
  return (
    <div ref={setNodeRef} style={{ ...s.row, ...style }}>
      <span
        {...(checked ? attributes : {})}
        {...(checked ? listeners : {})}
        style={s.dragHandle(checked)}
        aria-label="Reorder"
      >
        <Icon.GripVertical size={14} />
      </span>
      <Checkbox checked={checked} onChange={onToggle} />
      <span style={s.name}>{skill.name}</span>
      <Badge color={skillTypeColor(skill.type).color} bg={skillTypeColor(skill.type).bg}>
        {t(`listItem.type.${skill.type}`)}
      </Badge>
      <Badge color="var(--text-muted)">{t(`listItem.source.${skill.source}`)}</Badge>
    </div>
  );
}

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const {
    data: skills,
    isLoading: skillsLoading,
    isError: skillsError,
    refetch: refetchSkills,
  } = useSkills();
  const {
    data: links,
    isLoading: linksLoading,
    isError: linksError,
    refetch: refetchLinks,
  } = useAgentSkillLinks(agent.id);
  const setAgentSkills = useSetAgentSkills();

  const [order, setOrder] = React.useState<string[]>([]);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState("");
  // Track which agent the local order/checked state was seeded for, so a
  // background refetch/invalidate doesn't clobber an in-progress reorder.
  const initializedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!skills || !links) return;
    if (initializedFor.current === agent.id) return;
    setOrder(buildInitialOrder(skills, links));
    setChecked(toCheckedSet(links));
    initializedFor.current = agent.id;
  }, [agent.id, skills, links]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } }));

  const skillsById = React.useMemo(() => {
    const m = new Map<string, Skill>();
    (skills ?? []).forEach((sk) => m.set(sk.id, sk));
    return m;
  }, [skills]);

  const filteredSkillIds = React.useMemo(() => {
    const filtered = new Set(filterSkillsBySearch(skills ?? [], search).map((sk) => sk.id));
    return order.filter((id) => filtered.has(id));
  }, [order, skills, search]);

  const persist = (nextOrder: string[], nextChecked: Set<string>) => {
    setAgentSkills.mutate({ agentId: agent.id, skillIds: orderedCheckedIds(nextOrder, nextChecked) });
  };

  const toggle = (id: string, on: boolean) => {
    const next = new Set(checked);
    if (on) next.add(id);
    else next.delete(id);
    setChecked(next);
    persist(order, next);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const next = reorderFullOrder(order, filteredSkillIds, String(active.id), String(over.id));
    setOrder(next);
    persist(next, checked);
  };

  if (skillsLoading || linksLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={20} width={160} style={{ marginBottom: 16 }} />
        <Skeleton height={220} />
      </div>
    );
  }
  if (skillsError || linksError) {
    return (
      <ErrorState
        body={t("skills.loadError")}
        onRetry={() => {
          void refetchSkills();
          void refetchLinks();
        }}
      />
    );
  }

  const total = skills?.length ?? 0;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <span style={s.count}>{t("skills.enabledCount", { linked: checked.size, total })}</span>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>

      {total === 0 ? (
        <div style={s.empty}>{t("skills.empty")}</div>
      ) : (
        <>
          <div style={s.search}>
            <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("skills.filterPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={filteredSkillIds} strategy={verticalListSortingStrategy}>
              {filteredSkillIds.map((id) => {
                const skill = skillsById.get(id);
                if (!skill) return null;
                return <SkillRow key={id} skill={skill} checked={checked.has(id)} onToggle={(v) => toggle(id, v)} />;
              })}
            </SortableContext>
          </DndContext>
        </>
      )}
    </div>
  );
}
