import { describe, expect, it } from "vitest";
import { orderSelectedCredentialsFirst, type CredentialSelectionIdentity } from "../apps/web/src/credentialSelection";

function credential(id: string): CredentialSelectionIdentity & { title: string } {
  return { providerId: "bitwarden", accountId: "work", id, title: id };
}

describe("orderSelectedCredentialsFirst", () => {
  it("moves checked credentials to the top without changing either group's order", () => {
    const first = credential("first");
    const second = credential("second");
    const third = credential("third");
    const fourth = credential("fourth");

    expect(orderSelectedCredentialsFirst([first, second, third, fourth], [third, first]))
      .toEqual([first, third, second, fourth]);
  });

  it("returns a credential to the normal group as soon as it is unchecked", () => {
    const first = credential("first");
    const second = credential("second");
    const third = credential("third");

    expect(orderSelectedCredentialsFirst([first, second, third], [third])).toEqual([third, first, second]);
    expect(orderSelectedCredentialsFirst([first, second, third], [])).toEqual([first, second, third]);
  });
});
