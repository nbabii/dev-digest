/* AddSkillModal — the single "Add skill" entry point, used by both the
   Skills list header and the skill-editor rail's "Add" button. One modal,
   three tabs: Create (manual authoring), From file (upload → preview →
   confirm import), and Import from URL. Replaces the former pairing of a
   dropdown (Create from scratch / Import from file) opening two separate
   components (CreateSkillModal, a side-drawer ImportSkillDrawer). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@devdigest/ui";
import { CreatePanel } from "./_components/CreatePanel";
import { FilePanel } from "./_components/FilePanel";
import { UrlPanel } from "./_components/UrlPanel";
import { ADD_SKILL_MODAL_WIDTH, type AddSkillTab } from "./constants";
import { s } from "./styles";

export function AddSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const [tab, setTab] = React.useState<AddSkillTab>("create");

  return (
    <Modal width={ADD_SKILL_MODAL_WIDTH} title={t("drawer.title")} onClose={onClose}>
      <div style={s.tabBar}>
        <button style={s.tabBtn(tab === "create")} onClick={() => setTab("create")}>
          {t("drawer.tabs.create")}
        </button>
        <button style={s.tabBtn(tab === "file")} onClick={() => setTab("file")}>
          {t("drawer.tabs.file")}
        </button>
        <button style={s.tabBtn(tab === "url")} onClick={() => setTab("url")}>
          {t("drawer.tabs.url")}
        </button>
      </div>
      {tab === "create" && <CreatePanel onClose={onClose} />}
      {tab === "file" && <FilePanel onClose={onClose} />}
      {tab === "url" && <UrlPanel onClose={onClose} />}
    </Modal>
  );
}
