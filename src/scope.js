import * as Kit from "./kit"
import * as R from "ramda"
import {Tag,TypeInfo as TI,symbol,tok} from "./core"

export const assignSymols = R.pipe(
  function* assignSymbolsDecls(s) {
    s = Kit.auto(s)
    function* scope(root,par) {
      const dict = root.vars = {}
      const ctx = root.ctx = Object.create(par)
      const topLocals = root.locals = {}
      const params = root.params = {}
      for(const i of s.sub()) {
        yield i
        if (i.enter) {
          switch(i.pos) {
          case Tag.body:
            const locals = i.value.locals = {}
            yield* block(ctx,locals)
            break
          case Tag.params:
            for(const j of s.sub()) {
              yield j
              if (j.type === Tag.Identifier) {
              const n = j.value.node.name
                const s = Symbol(n)
                ctx[n] = s
                params[s] = true
                dict[s] = j.value
              }
            }
            break
          }
        }
      }
      function* block(ctx,locals) {
        for(const i of s.sub()) {
          yield i
          if (i.enter) {
            switch(i.type) {
            case Tag.VariableDeclarator:
              for(const j of s.one()) {
                if (j.enter && j.type === Tag.Identifier) {
                  const n = j.value.node.name
                  const s = Symbol(n)
                  ctx[n] = s
                  locals[s] = true
                  dict[s] = j.value
                }
              }
              break
            case Tag.BlockStatement:
              yield* block(i.value.ctx = Object.create(ctx))
              break
            case Tag.FunctionExpression:
            case Tag.ArrowFunctionExpression:
            case Tag.FunctionDeclaration:
            case Tag.ObjectMethod:
            case Tag.ClassMethod:
              yield* scope(i.value,ctx)
              break
            }
          }
        }
      }
    }
    const i = s.peel()
    yield i
    yield* scope(i.value,{})
    yield* s.leave()
  },
  Array.from,
  function assignSymbolsUse(s) {
    let ctx = {}
    for(const i of s) {
      if (i.enter && i.type === Tag.Identifier && i.value.expr) {
        const s = i.value.sym = ctx[i.value.node.name]
        i.value.global = s == null
      }
      if (i.value.ctx != null) {
        ctx = i.leave ? i.value.ctx : Object.getPrototypeOf(i.value.ctx)
      }
    }
    return s
  })

function makeUniqStore() {
  let cur = 0
  return (like) => {
    const name = `uniq_id_${cur++}`, sym = Symbol(name)
    return {node:{name},typeInfo:TI.identifier,sym,like}
  }
}

export function uniq(s) {
  return s.first._uniqIdsStore || (s.first._uniqIdsStore = makeUniqStore())
}

/**
 * for declarations with same name but different symbol creates another symbol
 */
export function uniqNames(s) {
  
  s = Kit.auto(s)
  function* block(store) {
    for(const i of s) {
      switch(i.type) {
      case Tag.Identifier:
        if (i.sym) {
        }
      }
    }
  }
}

// first get constraints - used in same scope
// next resolves them (prefer original names)

