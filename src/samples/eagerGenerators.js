import {produce,consume,Tag} from "../core"
import * as Kit from "../kit"
import * as R from "ramda"
import * as T from "babel-types"
import * as assert from "assert"

const Stream = Kit.Stream({peel:true})
const SpecVars = {$:"SpecVars"}

export default R.pipe(
  function* transform(s) {
    s = Kit.auto(s)
    function* make(i) {
      i.value.generator = false
      const lab = s.label()
      yield* s.peelTo(Tag.body)
      yield* s.peelTo(Tag.body)
      yield s.enter(Tag.push,Tag.ReturnStatement)
      yield s.enter(Tag.argument,Tag.CallExpression)
      yield s.tok(Tag.callee,T.identifier("e$y$make"))
      yield s.enter(Tag.arguments,Tag.Array)
      yield s.enter(Tag.push,
                    Tag.FunctionExpression,
                    {node:
                     {id: {type: "Identifier",
                           name: i.value.id != null
                           ? `${i.value.id.name}Impl`
                           : "EagerGen"},
                      params:[{type:"Identifier",name:"e$y$buf"}]}})
      yield s.enter(Tag.body,Tag.BlockStatement)
      yield s.enter(Tag.body,Tag.Array)
      yield* walk()
      yield* lab()
    }
    function* walk() {
      for(const i of s.sub()) {
        switch(i.type) {
        case Tag.YieldExpression:
          if (i.enter) {
            const lab = s.label()
            yield s.enter(i.pos,Tag.CallExpression)
            yield s.tok(Tag.callee,
                        T.identifier(i.value.delegate ? "e$y$star" : "e$y"))
            yield s.enter(Tag.arguments,Tag.Array)
            yield s.tok(Tag.push,T.identifier("e$y$buf"))
            yield s.enter(Tag.push,Kit.Subst)
            yield* walk()
            yield* lab()
          }
          continue
        case Tag.FunctionExpression:
        case Tag.ArrowFunctionExpression:
        case Tag.FunctionDeclaration:
          if (i.enter && i.value.generator) {
            yield* make(i)
          }
        }
        yield i
      }
    }
    for(const i of s) {
      yield i
      switch(i.type) {
      case Tag.FunctionExpression:
      case Tag.ArrowFunctionExpression:
      case Tag.FunctionDeclaration:
        if (i.enter) {
          if (!i.value.generator)
            break
          if (Kit.hasAnnot(i.value,"@LAZY")) {
            yield* s.sub()
            break
          }
          yield* make(i)
        }
      }
    }
  },
  Kit.completeSubst)

