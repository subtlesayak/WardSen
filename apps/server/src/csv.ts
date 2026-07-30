import type { PersonRecord } from "@wardsen/core";

export function parsePeopleCsv(csv: string): Array<Omit<PersonRecord, "id" | "createdAt" | "updatedAt"> & { id?: string }> {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  return rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => {
    const value = (name: string) => row[headers.indexOf(name)]?.trim() || undefined;
    return {
      id: value("id"),
      name: value("name") ?? "",
      phone: value("phone"),
      email: value("email"),
      groupName: value("group") ?? value("group_name"),
      role: value("role"),
      notes: value("notes"),
      active: value("active")?.toLowerCase() !== "false"
    };
  }).filter((person) => person.name);
}

export function peopleToCsv(people: PersonRecord[]): string {
  const rows = [
    ["id", "name", "phone", "email", "group", "role", "notes", "active"],
    ...people.map((person) => [
      person.id,
      person.name,
      person.phone ?? "",
      person.email ?? "",
      person.groupName ?? "",
      person.role ?? "",
      person.notes ?? "",
      String(person.active)
    ])
  ];
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (quoted && char === "\"" && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function escapeCsvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll("\"", "\"\"")}"`;
}
