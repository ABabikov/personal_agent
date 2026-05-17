/**
 * @deprecated Импортируйте из `./buildWorkoutFromCatalog`.
 */
export {
  buildWorkoutFromCatalog,
  type BuildCatalogOptions,
  type CatalogWorkoutSeries,
  type SwimCatalogBlock,
} from "./buildWorkoutFromCatalog";

/** @deprecated Используйте {@link SwimCatalogBlock} */
export type { SwimCatalogBlock as SwimBlockTemplateRow } from "./buildWorkoutFromCatalog";
