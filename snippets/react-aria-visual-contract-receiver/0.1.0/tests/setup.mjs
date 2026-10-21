import {afterEach} from "vitest";
import {cleanup} from "@testing-library/react";

afterEach(() => cleanup());

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

globalThis.ResizeObserver = ResizeObserverStub;
globalThis.IntersectionObserver = IntersectionObserverStub;
globalThis.PointerEvent ??= MouseEvent;
globalThis.requestAnimationFrame ??= (callback) => globalThis.setTimeout(callback, 0);
globalThis.cancelAnimationFrame ??= (handle) => globalThis.clearTimeout(handle);
Element.prototype.scrollIntoView ??= () => {};
