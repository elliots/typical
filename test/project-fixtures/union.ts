interface Cat {
  type: "cat";
  meow(): void;
}
interface Dog {
  type: "dog";
  bark(): void;
}
type Pet = Cat | Dog;

export function process(pet: Pet): string {
  return pet.type;
}
