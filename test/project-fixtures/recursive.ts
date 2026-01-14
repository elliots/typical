interface TreeNode {
  value: string;
  children?: TreeNode[];
}

export function process(node: TreeNode): string {
  return node.value;
}
