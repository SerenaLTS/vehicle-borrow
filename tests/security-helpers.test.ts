import { describe, expect, it } from "vitest";
import { sanitizeInternalPath } from "../lib/navigation";
import { escapeHtml, isCompanyEmail } from "../lib/utils";

describe("security helpers", () => {
  it("allows only internal callback paths", () => {
    expect(sanitizeInternalPath("/dashboard?message=ok")).toBe("/dashboard?message=ok");
    expect(sanitizeInternalPath("//evil.example")).toBe("/dashboard");
    expect(sanitizeInternalPath("https://evil.example")).toBe("/dashboard");
    expect(sanitizeInternalPath("/\\evil.example")).toBe("/dashboard");
  });

  it("escapes user-controlled HTML email content", () => {
    expect(escapeHtml(`<a href="bad">O'Brien & team</a>`)).toBe("&lt;a href=&quot;bad&quot;&gt;O&#39;Brien &amp; team&lt;/a&gt;");
  });

  it("matches only the configured company email domain", () => {
    expect(isCompanyEmail("person@example.com", "example.com")).toBe(true);
    expect(isCompanyEmail("person@fakeexample.com", "example.com")).toBe(false);
  });
});
