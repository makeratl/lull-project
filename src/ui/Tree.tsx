import type { TreeNode } from '../../shared/tree';

const joined = (s: string) => new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

/** A branch of the sharing tree: names, join dates, and how many joined through each person. */
export function Tree({ nodes, badge }: { nodes: TreeNode[]; badge?: (n: TreeNode) => string | null }) {
  return (
    <ul class="tree">
      {nodes.map(n => (
        <li key={n.id}>
          <div class="tree-node">
            <span class="tree-name">
              {n.name}
              {badge?.(n) && <span class="badge">{badge(n)}</span>}
            </span>
            <span class="note">
              joined {joined(n.joined_at)}
              {n.size ? ` · ${n.size} through them` : ''}
            </span>
          </div>
          {n.children.length > 0 && <Tree nodes={n.children} badge={badge} />}
        </li>
      ))}
    </ul>
  );
}
