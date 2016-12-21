import {produce,consume,Tag} from "../src"
import {parse} from "babylon"
import generate from "babel-generator"
import * as Kit from "../src/kit"
import * as Match from "../src/match"
import * as Trace from "../src/trace"
import * as R from "ramda"

const gen = ast => generate(ast,{retainLines:false,concise:true,quotes:"'"}).code
const pretty = R.pipe(R.invoker(0,"toString"),parse,gen)
const runImpl = (pats) =>
      R.pipe(
        R.invoker(0,"toString"),
        parse,
        produce,
        Match.run(pats))

describe("match", function() {
  const run = runImpl([
    ">$A=$B+1",
    "=$D=$B--"
  ])
  it("should find sub-node", function() {
    const p = Kit.auto(Trace.verify(run(
      function f() {
        let a = 1, b = a + 1;
        a = b--;
        b = a, b = b--;
      })))
    let i = Kit.skip(p.till(i => i.enter && i.type === Match.Root))
    expect(i.value.index).to.equal(0)
    expect(p.cur().pos.$).to.equal("push")
    expect(p.cur().type.$).to.equal("VariableDeclarator")
    i = Kit.skip(p.till(i => i.enter && i.type === Match.Placeholder))
    expect(i.value.name).to.equal("A")
    expect(p.cur().pos.$).to.equal("id")
    expect(p.cur().type.$).to.equal("Identifier")
    expect(p.cur().value.node.name).to.equal("b")
    Kit.skip(p.till(i => i.leave && i.type === Match.Placeholder))
    expect(p.cur().pos.$).to.equal("init")
    expect(p.cur().type.$).to.equal("BinaryExpression")
    i = Kit.skip(p.till(i => i.enter && i.type === Match.Placeholder))
    expect(i.value.name).to.equal("B")
    expect(p.cur().pos.$).to.equal("left")
    expect(p.cur().type.$).to.equal("Identifier")
    expect(p.cur().value.node.name).to.equal("a")
    i = Kit.skip(p.till(i => i.enter && i.type === Match.Root))
    expect(i.value.index).to.equal(1)
    expect(p.cur().pos.$).to.equal("expression")
    expect(p.cur().type.$).to.equal("AssignmentExpression")
    i = Kit.skip(p.till(i => i.enter && i.type === Match.Placeholder))
    expect(i.value.name).to.equal("D")
    expect(p.cur().pos.$).to.equal("left")
    expect(p.cur().type.$).to.equal("Identifier")
    expect(p.cur().value.node.name).to.equal("a")
    i = Kit.skip(p.till(i => i.enter && i.type === Match.Placeholder))
    expect(i.value.name).to.equal("B")
    expect(p.cur().pos.$).to.equal("argument")
    expect(p.cur().type.$).to.equal("Identifier")
    expect(p.cur().value.node.name).to.equal("b")
    i = Kit.skip(p.till(i => i.enter && i.type === Match.Root))
    expect(i.value.index).to.equal(1)
    expect(p.cur().pos.$).to.equal("push")
    expect(p.cur().type.$).to.equal("AssignmentExpression")
    i = Kit.skip(p.till(i => i.enter && i.type === Match.Placeholder))
    expect(i.value.name).to.equal("D")
    expect(p.cur().pos.$).to.equal("left")
    expect(p.cur().type.$).to.equal("Identifier")
    expect(p.cur().value.node.name).to.equal("b")
    i = Kit.skip(p.till(i => i.enter && i.type === Match.Placeholder))
    expect(i.value.name).to.equal("B")
    expect(p.cur().pos.$).to.equal("argument")
    expect(p.cur().type.$).to.equal("Identifier")
    expect(p.cur().value.node.name).to.equal("b")
    i = Kit.skip(p.till(i => i.enter
                        && (i.type === Match.Placeholder
                            || i.type === Match.Root)))
    expect(i).to.equal(null)
  })
})

