import { describe, expect, it } from 'vitest';
import { buildTree, countTree, type Person } from '../shared/tree';

const p = (id: string, invited_by: string | null, day: number): Person => ({ id, name: id, invited_by, joined_at: `2026-10-${String(day).padStart(2, '0')}T12:00:00Z` });

// Steven invited Ana and Dee; Ana invited Ben and Cleo; Ben invited Eli.
const people = [p('steven', null, 1), p('ana', 'steven', 2), p('dee', 'steven', 6), p('cleo', 'ana', 5), p('ben', 'ana', 3), p('eli', 'ben', 7)];
const names = (nodes: ReturnType<typeof buildTree>): unknown => nodes.map(n => (n.children.length ? [n.name, names(n.children)] : n.name));

describe('sharing tree', () => {
  it('the whole tree, children in the order they joined, with sizes', () => {
    const tree = buildTree(people);
    expect(names(tree)).toEqual([['steven', [['ana', [['ben', ['eli']], 'cleo']], 'dee']]]);
    expect(tree[0].size).toBe(5);
    expect(tree[0].children[0].size).toBe(3);
    expect(countTree(tree)).toBe(6);
  });

  it("a member's branch is only the people below them", () => {
    expect(names(buildTree(people, 'ana'))).toEqual([['ben', ['eli']], 'cleo']);
    expect(countTree(buildTree(people, 'ana'))).toBe(3);
    expect(buildTree(people, 'eli')).toEqual([]);
  });

  it('someone whose inviter is gone becomes a root; bad data (a cycle) cannot loop', () => {
    expect(names(buildTree([p('x', 'deleted', 1), p('y', 'x', 2)]))).toEqual([['x', ['y']]]);
    expect(buildTree([p('a', 'b', 1), p('b', 'a', 2)])).toEqual([]);
    expect(names(buildTree([p('a', 'b', 1), p('b', 'a', 2)], 'a'))).toEqual(['b']);
  });
});
