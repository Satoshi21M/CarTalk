export function normalizeDutchPlate(input: string) {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

