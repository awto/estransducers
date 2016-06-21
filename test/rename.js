import {produce,consume} from "../src"
import esprima from "esprima"
import escodegen from "escodegen"
import R from "ramda"

const subst = R.curry(function* subst(dict, s) {
  for(let i of s) {
    const v = i.value
    if (v) {
      if (v.type === "Identifier") {
        if (i.enter) {
          const n = dict[v.name]
          if (n) {
            yield* produce(n,i.pos)
            continue
          }
        }
      } else if (v.type === "Scope") {
        if (i.enter) {
          dict = Object.create(dict)
          for (let j in v.names)
            dict[j] = false
        } else
          dict = Object.getPrototypeOf(dict)
      }
    }
    yield i
  }
})

function* scope(s) {
  let inScope = null, buf = null
  const stack = []
  for(let i of s) {
    const v = i.value
    if (v) {
      switch (v.type) {
      case "FunctionExpression":
      case "FunctionDeclaration":
        if (i.enter) {
          inScope = {}
          stack.push(inScope)
          buf = []
          for(let j of v.params) {
            if (j.name)
              inScope[j.name] = false
          }
          // it needs to scan whole function because variable declaration
          // may be defined after variable usage
          buf.push({enter:true, leave: false, pos: false, value: {type:"Scope", names: inScope}})
          buf.push(i)
        } else {
          stack.pop()
          if (stack.length === 0) {
            for(let j of buf)
              yield j
            buf = null
          }
          yield i
          yield {enter:false, leave: true, pos: false, value: {type:"Scope", names: inScope}}
          inScope = Object.getPrototypeOf(inScope)
        }
        continue;
      case "VariableDeclaration":
        if (i.enter && inScope) {
          for(let {id} of v.declarations)
            if (id.name)
              inScope[id.name] = true
        }
        break;
      }
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
  esprima.parse,
  produce,
  scope,
  subst({i:{type:"Identifier", name: "j"}}),
  consume,
  escodegen.generate);

function pretty(txt) {
  return escodegen.generate(esprima.parse(txt))
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


