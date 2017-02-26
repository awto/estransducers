import {produce,consume,Tag} from "../src"
import {parse} from "babylon"
import generate from "babel-generator"
import * as Kit from "../src/kit"
import * as Scope from "../src/scope"
import * as Trace from "../src/trace"
import * as R from "ramda"

const gen = ast => generate(ast,{retainLines:false,concise:true,quotes:"'"}).code
const pretty = R.pipe(R.invoker(0,"toString"),parse,gen)

function varDeclsEs5(si) {
  const s = Kit.auto(si)
  function* walk(decls) {
    for(const i of s.sub()) {
      if (i.enter) {
        switch(i.type) {
        case Tag.FunctionDeclaration:
        case Tag.FunctionExpression:
          yield* scope(Tag.body,i)
          continue
        case Tag.VariableDeclaration:
          i.value.node.kind = "var"
          decls.push(s.peel(Kit.setPos(i,Tag.push)),...s.sub(),...s.leave())
          continue
        }
      }
      yield i
    }
  }
  function* scope(pos,i) {
    const decls = []
    const lab = s.label()
    yield s.peel(i)
    yield* s.peelTo(pos)
    yield* s.peelTo(Tag.body)
    const body = [...walk(decls)]
    yield* decls
    yield* body
    yield* lab()
  }
  return scope(Tag.program)
}

function* allToVar(s) {
  for(const i of s) {
    if (i.enter && i.type === Tag.VariableDeclaration)
      i.value.node.kind = "var"
    yield i
  }
}

const convertImpl = (pass) => R.pipe(
  i => i.toString(),
  parse,
  produce,
  Scope.assignSym,
  pass,
  Scope.calcDecls,
  Scope.solve,
  consume,
  i => i.top,
  gen)

describe("generating new names", function() {
  const convert = (s,genLikesNum,genLikesSimpl = []) => {
    let genId = 0
    return convertImpl(R.pipe(
      function*(si) {
        const s = Kit.auto(si)
        let debx = 0
        for(const i of s) {
          if (i.pos === Tag.declarations && i.leave) {
            let prev = null, prevSym = null
            const names = []
                  .concat(genLikesNum.map(i => [i,`${i}${genId++}`]),
                          genLikesSimpl.map(i => [i,i,Symbol(i)]))
            for(const [i,name,sym] of names) {
              yield s.enter(Tag.push,Tag.VariableDeclarator)
              yield s.tok(Tag.id,Tag.Identifier,{nameLike:i,sym,node:{name},debx:debx++})
              if (prev != null)
                yield s.tok(Tag.init,Tag.Identifier,{node:{name:prev},sym:prevSym})
              yield* s.leave()
              prev = name, prevSym = sym
            }
          }
          yield i
        }
      },Scope.assignSym
    ))(s)
  }
  it("should generate uniq names 1", function() {
    expect(
      convert(function a() {
        var a = 10, b = 10;
      },["a","b","c","d","a"]))
      .to.equal(pretty(function a() {
      var a = 10, b = 10, a1, b1 = a1, c = b1, d = c, a2 = d;
    }))
  })
  it("should generate uniq names 2", function() {
    expect(
      convert(function a() {
        var a = 10, b = 10;
      },["a","b","c","d","a"],["a"]))
      .to.equal(pretty(function a() {
        var a = 10, b = 10, a1, b1 = a1, c = b1, d = c, a2 = d, a3 = a2;
      }))
  })
  it("should generate uniq names 3", function() {
    expect(
      convert(function a() {
        var a = 10, b = 10;
      },["a","b","$$$"],["a","$$$"]))
      .to.equal(pretty(function a() {
        var a = 10, b = 10, a1, b1 = a1, c = b1, a2 = c, d = a2;
      }))
  })
  it("should generate uniq names 4", function() {
    expect(
      convert(function a() {
        var a = 10, b = 10;
        function c() {
          var d = 10, e = 10;
        }
      },["a","b","$$$"],["a","$$$"]))
      .to.equal(pretty(function a() {
        var a = 10, b = 10, a1, b1 = a1, d = b1, a2 = d, e = a2;
        function c() {
          var d = 10, e = 10, a, b = a, c = b, a1 = c, f = a1;
        }
      }))
  })
  it("should generate uniq names 5", function() {
    expect(
      convert(function a() {
        var a = 10, b = 10,c,d,e,f,g,h,k,m,n,x,y,z;
      },["a","b","$$$"],["a","$$$"]))
      .to.equal(pretty(function a() {
        var a = 10, b = 10, c, d, e, f, g, h, k, m, n, x, y,
            z, a1, b1 = a1, c1 = b1, a2 = c1, d1 = a2;
      }))
  })
  it("should generate uniq names 6", function() {
    expect(
      convert(`function f() {
        let a = 10, b = 10;
        {
          let c = a;
        }
        {
          let c = b, d = 20;
        }
        {
          let a = 10, c = 20, e = 30;
        }
      }`,["a","b","$$$"],["a","$$$"]))
      .to.equal(pretty(`function f() {
        let a = 10, b = 10, a1, b1 = a1, c = b1, a2 = c, d = a2;
        {
          let c = a, a1, b = a1, d = b, a2 = d, e = a2;
        }
        {
          let c = b, d = 20, a, b1 = a, e = b1, a1 = e, f = a1;
        }
        {
          let a = 10, c = 20, e = 30, a1, b = a1, d = b, a2 = d, f = a2;
        }
      }`))
  })
})

