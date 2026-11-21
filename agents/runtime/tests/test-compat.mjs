import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

function partialMatch(actual, expected, path = "value") {
  if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object", `${path} should be an object`);
    if (Array.isArray(expected)) {
      assert.ok(Array.isArray(actual), `${path} should be an array`);
      assert.equal(actual.length, expected.length, `${path} length`);
      expected.forEach((value, index) => partialMatch(actual[index], value, `${path}[${index}]`));
      return;
    }
    for (const [key, value] of Object.entries(expected)) {
      assert.ok(Object.prototype.hasOwnProperty.call(actual, key), `${path} missing property ${key}`);
      partialMatch(actual[key], value, `${path}.${key}`);
    }
    return;
  }
  assert.deepEqual(actual, expected, path);
}

function hasProperty(actual, property) {
  const keys = String(property).split(".");
  let value = actual;
  for (const key of keys) {
    if (value == null || !Object.prototype.hasOwnProperty.call(Object(value), key)) return false;
    value = value[key];
  }
  return true;
}

function thrownError(fn) {
  try { fn(); } catch (error) { return error; }
  assert.fail("Expected function to throw");
}

function expect(actual) {
  const matchers = {
    toBe(expected) { assert.strictEqual(actual, expected); },
    toEqual(expected) { assert.deepStrictEqual(actual, expected); },
    toMatchObject(expected) { partialMatch(actual, expected); },
    toHaveLength(expected) { assert.strictEqual(actual?.length, expected); },
    toBeLessThan(expected) { assert.ok(actual < expected, `Expected ${actual} < ${expected}`); },
    toContain(expected) {
      assert.ok(actual != null && typeof actual.includes === "function" && actual.includes(expected));
    },
    toContainEqual(expected) {
      assert.ok(Array.isArray(actual) && actual.some(value => isDeepStrictEqual(value, expected)));
    },
    toBeUndefined() { assert.strictEqual(actual, undefined); },
    toHaveProperty(property) { assert.ok(hasProperty(actual, property)); },
    toMatch(expected) {
      assert.ok((expected instanceof RegExp ? expected : new RegExp(expected)).test(String(actual)));
    },
    toThrow(expected) {
      assert.equal(typeof actual, "function");
      const error = thrownError(actual);
      if (expected !== undefined) {
        const message = error instanceof Error ? error.message : String(error);
        assert.ok(message.includes(String(expected)), `Expected thrown message to include ${expected}, received ${message}`);
      }
    }
  };
  const rejects = {
    async toThrow(expected) {
      assert.ok(actual && typeof actual.then === "function", "Expected a Promise");
      let error;
      try { await actual; } catch (caught) { error = caught; }
      assert.ok(error, "Expected Promise to reject");
      if (expected !== undefined) {
        const message = error instanceof Error ? error.message : String(error);
        assert.ok(message.includes(String(expected)), `Expected rejection message to include ${expected}, received ${message}`);
      }
    }
  };
  const negative = {
    toHaveProperty(property) { assert.ok(!hasProperty(actual, property)); },
    toContain(expected) {
      assert.ok(!(actual != null && typeof actual.includes === "function" && actual.includes(expected)));
    }
  };
  return { ...matchers, rejects, not: negative };
}

export { expect };
