/**
 * Normalizes RESQML UOM strings to OSDU canonical UnitOfMeasure codes.
 *
 * OSDU reference-data UnitOfMeasure follows Energistics UOM conventions.
 * Some RESQML datasets use informal or legacy codes that don't match
 * canonical entries (e.g. "v/v" instead of "m3/m3").
 */
const UOM_MAP: Record<string, string> = {
  "v/v": "m3/m3",
  "vol/vol": "m3/m3",
  "unitless": "Euc",
  "fraction": "Euc",
  "none": "Euc",
  "NONE": "Euc",
};

export function normalizeUom(uom: string | undefined): string {
  if (uom === undefined) {
    return "Euc";
  }
  return UOM_MAP[uom] ?? uom;
}