describe("converting const/let to var", function() {
  context("if just kind is updated", function() {
    const convert = convertImpl(allToVar /*varDeclsEs5*/)
    it("should keep names uniq 1", function() {
      expect(convert(`function a() {
        var a = 10;
        {
          let a = 20;
          a++
          {
            let a = 30, a2 = 40, a3 = 50;
            a++;
          }
        }
      }`)).to.equal(pretty(function a() {
        var a = 10;
        {
          var a1 = 20;
          a1++;
          {
            var a4 = 30, a2 = 40, a3 = 50;
            a4++;
          }
        }
      }))
    })
    it("should keep names uniq 2", function() {
      expect(convert(`function a() {
        function a() {
          a()
          var a = 10
        }
        {
          let a = 20;
          a++
          {
            let a = 30, a2 = 40, a3 = 50;
            a++;
          }
        }
        a()
      }`)).to.equal(pretty(function a() {
        function a() {
          a()
          var a = 10;
        }
        {
          var a1 = 20;
          a1++;
          {
            var a4 = 30, a2 = 40, a3 = 50;
            a4++;
          }
        }
        a()
      }))
    })
    it("should keep names uniq 3", function() {
      expect(convert(`function a() {
        function a() {
          a()
          {
            let a = 10
            a++
          }
          let a = 20
          a++
        }
        {
          let a = 20;
          a++
          {
            let a = 30, a2 = 40, a3 = 50;
            a++;
          }
        }
        a()
      }`)).to.equal(pretty(function a() {
        function a() {
          a(); { var a1 = 10; a1++; }
          var a4 = 20;
          a4++;
        }
        {
          var a1 = 20;
          a1++;
          {
            var a4 = 30, a2 = 40, a3 = 50;
            a4++;
          }
        }
        a();
      }))
    })
    it("should keep names uniq 4", function() {
      expect(convert(`function a() {
          a()
          var a = 10; 
          {
            let a = 10;
          }
      }`)).to.equal(pretty(function a() {
        a();
        var a = 10;
        { var a1 = 10; } }))
    })
  })
  context("if every declaration is moved to its scope start", function() {
    const convert = convertImpl(varDeclsEs5)
    it("should keep names uniq 5", function() {
      expect(convert(`function a() {
      var a = 10;
      {
        let a = 20;
        a++
        {
          let a = 30, a2 = 40, a3 = 50;
          a++;
        }
      }
      }`)).to.equal(pretty(function a() {
        var a = 10;
        var a1 = 20;
        var a4 = 30, a2 = 40, a3 = 50;
        { a1++; { a4++; } }
      }))
    })
  })
})