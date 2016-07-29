import {produce,consume,Tag} from "../src"
import {parse} from "babylon"
import generate from "babel-generator"
import R from "ramda"

const Scope = {$:"Scope"}

const subst = R.curry(function* subst(dict, s) {
  for(const i of s) {
    switch (i.type) {
    case Tag.Identifier:
      const n = dict[i.value.name]
      if (n) {
        if (i.enter)
          yield* produce(n,i.pos)
        continue
      }
      break
    case Scope:
      if (i.enter) {
        dict = Object.create(dict)
        for (const j in i.value)
          dict[j] = false
      } else
        dict = Object.getPrototypeOf(dict)
      break
    }
    yield i
  }
})

function* scope(s) {
  let inScope = null, buf = null
  const stack = []
  for(const i of s) {
    switch (i.type) {
    case Tag.FunctionExpression:
    case Tag.FunctionDeclaration:
      if (i.enter) {
        inScope = {}
        stack.push(inScope)
        buf = []
        for(let j of i.value.params) {
          if (j.name)
            inScope[j.name] = false
        }
        // it needs to scan whole function because variable declaration
        // may be defined after variable usage
        buf.push({enter:true, leave: false, pos: false, 
                  value: inScope, type: Scope})
        buf.push(i)
      } else {
        stack.pop()
        if (stack.length === 0) {
          for(let j of buf)
            yield j
          buf = null
        }
        yield i
        yield {enter:false, leave: true, pos: false, value: inScope}
        inScope = Object.getPrototypeOf(inScope)
      }
      continue;
    case Tag.VariableDeclaration:
      if (i.enter && inScope) {
        for(const {id} of i.value.declarations)
          if (id.name)
            inScope[id.name] = true
      }
      break;
    }
    if (buf)
      buf.push(i)
    else
      yield i
  }
}

const filter = R.curry(function* filter(pred, s) {
  for (let i of s) {
    if (pred(i))
      yield i;
  }
})

const rename = R.pipe(
  parse,
  produce,
  scope,
  subst({i:{type:"Identifier", name: "j"}}),
  consume,
  R.prop("top"),
  generate,
  R.prop("code")
);

function pretty(txt) {
  return generate(parse(txt)).code
}

describe("transducers composition", function() {
  it("rename", function() {
    expect(rename(`var i;`)).to.equal(pretty(`var j;`))
    expect(rename(`i;`)).to.equal(pretty(`j;`))
    expect(rename(`function a() { return i; }`))
      .to.equal(pretty(`function a() { return j; }`))
    expect(rename(`
                  i + k;
                  `)).to.equal(pretty(`
                                      j + k;
                                      `))
    expect(rename(`
                  console.log(i + k);
                  `)).to.equal(pretty(`
                                      console.log(j + k);
                                      `))
    expect(rename(`
                  console.log(i + k);
                  function a() {
                    var i;
                    console.log(i + k);
                  }
                  `)).to.equal(pretty(`
                                       console.log(j + k);
                                       function a() {
                                         var i;
                                         console.log(i + k);
                                       }`))
    expect(rename(`
                  console.log(i + k);
                  function a(i) {
                    console.log(i + k);
                  }
                  `)).to.equal(pretty(`
                                      console.log(j + k);
                                      function a(i) {
                                        console.log(i + k);
                                      }`))
  })
})


