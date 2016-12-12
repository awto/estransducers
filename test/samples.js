import {produce,consume,Tag} from "../src"
import {parse} from "babylon"
import generate from "babel-generator"
import * as Kit from "../src/kit"
import * as R from "ramda"
import eagerGenerators from "../src/samples/eagerGenerators"
import joinMemExprs from "../src/samples/joinMemExprs"
import looseForOf from "../src/samples/looseForOf"

const gen = ast => generate(ast,{retainLines:false,concise:true}).code
const pretty = R.pipe(R.invoker(0,"toString"),parse,gen)

describe("join member expression", function() {
  const run = R.pipe(
    R.invoker(0,"toString"),
    parse,
    produce,
    joinMemExprs,
    consume,
    R.prop("top"),
    gen)
  it("sample1", function() {
    expect(run(`function a() {
      const a = create(), b = create(), /*@PACK*/d = create(), e = cr()
      d.a = 10
      console.log(a.a,a.c,b.a,e.c,d.c)
      if (check(b)) {
        const b = create()
        let d = create(e)
        console.log(a.a,a.c,b.a,d)
      }
    }`)).to.equal(pretty(`function a() {
      const a = create(), b = create(), /*@PACK*/ d = create(), e = cr();
      let a$a = a && a.a;
      let a$c = a && a.c;
      let d$a = d && d.a;
      let d$c = d && d.c;
      d$a = 10;
      console.log(a$a, a$c, b.a, e.c, d$c);
      if (check(b)) {
        const b = create();
        let b$a = b && b.a;
        let d = create(e);
        console.log(a$a, a$c, b$a, d);
      }
    }`))
  })
})

describe("extra loose for-ofs", function() {
  const run = R.pipe(
    R.invoker(0,"toString"),
    parse,
    produce,
    looseForOf,
    consume,
    R.prop("top"),
    gen)
  it("sample1", function() {
    expect(run(`function a() {
      for(const i of a) {
        zzz
      }
    }`)).to.equal(pretty(`function a() {
      {
        const _e = a;
        const _arr = e$y$arr(_e);
        if (_arr != null) {
          const _len = _arr.length;
          for (let _i = 0; _i < _len; ++_i) {
            const i = _arr[_i];
            zzz;
          }
        } else {
          const _iter = _e[Symbol.iterator]();
          for (let _i = _iter.next(); !_i.done; _i = _iter.next()) {
            const i = _i.value;
            zzz;
          }
        }
      }
    }`))
  })
  it("sample2", function() {
    expect(run(`function a() {
      for(const i of a)
        zzz
    }`)).to.equal(pretty(`function a() {
      {
        const _e = a;
        const _arr = e$y$arr(_e);
        if (_arr != null) {
          const _len = _arr.length;
          for (let _i = 0; _i < _len; ++_i) {
            const i = _arr[_i];
            zzz;
          }
        } else {
          const _iter = _e[Symbol.iterator]();
          for (let _i = _iter.next(); !_i.done; _i = _iter.next()) {
            const i = _i.value;
            zzz;
          }
        }
      }
    }`))
  })
  it("sample3", function() {
    expect(run(`function a() {
      var i
      for(i of a)
        zzz
    }`)).to.equal(pretty(`function a() {
      var i
      {
        const _e = a;
        const _arr = e$y$arr(_e);
        if (_arr != null) {
          const _len = _arr.length;
          for (let _i = 0; _i < _len; ++_i) {
            i = _arr[_i];
            zzz;
          }
        } else {
          const _iter = _e[Symbol.iterator]();
          for (let _i = _iter.next(); !_i.done; _i = _iter.next()) {
            i = _i.value;
            zzz;
          }
        }
      }
    }`))
  })
  it("sample4", function() {
    expect(run(`function a() {
      var i
      for(i of a)
        for(const j of b) {
          zzz
        }
    }`)).to.equal(pretty(`function a() {
      var i;
      {
        const _e = a;
        const _arr = e$y$arr(_e);
        if (_arr != null) {
          const _len = _arr.length;
          for (let _i = 0; _i < _len; ++_i) {
            i = _arr[_i];
            {
              const _e = b;
              const _arr = e$y$arr(_e);
              if (_arr != null) {
                const _len = _arr.length;
                for (let _i = 0; _i < _len; ++_i) {
                  const j = _arr[_i];
                  zzz;
                }
              } else {
                const _iter = _e[Symbol.iterator]();
                for (let _i = _iter.next(); !_i.done; _i = _iter.next()) {
                  const j = _i.value;
                  zzz;
                }
              }
            }
          }
        } else {
          const _iter = _e[Symbol.iterator]();
          for (let _i = _iter.next(); !_i.done; _i = _iter.next()) {
            i = _i.value;
            {
              const _e = b;
              const _arr = e$y$arr(_e);
              if (_arr != null) {
                const _len = _arr.length;
                for (let _i = 0; _i < _len; ++_i) {
                  const j = _arr[_i];
                  zzz;
                }
              } else {
                const _iter = _e[Symbol.iterator]();
                for (let _i = _iter.next(); !_i.done; _i = _iter.next()) {
                  const j = _i.value;
                  zzz;
                }
              }
            }
          }
        }
      }
    }`))
  })
  it("sample5", function() {
    expect(run(`function a() {
      var i
      loo: for(i of a)
        zzz
    }`)).to.equal(pretty(`function a() {
      var i
      {
        const _e = a;
        const _arr = e$y$arr(_e);
        if (_arr != null) {
          const _len = _arr.length;
          loo: for (let _i = 0; _i < _len; ++_i) {
            i = _arr[_i];
            zzz;
          }
        } else {
          const _iter = _e[Symbol.iterator]();
          loo: for (let _i = _iter.next(); !_i.done; _i = _iter.next()) {
            i = _i.value;
            zzz;
          }
        }
      }
    }`))
  })
  
})
