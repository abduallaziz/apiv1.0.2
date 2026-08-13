// AIM (Association for Automatic Identification and Mobility) symbology
// identifiers are an optional 3-character prefix some industrial scanners
// (Zebra, Honeywell) can be configured to emit ahead of the payload —
// e.g. "]C1" for Code128, "]E0" for EAN-13, "]d2" for PDF417. Shared by
// both adapters rather than duplicated, since the format is identical;
// only the configuration defaults commonly differ per vendor, which is
// not something this stateless parser needs to know.
const AIM_PREFIX_PATTERN = /^\][A-Za-z0-9]{2}/;

export function stripAimPrefix(value: string): {
  value: string;
  symbology: string | null;
} {
  const match = AIM_PREFIX_PATTERN.exec(value);
  if (!match) return { value, symbology: null };
  return { value: value.slice(match[0].length), symbology: match[0] };
}
