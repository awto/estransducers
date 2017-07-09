import {Tag} from "../core"
import * as Kit from "../kit"
import * as Trace from "../trace"
import dump from "../dump"
import * as Scope from "../scope"
import * as R from "ramda"
import * as RT from "../rt"

import {symbol,produce} from "../core"

/** calculates captured vars dependencies */
function calcClosCapt(si) {
  const sa = Kit.toArray(si)
  const s = Kit.auto(sa)
  const closureSym = s.first.closureSym = Scope.newSym("closure")
  s.first.rt.syms.push(closureSym)
  function walk(root,sw) {
    const decls = root.decls = []
    const sym = root.closSym
          = Scope.newSym(root.node.id && root.node.id.name || "fn")
    const closDeps = new Set()
    function id(i) {
      const si = i.value.sym
      if (si != null) {
        if (si === Scope.argumentsSym && !root.argumentsSym) {
          root.argumentsSym = Scope.newSym("args")
          return
        }
        if (i.value.decl)
          decls.push(si)
        if (si.declScope) {
          if (si.declScope !== root)  {
            (si.refScopes || (si.refScopes = new Set())).add(root)
            closDeps.add(si.declScope)
          }
        }
      }
    }
    for(const i of sw) {
      if (i.enter) {
        switch(i.type) {
        case Tag.FunctionDeclaration:
          id(s.cur())
          Kit.skip(s.one())
        case Tag.FunctionExpression:
          walk(i.value,s.sub())
          break
        case Tag.Identifier:
          id(i)
          break
        }
      }
    }
    root.closDeps = [...closDeps].sort((a,b) => a.closSym.num - b.closSym.num)
  }
  walk(s.first.value,s)
  return sa;
}

/** replaces function calls, to call method */
function replaceCalls(si) {
  const s = Kit.auto(si)
  function* walk(sw,decls) {
    for(const i of sw) {
      if (i.enter) {
        switch(i.type) {
        case Tag.FunctionDeclaration:
        case Tag.FunctionExpression:
          yield i
          yield* walk(s.sub(),i.value.decls)
          continue
        case Tag.NewExpression:
        case Tag.CallExpression:
          const j = s.curLev()
          const lab = s.label()
          const constr = i.type === Tag.NewExpression
          yield s.peel(Kit.setType(i, Tag.CallExpression))
          yield s.enter(Tag.callee,Tag.MemberExpression)
          let sym
          if (j.type === Tag.MemberExpression) {
            s.take()
            yield s.enter(Tag.object,j.type,j.value)
            const k = s.curLev()
            if (k.type === Tag.Identifier || constr) {
              yield* s.one()
              sym = k.value.sym
            } else {
              decls.push(sym = Scope.newSym("temp"))
              yield* s.template(k.pos,"=$I = $_", sym)
              yield* Kit.reposOne(walk(s.one(),decls), Tag.right)
              yield* s.leave()
            }
            yield* walk(s.one(),decls)
            yield* s.leave()
            s.close(j)
          } else {
            sym = Scope.undefinedSym
            yield* Kit.reposOne(walk(s.one()), Tag.object)
          }
          yield s.tok(Tag.property,Tag.Identifier,
                      {node:{name:constr?"constr":"call"}})
          yield* s.leave()
          yield s.peel()
          if (!constr)
            yield s.tok(Tag.push,Tag.Identifier,{sym})
          yield* walk(s.sub(),decls)
          yield* s.leave()
          yield* lab()
          continue
        }
      }
      yield i
    }
  }
  return walk(s,s.first.value.decls)
}

const selfSym = Scope.newSym("self")

