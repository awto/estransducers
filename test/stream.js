import {produce,consume,Tag} from "../src"
import {parse} from "babylon"
import generate from "babel-generator"
import * as T from "babel-types"

import * as Kit from "../src/kit"
const fs = require("fs")

describe("lookahead iterator", function() {
  const COUNT = 1000
  it("should provide accesst to the next element", function() { 
    const buf = Array.from(Array(COUNT+1).keys())
    const Stream = Kit.Stream({input:true})
    const s = new Stream(buf)
    expect(s.cur()).to.equal(0)
    let res = 0
    for(const i of s) {
      if (i === COUNT) {
        expect(s.cur()).to.equal(undefined)
      } else {
        expect(s.cur()).to.equal(i+1)
      }
    }
  })
  context("with array container", function() {
    it("should provide accesst to the next element", function() { 
      const buf = Array.from(Array(COUNT+1).keys())
      const Stream = Kit.Stream({arr:true,input:true})
      const s = new Stream(buf)
      expect(s.cur()).to.equal(0)
      let res = 0
      for(const i of s) {
        if (i === COUNT) {
          expect(s.cur()).to.equal(undefined)
        } else {
          expect(s.cur()).to.equal(i+1)
        }
      }
    })
  })
})

function toStr(iter) {
  const a = Array.from(iter)
  a[0].pos = a[a.length-1].pos = Tag.top
  return generate(consume(a).top,{compact:true}).code
}

function compact(str) {
  return generate(parse(str),{compact:true}).code
}

describe("scoped output", function() {
  function* gen() {
    const Stream = Kit.Stream({output:true})
    const s = new Stream()
    const lab = s.label()
    yield s.enter(Tag.top,Tag.FunctionExpression)
    yield s.enter(Tag.params,Tag.Array)
    yield* s.leave()
    yield s.enter(Tag.body,Tag.BlockStatement)
    yield s.enter(Tag.body,Tag.Array)
    yield s.enter(Tag.push,Tag.ReturnStatement)
    yield s.tok(Tag.argument,T.numericLiteral(10))
    yield* lab()
  }
  it("should auto close all openned elements", function() {
    expect(toStr(gen())).to.equal("function(){return 10;}")
  })
})

