/** Drinks seeded from the spreadsheet prototype. */
export const PRESETS = [
  { id: "sf-v-250", name: "Sugar-free V, 250 ml", amount_mg: 73 },
  { id: "dare-mocha-750", name: "Dare mocha, 750 ml", amount_mg: 189 },
  { id: "diet-coke-375", name: "Diet Coke, 375 ml", amount_mg: 48 },
  { id: "redbull-330", name: "Red Bull, 330 ml", amount_mg: 106 },
  { id: "redbull-473", name: "Red Bull, 473 ml", amount_mg: 151 },
  { id: "redbull-250", name: "Red Bull, 250 ml", amount_mg: 79 },
];

export const MULTIPLIERS = [
  { id: "0.5", label: "½", value: 0.5 },
  { id: "1", label: "1", value: 1 },
  { id: "1.5", label: "1½", value: 1.5 },
  { id: "2", label: "2", value: 2 },
];

export function presetById(id) {
  return PRESETS.find((preset) => preset.id === id) || null;
}
