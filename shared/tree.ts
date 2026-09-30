/**
 * The sharing family tree, built from each profile's `invited_by` (whoever made the code they joined with).
 * Used by the server for a member's branch and by the admin screen for the whole tree.
 */
export interface Person {
  id: string;
  name: string;
  invited_by: string | null;
  joined_at: string;
}

export interface TreeNode {
  id: string;
  name: string;
  joined_at: string;
  children: TreeNode[];
  /** Everyone below this person. */
  size: number;
}

/**
 * The whole tree (roots are people with no inviter, or one who's gone), or with `root`, just the branch
 * below that person. Children are in the order they joined.
 */
export const buildTree = (people: Person[], root?: string): TreeNode[] => {
  const ids = new Set(people.map(p => p.id));
  const kids = new Map<string | null, Person[]>();
  for (const p of people) {
    const parent = p.invited_by && p.invited_by !== p.id && ids.has(p.invited_by) ? p.invited_by : null;
    kids.set(parent, [...(kids.get(parent) ?? []), p]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  // `seen` guards against a cycle in bad data; invited_by is only ever set to someone who already existed.
  const seen = new Set<string>();
  const make = (p: Person): TreeNode => {
    seen.add(p.id);
    const children = (kids.get(p.id) ?? []).filter(c => !seen.has(c.id)).map(make);
    return { id: p.id, name: p.name, joined_at: p.joined_at, children, size: children.reduce((n, c) => n + 1 + c.size, 0) };
  };
  if (root) {
    seen.add(root);
    return (kids.get(root) ?? []).map(make);
  }
  return (kids.get(null) ?? []).map(make);
};

export const countTree = (nodes: TreeNode[]) => nodes.reduce((n, c) => n + 1 + c.size, 0);