describe("hierarchical iterator",function() {
  const Stream = Kit.Stream({level:true,output:true})
  const prog = `
    function a() {
      const i = 10, j = 20
      {
        console.log(i)
        console.log(j)
      }
      let k = i + j
      console.log(k) 
    }`
  it("should be able to traverse sub-levels", function() {
    const s = new Stream(produce(parse(prog)))
    let cnt = 0
    expect(s.cur().type).to.equal(Tag.File)
    for(const i of s) {
      if (i.enter && i.type === Tag.Array && i.pos === Tag.body) {
        expect(s.level).to.equal(3)
        expect(s.cur().type).to.equal(Tag.FunctionDeclaration)
        for(const j of s.one()) {
          if (j.enter && j.type === Tag.Array && j.pos === Tag.body) {
            expect(s.cur().type).to.equal(Tag.VariableDeclaration)
            expect(toStr(s.one())).to.equal("const i=10,j=20;")
            expect(s.cur().type).to.equal(Tag.BlockStatement)
            for(const j of s.one()) {
              if (j.enter && j.type === Tag.Array && j.pos === Tag.body) {
                cnt++
                expect(s.cur().type).to.equal(Tag.ExpressionStatement)
                const j = [
                  s.enter(Tag.top,Tag.BlockStatement),
                  s.enter(Tag.body,Tag.Array),
                  ...s.sub(),
                  ...s.leave(), ...s.leave()]
                expect(s.curLev()).to.equal(null)
                expect([...s.one()].length).to.equal(0)
                expect([...s.sub()].length).to.equal(0)
                expect(toStr(j)).to.equal("{console.log(i);console.log(j);}")
              }
            }
            expect(s.curLev().type).to.equal(Tag.VariableDeclaration)
            expect(s.cur().type).to.equal(Tag.VariableDeclaration)
            const j = [
              s.enter(Tag.top,Tag.BlockStatement),
              s.enter(Tag.body,Tag.Array),
              ...s.sub(),
              ...s.leave(), ...s.leave()]
            expect(toStr(j)).to.equal("{let k=i+j;console.log(k);}")
            expect(s.cur().type).to.equal(Tag.Array)
            expect(s.curLev()).to.equal(null)
            expect([...s.sub()].length).to.equal(0)
            expect([...s.one()].length).to.equal(0)
          }
        }
      }
    }
    expect(cnt).to.equal(1)
  })
  context("with peel",function() {
    it("should manage input levels", function() {
      let cnt = 0
      const Stream = Kit.Stream({level:true,output:true,peel:true})
      const s = new Stream(produce(parse(prog)))
      expect(s.cur().type).to.equal(Tag.File)
      const i = [...(function* (){
        const exit = s.label()
        yield s.peel()
        expect(s.cur().type).to.equal(Tag.Program)
        yield s.peel()
        yield* s.peelTo(Tag.body)
        expect(s.cur().type).to.equal(Tag.FunctionDeclaration)
        yield s.peel()
        yield* s.peelTo(Tag.body)
        expect(s.cur().type).to.equal(Tag.Array)
        yield* s.peelTo(Tag.body)
        expect(s.cur().type).to.equal(Tag.VariableDeclaration)
        yield* s.one()
        const iflab = s.label()
        expect(s.cur().type).to.equal(Tag.BlockStatement)
        const j = s.peel()
        expect(s.cur().type).to.equal(Tag.Array)
        yield j
        yield* s.peelTo(Tag.body)
        expect(s.curLev().pos).to.equal(Tag.push)
        yield s.enter(Tag.push,Tag.IfStatement)
        yield s.tok(Tag.test,T.identifier("i"))
        yield s.enter(Tag.consequent,Tag.BlockStatement)
        yield s.enter(Tag.body,Tag.Array)
        yield* s.sub()
        yield* iflab()
        yield* s.sub()
        yield* exit()
      }())]
      expect(toStr(i)).to.equal(compact(`function a(){
        const i=10,j=20;
        {
            if(i) {
              console.log(i);
              console.log(j);
            }
        }
        let k=i+j;
        console.log(k);
      }`))
      let sn = new Stream(i)
      for(const j of sn) {
        if (j.pos === Tag.test) {
          cnt++
          sn.peel(j)
          expect([...sn.sub()].length).to.equal(0)
          Kit.skip(sn.leave())
          expect([...sn.sub()].length).to.equal(32)
        }
      }
      sn = new Stream(i)
      for(const j of sn) {
        if (j.pos === Tag.test) {
          cnt++
          expect([...sn.sub()].length).to.equal(32)
        }
      }
      expect(cnt).to.equal(2)
    })
  })
})


describe("template",function() {
  const s = Kit.output()
  it("should fill the placeholders", function() {
    function* gen() {
      const s = Kit.output()
      const fpos = yield* s.template(Tag.top,`
        function $_(a,$_) {
          $_
          console.log($_)
          $E
        }
      `)
      yield s.tok(fpos,T.identifier("F"))
      yield s.tok((yield* s.refocus()),T.identifier("X"))
      yield* s.toks((yield* s.refocus()),`*
                              console.log("hi")
                              console.log("there")`)
      yield* s.toks((yield* s.refocus()),`=a + b`)
      yield* s.toks((yield* s.refocus()),`=a = b`)
      yield* s.leave()
    }
    const res = 'function F(a,X){console.log("hi");'+
        'console.log("there");console.log(a+b);a=b;}'
    expect(toStr(gen())).to.equal(res)
    expect(toStr(gen())).to.equal(res)
  })
})
