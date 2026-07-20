'use client';

import { AttentionItem } from "../lib/kpi-engine";

interface AttentionPanelProps {
  items: AttentionItem[];
  onOrderClick: (orderId: string) => void;
}

export default function AttentionPanel({ items, onOrderClick }: AttentionPanelProps) {
  if (items.length === 0) return null;

  return (
    <div className="mx-4 mt-3 rounded-lg border border-danger/30 bg-danger-dim/50 p-3">
      <h3 className="text-xs font-bold text-danger uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-danger animate-pulse" />
        Immediate Attention Required
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
        {items.map(item => (
          <button
            key={item.id}
            onClick={() => onOrderClick(item.orderId)}
            className="flex items-center justify-between rounded-md bg-background/50 px-3 py-2 text-left hover:bg-surface-hover transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className={`shrink-0 text-xs ${item.severity === "critical" ? "text-danger" : "text-warning"}`}>
                {item.severity === "critical" ? "⚠" : "●"}
              </span>
              <span className="text-xs text-foreground truncate">{item.message}</span>
            </div>
            <span className="shrink-0 ml-2 text-[10px] text-muted-light">{item.action}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
