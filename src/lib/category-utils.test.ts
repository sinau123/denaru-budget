import { describe, expect, it } from "vitest";

import type { Category } from "./api/api-types";
import { flattenCategories } from "./category-utils";

function cat(id: string, name: string, parent_id: string | null = null, extra: Partial<Category> = {}): Category {
  return { id, name, type: "expense", parent_id, seed_key: null, archived_at: null, created_at: "", ...extra };
}

describe("flattenCategories", () => {
  const list = [
    cat("food", "Makanan"),
    cat("snack", "Jajan", "food"),
    cat("transport", "Transportasi"),
    cat("fruit", "Buah", "food"),
    cat("salary", "Gaji", null, { type: "income" }),
  ];

  it("puts children right after their parent with a combined label", () => {
    expect(flattenCategories(list).map((o) => [o.label, o.depth])).toEqual([
      ["Makanan", 0],
      ["Makanan › Jajan", 1],
      ["Makanan › Buah", 1],
      ["Transportasi", 0],
      ["Gaji", 0],
    ]);
  });

  it("keeps a child whose parent is filtered out", () => {
    const archivedParent = list.map((c) => (c.id === "food" ? { ...c, archived_at: "2026-01-01" } : c));
    const labels = flattenCategories(archivedParent, (c) => c.type === "expense" && !c.archived_at).map((o) => o.label);
    expect(labels).toEqual(["Makanan › Jajan", "Makanan › Buah", "Transportasi"]);
  });

  it("treats a child with an unknown parent as top-level", () => {
    expect(flattenCategories([cat("x", "Lepas", "missing")]).map((o) => o.label)).toEqual(["Lepas"]);
  });
});
