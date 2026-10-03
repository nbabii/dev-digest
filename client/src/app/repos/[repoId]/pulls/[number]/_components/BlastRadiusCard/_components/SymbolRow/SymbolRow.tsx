"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { BlastSymbolImpact } from "@devdigest/shared";
import { ImpactChip } from "../ImpactChip/ImpactChip";
import { s } from "../../styles";

interface SymbolRowProps {
  sym: BlastSymbolImpact;
  panelId: string;
  open: boolean;
  onToggle: () => void;
  /** Index is partial or facts incomplete: an empty caller list is not a guarantee. */
  incomplete: boolean;
}

function CallerList({ sym }: { sym: BlastSymbolImpact }) {
  const t = useTranslations("blast");
  return (
    <ul style={s.callerList} aria-label={t("card.callersList", { symbol: sym.symbol })}>
      {sym.callers.map((c) => (
        <li key={`${c.file}:${c.line}:${c.name}`} style={s.callerItem}>
          <Icon.CornerDownRight size={12} aria-hidden style={s.muted} />
          <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            style={s.callerLink}
            aria-label={t("card.callerLinkLabel", { file: c.file, line: c.line })}
          >
            {c.file}:{c.line}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Impacts({ sym }: { sym: BlastSymbolImpact }) {
  const t = useTranslations("blast");
  const moreEndpoints = sym.endpoints_total - sym.endpoints_affected.length;
  const moreCrons = sym.crons_total - sym.crons_affected.length;
  if (sym.endpoints_affected.length === 0 && sym.crons_affected.length === 0) return null;
  return (
    <div>
      <span style={s.chipsLabel} title={t("card.mayDependHint")}>
        {t("card.mayDepend")}
      </span>
      <div style={s.chips}>
        {sym.endpoints_affected.map((e) => (
          <ImpactChip key={`e:${e}`} kind="endpoint" label={e} />
        ))}
        {moreEndpoints > 0 && <span style={s.plainNote}>{t("card.moreChips", { count: moreEndpoints })}</span>}
        {sym.crons_affected.map((c) => (
          <ImpactChip key={`c:${c}`} kind="cron" label={c} />
        ))}
        {moreCrons > 0 && <span style={s.plainNote}>{t("card.moreChips", { count: moreCrons })}</span>}
      </div>
    </div>
  );
}

export function SymbolRow({ sym, panelId, open, onToggle, incomplete }: SymbolRowProps) {
  const t = useTranslations("blast");
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;
  const moreCallers = sym.callers_total - sym.callers.length;
  return (
    <li style={s.symbolBox}>
      <button type="button" style={s.symbolHeader} aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <Chevron size={14} aria-hidden style={s.muted} />
        <Icon.Code size={14} aria-hidden style={s.muted} />
        <span style={s.symbolName}>{sym.symbol}()</span>
        {sym.match === "file" && (
          <span style={s.wholeFileTag} title={t("card.wholeFileHint")}>
            {t("card.wholeFile")}
          </span>
        )}
        <span style={s.callerCount}>{t("callerCount", { count: sym.callers_total })}</span>
      </button>
      {open && (
        <div id={panelId} style={s.panel}>
          {sym.callers.length > 0 ? (
            <CallerList sym={sym} />
          ) : (
            <p style={s.plainNote}>{incomplete ? t("card.callersUnknown") : t("card.noCallers")}</p>
          )}
          {moreCallers > 0 && <p style={s.plainNote}>{t("card.moreCallers", { count: moreCallers })}</p>}
          <Impacts sym={sym} />
        </div>
      )}
    </li>
  );
}