function* functToObj(si) {
  const s = Kit.auto(si)
  const hoisted = []
  const blockHoisted = []
  const rtSym = new Scope.newSym("RT")
  const closSym = s.first.closureSym
  function* walk(sw,root) {
    function* func(i,pos) {
      const sym = i.value.closSym
      yield* s.template(pos, "=new $I($_)", sym)
      for(const j of i.value.closDeps) {
        if (j === root)
          yield s.tok(Tag.push,Tag.ThisExpression)
        else
          yield* s.toks(Tag.push,"=this.$I",j.closSym)
      }
      yield* s.leave()
      hoisted.push(Kit.toArray(obj(i.value,sym)))
      s.close(i)
    }
    for(const i of sw) {
      if (i.enter) {
        switch(i.type) {
        case Tag.BlockStatement:
          yield i
          yield* s.peelTo(Tag.body)
          const buf = Kit.toArray(walk(s.sub(),root))
          for(const j of blockHoisted)
            yield* j
          blockHoisted.length = 0
          yield *buf
          yield* s.leave()
          continue
        case Tag.ThisExpression:
          yield s.tok(i.pos,Tag.Identifier,{sym:selfSym})
          s.close(i)
          continue
        case Tag.VariableDeclaration:
          const vlab = s.label()
          if (i.pos === Tag.push) {
            yield s.enter(Tag.push, Tag.ExpressionStatement)
            yield s.enter(Tag.expression, Tag.SequenceExpression)
            yield s.enter(Tag.expressions, Tag.Array)
          }
          let sym
          for(const j of s.sub()) {
            if (j.enter) {
              for(const j of s.sub()) {
                const id = Kit.toArray(s.one())
                sym = id[0].value.sym
                if (s.curLev() != null) {
                  yield* s.template(i.pos,"=$I = $_",sym)
                  yield* Kit.reposOne(walk(s.one(),root), Tag.right)
                  yield* s.leave()
                }
                s.close(j)
              }
            }
          }
          yield* vlab()
          if (i.pos !== Tag.push)
            yield s.tok(i.pos,Tag.Identifier,{sym})
          s.close(i)
          continue
        case Tag.FunctionDeclaration:
          blockHoisted.push(Kit.toArray(function*(i) {
            yield* s.template(i.pos, "$I = $_", s.curLev().value.sym)
            yield* func(i, Tag.right)
            yield* s.leave()
          }(i)))
          continue
        case Tag.FunctionExpression:
          yield* func(i, i.pos)
          continue
        }
      }
      yield i
    }
  }
  function* obj(fun,sym) {
    const lab = s.label()
    yield* s.template(Tag.push,"*function $1($_){$_} $2($1, $_)",sym,closSym)
    for(const j of fun.closDeps)
      yield s.tok(Tag.push,Tag.Identifier,{sym:j.closSym})
    yield* s.refocus()
    for(const j of fun.closDeps)
      yield* s.toks(Tag.push,"this.$1 = $1",j.closSym)
    yield* s.refocus()
    yield s.enter(Tag.push,Tag.FunctionExpression,fun)
    yield* walk(s.sub(),fun)
    yield* lab()
  }
  yield* s.till(i => i.type === Tag.Array && i.pos === Tag.body)
  const buf = Kit.toArray(walk(s,s.first.value))
  for(const i of hoisted)
    yield* i
  for(const i of blockHoisted)
    yield* i
  yield* buf
  yield* s
}

function substIds(si) {
  const s = Kit.auto(si)
  function* emitDecls({decls,argumentsSym}) {
    decls = decls.filter(i => !i.param && !i.refScopes)
    yield* s.till(i => i.pos === Tag.body && i.type === Tag.Array)
    if (decls.length || argumentsSym) {
      const lab = s.label()
      yield s.enter(Tag.push,Tag.VariableDeclaration,{node:{kind:"var"}})
      yield s.enter(Tag.declarations,Tag.Array)
      if (argumentsSym) {
        yield s.enter(Tag.push,Tag.VariableDeclarator)
        yield s.tok(Tag.id,Tag.Identifier,{sym:argumentsSym})
        yield* s.toks(Tag.init,"=Array.from(arguments).slice(1)")
        yield* s.leave()
      }
      for(const sym of decls) {
        yield s.enter(Tag.push,Tag.VariableDeclarator)
        yield s.tok(Tag.id,Tag.Identifier,{sym})
        yield* s.leave()
      }
      yield* lab()
    }
  }
  function* walk(root) {
    for(const i of s.sub()) {
      if (i.enter) {
        switch(i.type) {
        case Tag.FunctionExpression:
          yield i
          yield* s.till(i => i.pos === Tag.params)
          yield s.tok(Tag.push,Tag.Identifier,{sym:selfSym})
          yield* emitDecls(i.value)
          yield* walk(i.value)
          continue
        case Tag.File:
          yield i
          yield* emitDecls(i.value)
          continue
        case Tag.Identifier:
          const {sym} = i.value
          if (sym && i.pos !== Tag.property) {
            if (sym === Scope.argumentsSym) {
              i.value.sym = root.argumentsSym
            } else if (sym.refScopes) {
              if (root === sym.declScope)
                yield* s.toks(i.pos,"=this.$I",sym)
              else
                yield* s.toks(i.pos,"=this.$I.$I",sym.declScope.closSym,sym)
              s.close(i)
              continue
            }
          }
          break
        }
      }
      yield i
    }
  }
  return walk(s.first.value)
}

export default R.pipe(
  Scope.prepare,
  RT.setRT,
  calcClosCapt,
  replaceCalls,
  functToObj,
  substIds,
  RT.inlineRT,
  Scope.resolve)
