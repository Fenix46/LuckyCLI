import { describe, expect, it } from "vitest";
import {
  type CallCandidate,
  type Graph,
  emptyGraph,
  makeNodeId,
  resolveCrossFileCalls,
} from "./types.js";

function fnNode(path: string, name: string, qualified = name) {
  return {
    id: makeNodeId(`${path}::${qualified}`),
    label: name,
    kind: "function" as const,
    sourceFile: path,
  };
}

function methodNode(path: string, className: string, name: string) {
  return {
    id: makeNodeId(`${path}::${className}.${name}`),
    label: name,
    kind: "method" as const,
    sourceFile: path,
  };
}

function graphWith(nodes: Graph["nodes"]): Graph {
  const graph = emptyGraph("/repo");
  graph.nodes = nodes;
  return graph;
}

describe("resolveCrossFileCalls", () => {
  it("resolves a bare-name candidate to the unique matching function across files", () => {
    const caller = fnNode("a.go", "run");
    const callee = fnNode("b.go", "helper");
    const graph = graphWith([caller, callee]);

    const candidates: CallCandidate[] = [
      { callerId: caller.id, calleeName: "helper" },
    ];
    resolveCrossFileCalls(graph, candidates);

    expect(graph.edges).toEqual([
      { source: caller.id, target: callee.id, relation: "calls", confidence: "AMBIGUOUS" },
    ]);
  });

  it("prefers the receiver-hinted method when multiple same-named methods exist", () => {
    const caller = fnNode("a.go", "run");
    const dogBark = methodNode("dog.go", "Dog", "bark");
    const catBark = methodNode("cat.go", "Cat", "bark"); // decoy, same bare name
    const graph = graphWith([caller, dogBark, catBark]);

    const candidates: CallCandidate[] = [
      { callerId: caller.id, calleeName: "bark", receiverHint: "Dog" },
    ];
    resolveCrossFileCalls(graph, candidates);

    expect(graph.edges).toEqual([
      { source: caller.id, target: dogBark.id, relation: "calls", confidence: "AMBIGUOUS" },
    ]);
  });

  it("does not let a receiver hint match a longer class name ending in that hint", () => {
    const caller = fnNode("a.go", "run");
    // Only MyFoo.bark exists; a hint of "Foo" must not claim it, since the id
    // (`..._myfoo_bark`) merely ends with the `foo_bark` suffix.
    const myFooBark = methodNode("myfoo.go", "MyFoo", "bark");
    const graph = graphWith([caller, myFooBark]);

    const candidates: CallCandidate[] = [
      { callerId: caller.id, calleeName: "bark", receiverHint: "Foo" },
    ];
    resolveCrossFileCalls(graph, candidates);

    // Falls through to the bare-name tier, which is unique here, so the edge
    // still lands — but via the honest fallback, not a bogus "hint matched".
    expect(graph.edges).toEqual([
      { source: caller.id, target: myFooBark.id, relation: "calls", confidence: "AMBIGUOUS" },
    ]);
  });

  it("picks the exact class when a same-suffix decoy class exists", () => {
    const caller = fnNode("a.go", "run");
    const fooBark = methodNode("foo.go", "Foo", "bark");
    const myFooBark = methodNode("myfoo.go", "MyFoo", "bark");
    const graph = graphWith([caller, fooBark, myFooBark]);

    const candidates: CallCandidate[] = [
      { callerId: caller.id, calleeName: "bark", receiverHint: "Foo" },
    ];
    resolveCrossFileCalls(graph, candidates);

    // Suffix matching without a boundary check would match both and, being
    // ambiguous, drop the edge entirely.
    expect(graph.edges).toEqual([
      { source: caller.id, target: fooBark.id, relation: "calls", confidence: "AMBIGUOUS" },
    ]);
  });

  it("skips an ambiguous candidate rather than guessing wrong", () => {
    const caller = fnNode("a.go", "run");
    const dogBark = methodNode("dog.go", "Dog", "bark");
    const catBark = methodNode("cat.go", "Cat", "bark");
    const graph = graphWith([caller, dogBark, catBark]);

    // No receiver hint and two candidates share the bare name "bark".
    const candidates: CallCandidate[] = [
      { callerId: caller.id, calleeName: "bark" },
    ];
    resolveCrossFileCalls(graph, candidates);

    expect(graph.edges).toEqual([]);
  });

  it("drops a candidate whose callee name matches nothing in the project", () => {
    const caller = fnNode("a.go", "run");
    const graph = graphWith([caller]);

    const candidates: CallCandidate[] = [
      { callerId: caller.id, calleeName: "unknownFn" },
    ];
    resolveCrossFileCalls(graph, candidates);

    expect(graph.edges).toEqual([]);
  });

  it("drops a candidate whose caller no longer exists in the graph", () => {
    const callee = fnNode("b.go", "helper");
    const graph = graphWith([callee]);

    const candidates: CallCandidate[] = [
      { callerId: makeNodeId("gone.go::stale"), calleeName: "helper" },
    ];
    resolveCrossFileCalls(graph, candidates);

    expect(graph.edges).toEqual([]);
  });

  it("never emits a self-loop even if name matching would otherwise produce one", () => {
    const caller = fnNode("a.go", "run");
    const graph = graphWith([caller]);

    const candidates: CallCandidate[] = [
      { callerId: caller.id, calleeName: "run" },
    ];
    resolveCrossFileCalls(graph, candidates);

    expect(graph.edges).toEqual([]);
  });

  it("does not duplicate an edge that already exists in the graph", () => {
    const caller = fnNode("a.go", "run");
    const callee = fnNode("b.go", "helper");
    const graph = graphWith([caller, callee]);
    graph.edges = [
      { source: caller.id, target: callee.id, relation: "calls", confidence: "INFERRED" },
    ];

    const candidates: CallCandidate[] = [
      { callerId: caller.id, calleeName: "helper" },
    ];
    resolveCrossFileCalls(graph, candidates);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]!.confidence).toBe("INFERRED");
  });

  it("is a no-op given an empty candidate list", () => {
    const graph = graphWith([fnNode("a.go", "run")]);
    resolveCrossFileCalls(graph, []);
    expect(graph.edges).toEqual([]);
  });
});
