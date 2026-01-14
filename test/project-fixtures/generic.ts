interface HasId {
  id: number;
}

export function getId<T extends HasId>(item: T): number {
  return item.id;
}
