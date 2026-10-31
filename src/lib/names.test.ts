import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNamed } from "./names.ts";

describe("pasted Facebook lists", () => {
  it("keeps each bought number with its name", () => {
    const pasted = `1. George
2 Mike
3 Tommy 
4. Jerry 
5 room
6 Bob
7 Robin mini `;
    assert.deepEqual(parseNamed(pasted), [
      { name: "George", number: 1 },
      { name: "Mike", number: 2 },
      { name: "Tommy", number: 3 },
      { name: "Jerry", number: 4 },
      { name: "room", number: 5 },
      { name: "Bob", number: 6 },
      { name: "Robin mini", number: 7 },
    ]);
  });

  it("accepts the punctuation people actually type", () => {
    assert.deepEqual(parseNamed("1.George\n1.) Ana\nNo. 8 Chris\n#9 Dana"), [
      { name: "George", number: 1 },
      { name: "Ana", number: 1 },
      { name: "Chris", number: 8 },
      { name: "Dana", number: 9 },
    ]);
  });

  it("still takes a plain name with no number", () => {
    assert.deepEqual(parseNamed("Robin mini"), [{ name: "Robin mini" }]);
  });
});
