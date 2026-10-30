import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  audit,
  canonical,
  commitment,
  formatProof,
  parseProof,
  sealCode,
  winningNames,
} from "./fair.ts";

const NAMES = ["Amina Rahman", "Chris Dalton", "Elena Vasquez", "Jordan Blake"];

describe("public draw", () => {
  it("seals the same list to the same code", async () => {
    const first = await commitment(NAMES, 1, 100);
    const second = await commitment(NAMES, 1, 100);
    assert.equal(first, second);
    assert.equal(first.length, 64);
    assert.notEqual(await commitment(NAMES, 2, 100), first);
    assert.notEqual(await commitment([...NAMES].reverse(), 1, 100), first);
    assert.equal(sealCode(first), first.slice(0, 8).toUpperCase());
    assert.match(canonical(NAMES, 1, 100), /^waffle-v1\n1\n100\nAmina Rahman/);
  });

  it("picks the same winners from the same pulse and a different set from another", async () => {
    const seed = "ab".repeat(32);
    const other = "cd".repeat(32);
    const once = await winningNames(NAMES, 2, seed);
    const twice = await winningNames(NAMES, 2, seed);
    assert.deepEqual(once, twice);
    assert.equal(once.length, 2);
    assert.notDeepEqual(new Set(once).size, 1);
    assert.notDeepEqual(await winningNames(NAMES, 2, other), once);
  });

  it("matches a proof and rejects a swapped winner", async () => {
    const seed = "11".repeat(32);
    const winners = await winningNames(NAMES, 1, seed);
    const seal = await commitment(NAMES, 1, 42);
    assert.equal(await audit(NAMES, 1, 42, seed, winners, seal), "match");
    const swapped = winners[0] === NAMES[0] ? NAMES[1]! : NAMES[0]!;
    assert.equal(await audit(NAMES, 1, 42, seed, [swapped], seal), "mismatch");
    const text = formatProof({ names: NAMES, count: 1, round: 42, randomness: seed, commitment: seal }, winners);
    const parsed = parseProof(`Winner — ${winners[0]}\n\n${text}`);
    assert.ok(parsed);
    assert.deepEqual(parsed?.winners, winners);
    assert.deepEqual(parsed?.proof.names, NAMES);
    assert.equal(parsed?.proof.round, 42);
  });
});
