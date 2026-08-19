// @vitest-environment jsdom
import { mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";
import NumberField from "./NumberField.svelte";

describe("NumberField", () => {
  it("emits finite numeric edits", async () => {
    const target = document.createElement("div");
    const onChange = vi.fn();
    const component = mount(NumberField, { target, props: { label: "Width", value: 300, suffix: "mm", min: 50, max: 600, onChange } });
    const input = target.querySelector("input") as HTMLInputElement;
    input.value = "325";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith(325);
    await unmount(component);
  });
});
