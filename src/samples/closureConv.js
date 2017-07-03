import {produce,consume,Tag,symbol} from "../core"
import * as Kit from "../kit"
import * as Scope from "../scope"
import * as R from "ramda"
import * as assert from "assert"

function* replaceCalls(si) {
  const s = Kit.auto(si)
  function* walk(sw) {
    for(const i of s.sub()) {
      yield i
      if (i.enter && i.type === Tag.CallExpression) {
          const lab = s.label()
          const j = s.curLev()
          yield s.enter(Tag.callee,Tag.MemberExpression)
          let sym
          switch(j.type) {
          case Tag.Identifier:
            sym = j.value.sym
            yield* Kit.reposOne(s.one(), Tag.object)
            break
          default:
            yield s.enter(Tag.object,Tag.AssignmentExpression,
                          {node:{operator:"="}})
            sym = yield* Scope.emitTempVar()
            yield s.tok(Tag.left, Tag.Identifiier, {sym})
            yield* Kit.reposOne(walk(s.one()), Tag.right)
            yield* s.leave()
          }
          yield s.tok(Tag.property,Tag.Identifier,{node:{name:"call"}})
          yield s.peel()
          yield s.tok(Tag.push,Tag.Identifier,{sym})
          yield* lab()
          break
      }
    }
  }
  yield s.peel()
  yield* walk(s.cur().value.tempVars = [])
  yield* s.leave()
}

function calcClosCapt(si) {
  const sa = Kit.toArray(si)
  const s = Kit.auto(sa)
  function walk(root,sw) {
    root.decls = []
    root.closCapt = new Set()
    for(const i of sw) {
      if (i.enter) {
        switch(i.type) {
        case Tag.FunctionDeclaration:
          walk(root,s.one())
        case Tag.FunctionExpression:
          walk(i.value)
          break
        case Tag.Identifier:
          const si = i.value.sym
          if (si != null) {
            if (i.value.decl)
              root.decls.push(si)
            if (si.declScope !== root) {
              (si.refScopes || (si.refScopes = new Set())).add(root)
              root.closCapt.add(si)
            }
          }
        }
      }
    }
  }
  walk()
  return sa;
}

function* functToObj(si) {
  const s = Kit.auto(si)
  const hoisted = []
  const subst = new Map()
  const rtSym = new Scope.newSym("RT")
  function* walk(sw,root) {
    const decls = []
    for(const i of sw) {
      if (i.enter) {
        switch(i.type) {
          // TODO: parameters too!!
        case Tag.VariableDeclaration:
          const vlab = s.label()
          if (i.pos === Tag.push) {
            yield s.enter(Tag.push, Tag.ExpressionStatement)
            yield s.enter(Tag.expression, Tag.SequenceExpression)
            yield s.enter(Tag.expressions, Tag.Array)
          }
          for(const j of s.sub()) {
            if (j.enter) {
              for(const j of s.sub()) {
                const id = [...s.one()]
                const sym = id[0].value.sym
                if (s.curLev() != null) {
                  yield* s.template(i.pos,"=$I = $_",sym)
                  yield* Kit.reposOne(walk(s.one()),Tag.right)
                  yield* s.leave()
                }
              }
            }
          }
          yield* vlab()
          break
        case Tag.FunctionDeclaration:
          const decl = true
        case Tag.FunctionExpression:
          const capt = i.value.closCapt
          const ctx = i.value.ctx = new Set()
          const sym = Scope.newSym(
            i.value.node.id && i.value.node.id.name || "fn")
          if (capt && capt.size) {
            const tmp = yield* Scope.emitTempVar()
            yield* s.template(i.pos,"=($1 = new $2(), $_, $1)", tmp, sym)
            for(const j of capt) {
              yield* s.template(Tag.push,"=$I.$I = $_",tmp,j)
              yield* Kit.reposOne(walk(s.one(),Tag.right))
              yield* s.leave()
            }
            yield* s.leave()
            hoisted.push([...obj(i.value,sym)])
          }
          continue
        }
      }
      yield i
    }
  }
  function* obj(fun,sym) {
    yield* s.template(
      Tag.push,"function $1(){}; closure($1, function $1() { $_ });",sym)
    yield* walk()
    yield* s.leave()
  }
  const topLab = s.label()
  yield s.peel()
  yield s.peelTo(Tag.body)
  const buf = [...walk(s)]
  for(const i of hoisted)
    yield* i
  yield* buf
  yield* topLab()
}

// for each Identifier
// if sym from root and clos capt, replcing to reference to local thing
// the local thing if used is replaced to something?

