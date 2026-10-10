import type { Category } from "./api/api-types";

export type CategoryOption = {
  category: Category;
  /** "Makanan" for a top-level category, "Makanan › Jajan" for a child. */
  label: string;
  depth: 0 | 1;
};

/**
 * Flattens the category tree into one level: each top-level category is
 * followed by its children, keeping the server order within each level.
 * `keep` filters individual entries; a child stays even if its parent is
 * filtered out (e.g. an archived parent), so its label still names the parent.
 */
export function flattenCategories(
  categories: readonly Category[],
  keep: (category: Category) => boolean = () => true,
): CategoryOption[] {
  const ids = new Set(categories.map((c) => c.id));
  const children = new Map<string, Category[]>();
  const tops: Category[] = [];
  for (const c of categories) {
    if (c.parent_id && ids.has(c.parent_id)) {
      const list = children.get(c.parent_id);
      if (list) list.push(c);
      else children.set(c.parent_id, [c]);
    } else {
      tops.push(c);
    }
  }

  const options: CategoryOption[] = [];
  for (const top of tops) {
    if (keep(top)) options.push({ category: top, label: top.name, depth: 0 });
    for (const child of children.get(top.id) ?? []) {
      if (keep(child)) options.push({ category: child, label: `${top.name} › ${child.name}`, depth: 1 });
    }
  }
  return options;
}
