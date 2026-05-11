/**
 * Словарь снаряжения для тегов в БД и инвентаря пользователя.
 * В шаблоне: `paddles_any` означает «подойдёт любой размер лопат из профиля».
 */
export const SWIM_EQUIPMENT_ITEMS = [
  { id: "kickboard", label: "Доска для ног" },
  { id: "pull_buoy", label: "Колобашка" },
  { id: "snorkel", label: "Трубка передняя" },
  { id: "fins", label: "Ласты" },
  { id: "paddles_s", label: "Лопаты, маленькие" },
  { id: "paddles_m", label: "Лопаты, средние" },
  { id: "paddles_l", label: "Лопаты, крупные" },
  { id: "anti_paddles", label: "Антилопатки / мачики" },
  { id: "drag_shirt", label: "Майка / лишнее сопротивление" },
  { id: "tempo_trainer", label: "Tempo Trainer / метроном" },
] as const;

export type SwimEquipmentId = (typeof SWIM_EQUIPMENT_ITEMS)[number]["id"];

/** Все id для «выделить всё» при первом включении фильтра */
export const ALL_SWIM_EQUIPMENT_IDS: SwimEquipmentId[] =
  SWIM_EQUIPMENT_ITEMS.map((x) => x.id);

export function swimEquipmentLabel(id: string): string {
  const row = SWIM_EQUIPMENT_ITEMS.find((x) => x.id === id);
  return row?.label ?? id;
}

/** Один требуемый тег покрыт инвентарём */
export function inventoryCoversTag(
  requiredTag: string,
  inventory: string[]
): boolean {
  if (requiredTag === "paddles_any") {
    return ["paddles_s", "paddles_m", "paddles_l"].some((p) =>
      inventory.includes(p)
    );
  }
  return inventory.includes(requiredTag);
}

/**
 * Блок допустим, если у него нет требований по снаряжению или все теги закрыты инвентарём.
 */
export function templateFitsInventory(
  equipmentTags: string[] | null | undefined,
  inventory: string[] | null | undefined
): boolean {
  if (inventory == null) return true;
  const req = equipmentTags?.filter(Boolean) ?? [];
  if (req.length === 0) return true;
  return req.every((tag) => inventoryCoversTag(tag, inventory));
}
