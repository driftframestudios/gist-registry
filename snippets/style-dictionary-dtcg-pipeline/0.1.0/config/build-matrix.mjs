export const BUILD_MATRIX = Object.freeze([
  Object.freeze({ brand: "acme", mode: "dark" }),
  Object.freeze({ brand: "acme", mode: "light" }),
  Object.freeze({ brand: "research", mode: "dark" }),
  Object.freeze({ brand: "research", mode: "light" }),
]);

export function coordinateId({ brand, mode }) {
  return `${brand}-${mode}`;
}
