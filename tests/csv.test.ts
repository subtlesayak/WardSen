import { describe, expect, it } from "vitest";
import { parsePeopleCsv, peopleToCsv } from "../apps/server/src/csv";

describe("people CSV helpers", () => {
  it("imports quoted people rows and exports escaped CSV", () => {
    const people = parsePeopleCsv('name,email,group,notes\n"Mira Shah",mira@example.com,Ops,"has, comma"');
    expect(people).toHaveLength(1);
    expect(people[0].notes).toBe("has, comma");

    const csv = peopleToCsv([
      {
        id: "1",
        name: "Mira Shah",
        email: "mira@example.com",
        notes: "has, comma",
        active: true,
        createdAt: "now",
        updatedAt: "now"
      }
    ]);
    expect(csv).toContain('"has, comma"');
  });
});
