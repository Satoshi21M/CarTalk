/**
 * Client-side port of the recipient matching logic from
 * server/gemini-audio-analyze.mjs.
 *
 * Matches a Gemini-extracted target string against a list of known vehicles.
 * Returns the best match or null if confidence is too low.
 */

export type MatchCandidate = {
  id: string;
  label: string;
  plate: string;
  brand: string;
  color: string;
  vehicleType: string;
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function expandColorAliases(value: string): string[] {
  const normalized = normalizeText(value);
  const map: Record<string, string[]> = {
    zwart: ["zwart", "zwarte"],
    wit: ["wit", "witte"],
    grijs: ["grijs", "grijze", "grijzige"],
    rood: ["rood", "rode", "roodkleurige"],
    blauw: ["blauw", "blauwe"],
    groen: ["groen", "groene"],
    geel: ["geel", "gele"],
    zilver: ["zilver", "zilveren"]
  };
  return Object.values(map).find((aliases) => aliases.includes(normalized)) ?? [normalized];
}

function expandBrandAliases(value: string): string[] {
  const normalized = normalizeText(value);
  const aliases = new Set([normalized]);
  if (normalized.includes("mercedes")) {
    aliases.add("mercedes");
    aliases.add("mercedes benz");
    aliases.add("mercedes-benz");
  }
  if (normalized.includes("volkswagen")) {
    aliases.add("volkswagen");
    aliases.add("vw");
  }
  return [...aliases].filter(Boolean);
}

function expandVehicleTypeAliases(value: string): string[] {
  const normalized = normalizeText(value);
  const map: Record<string, string[]> = {
    sedan: ["sedan", "limousine"],
    stationwagen: ["stationwagen", "station", "wagon"],
    suv: ["suv", "jeep"],
    bestelwagen: ["bestelwagen", "bestelbus", "busje", "van"],
    bus: ["bus", "minibus"]
  };
  return Object.values(map).find((aliases) => aliases.includes(normalized)) ?? [normalized];
}

/** Count how many distinct signals (plate, color, brand, vehicleType) appear in the target string. */
export function countTargetSignals(target: string): number {
  const normalized = normalizeText(target);
  if (!normalized || normalized === "onbekend") return 0;

  const signals = new Set<string>();

  if (/[a-z0-9]{2,}-?[a-z0-9]{2,}-?[a-z0-9]{2,}/i.test(target)) {
    signals.add("plate");
  }

  const colors = ["zwart", "witte", "wit", "grijs", "grijze", "rood", "rode", "blauw", "blauwe", "groen", "groene"];
  const brands = ["volvo", "bmw", "mercedes", "mercedes-benz", "audi", "volkswagen", "vw", "tesla", "toyota"];
  const vehicleTypes = ["sedan", "stationwagen", "suv", "bestelwagen", "bus"];

  if (colors.some((c) => normalized.includes(c))) signals.add("color");
  if (brands.some((b) => normalized.includes(b))) signals.add("brand");
  if (vehicleTypes.some((t) => normalized.includes(t))) signals.add("vehicleType");

  return signals.size;
}

/** Find the best-matching candidate for the given target string. */
export function matchRecipient(target: string, candidates: MatchCandidate[]): MatchCandidate | null {
  const normalizedTarget = normalizeText(target);
  if (!normalizedTarget || normalizedTarget === "onbekend") return null;

  const normalizedPlate = normalizePlate(target);

  return (
    candidates.find((candidate) => {
      const plate = normalizePlate(candidate.plate);
      const colorAliases = expandColorAliases(candidate.color);
      const brandAliases = expandBrandAliases(candidate.brand);
      const typeAliases = expandVehicleTypeAliases(candidate.vehicleType);
      const label = normalizeText(candidate.label);

      // Exact plate match is the strongest signal
      if (plate && normalizedPlate.includes(plate)) return true;

      const colorMatch = colorAliases.some((v) => v && normalizedTarget.includes(v));
      const brandMatch = brandAliases.some((v) => v && normalizedTarget.includes(v));
      const typeMatch = typeAliases.some((v) => v && normalizedTarget.includes(v));
      const labelMatch = Boolean(label && normalizedTarget.includes(label));

      return labelMatch || (brandMatch && colorMatch) || (brandMatch && typeMatch) || (colorMatch && typeMatch);
    }) ?? null
  );
}
